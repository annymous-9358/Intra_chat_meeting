// Shared chat API used by both the Netlify Function and the local LAN server.
// Storage is a tiny key/value interface: list(prefix) -> keys[], get(key), set(key, value), del(key).
import crypto from 'node:crypto';
import { getVapid, cleanSubscription, notifyMembers, notifyUser, wakeWalkie } from './push.mjs';
import { gameRoute, loadGame, gameView } from './games.mjs';

const MAX_TEXT = 2000;
const KEEP_PER_ROOM = 300;     // older messages are pruned
const INITIAL_LOAD = 100;
const ONLINE_MS = 20_000;      // considered online if polled within this window
const STALE_MS = 5 * 60_000;   // presence entries removed after this
const TYPING_MS = 4_000;
const OVERLAP_MS = 10_000;    // re-send recent messages so late writes from parallel instances are never missed
let seq = 0;
const MAX_WAIT_MS = 7_000;     // long-poll hold time (Netlify sync functions time out at 10 s)
const CHECK_MS = 150;          // how often a waiting request checks for changes
const sleep = ms => new Promise(r => setTimeout(r, ms));
const newVersion = now => `${now}-${crypto.randomBytes(4).toString('hex')}`;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
const cleanRoom = s => clean(s, 30).toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'general';

const MAX_UPLOAD = 4 * 1024 * 1024;
const FILE_ID = /^[a-f0-9]{24}$/;
// Only these image/audio types are accepted, detected from the file's bytes (never trusted from the client)
function sniffMedia(b) {
  const at = (o, str) => b.length >= o + str.length && b.toString('latin1', o, o + str.length) === str;
  if (b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'audio/webm';   // Chrome/Firefox/Android recordings
  if (at(0, 'OggS')) return 'audio/ogg';
  if (at(4, 'ftyp')) return 'audio/mp4';                                                                       // Safari/iOS recordings (m4a)
  if (at(0, 'RIFF') && at(8, 'WAVE')) return 'audio/wav';
  if (at(0, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && b.length > 4 && !(b[1] === 0xd8))) return 'audio/mpeg';
  return sniffImage(b);
}
function sniffImage(b) {
  if (b.length > 6 && b.toString('latin1', 0, 6).match(/^GIF8[79]a$/)) return 'image/gif';
  if (b.length > 8 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
// A GIF/image attached to a message: either one uploaded here or one from GIPHY
const GIPHY_URL = /^https:\/\/(media\d?\.giphy\.com|i\.giphy\.com)\/[\w\-./?=&%]+$/;
function cleanGif(g) {
  if (!g || typeof g.url !== 'string') return undefined;
  const local = g.url.match(/^\/api\/file\/([a-f0-9]{24})$/);
  if (!local && !GIPHY_URL.test(g.url)) return undefined;
  const dim = v => Math.min(Math.max(Math.round(Number(v) || 0), 0), 4000) || undefined;
  return { url: g.url, w: dim(g.w), h: dim(g.h), title: clean(g.title, 80) || undefined };
}

const LOCAL_FILE = /^\/api\/file\/([a-f0-9]{24})$/;
function cleanAudio(a) {
  if (!a || typeof a.url !== 'string' || !LOCAL_FILE.test(a.url)) return undefined;
  const dur = Math.round(Math.min(Math.max(Number(a.dur) || 0, 0), 600) * 10) / 10;
  const peaks = Array.isArray(a.peaks) ? a.peaks.slice(0, 48).map(v => Math.min(Math.max(Math.round(Number(v) || 0), 0), 100)) : undefined;
  return { url: a.url, dur, peaks, walkie: a.walkie === true || undefined };
}

// ---------- Location groups ----------
// A group (room) can have a geofence: the admin sets a centre and a radius. Members inside the radius can chat;
// members outside stay in the group read-only until the admin approves their request.
const MIN_RADIUS = 50, MAX_RADIUS = 50_000;
const ACCURACY_SLACK = 150;    // GPS accuracy (m) we forgive when deciding "inside"
function cleanLoc(l) {
  if (!l || typeof l !== 'object') return null;
  const lat = Number(l.lat), lng = Number(l.lng), acc = Number(l.acc);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, acc: Number.isFinite(acc) ? Math.min(Math.max(acc, 0), 100_000) : 0 };
}
function distanceM(a, b) {
  const R = 6371e3, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const deviceId = secret => typeof secret === 'string' && /^[a-f0-9]{32,64}$/.test(secret)
  ? crypto.createHash('sha256').update(secret).digest('hex').slice(0, 24) : null;


// ---------- Accounts ----------
// People sign up with a username, a display name and a password. A session token (kept in the browser) proves who
// they are; the server fills in names itself, so nobody can post as someone else. Passwords are scrypt-hashed.
const USERNAME = /^[a-z0-9_.]{3,20}$/;
const ID = /^[a-f0-9]{24}$/;
const sha256 = v => crypto.createHash('sha256').update(String(v)).digest('hex');
const hashPassword = (pw, salt = crypto.randomBytes(16).toString('hex')) => ({ salt, hash: crypto.scryptSync(String(pw), salt, 32).toString('hex') });
const checkPassword = (pw, rec) => !!rec && crypto.timingSafeEqual(Buffer.from(hashPassword(pw, rec.salt).hash, 'hex'), Buffer.from(rec.hash, 'hex'));
// A status ("🏖️ On leave") disappears by itself after its end time
const activeStatus = st => st && (st.emoji || st.text) && (!st.until || st.until > Date.now()) ? { emoji: st.emoji || '', text: st.text || '', until: st.until || 0 } : null;
const publicUser = u => u && { uid: u.uid, username: u.username, name: u.name, photo: u.photo || null, about: u.about || '', status: activeStatus(u.status) };
const bearer = req => (req.headers.get('authorization') || '').match(/^Bearer ([a-f0-9]{64})$/)?.[1] || null;
async function sessionUser(store, req) {
  const t = bearer(req); if (!t) return null;
  const s = await store.get(`ss/${sha256(t)}`); if (!s?.uid) return null;
  return await store.get(`u/${s.uid}`);
}
async function newSession(store, uid) {
  const t = crypto.randomBytes(32).toString('hex');
  await store.set(`ss/${sha256(t)}`, { uid, at: Date.now() });
  return t;
}

async function authRoute(action, { store, req, body, user }) {
  const now = Date.now();
  if (action === 'signup') {
    const username = clean(body.username, 20).toLowerCase();
    const name = clean(body.name, 24).replace(/\s+/g, ' ');
    const password = typeof body.password === 'string' ? body.password : '';
    if (!USERNAME.test(username)) return json({ error: 'Usernames are 3–20 characters: letters, numbers, dots or underscores', field: 'username' }, 400);
    if (!name) return json({ error: 'Enter the name people will see', field: 'name' }, 400);
    if (password.length < 6 || password.length > 128) return json({ error: 'Use a password of at least 6 characters', field: 'password' }, 400);
    if (await store.get(`un/${username}`)) return json({ error: 'That username is taken — try another', field: 'username' }, 409);
    const uid = crypto.randomBytes(12).toString('hex');
    const u = { uid, username, name, pw: hashPassword(password), created: now };
    await store.set(`u/${uid}`, u);
    await store.set(`un/${username}`, { uid });
    return json({ token: await newSession(store, uid), user: publicUser(u) });
  }
  if (action === 'login') {
    const username = clean(body.username, 20).toLowerCase().replace(/^@/, '');
    const lf = (await store.get(`lf/${username}`)) || { n: 0, until: 0 };
    if (lf.until > now) return json({ error: 'Too many wrong attempts — try again in a few minutes' }, 429);
    const ref = USERNAME.test(username) && await store.get(`un/${username}`);
    const u = ref && await store.get(`u/${ref.uid}`);
    if (!u || !checkPassword(String(body.password || ''), u.pw)) {
      await sleep(400);
      const n = lf.n + 1;
      await store.set(`lf/${username}`, { n, until: n >= 5 ? now + 5 * 60_000 : 0 });
      return json({ error: 'Wrong username or password', field: 'password' }, 401);
    }
    if (lf.n) await store.del(`lf/${username}`);
    return json({ token: await newSession(store, u.uid), user: publicUser(u) });
  }
  if (!user) return json({ error: 'Please sign in', code: 'auth' }, 401);
  if (action === 'me') return json({ user: publicUser(user) });
  if (action === 'logout') { const t = bearer(req); if (t) await store.del(`ss/${sha256(t)}`); return json({ ok: true }); }
  if (action === 'update') {
    if (body.about !== undefined) user.about = clean(body.about, 140);
    if (body.status !== undefined) {
      const st = body.status;
      user.status = st && (st.emoji || st.text) ? { emoji: clean(st.emoji, 20), text: clean(st.text, 60), until: Math.max(0, Math.min(Number(st.until) || 0, 8.64e15)) } : null;
    }
    if (body.photo === null && user.photo) {
      const id = user.photo.match(LOCAL_FILE)?.[1]; if (id) await store.delFile(`f/${id}`);
      user.photo = null;
    }
    if (body.name !== undefined) {
      const name = clean(body.name, 24).replace(/\s+/g, ' ');
      if (!name) return json({ error: 'Your name can’t be empty' }, 400);
      user.name = name;
    }
    if (body.newPassword !== undefined) {
      if (!checkPassword(String(body.password || ''), user.pw)) return json({ error: 'Your current password isn’t right', field: 'password' }, 401);
      if (String(body.newPassword).length < 6) return json({ error: 'Use at least 6 characters', field: 'newPassword' }, 400);
      user.pw = hashPassword(body.newPassword);
    }
    await store.set(`u/${user.uid}`, user);
    return json({ user: publicUser(user) });
  }
  return json({ error: 'Not found' }, 404);
}

// ---------- Groups: admin, access, members ----------
const isGeo = g => !!g?.center;
// Admin is an account. Groups made before accounts existed belong to the device that created them,
// until someone signs in on that device — then that account becomes the admin.
// The owner (g.adminUid, the creator) is always an admin and can't be removed; they and other admins can add more admins (g.admins).
const isOwnerOf = (g, user, dev) => !!g && ((g.adminUid && user?.uid === g.adminUid) || (!g.adminUid && !!dev && g.admin === dev));
const isAdminOf = (g, user, dev) => isOwnerOf(g, user, dev) || (!!g && !!user && Array.isArray(g.admins) && g.admins.includes(user.uid));
const isAdminUid = (g, uid) => !!g && (uid === g.adminUid || (Array.isArray(g.admins) && g.admins.includes(uid)));
async function claimLegacyAdmin(store, room, g, user, dev) {
  if (g && !g.adminUid && user && dev && g.admin === dev) { g.adminUid = user.uid; g.adminName = user.name; await store.set(`g/${room}`, g); }
}
async function hasAccess(store, g, room, user, dev) {
  if (g?.dm) return !!user && g.members.includes(user.uid);      // 1:1 chats: only the two people
  if (g?.invite) return !!user && (isAdminOf(g, user, dev) || !!(await store.get(`iv/${room}/${user.uid}`)));   // invite-only: members only
  if (!g?.pw) return true;
  if (isAdminOf(g, user, dev)) return true;
  const a = user && await store.get(`ga/${room}/${user.uid}`);
  return !!a && a.v === g.pw.v;            // joined with the current password
}
const groupView = (g, user, dev) => g && { photo: g.photo || null, title: g.title, geo: isGeo(g), locked: !!g.pw, invite: !!g.invite, inviteCode: g.invite && isAdminOf(g, user, dev) ? g.invite.code : undefined, radius: isGeo(g) ? g.radius : null, adminName: g.adminName || null, adminUid: g.adminUid || null, admins: g.admins || [], isAdmin: isAdminOf(g, user, dev), isOwner: isOwnerOf(g, user, dev) };
const previewOf = m => m.deleted ? 'Message deleted' : m.text ? m.text.slice(0, 90) : m.audio ? (m.audio.walkie ? 'Walkie-talkie' : 'Voice message') : m.gif ? 'GIF' : '';
async function saveRoomMeta(store, room, g, last) {
  const old = (await store.get(`r/${room}`)) || {};
  // the preview only moves forward (two quick sends can finish out of order)
  const keepOld = last && old.last?.key && old.last.key > last.key;
  const meta = { room, title: g?.title || old.title || null, geo: isGeo(g), locked: !!g?.pw, invite: !!g?.invite, radius: isGeo(g) ? g.radius : null, last: last === undefined || keepOld ? old.last || null : last };
  if (g?.photo) meta.photo = g.photo;
  if (g?.dm) { meta.dm = true; meta.members = g.members; meta.title = null; }
  await store.set(`r/${room}`, meta);
}


// ---------- Step challenge ----------
// sp/<uid>/<YYYY-MM-DD>: steps for a day (the phone's own date). sg/<uid>: personal daily goal.
// ch/<room>: a group's challenge { title, goal, days, teamKm, start (date), end (date), by }.
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STEP_M = 0.75;                                       // ~0.75 m per step
const dayShift = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5);
function cleanDay(d) {
  if (typeof d !== 'string' || !DAY.test(d)) return null;
  const today = new Date().toISOString().slice(0, 10), diff = daysBetween(today, d);
  return diff >= -7 && diff <= 1 ? d : null;               // your local "today" (± time zones), or up to a week back
}
async function stepDays(store, uid) {
  const keys = await store.list(`sp/${uid}/`), out = {};
  const old = dayShift(new Date().toISOString().slice(0, 10), -70);
  await Promise.all(keys.map(async k => { const d = k.split('/')[2]; if (d < old) return store.del(k); const r = await store.get(k); if (r) out[d] = r.steps || 0; }));
  return out;
}
const goalOf = async (store, uid) => (await store.get(`sg/${uid}`))?.goal || 8000;
function streakOf(days, today, goal) {
  let n = 0, d = (days[today] || 0) >= goal ? today : dayShift(today, -1);   // today counts once you reach it
  while ((days[d] || 0) >= goal) { n++; d = dayShift(d, -1); }
  return n;
}
function badgesOf(days, today, goal) {
  const vals = Object.values(days), total = vals.reduce((a, b) => a + b, 0), best = Math.max(0, ...vals), streak = streakOf(days, today, goal);
  let longest = 0, run = 0; for (const d of Object.keys(days).sort()) { if (days[d] >= goal && days[dayShift(d, -1)] >= goal) run++; else run = days[d] >= goal ? 1 : 0; longest = Math.max(longest, run); }
  const list = [
    ['first', 'First steps', 'Logged your first steps', vals.some(v => v > 0)],
    ['goal', 'Goal getter', 'Reached your daily goal', vals.some(v => v >= goal)],
    ['10k', '10K club', '10,000 steps in a day', best >= 10000],
    ['20k', 'Trailblazer', '20,000 steps in a day', best >= 20000],
    ['streak3', 'On a roll', '3-day goal streak', longest >= 3],
    ['streak7', 'Unstoppable', '7-day goal streak', longest >= 7],
    ['km42', 'Marathoner', '42 km walked in total', total * STEP_M >= 42195],
    ['km100', 'Explorer', '100 km walked in total', total * STEP_M >= 100000],
  ];
  return { streak, longest, total, best, badges: list.map(([id, name, desc, got]) => ({ id, name, desc, got })) };
}
const TEAM_STOPS = [[0, 'Start line'], [.25, 'First water stop'], [.5, 'Halfway camp'], [.75, 'Final climb'], [1, 'Finish line']];
async function stepsRoute(action, { store, body, room, group, user, isAdmin, push }) {
  const me = user.uid;
  const today = cleanDay(body.today) || new Date().toISOString().slice(0, 10);

  if (action === 'log') {
    const day = cleanDay(body.date || today); if (!day) return json({ error: 'Pick a day in the last week' }, 400);
    const n = Math.round(Number(body.steps));
    if (!(n >= 0 && n <= 100000)) return json({ error: 'Enter a number of steps between 0 and 100,000' }, 400);
    const k = `sp/${me}/${day}`, rec = (await store.get(k)) || { steps: 0, announced: [] };
    const before = rec.steps || 0;
    rec.steps = Math.min(100000, body.mode === 'add' ? before + n : n); rec.at = Date.now(); rec.src = body.mode === 'add' ? 'walk' : 'manual';
    // Celebrate in groups with a running challenge, once a day, when you cross that challenge's daily goal
    const announce = [];
    if (day === today && rec.steps > before) {
      for (const r of (await store.list('ch/')).map(k => k.slice(3))) {
        if ((rec.announced || []).includes(r)) continue;
        const [ch, mb] = await Promise.all([store.get(`ch/${r}`), store.get(`mb/${r}/${me}`)]);
        if (!ch || !mb || today < ch.start || today > ch.end || !(before < ch.goal && rec.steps >= ch.goal)) continue;
        announce.push([r, ch.goal]);
      }
      rec.announced = [...(rec.announced || []), ...announce.map(x => x[0])];
    }
    await store.set(k, rec);
    if (announce.length) {
      const days = await stepDays(store, me);
      for (const [r, goal] of announce) {
        const g = await store.get(`g/${r}`), streak = streakOf(days, today, goal);
        await postMessage(store, { room: r, group: g, user, sys: 'steps', text: `${user.name} hit the ${goal.toLocaleString('en-US')}-step goal today${streak > 1 ? ` · ${streak}-day streak` : ''}` }, push);
      }
    }
    return json({ ok: true, steps: rec.steps, celebrated: announce.length > 0 });
  }

  // Daily totals read on the phone (Health Connect on Android, Apple Health on iPhone) by the native app
  if (action === 'import') {
    const src = body.src === 'apple-health' ? 'apple-health' : 'health-connect';
    const days = {};
    for (const [d, v] of Object.entries(body.days && typeof body.days === 'object' ? body.days : {}).slice(0, 14)) {
      const day = cleanDay(d), n = Math.round(Number(v));
      if (day && n >= 0 && n <= 100000) days[day] = n;
    }
    const updated = await mergeStepDays(store, user, days, src, today, push);
    await store.set(`hi/${me}`, { src, at: Date.now(), today: days[today] ?? null });
    const rec = await store.get(`sp/${me}/${today}`);
    return json({ ok: true, updated, steps: rec?.steps || 0 });
  }

  if (action === 'goal') {
    const goal = Math.round(Number(body.goal));
    if (!(goal >= 1000 && goal <= 50000)) return json({ error: 'Choose a goal between 1,000 and 50,000 steps' }, 400);
    await store.set(`sg/${me}`, { goal });
    return json({ ok: true, goal });
  }

  if (action === 'me') {
    const [days, goal] = await Promise.all([stepDays(store, me), goalOf(store, me)]);
    const week = Array.from({ length: 7 }, (_, i) => { const d = dayShift(today, i - 6); return { date: d, steps: days[d] || 0 }; });
    return json({ today, steps: days[today] || 0, goal, week, ...badgesOf(days, today, goal) });
  }

  if (action === 'board') {
    const ch = await store.get(`ch/${room}`);
    const active = ch && today >= ch.start && today <= ch.end;
    const range = body.range === 'week' ? 'week' : body.range === 'challenge' && ch ? 'challenge' : 'today';
    const from = range === 'today' ? today : range === 'week' ? dayShift(today, -6) : ch.start;
    const to = range === 'challenge' ? (today < ch.end ? today : ch.end) : today;
    const memberKeys = await store.list(`mb/${room}/`);
    const members = (await Promise.all(memberKeys.map(k => store.get(k)))).filter(m => m?.uid);
    let teamSteps = 0;
    const rows = (await Promise.all(members.map(async m => {
      const u = await store.get(`u/${m.uid}`); if (!u) return null;
      const [days, pgoal] = await Promise.all([stepDays(store, m.uid), goalOf(store, m.uid)]);
      const goal = active ? ch.goal : pgoal;
      let sum = 0; for (let d = from; d <= to; d = dayShift(d, 1)) sum += days[d] || 0;
      if (ch) for (let d = ch.start; d <= (today < ch.end ? today : ch.end); d = dayShift(d, 1)) teamSteps += days[d] || 0;
      const cheer = await store.get(`cr/${room}/${m.uid}/${me}/${today}`);
      return { uid: m.uid, name: u.name, photo: u.photo || null, steps: sum, today: days[today] || 0, goal, hit: (days[today] || 0) >= goal, streak: streakOf(days, today, goal), cheered: !!cheer };
    }))).filter(Boolean).sort((a, b) => b.steps - a.steps || a.name.localeCompare(b.name));
    rows.forEach((r, i) => { r.rank = r.steps ? i + 1 : null; });
    let challenge = null;
    if (ch) {
      const km = teamSteps * STEP_M / 1000, pct = ch.teamKm ? Math.min(1, km / ch.teamKm) : 0;
      challenge = { ...ch, active, ended: today > ch.end, dayNo: Math.min(ch.days, daysBetween(ch.start, today) + 1), teamKm: ch.teamKm, km: Math.round(km * 10) / 10, pct,
        stops: TEAM_STOPS.map(([p, name]) => ({ p, name, reached: pct >= p })) };
    }
    return json({ today, range, rows, challenge, dm: !!group?.dm, canManage: !!isAdmin || !!group?.dm });
  }

  if (action === 'challenge') {
    // groups: admins run challenges; 1:1 chats: either friend can start or end a duel
    if (!isAdmin && !group?.dm) return json({ error: 'Only group admins can start or end a challenge' }, 403);
    if (body.end) { await store.del(`ch/${room}`); await store.set(`v/${room}`, { v: newVersion(Date.now()) }); return json({ ok: true }); }
    const goal = Math.round(Number(body.goal) || 8000), days = Math.round(Number(body.days) || 7), teamKm = Math.round(Number(body.teamKm) || 0);
    if (!(goal >= 1000 && goal <= 50000)) return json({ error: 'Daily goal: 1,000–50,000 steps' }, 400);
    if (!(days >= 1 && days <= 60)) return json({ error: 'Length: 1–60 days' }, 400);
    if (!(teamKm >= 0 && teamKm <= 100000)) return json({ error: 'Team distance: up to 100,000 km' }, 400);
    const ch = { title: clean(body.title, 40) || (group?.dm ? 'Step duel' : 'Step challenge'), goal, days, teamKm, start: today, end: dayShift(today, days - 1), by: user.name, at: Date.now() };
    await store.set(`ch/${room}`, ch);
    await postMessage(store, { room, group, user, sys: 'steps', text: `${user.name} ${group?.dm ? 'started a step duel' : 'started'} “${ch.title}”: ${goal.toLocaleString('en-US')} steps a day for ${days} day${days > 1 ? 's' : ''}${teamKm ? ` · team goal ${teamKm} km` : ''}` }, push);
    return json({ ok: true, challenge: ch });
  }

  if (action === 'cheer') {
    const uid = typeof body.uid === 'string' && ID.test(body.uid) ? body.uid : null;
    if (!uid || uid === me) return json({ error: 'Pick a teammate' }, 400);
    if (!(await store.get(`mb/${room}/${uid}`))) return json({ error: 'They’re not in this group' }, 404);
    const k = `cr/${room}/${uid}/${me}/${today}`;
    if (await store.get(k)) return json({ error: 'You already cheered them today', code: 'done' }, 429);
    await store.set(k, { at: Date.now() });
    const vapid = await getVapid(store, push.vapidEnv);
    const job = notifyUser(store, uid, { type: 'steps', room, title: `${user.name} is cheering you on`, body: 'Keep walking — you’ve got this!', url: `/#/g/${room}?a=steps` }, { vapid, sender: push.pushSender, siteOrigin: push.origin });
    if (push.waitUntil) push.waitUntil(job); else await job;
    return json({ ok: true });
  }
  return json({ error: 'Not found' }, 404);
}


// ---------- Google Health API: automatic step sync ----------
// The person connects once (Google OAuth, read-only "activity & fitness" scope). The server keeps their refresh token,
// and every ~30 minutes (scheduler) or on "Sync now" reads their daily step totals — phone steps (Health Connect),
// Fitbit / Pixel Watch and other connected apps — and stores the higher of that and what's already logged for each day.
const GH = { auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', revoke: 'https://oauth2.googleapis.com/revoke',
  api: 'https://health.googleapis.com/v4/users/me', scope: 'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly' };
const HEALTH_SYNC_MS = 30 * 60_000;
let healthFetch = (...a) => fetch(...a);
export const _setHealthFetch = f => { healthFetch = f; };      // tests
const ghConfigured = h => !!(h?.clientId && h?.clientSecret);
async function ghToken(h, params) {
  const r = await healthFetch(GH.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: h.clientId, client_secret: h.clientSecret, ...params }).toString() });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error_description || d.error || `Google sign-in failed (${r.status})`); e.code = d.error; throw e; }
  return d;
}
async function ghAccess(store, uid, h) {
  const rec = await store.get(`hc/${uid}`); if (!rec) throw Object.assign(new Error('Not connected'), { code: 'not_connected' });
  if (rec.access && rec.exp > Date.now() + 60_000) return { rec, access: rec.access };
  try {
    const t = await ghToken(h, { grant_type: 'refresh_token', refresh_token: rec.refresh });
    rec.access = t.access_token; rec.exp = Date.now() + (t.expires_in || 3600) * 1000;
    if (t.refresh_token) rec.refresh = t.refresh_token;
    rec.error = null; await store.set(`hc/${uid}`, rec);
    return { rec, access: rec.access };
  } catch (e) {
    if (e.code === 'invalid_grant') { rec.error = 'expired'; rec.access = null; await store.set(`hc/${uid}`, rec); throw Object.assign(new Error('Google Health access expired — tap Reconnect'), { code: 'expired' }); }
    throw e;
  }
}
const civil = (d, end) => { const [y, m, dd] = d.split('-').map(Number); return { date: { year: y, month: m, day: dd }, time: end ? {} : { hours: 0, minutes: 0, seconds: 0, nanos: 0 } }; };
const localToday = tzMin => new Date(Date.now() - (tzMin || 0) * 60_000).toISOString().slice(0, 10);
// Pull the last 7 days of daily step totals and merge them in. Returns { days, updated }.
// Merge daily totals from a tracker into the log: never lowers a day (walk mode / manual entries may be higher).
async function mergeStepDays(store, user, days, src, today, push) {
  let updated = 0;
  for (const [day, n] of Object.entries(days)) {
    const have = (await store.get(`sp/${user.uid}/${day}`))?.steps || 0;
    if (n > have) {
      const r = await stepsRoute('log', { store, body: { date: day, steps: n, today }, user, push: push || {} });
      if (r.status !== 200) continue;
      const k = `sp/${user.uid}/${day}`, sp = await store.get(k); if (sp) { sp.src = src; await store.set(k, sp); }
      updated++;
    }
  }
  return updated;
}
async function syncHealth(store, uid, h, push) {
  const { rec, access } = await ghAccess(store, uid, h);
  const today = localToday(rec.tz), start = dayShift(today, -6), end = dayShift(today, 1);
  const r = await healthFetch(`${GH.api}/dataTypes/steps/dataPoints:dailyRollUp`, { method: 'POST',
    headers: { authorization: `Bearer ${access}`, accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ range: { start: civil(start), end: civil(end) }, windowSizeDays: 1 }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const reason = d?.error?.details?.find?.(x => x.reason)?.reason;
    rec.error = reason === 'ACCOUNT_NOT_LINKED' ? 'not_linked' : `api_${r.status}`; rec.lastTry = Date.now(); await store.set(`hc/${uid}`, rec);
    throw Object.assign(new Error(reason === 'ACCOUNT_NOT_LINKED' ? 'Your Google account isn’t linked to Google Health yet — open the Google Health app and sign in, then try again' : d?.error?.message || `Google Health error (${r.status})`), { code: rec.error });
  }
  const user = await store.get(`u/${uid}`);
  const days = {};
  for (const p of d.rollupDataPoints || []) {
    const dt = p.civilStartTime?.date; if (!dt) continue;
    const key = `${dt.year}-${String(dt.month).padStart(2, '0')}-${String(dt.day).padStart(2, '0')}`;
    days[key] = Math.min(100000, Math.round(Number(p.steps?.countSum) || 0));
  }
  const updated = user ? await mergeStepDays(store, user, days, 'google', today, push) : 0;
  rec.lastSync = Date.now(); rec.lastTry = rec.lastSync; rec.error = null; rec.lastToday = days[today] ?? null;
  await store.set(`hc/${uid}`, rec);
  return { days, updated, today: days[today] ?? 0 };
}
export async function syncAllHealth(store, h, push) {
  if (!ghConfigured(h)) return 0;
  let n = 0;
  for (const k of await store.list('hc/')) {
    const rec = await store.get(k);
    if (!rec || rec.error === 'expired' || Date.now() - (rec.lastTry || 0) < HEALTH_SYNC_MS) continue;
    try { await syncHealth(store, k.slice(3), h, push); n++; } catch {}
  }
  return n;
}
async function healthRoute(action, { store, body, user, health, origin, push }) {
  const me = user.uid;
  if (action === 'status') {
    const rec = await store.get(`hc/${me}`);
    return json({ configured: ghConfigured(health), connected: !!rec, lastSync: rec?.lastSync || 0, error: rec?.error || null, today: rec?.lastToday ?? null });
  }
  if (!ghConfigured(health)) return json({ error: 'Google Health sync isn’t set up on this server yet', code: 'not_configured' }, 400);
  if (action === 'start') {
    const state = crypto.randomBytes(16).toString('hex');
    await store.set(`hs/${state}`, { uid: me, at: Date.now(), tz: Math.max(-840, Math.min(840, Math.round(Number(body.tz) || 0))) });
    const q = new URLSearchParams({ client_id: health.clientId, redirect_uri: `${origin}/api/health/callback`, response_type: 'code', scope: GH.scope,
      access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state });
    return json({ url: `${GH.auth}?${q}` });
  }
  if (action === 'sync') {
    const rec = await store.get(`hc/${me}`); if (!rec) return json({ error: 'Connect Google Health first', code: 'not_connected' }, 400);
    if (body.tz !== undefined) { rec.tz = Math.max(-840, Math.min(840, Math.round(Number(body.tz) || 0))); await store.set(`hc/${me}`, rec); }
    try { const r = await syncHealth(store, me, health, push); return json({ ok: true, ...r }); }
    catch (e) { return json({ error: e.message, code: e.code || 'sync_failed' }, e.code === 'expired' ? 401 : 502); }
  }
  if (action === 'disconnect') {
    const rec = await store.get(`hc/${me}`);
    if (rec?.refresh) await healthFetch(`${GH.revoke}?token=${encodeURIComponent(rec.refresh)}`, { method: 'POST' }).catch(() => {});
    await store.del(`hc/${me}`);
    return json({ ok: true });
  }
  return json({ error: 'Not found' }, 404);
}
async function healthCallback(req, store, health, push) {
  const url = new URL(req.url), back = (q) => new Response(null, { status: 302, headers: { location: `${url.origin}/#/steps?${new URLSearchParams(q)}` } });
  const state = url.searchParams.get('state') || '', code = url.searchParams.get('code');
  const st = /^[a-f0-9]{32}$/.test(state) && await store.get(`hs/${state}`);
  if (st) await store.del(`hs/${state}`);
  if (!st || Date.now() - st.at > 15 * 60_000) return back({ health: 'error', msg: 'That sign-in link expired — please try again' });
  if (url.searchParams.get('error')) return back({ health: 'error', msg: url.searchParams.get('error') === 'access_denied' ? 'You didn’t allow access' : 'Google sign-in was cancelled' });
  if (!code || !ghConfigured(health)) return back({ health: 'error', msg: 'Google Health sync isn’t set up on this server' });
  try {
    const t = await ghToken(health, { grant_type: 'authorization_code', code, redirect_uri: `${url.origin}/api/health/callback` });
    if (!t.refresh_token) return back({ health: 'error', msg: 'Google didn’t return offline access — please try again' });
    if (!String(t.scope || GH.scope).includes('activity_and_fitness')) return back({ health: 'error', msg: 'Please allow access to activity & fitness data' });
    const id = await healthFetch(`${GH.api}/identity`, { headers: { authorization: `Bearer ${t.access_token}`, accept: 'application/json' } });
    const idj = await id.json().catch(() => ({}));
    await store.set(`hc/${st.uid}`, { refresh: t.refresh_token, access: t.access_token, exp: Date.now() + (t.expires_in || 3600) * 1000,
      refreshExp: t.refresh_token_expires_in ? Date.now() + t.refresh_token_expires_in * 1000 : null, tz: st.tz, healthUserId: idj.healthUserId || null,
      connectedAt: Date.now(), error: id.ok ? null : 'not_linked' });
    if (!id.ok) return back({ health: 'error', msg: 'Connected, but your Google account isn’t linked to Google Health yet — install the Google Health app and sign in, then tap Sync now' });
    let today = 0; try { today = (await syncHealth(store, st.uid, health, push)).today; } catch {}
    return back({ health: 'ok', today });
  } catch (e) { return back({ health: 'error', msg: e.message }); }
}

// ---------- Stories ----------
// st/<uid>/<id>: a photo or text story shown to friends (or only "close friends") for 6–48 hours, with views,
// emoji reactions, an optional poll, and replies that arrive as a 1:1 message quoting the story.
const STORY_BGS = ['#00a884', '#7c3aed', '#e11d48', '#ea580c', '#0284c7', '#0f172a', '#16a34a', '#db2777', '#ca8a04', 'grad1', 'grad2', 'grad3'];
const STORY_FONTS = ['sans', 'serif', 'mono', 'hand', 'bold'];
const STORY_ID = /^\d{13}-[a-f0-9]{6}$/;
const STORY_REACTS = ['❤️', '😂', '😮', '😢', '👏', '🔥'];
async function liveStories(store, uid, now = Date.now()) {
  const keys = await store.list(`st/${uid}/`);
  const out = [];
  for (const k of keys.sort()) {
    const st = await store.get(k);
    if (!st) continue;
    if (st.until <= now) {                                  // expired: clean up
      await store.del(k);
      const id = st.url?.match(LOCAL_FILE)?.[1]; if (id) await store.delFile(`f/${id}`);
      continue;
    }
    out.push(st);
  }
  return out;
}
function storyFor(st, viewer) {
  const mine = st.uid === viewer;
  const view = { id: st.id, uid: st.uid, type: st.type, url: st.url || null, text: st.text || '', bg: st.bg || null, font: st.font || null, caption: st.caption || '',
    at: st.at, until: st.until, audience: st.audience, seen: mine || !!st.views?.[viewer], myReact: st.reacts?.[viewer] || null };
  if (st.poll) {
    const votes = Object.values(st.poll.votes || {}), myVote = st.poll.votes?.[viewer];
    const showCounts = mine || myVote !== undefined;
    view.poll = { q: st.poll.q, opts: st.poll.opts, myVote: myVote ?? null, counts: showCounts ? st.poll.opts.map((_, i) => votes.filter(v => v === i).length) : null };
  }
  if (mine) { view.views = Object.keys(st.views || {}).length; view.reacts = Object.keys(st.reacts || {}).length; }
  return view;
}
async function canSeeStory(store, st, viewerUid) {
  if (st.uid === viewerUid) return true;
  if ((await store.get(`fr/${st.uid}/${viewerUid}`))?.state !== 'friends') return false;
  if (st.audience === 'close') return ((await store.get(`cf/${st.uid}`)) || []).includes(viewerUid);
  return true;
}
async function storyRoute(action, { store, body, user, vapidEnv, waitUntil, pushSender, origin }) {
  const me = user.uid, now = Date.now();
  const ping = (uid, title, text, url = '/#/stories') => {
    const job = getVapid(store, vapidEnv).then(vapid => notifyUser(store, uid, { type: 'story', title, body: text, url }, { vapid, sender: pushSender, siteOrigin: origin }));
    if (waitUntil) waitUntil(job); else return job;
  };
  const findStory = async () => {
    const uid = typeof body.uid === 'string' && ID.test(body.uid) ? body.uid : me;
    const id = typeof body.id === 'string' && STORY_ID.test(body.id) ? body.id : null;
    const st = id && await store.get(`st/${uid}/${id}`);
    if (!st || st.until <= now || !(await canSeeStory(store, st, me))) return null;
    return st;
  };

  if (action === 'feed') {
    const friendKeys = await store.list(`fr/${me}/`);
    const rels = await Promise.all(friendKeys.map(k => store.get(k)));
    const friendIds = friendKeys.map((k, i) => rels[i]?.state === 'friends' ? k.split('/')[2] : null).filter(Boolean);
    const muted = (await store.get(`sm/${me}`)) || [];
    const people = [];
    for (const uid of [me, ...friendIds]) {
      const list = [];
      for (const st of await liveStories(store, uid, now)) if (await canSeeStory(store, st, me)) list.push(storyFor(st, me));
      if (!list.length && uid !== me) continue;
      const u = uid === me ? user : await store.get(`u/${uid}`);
      if (!u) continue;
      people.push({ uid, name: u.name, username: u.username, photo: u.photo || null, mine: uid === me, muted: muted.includes(uid),
        stories: list, allSeen: list.every(x => x.seen), latest: list.length ? list[list.length - 1].at : 0 });
    }
    const [mine, ...others] = people;
    others.sort((a, b) => a.muted - b.muted || a.allSeen - b.allSeen || b.latest - a.latest);
    return json({ people: [mine, ...others], closeFriends: (await store.get(`cf/${me}`)) || [], muted });
  }

  if (action === 'post') {
    const type = body.type === 'photo' ? 'photo' : 'text';
    const text = clean(body.text, 300), caption = clean(body.caption, 200);
    const url = typeof body.url === 'string' && LOCAL_FILE.test(body.url) ? body.url : null;
    if (type === 'text' && !text) return json({ error: 'Write something for your story' }, 400);
    if (type === 'photo' && !url) return json({ error: 'Choose a photo' }, 400);
    const hours = [6, 24, 48].includes(Number(body.hours)) ? Number(body.hours) : 24;
    let poll = null;
    if (body.poll && typeof body.poll === 'object') {
      const q = clean(body.poll.q, 80), opts = (Array.isArray(body.poll.opts) ? body.poll.opts : []).map(o => clean(o, 30)).filter(Boolean).slice(0, 4);
      if (q && opts.length >= 2) poll = { q, opts, votes: {} };
      else return json({ error: 'A poll needs a question and at least 2 options' }, 400);
    }
    if ((await store.list(`st/${me}/`)).length >= 30) return json({ error: 'You can have up to 30 stories at a time' }, 400);
    const id = `${String(now).padStart(13, '0')}-${crypto.randomBytes(3).toString('hex')}`;
    const st = { id, uid: me, type, text: type === 'text' ? text : '', caption: type === 'photo' ? caption : '', url: type === 'photo' ? url : null,
      bg: STORY_BGS.includes(body.bg) ? body.bg : STORY_BGS[0], font: STORY_FONTS.includes(body.font) ? body.font : 'sans',
      audience: body.audience === 'close' ? 'close' : 'friends', at: now, until: now + hours * 3600e3, poll, views: {}, reacts: {} };
    await store.set(`st/${me}/${id}`, st);
    return json({ story: storyFor(st, me) });
  }

  if (action === 'view') {
    const st = await findStory(); if (!st) return json({ error: 'This story is no longer available' }, 404);
    if (st.uid !== me && !st.views?.[me]) { st.views = { ...(st.views || {}), [me]: now }; await store.set(`st/${st.uid}/${st.id}`, st); }
    return json({ ok: true });
  }

  if (action === 'react') {
    const st = await findStory(); if (!st) return json({ error: 'This story is no longer available' }, 404);
    if (st.uid === me) return json({ error: 'That’s your own story' }, 400);
    const emoji = STORY_REACTS.includes(body.emoji) ? body.emoji : null;
    st.reacts = { ...(st.reacts || {}) };
    if (!emoji || st.reacts[me] === emoji) delete st.reacts[me]; else st.reacts[me] = emoji;
    st.views = { ...(st.views || {}), [me]: st.views?.[me] || now };
    await store.set(`st/${st.uid}/${st.id}`, st);
    if (st.reacts[me]) await ping(st.uid, `${user.name} reacted ${st.reacts[me]}`, 'to your story', `/#/story/${st.uid}/${st.id}?viewers=1`);
    return json({ ok: true, myReact: st.reacts[me] || null });
  }

  if (action === 'vote') {
    const st = await findStory(); if (!st?.poll) return json({ error: 'This poll is no longer available' }, 404);
    const opt = Number(body.opt);
    if (!(opt >= 0 && opt < st.poll.opts.length)) return json({ error: 'Pick an option' }, 400);
    st.poll.votes = { ...(st.poll.votes || {}), [me]: opt };
    st.views = { ...(st.views || {}), [me]: st.views?.[me] || now };
    await store.set(`st/${st.uid}/${st.id}`, st);
    return json({ ok: true, story: storyFor(st, me) });
  }

  if (action === 'reply') {
    const st = await findStory(); if (!st) return json({ error: 'This story is no longer available' }, 404);
    if (st.uid === me) return json({ error: 'That’s your own story' }, 400);
    const text = clean(body.text, MAX_TEXT); if (!text) return json({ error: 'Write a reply' }, 400);
    const { room, group } = await openDm(store, user, st.uid);
    const owner = await store.get(`u/${st.uid}`);
    const replyTo = { key: `story:${st.id}`, story: true, uid: st.uid, name: owner?.name || '', text: st.type === 'photo' ? (st.caption || 'Photo') : st.text.slice(0, 140), thumb: st.url || null, bg: st.bg };
    const msg = await postMessage(store, { room, group, user, text, replyTo }, { vapidEnv, waitUntil, pushSender, origin });
    return json({ ok: true, room, message: pub(msg) });
  }

  if (action === 'viewers') {
    const id = typeof body.id === 'string' && STORY_ID.test(body.id) ? body.id : null;
    const st = id && await store.get(`st/${me}/${id}`);
    if (!st) return json({ error: 'Story not found' }, 404);
    const uids = [...new Set([...Object.keys(st.views || {}), ...Object.keys(st.reacts || {})])];
    const list = (await Promise.all(uids.map(async uid => {
      const u = await store.get(`u/${uid}`); if (!u) return null;
      return { uid, name: u.name, username: u.username, photo: u.photo || null, at: st.views?.[uid] || 0, react: st.reacts?.[uid] || null, vote: st.poll?.votes?.[uid] ?? null };
    }))).filter(Boolean).sort((a, b) => b.at - a.at);
    return json({ viewers: list, poll: st.poll ? { q: st.poll.q, opts: st.poll.opts } : null });
  }

  if (action === 'delete') {
    const id = typeof body.id === 'string' && STORY_ID.test(body.id) ? body.id : null;
    const st = id && await store.get(`st/${me}/${id}`);
    if (!st) return json({ error: 'Story not found' }, 404);
    await store.del(`st/${me}/${id}`);
    const fid = st.url?.match(LOCAL_FILE)?.[1]; if (fid) await store.delFile(`f/${fid}`);
    return json({ ok: true });
  }

  if (action === 'close-friends') {
    if (Array.isArray(body.uids)) {
      const ids = [...new Set(body.uids.filter(x => typeof x === 'string' && ID.test(x)))].slice(0, 200);
      const ok = await Promise.all(ids.map(async x => (await store.get(`fr/${me}/${x}`))?.state === 'friends'));
      await store.set(`cf/${me}`, ids.filter((_, i) => ok[i]));
    }
    return json({ closeFriends: (await store.get(`cf/${me}`)) || [] });
  }

  if (action === 'mute') {
    const uid = typeof body.uid === 'string' && ID.test(body.uid) ? body.uid : null;
    if (!uid || uid === me) return json({ error: 'Pick a friend' }, 400);
    const list = new Set((await store.get(`sm/${me}`)) || []);
    if (body.on) list.add(uid); else list.delete(uid);
    await store.set(`sm/${me}`, [...list]);
    return json({ muted: [...list] });
  }
  return json({ error: 'Not found' }, 404);
}

// ---------- Friends & 1:1 chats ----------
async function openDm(store, user, other) {
  const room = dmRoomId(user.uid, other);
  let g = await store.get(`g/${room}`);
  if (!g) {
    g = { room, dm: true, members: [user.uid, other].sort(), created: Date.now() };
    await store.set(`g/${room}`, g);
    await saveRoomMeta(store, room, g, null);
  }
  const ou = await store.get(`u/${other}`);
  await Promise.all([touchMember(store, room, user, g), ou && touchMember(store, room, ou, g)]);   // both get notifications from the start
  return { room, group: g };
}
const dmRoomId = (a, b) => 'd-' + sha256([a, b].sort().join(':')).slice(0, 24);
const lastSeenOf = async (store, uid) => (await store.get(`ls/${uid}`))?.at || 0;
async function peerInfo(store, g, me) {
  const peerUid = g.members.find(u => u !== me.uid) || me.uid;
  const p = await store.get(`u/${peerUid}`);
  return { uid: peerUid, name: p?.name || 'Deleted account', username: p?.username || null, photo: p?.photo || null, status: activeStatus(p?.status), lastSeen: await lastSeenOf(store, peerUid) };
}
// @mentions: "@priya" → that account (max 10 per message, never yourself)
async function findMentions(store, text, selfUid) {
  const names = [...new Set((text || '').toLowerCase().match(/@[a-z0-9_.]{3,20}/g) || [])].slice(0, 10).map(x => x.slice(1));
  const refs = await Promise.all(names.map(n => store.get(`un/${n}`)));
  return [...new Set(refs.filter(r => r && r.uid !== selfUid).map(r => r.uid))];
}
// Store a message and notify people — used by "send" and by the scheduler for scheduled messages
async function postMessage(store, { room, group, user, text, gif, audio, replyTo, cid, scheduled, sys, notify }, { vapidEnv, waitUntil, pushSender, origin } = {}) {
  const now = Date.now();
  seq = (seq + 1) % 1e6;
  const mkey = `m/${room}/${String(now).padStart(13, '0')}-${String(seq).padStart(6, '0')}-${crypto.randomBytes(3).toString('hex')}`;
  const mentions = await findMentions(store, text, user.uid);
  const msg = { key: mkey, room, uid: user.uid, name: user.name, text, gif, audio, ts: now, cid: cid || undefined, replyTo, mentions: mentions.length ? mentions : undefined, scheduled: scheduled || undefined, sys: sys || undefined };
  await Promise.all([store.set(mkey, msg), store.set(`ls/${user.uid}`, { at: now })]);
  await Promise.all([store.set(`v/${room}`, { v: newVersion(now) }), saveRoomMeta(store, room, group, { name: user.name, uid: user.uid, text: previewOf(msg), ts: now, key: mkey }), touchMember(store, room, user, group, { posted: !sys }),
    store.set(`p/${room}/${user.uid}`, { uid: user.uid, name: user.name, seen: now, typingAt: 0 })]);   // sending ends "typing…"
  const keys = (await store.list(`m/${room}/`)).sort();
  if (keys.length > KEEP_PER_ROOM) {
    // Prune old messages, and any uploaded files they used
    await Promise.all(keys.slice(0, keys.length - KEEP_PER_ROOM).map(async k => {
      const old = await store.get(k);
      const ids = [old?.gif?.url, old?.audio?.url].map(u => u?.match(LOCAL_FILE)?.[1]).filter(Boolean);
      await Promise.all([store.del(k), ...ids.map(id => store.delFile(`f/${id}`))]);
    }));
  }
  // Notify the other members (runs after the response where the platform allows it); celebration notes stay quiet
  if (sys && !notify) return msg;
  // Notify the other members (runs after the response where the platform allows it)
  const pushJob = getVapid(store, vapidEnv).then(vapid => notifyMembers(store, { room, group, msg, senderUid: user.uid, vapid, sender: pushSender, siteOrigin: origin }));
  if (waitUntil) waitUntil(pushJob); else await pushJob;
  return msg;
}
async function resolveReply(store, room, r) {
  if (!(r && typeof r.key === 'string' && r.key.startsWith(`m/${room}/`) && r.key.length < 80)) return undefined;
  const orig = await store.get(r.key);
  return { key: r.key, name: orig?.name || clean(r.name, 24), uid: orig?.uid, text: clean(r.text, 140) };
}

// ---------- Scheduler: scheduled messages + reminders (run every minute by a scheduled function) ----------
export async function runScheduler(store, push = {}) {
  if (push.health) await syncAllHealth(store, push.health, push).catch(() => 0);
  const now = Date.now(), at = k => Number(k.split('/')[1].slice(0, 13));
  const due = [...(await store.list('sc/')), ...(await store.list('rm/'))].filter(k => at(k) <= now);
  let sent = 0;
  for (const k of due) {
    const job = await store.get(k);
    await store.del(k);                                 // claim it first so it's delivered once
    if (!job) continue;
    const user = await store.get(`u/${job.uid}`);
    if (!user) continue;
    const group = await store.get(`g/${job.room}`);
    if (!(await hasAccess(store, group, job.room, user, null))) continue;
    if (k.startsWith('sc/')) {
      await postMessage(store, { room: job.room, group, user, text: job.text, replyTo: job.replyTo, scheduled: job.created }, push);
    } else {
      const vapid = await getVapid(store, push.vapidEnv);
      await notifyUser(store, job.uid, { type: 'reminder', room: job.room, title: 'Reminder', body: job.preview, url: `/#/g/${job.room}?a=show&k=${encodeURIComponent(job.key)}` }, { vapid, sender: push.pushSender, siteOrigin: push.origin });
    }
    sent++;
  }
  return sent;
}
// Group membership (anyone who has opened the group). Used for the members list and notifications.
async function touchMember(store, room, user, g, { posted } = {}) {
  const key = `mb/${room}/${user.uid}`;
  const old = await store.get(key);
  const pwv = g?.pw?.v || 0;
  if (!old || old.name !== user.name || old.pwv !== pwv || old.username !== user.username || (posted && !old.posted)) {
    await store.set(key, { ...(old || {}), uid: user.uid, name: user.name, username: user.username, pwv, muteUntil: old?.muteUntil || 0, joined: old?.joined || Date.now(), posted: !!(posted || old?.posted) });
  }
  return old;
}

// Work out (and persist when it changes) a member's standing in a location group
async function memberState(store, group, room, user, dev, loc, now) {
  const isAdmin = isAdminOf(group, user, dev);
  const key = user && `gm/${room}/${user.uid}`;
  let old = (key && await store.get(key)) || null;
  if (!old && key && dev) {                // carry over a pre-accounts record kept per device
    old = await store.get(`gm/${room}/${dev}`);
    if (old) await store.del(`gm/${room}/${dev}`);
  }
  let inside = null, dist = null;
  if (loc) {
    dist = Math.round(distanceM(group.center, loc));
    inside = dist <= group.radius + Math.min(loc.acc || 0, ACCURACY_SLACK);
  }
  const rec = { uid: user?.uid, name: user?.name, inside: inside ?? old?.inside ?? null, dist: dist ?? old?.dist ?? null, acc: loc ? Math.round(loc.acc) : old?.acc ?? null,
    approved: !!old?.approved, req: old?.req || null, reqAt: old?.reqAt || 0, note: old?.note || '', at: loc ? now : old?.at || 0, seenAt: old?.seenAt || 0 };
  let changed = false;
  if (key && (!old || old.uid !== rec.uid || old.inside !== rec.inside || old.name !== rec.name || now - (old.seenAt || 0) > 60_000 || (loc && Math.abs((old.dist ?? 0) - rec.dist) > 100))) {
    rec.seenAt = now;
    changed = !old || old.inside !== rec.inside;
    await store.set(key, rec);
  }
  const fresh = loc != null;
  // A fresh fix inside the range, or (when the phone can't get a fix right now) inside within the last 10 minutes
  const recentInside = rec.inside === true && now - (rec.at || 0) < 10 * 60_000;
  const canChat = isAdmin || rec.approved || (fresh ? rec.inside === true : recentInside);
  return { isAdmin, changed, rec, canChat, fresh };
}

const failedJoins = new Map();   // room+uid -> { n, until } (brute-force brake per server instance)
const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const pub = m => { if (!m) return m; const { dev, ...rest } = m; return rest; };      // never send device ids to clients
// Per-room log of message edits (reactions, deletions) so open chats can update older messages live
async function recordEdit(store, room, key, patch) {
  const x = (await store.get(`x/${room}`)) || {};
  const at = Date.now();
  x[key] = { ...(x[key] || {}), ...patch, at };
  const keys = Object.keys(x);
  if (keys.length > 400) for (const k of keys.sort((a, b) => x[a].at - x[b].at).slice(0, keys.length - 400)) delete x[k];
  await store.set(`x/${room}`, x);
  return x[key];
}

// ---------- Walkie-talkie ----------
// One person holds the channel at a time ("floor", a short lease renewed by each audio piece). While talking, the
// browser records ~1 s pieces; each piece is stored and listed in a short-lived per-room log that open chats poll and
// play straight away. Pieces older than a minute are deleted.
const TALK_LEASE_MS = 6_000, TALK_KEEP_MS = 60_000;
const TALK_ID = /^[a-z0-9]{8,24}$/;
async function talkFloor(store, room, now = Date.now()) {
  const f = await store.get(`wt/${room}`);
  return f && f.until > now ? f : null;
}
async function appendTalk(store, room, entry) {
  const now = Date.now();
  const log = ((await store.get(`tk/${room}`)) || []);
  const keep = [], drop = [];
  for (const e of log) (now - e.at > TALK_KEEP_MS ? drop : keep).push(e);
  keep.push(entry);
  await store.set(`tk/${room}`, keep.slice(-60));
  await Promise.all(drop.map(e => { const id = e.url.match(LOCAL_FILE)?.[1]; return id && store.delFile(`f/${id}`); }));
}

export async function handle(req, store, { giphyKey, vapid: vapidEnv, waitUntil, pushSender, health, livekit, youtubeKey } = {}) {
  const route = new URL(req.url).pathname.replace(/^\/api\/?/, '');
  // Google sends the person back here after they allow step access (a normal browser navigation, no session header)
  if (req.method === 'GET' && route === 'health/callback') return healthCallback(req, store, health, { vapidEnv, waitUntil, pushSender, origin: new URL(req.url).origin });

  // Uploaded files are public by unguessable id so <img>/<audio> tags can load them without headers
  if (req.method === 'GET' && route.startsWith('file/')) {
    const id = route.slice(5);
    const file = FILE_ID.test(id) && await store.getFile(`f/${id}`);
    if (!file) return new Response('Not found', { status: 404 });
    return new Response(file.data, { headers: {
      'content-type': file.type, 'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'",
    } });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const dev = deviceId(req.headers.get('x-chat-device'));
  const user = await sessionUser(store, req);

  // Walkie-talkie audio piece (binary body). Only the person holding the channel can send.
  if (route === 'talk/chunk') {
    if (!user) return json({ error: 'Please sign in', code: 'auth' }, 401);
    const room = cleanRoom(req.headers.get('x-chat-room'));
    const talkId = req.headers.get('x-talk-id') || '', seq = Math.max(0, Math.min(Number(req.headers.get('x-talk-seq')) || 0, 10_000));
    const final = req.headers.get('x-talk-final') === '1';
    const group = await store.get(`g/${room}`);
    if (!(await hasAccess(store, group, room, user, dev))) return json({ error: 'This group is locked', code: 'locked' }, 403);
    const now = Date.now();
    const floor = await talkFloor(store, room, now);
    if (!TALK_ID.test(talkId) || !floor || floor.uid !== user.uid || floor.talkId !== talkId) return json({ error: 'You’re not holding the channel', code: 'no_floor' }, 409);
    const data = Buffer.from(await req.arrayBuffer());
    if (data.length > 512 * 1024) return json({ error: 'Audio piece too large' }, 413);
    const type = data.length ? sniffMedia(data) : null;
    let url = null;
    if (data.length) {
      if (!type?.startsWith('audio/')) return json({ error: 'Not an audio recording' }, 415);
      const id = crypto.randomBytes(12).toString('hex');
      await store.setFile(`f/${id}`, data, type);
      url = `/api/file/${id}`;
    }
    if (url) await appendTalk(store, room, { talkId, seq, uid: user.uid, name: user.name, url, at: now, final });
    await store.set(`wt/${room}`, final ? { ...floor, until: 0 } : { ...floor, until: now + TALK_LEASE_MS });
    await store.set(`v/${room}`, { v: newVersion(now) });
    return json({ ok: true });
  }

  // Profile photo (yours, or a group's photo when you're its admin)
  if (route === 'avatar') {
    if (!user) return json({ error: 'Please sign in', code: 'auth' }, 401);
    const data = Buffer.from(await req.arrayBuffer());
    if (data.length > 2 * 1024 * 1024) return json({ error: 'Photo too large (max 2 MB)' }, 413);
    const type = sniffImage(data);
    if (!type) return json({ error: 'Choose a photo (JPEG, PNG, WebP or GIF)' }, 415);
    const groupRoom = req.headers.get('x-chat-room') ? cleanRoom(req.headers.get('x-chat-room')) : null;
    let g = null;
    if (groupRoom) {
      g = await store.get(`g/${groupRoom}`);
      if (!g || g.dm || !isAdminOf(g, user, dev)) return json({ error: 'Only the group admin can change the group photo' }, 403);
    }
    const id = crypto.randomBytes(12).toString('hex');
    await store.setFile(`f/${id}`, data, type);
    const url = `/api/file/${id}`;
    const old = (g ? g.photo : user.photo)?.match(LOCAL_FILE)?.[1];
    if (old) await store.delFile(`f/${old}`);
    if (g) { g.photo = url; await store.set(`g/${groupRoom}`, g); await saveRoomMeta(store, groupRoom, g); await store.set(`v/${groupRoom}`, { v: newVersion(Date.now()) }); return json({ photo: url }); }
    user.photo = url; await store.set(`u/${user.uid}`, user);
    return json({ user: publicUser(user) });
  }

  // Story photo (stored until the story is deleted or expires)
  if (route === 'story/photo') {
    if (!user) return json({ error: 'Please sign in', code: 'auth' }, 401);
    const data = Buffer.from(await req.arrayBuffer());
    if (data.length > 3 * 1024 * 1024) return json({ error: 'Photo too large (max 3 MB)' }, 413);
    const type = sniffImage(data);
    if (!type) return json({ error: 'Choose a photo (JPEG, PNG, WebP or GIF)' }, 415);
    const id = crypto.randomBytes(12).toString('hex');
    await store.setFile(`f/${id}`, data, type);
    return json({ url: `/api/file/${id}` });
  }

  if (route === 'upload') {
    if (!user) return json({ error: 'Please sign in', code: 'auth' }, 401);
    // Uploads are tied to a room the uploader can access
    const room = cleanRoom(req.headers.get('x-chat-room'));
    const group = await store.get(`g/${room}`);
    if (!(await hasAccess(store, group, room, user, dev))) return json({ error: 'This group is locked', code: 'locked' }, 403);
    if (Number(req.headers.get('content-length')) > MAX_UPLOAD) return json({ error: 'File too large (max 4 MB)' }, 413);
    const data = Buffer.from(await req.arrayBuffer());
    if (data.length > MAX_UPLOAD) return json({ error: 'File too large (max 4 MB)' }, 413);
    const type = sniffMedia(data);
    if (!type) return json({ error: 'Only images (GIF, PNG, JPEG, WebP) and voice recordings are allowed' }, 415);
    const id = crypto.randomBytes(12).toString('hex');
    await store.setFile(`f/${id}`, data, type);
    return json({ url: `/api/file/${id}` });
  }

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }

  if (route.startsWith('auth/')) return authRoute(route.slice(5), { store, req, body, user });
  if (!user) return json({ error: 'Please sign in', code: 'auth' }, 401);

  const name = user.name;
  const room = cleanRoom(body.room);
  const loc = cleanLoc(body.loc);
  const now = Date.now();
  const presenceKey = `p/${room}/${user.uid}`;
  const pushOpts = { vapidEnv, waitUntil, pushSender, origin: new URL(req.url).origin };

  // Push notifications for this device (stored under the account, so every signed-in device gets them)
  if (route === 'push/key') return json({ publicKey: (await getVapid(store, vapidEnv)).publicKey });
  if (route === 'push/subscribe') {
    const sub = cleanSubscription(body.subscription);
    if (!dev || !sub) return json({ error: 'Invalid subscription' }, 400);
    await store.set(`ps/${user.uid}/${dev}`, { sub, at: now });
    return json({ ok: true });
  }
  if (route === 'push/unsubscribe') { if (dev) await store.del(`ps/${user.uid}/${dev}`); return json({ ok: true }); }
  // Native app (Firebase Cloud Messaging) token for this device. One account per token: signing in as someone else moves it.
  if (route === 'push/native') {
    const token = typeof body.token === 'string' && /^[\w:\-.]{20,4096}$/.test(body.token) ? body.token : null;
    if (!dev || !token) return json({ error: 'Invalid token' }, 400);
    const ik = `pt/${sha256(token).slice(0, 32)}`, prev = await store.get(ik);
    if (prev && (prev.uid !== user.uid || prev.dev !== dev)) await store.del(`pf/${prev.uid}/${prev.dev}`);
    const old = await store.get(`pf/${user.uid}/${dev}`);
    await Promise.all([store.set(`pf/${user.uid}/${dev}`, { token, platform: body.platform === 'ios' ? 'ios' : 'android', at: now, walkieWake: old?.walkieWake !== false }), store.set(ik, { uid: user.uid, dev })]);
    return json({ ok: true });
  }
  // "Hear the walkie-talkie when the app is closed" for this phone
  if (route === 'push/native/walkie') {
    const k = dev && `pf/${user.uid}/${dev}`, rec = k && await store.get(k);
    if (!rec) return json({ error: 'Turn on notifications in the app first', code: 'no_device' }, 400);
    rec.walkieWake = body.on === true; await store.set(k, rec);
    return json({ ok: true, on: rec.walkieWake });
  }
  if (route === 'push/native/remove') { if (dev) await store.del(`pf/${user.uid}/${dev}`); return json({ ok: true }); }

  if (route === 'rooms') return json({ rooms: await listRooms(store, room, user, dev, body.reads, loc || cleanLoc(body.listLoc)) });
  if (route === 'profile/get' || route === 'profile/batch') {
    const ids = (route === 'profile/get' ? [body.uid] : Array.isArray(body.uids) ? body.uids : []).filter(x => typeof x === 'string' && ID.test(x)).slice(0, 60);
    const out = {};
    await Promise.all(ids.map(async id => {
      const u = await store.get(`u/${id}`); if (!u) return;
      out[id] = { ...publicUser(u), lastSeen: await lastSeenOf(store, id) };
      if (route === 'profile/get') out[id].friend = (await store.get(`fr/${user.uid}/${id}`))?.state || null;
    }));
    return json(route === 'profile/get' ? { profile: out[body.uid] || null } : { profiles: out });
  }
  if (route.startsWith('health/')) return healthRoute(route.slice(7), { store, body, user, health, origin: new URL(req.url).origin, push: { vapidEnv, waitUntil, pushSender, origin: new URL(req.url).origin } });
  if (route.startsWith('story/')) return storyRoute(route.slice(6), { store, body, user, vapidEnv, waitUntil, pushSender, origin: new URL(req.url).origin });
  if (route.startsWith('friends/')) return friendsRoute(route.slice(8), { store, body, user, vapidEnv, waitUntil, pushSender, origin: new URL(req.url).origin });
  if (route === 'gifs') return gifSearch(giphyKey, clean(body.q, 50));

  let group = await store.get(`g/${room}`);
  if (!group && route !== 'group/create' && room !== 'general') {
    const gone = await store.get(`gx/${room}`);
    if (gone) return json({ error: `“${gone.title}” was deleted by ${gone.by}`, code: 'deleted' }, 410);
  }
  await claimLegacyAdmin(store, room, group, user, dev);
  if (route.startsWith('group/')) return groupRoute(route.slice(6), { store, body, room, user, dev, loc, now, group, push: { vapidEnv, waitUntil, pushSender, origin: new URL(req.url).origin } });

  // Everything below needs access to the room
  if (!(await hasAccess(store, group, room, user, dev)))
    return group?.invite ? json({ error: 'This group is invite-only — ask its owner or an admin to add you, or for an invite link', code: 'invite_only', group: { title: group.title } }, 403)
      : json({ error: 'This group needs a password', code: 'locked', group: groupView(group, user, dev) }, 403);
  const isAdmin = isAdminOf(group, user, dev);

  if (route === 'send') {
    const text = clean(body.text, MAX_TEXT);
    const gif = cleanGif(body.gif);
    const audio = cleanAudio(body.audio);
    if (!text && !gif && !audio) return json({ error: 'Empty message' }, 400);
    if (isGeo(group)) {
      const st = await memberState(store, group, room, user, dev, loc, now);
      if (!st.canChat) return json({ error: st.fresh ? 'You’re outside this group’s range. Ask the admin to let you chat.' : 'Your location is needed to chat in this group', code: 'out_of_range' }, 403);
    }
    const msg = await postMessage(store, { room, group, user, text, gif, audio, replyTo: await resolveReply(store, room, body.replyTo), cid: clean(body.cid, 40) }, pushOpts);
    return json({ message: pub(msg) });
  }

  // ⏰ Schedule a message for later (delivered by the scheduler, to the minute)
  if (route === 'schedule') {
    const text = clean(body.text, MAX_TEXT), at = Math.round(Number(body.at) || 0);
    if (!text) return json({ error: 'Write a message to schedule' }, 400);
    if (at < now + 30_000 || at > now + 60 * 864e5) return json({ error: 'Pick a time between 1 minute and 60 days from now' }, 400);
    if (isGeo(group)) { const st = await memberState(store, group, room, user, dev, loc, now); if (!st.canChat) return json({ error: 'You can’t send messages in this group right now', code: 'out_of_range' }, 403); }
    const mine = (await Promise.all((await store.list('sc/')).map(k => store.get(k)))).filter(j => j?.uid === user.uid);
    if (mine.length >= 25) return json({ error: 'You already have 25 scheduled messages' }, 400);
    const id = `${String(at).padStart(13, '0')}-${crypto.randomBytes(4).toString('hex')}`;
    await store.set(`sc/${id}`, { id, room, uid: user.uid, text, replyTo: await resolveReply(store, room, body.replyTo), at, created: now });
    return json({ ok: true, id, at });
  }
  if (route === 'schedule/list') {
    const jobs = (await Promise.all((await store.list('sc/')).map(k => store.get(k)))).filter(j => j?.uid === user.uid && j.room === room).sort((a, b) => a.at - b.at);
    return json({ scheduled: jobs.map(j => ({ id: j.id, text: j.text, at: j.at })) });
  }
  if (route === 'schedule/cancel') {
    const id = String(body.id || ''), j = /^\d{13}-[a-f0-9]{8}$/.test(id) && await store.get(`sc/${id}`);
    if (!j || j.uid !== user.uid) return json({ error: 'Not found' }, 404);
    await store.del(`sc/${id}`);
    return json({ ok: true });
  }
  // 🔔 Remind me about a message later (push notification at that time)
  if (route === 'remind') {
    const mkey = typeof body.key === 'string' && body.key.startsWith(`m/${room}/`) ? body.key : null;
    const m = mkey && await store.get(mkey), at = Math.round(Number(body.at) || 0);
    if (!m) return json({ error: 'Message not found' }, 404);
    if (at < now + 30_000 || at > now + 365 * 864e5) return json({ error: 'Pick a time in the future' }, 400);
    const id = `${String(at).padStart(13, '0')}-${crypto.randomBytes(4).toString('hex')}`;
    await store.set(`rm/${id}`, { uid: user.uid, room, key: mkey, preview: `${m.name}: ${previewOf(m)}`.slice(0, 140), at });
    return json({ ok: true, at });
  }
  // ✏️ Edit your own message (any time; shown as "edited")
  if (route === 'edit') {
    const mkey = typeof body.key === 'string' && body.key.startsWith(`m/${room}/`) ? body.key : null;
    const m = mkey && await store.get(mkey), text = clean(body.text, MAX_TEXT);
    if (!m || m.deleted) return json({ error: 'Message not found' }, 404);
    if (m.uid !== user.uid) return json({ error: 'You can only edit your own messages' }, 403);
    if (!text && !m.gif && !m.audio) return json({ error: 'A message can’t be empty — delete it instead' }, 400);
    m.text = text; m.edited = now;
    const mentions = await findMentions(store, text, user.uid); m.mentions = mentions.length ? mentions : undefined;
    await store.set(mkey, m);
    const edit = await recordEdit(store, room, mkey, { text, edited: now, mentions: m.mentions || [] });
    const meta = await store.get(`r/${room}`);
    if (meta?.last?.key === mkey) await saveRoomMeta(store, room, group, { ...meta.last, text: previewOf(m) });
    await store.set(`v/${room}`, { v: newVersion(now) });
    return json({ ok: true, edit });
  }
  // 📌 Pin / unpin a message for everyone in the chat (up to 10)
  if (route === 'pin') {
    const mkey = typeof body.key === 'string' && body.key.startsWith(`m/${room}/`) ? body.key : null;
    if (!mkey || !(await store.get(mkey))) return json({ error: 'Message not found' }, 404);
    let pins = ((await store.get(`pn/${room}`)) || []).filter(p => p.key !== mkey);
    if (body.on) { pins.push({ key: mkey, by: user.name, at: now }); pins = pins.slice(-10); }
    await store.set(`pn/${room}`, pins);
    await store.set(`v/${room}`, { v: newVersion(now) });
    return json({ ok: true });
  }
  // 🔍 Search this chat's history
  if (route.startsWith('game/')) {
    // mini-games: a short note in the chat when one starts or ends (these notes notify like messages)
    const announce = (text, extra) => postMessage(store, { room, group, user, text, sys: 'game', notify: !!extra?.game }, { vapidEnv, waitUntil, pushSender, origin: new URL(req.url).origin });
    return gameRoute(route.slice(5), body, { store, room, user, group, isAdmin, announce, youtubeKey });
  }
  if (route.startsWith('steps/')) return stepsRoute(route.slice(6), { store, body, room, group, user, isAdmin, push: pushOpts });
  if (route === 'search') {
    const q = clean(body.q, 60).toLowerCase();
    if (q.length < 2) return json({ results: [] });
    const keys = (await store.list(`m/${room}/`)).sort().reverse();
    const msgs = (await Promise.all(keys.map(k => store.get(k)))).filter(m => m && !m.deleted && ((m.text || '').toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q)));
    return json({ results: msgs.slice(0, 50).map(m => ({ key: m.key, name: m.name, uid: m.uid, text: previewOf(m), ts: m.ts })) });
  }

  // Mute this group's notifications for this account until a time (0 = unmute, -1 = always)
  if (route === 'push/mute') {
    const until = Number(body.until) === -1 ? 8.64e15 : Math.max(0, Math.min(Number(body.until) || 0, 8.64e15));
    await touchMember(store, room, user, group);
    const k = `mb/${room}/${user.uid}`;
    const m = await store.get(k);
    m.muteUntil = until; await store.set(k, m);
    return json({ ok: true, muteUntil: until });
  }

  // Emoji reaction (one per person; picking the same one again removes it)
  if (route === 'react') {
    const mkey = typeof body.key === 'string' && body.key.startsWith(`m/${room}/`) ? body.key : null;
    if (!mkey || !(await store.get(mkey))) return json({ error: 'Message not found' }, 404);
    if (body.emoji && !REACTIONS.includes(body.emoji)) return json({ error: 'Unsupported reaction' }, 400);
    const x = (await store.get(`x/${room}`)) || {};
    const reactions = {};
    let had = false;
    for (const [e, list] of Object.entries(x[mkey]?.reactions || {})) {
      const kept = list.filter(p => { const mine = typeof p === 'string' ? p === name : p.uid === user.uid; if (mine && e === body.emoji) had = true; return !mine; });
      if (kept.length) reactions[e] = kept;
    }
    if (body.emoji && !had) reactions[body.emoji] = [...(reactions[body.emoji] || []), { uid: user.uid, name }];
    const edit = await recordEdit(store, room, mkey, { reactions });
    await store.set(`v/${room}`, { v: newVersion(now) });
    return json({ ok: true, edit });
  }

  // Delete for everyone: the sender or the group admin
  if (route === 'delete') {
    const mkey = typeof body.key === 'string' && body.key.startsWith(`m/${room}/`) ? body.key : null;
    const m = mkey && await store.get(mkey);
    if (!m) return json({ error: 'Message not found' }, 404);
    const own = m.uid ? m.uid === user.uid : !!dev && m.dev === dev;
    if (!(own || isAdmin)) return json({ error: 'You can only delete your own messages' }, 403);
    const ids = [m.gif?.url, m.audio?.url].map(u => u?.match(LOCAL_FILE)?.[1]).filter(Boolean);
    await Promise.all([store.set(mkey, { key: mkey, room, uid: m.uid, name: m.name, ts: m.ts, deleted: true }), ...ids.map(id => store.delFile(`f/${id}`))]);
    await recordEdit(store, room, mkey, { deleted: true, reactions: {} });
    const meta = await store.get(`r/${room}`);
    if (meta?.last?.key === mkey) await saveRoomMeta(store, room, group, { ...meta.last, text: 'Message deleted' });
    await store.set(`v/${room}`, { v: newVersion(now) });
    return json({ ok: true });
  }

  // Walkie-talkie: take / release the channel
  if (route === 'talk/start') {
    const talkId = String(body.talkId || '');
    if (!TALK_ID.test(talkId)) return json({ error: 'Bad talk id' }, 400);
    if (isGeo(group)) {
      const st = await memberState(store, group, room, user, dev, loc, now);
      if (!st.canChat) return json({ error: 'You’re outside this group’s range, so you can listen but not talk', code: 'out_of_range' }, 403);
    }
    const floor = await talkFloor(store, room, now);
    if (floor && floor.uid !== user.uid) return json({ error: `${floor.name} is talking`, code: 'busy', floor: { uid: floor.uid, name: floor.name } }, 409);
    await store.set(`wt/${room}`, { uid: user.uid, name, talkId, until: now + TALK_LEASE_MS, since: now });
    await store.set(`v/${room}`, { v: newVersion(now) });
    if (!floor || floor.talkId !== talkId) {           // a new turn: wake phones that listen with the app closed
      const title = group?.dm ? name : group?.title || (room === 'general' ? '#general' : `#${room}`);
      const job = wakeWalkie(store, { room, group, talkerUid: user.uid, talkerName: name, title });
      if (waitUntil) waitUntil(job); else await job;
    }
    return json({ ok: true });
  }
  // Real-time walkie-talkie voice (LiveKit / WebRTC): a short-lived pass for this chat's voice room.
  // Talking still goes through talk/start (one speaker at a time); without LiveKit set up, the app uses audio pieces.
  if (route === 'talk/lk') {
    if (!livekit?.url || !livekit?.apiKey || !livekit?.apiSecret) return json({ enabled: false });
    let canTalk = true;
    if (isGeo(group)) canTalk = (await memberState(store, group, room, user, dev, loc, now)).canChat;
    const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url'), t = Math.floor(now / 1000);
    const head = b64({ alg: 'HS256', typ: 'JWT' });
    const claims = b64({ iss: livekit.apiKey, sub: user.uid, name, nbf: t - 10, exp: t + 6 * 3600,
      video: { room: `walkie-${room}`, roomJoin: true, canSubscribe: true, canPublish: canTalk, canPublishData: false, canPublishSources: ['microphone'] } });
    const sig = crypto.createHmac('sha256', livekit.apiSecret).update(`${head}.${claims}`).digest('base64url');
    return json({ enabled: true, url: livekit.url, token: `${head}.${claims}.${sig}`, canTalk });
  }
  // Lightweight live-audio feed for the native app playing the walkie-talkie with the app closed
  if (route === 'talk/feed') {
    const tsince = Number(body.tsince) || 0;
    const [floor, log] = await Promise.all([talkFloor(store, room, now), store.get(`tk/${room}`)]);
    return json({ now, floor: floor && { uid: floor.uid, name: floor.name, since: floor.since },
      chunks: (log || []).filter(e => e.at > tsince && e.uid !== user.uid).sort((a, b) => a.at - b.at || a.seq - b.seq) });
  }
  if (route === 'talk/end') {
    const floor = await store.get(`wt/${room}`);
    if (floor && floor.uid === user.uid) { await store.set(`wt/${room}`, { ...floor, until: 0 }); await store.set(`v/${room}`, { v: newVersion(now) }); }
    return json({ ok: true });
  }

  if (route === 'typing') {
    await Promise.all([store.set(presenceKey, { uid: user.uid, name, seen: now, typingAt: now }), store.set(`v/${room}`, { v: newVersion(now) })]);
    return json({ ok: true });
  }

  if (route === 'poll') {
    const prev = await store.get(presenceKey);
    const presenceWrite = store.set(presenceKey, { uid: user.uid, name, seen: now, typingAt: prev?.typingAt || 0, walkie: body.walkie === true });
    const membership = touchMember(store, room, user, group);
    const ls = await store.get(`ls/${user.uid}`);
    if (!ls || now - ls.at > 60_000) await store.set(`ls/${user.uid}`, { at: now });

    const since = typeof body.since === 'string' ? body.since : '';
    // Long-poll: hold the request until the room changes (new message / typing) or the wait expires.
    let known = typeof body.version === 'string' ? body.version : '';
    const wait = Math.min(Math.max(Number(body.wait) || 0, 0), MAX_WAIT_MS);
    let version = (await store.get(`v/${room}`))?.v || '';
    const bumpOwn = async () => {
      const bumped = newVersion(now);
      await store.set(`v/${room}`, { v: bumped });
      if (version === known) known = bumped;                  // our own change shouldn't end our wait
      version = bumped;
    };

    // Read receipts: the client reports the newest message it has received ("delivered")
    // and the newest one it has had on screen ("read"). Both only ever move forward.
    const ack = body.ack && typeof body.ack === 'object' ? body.ack : {};
    const validKey = k => typeof k === 'string' && k.startsWith(`m/${room}/`) && k.length < 80 ? k : '';
    const ackD = validKey(ack.delivered), ackR = validKey(ack.read);
    if (ackD || ackR) {
      const rk = `rd/${room}/${user.uid}`;
      const old = (await store.get(rk)) || {};
      const read = [old.read || '', ackR].sort().pop();
      const delivered = [old.delivered || '', ackD, read].sort().pop();
      if (read !== (old.read || '') || delivered !== (old.delivered || '')) {
        await store.set(rk, { uid: user.uid, name, delivered, read, at: now });
        await bumpOwn();                                         // wake senders so their ticks update
      }
    }

    // Location groups: update this member's standing; status flips wake the admin's screen
    if (isGeo(group)) {
      const st = await memberState(store, group, room, user, dev, loc, now);
      if (st.changed) await bumpOwn();
    }

    if (known && version === known && wait) {
      const deadline = Date.now() + wait;
      while (Date.now() < deadline && !req.signal?.aborted) {
        await sleep(CHECK_MS);
        version = (await store.get(`v/${room}`))?.v || '';
        if (version !== known) break;
      }
    }
    const t = Date.now();
    // Fetch messages, presence, rooms, receipts, edits and group info in parallel to keep latency low
    const loadMessages = async () => {
      const allKeys = (await store.list(`m/${room}/`)).sort();
      const sinceTs = Number(since.split('/')[2]?.slice(0, 13)) || 0;
      const cutoff = `m/${room}/${String(Math.max(0, sinceTs - OVERLAP_MS)).padStart(13, '0')}`;
      const newKeys = since ? allKeys.filter(k => k > cutoff) : allKeys.slice(-INITIAL_LOAD);
      return (await Promise.all(newKeys.map(k => store.get(k)))).filter(Boolean).map(pub);
    };
    const tsince = Number(body.tsince) || 0;
    const loadTalk = async () => {
      const [floor, log] = await Promise.all([talkFloor(store, room, Date.now()), store.get(`tk/${room}`)]);
      return { floor: floor && { uid: floor.uid, name: floor.name, since: floor.since }, chunks: (log || []).filter(e => e.at > tsince && e.uid !== user.uid) };
    };
    const xsince = Number(body.xsince) || 0;
    const loadPins = async () => {
      const pins = (await store.get(`pn/${room}`)) || [];
      const msgs = await Promise.all(pins.map(p => store.get(p.key)));
      return pins.map((p, i) => msgs[i] && !msgs[i].deleted ? { key: p.key, by: p.by, name: msgs[i].name, text: previewOf(msgs[i]) } : null).filter(Boolean);
    };
    const loadEdits = async () => {
      const x = (await store.get(`x/${room}`)) || {};
      const out = {};
      for (const [k, v] of Object.entries(x)) if (v.at > xsince) out[k] = v;
      return out;
    };
    const loadUsers = async () => {
      const pKeys = await store.list(`p/${room}/`);
      const entries = await Promise.all(pKeys.map(async k => [k, await store.get(k)]));
      const users = [], stale = [];
      for (const [k, p] of entries) {
        if (!p || !p.uid || t - p.seen > STALE_MS) { stale.push(k); continue; }
        if (t - p.seen <= ONLINE_MS) users.push({ uid: p.uid, name: p.name, typing: t - (p.typingAt || 0) < TYPING_MS, walkie: !!p.walkie });
      }
      await Promise.all(stale.map(k => store.del(k)));
      return users;
    };
    const loadGroup = async () => {
      if (!group) return null;
      const g = (await store.get(`g/${room}`)) || group;          // may have been edited while we waited
      const out = groupView(g, user, dev);
      if (g.dm) { const peer = await peerInfo(store, g, user), ch = await store.get(`ch/${room}`); return { dm: true, title: peer.name, peer, isAdmin: false, locked: false, geo: false, steps: ch ? { title: ch.title, goal: ch.goal, start: ch.start, end: ch.end, days: ch.days } : null }; }
      // keep the admin name in step with the admin account's current name
      if (out.isOwner && g.adminName !== name) { g.adminName = name; out.adminName = name; await store.set(`g/${room}`, g); }
      const ch = await store.get(`ch/${room}`);
      if (ch) out.steps = { title: ch.title, goal: ch.goal, start: ch.start, end: ch.end, days: ch.days };
      if (!isGeo(g)) return out;
      const me = await memberState(store, g, room, user, dev, loc, Date.now());
      out.me = { inside: me.rec.inside, dist: me.rec.dist, acc: me.rec.acc, canChat: me.canChat, approved: me.rec.approved, req: me.rec.req, hasLocation: me.fresh };
      out.center = g.center;     // the group's area, shown on the map to members (members' own positions are never shared)
      if (out.isAdmin) {
        const keys = await store.list(`gm/${room}/`);
        out.members = (await Promise.all(keys.map(k => store.get(k)))).filter(m => m?.uid && m.uid !== g.adminUid)
          .map(m => ({ uid: m.uid, name: m.name, inside: m.inside, dist: m.dist, acc: m.acc, approved: m.approved, req: m.req, note: m.note, reqAt: m.reqAt, at: m.at }))
          .sort((a, b) => (b.req === 'pending') - (a.req === 'pending') || (b.at || 0) - (a.at || 0));
      }
      return out;
    };
    const loadReceipts = async () => {
      const keys = await store.list(`rd/${room}/`);
      return (await Promise.all(keys.map(k => store.get(k)))).filter(r => r?.uid).map(r => ({ uid: r.uid, name: r.name, delivered: r.delivered, read: r.read }));
    };
    const loadGameView = async () => gameView(await loadGame(store, room, { announce: text => postMessage(store, { room, group, user, text, sys: 'game' }, {}) }), user.uid);
    const [messages, users, rooms, receipts, groupInfo, edits, talk, pins, game] = await Promise.all([loadMessages(), loadUsers(), listRooms(store, room, user, dev, body.reads, loc || cleanLoc(body.listLoc)), loadReceipts(), loadGroup(), loadEdits(), loadTalk(), loadPins(), loadGameView()]);
    const mem = await membership;
    await presenceWrite;
    return json({ messages, users, rooms, receipts, group: groupInfo, edits, talk, pins, game, xt: t, muteUntil: mem?.muteUntil || 0, version });
  }

  return json({ error: 'Not found' }, 404);
}

// GIF search / trending through GIPHY (the API key stays on the server)
async function gifSearch(giphyKey, q) {
  if (!giphyKey) return json({ error: 'GIF search is not set up', configured: false }, 501);
  const params = new URLSearchParams({ api_key: giphyKey, limit: '24', rating: 'pg', bundle: 'messaging_non_clips' });
  if (q) params.set('q', q);
  const r = await fetch(`https://api.giphy.com/v1/gifs/${q ? 'search' : 'trending'}?${params}`).catch(() => null);
  if (!r?.ok) return json({ error: 'GIF search failed' }, 502);
  const { data = [] } = await r.json();
  const pick = (im, ...names) => names.map(n => im?.[n]).find(x => x?.url);
  const gifs = data.map(g => {
    const preview = pick(g.images, 'fixed_width_downsampled', 'fixed_width', 'downsized');
    const full = pick(g.images, 'fixed_width', 'downsized', 'original');
    return preview && full && GIPHY_URL.test(full.url) ? {
      title: g.title || 'GIF',
      preview: { url: preview.url, w: +preview.width, h: +preview.height },
      full: { url: full.url, w: +full.width, h: +full.height },
    } : null;
  }).filter(Boolean);
  return json({ gifs });
}

async function listRooms(store, current, user, dev, reads, loc) {
  const metaKeys = await store.list('r/');
  const metas = (await Promise.all(metaKeys.map(k => store.get(k)))).filter(m => m?.room && (!m.dm || m.members?.includes(user?.uid)));
  const map = new Map([['general', { room: 'general' }]]);
  for (const m of metas) map.set(m.room, m);
  if (current && !map.has(current) && !current.startsWith('d-')) map.set(current, { room: current });
  const wantCounts = reads && typeof reads === 'object' ? reads : null;
  const out = await Promise.all([...map.values()].map(async m => {
    let last = m.last || null, access = true, unread;
    const since = wantCounts ? (typeof wantCounts[m.room] === 'string' ? wantCounts[m.room] : m.dm ? '' : null) : null;
    if (since !== null) {         // unread = messages newer than what this person has read (a 1:1 chat never opened: all of it)
      unread = Math.min((await store.list(`m/${m.room}/`)).filter(k => k > since).length, 99);
    }
    if (m.dm) {
      const peer = await peerInfo(store, { members: m.members }, user);
      return { room: m.room, dm: true, title: peer.name, peer, last, unread, access: true };
    }
    // Invite-only groups: members only. Location groups: people in range now, people who have posted there, admins.
    if (m.invite || m.geo) {
      const g = await store.get(`g/${m.room}`);
      if (!g) return null;
      if (g.invite && !(await hasAccess(store, g, m.room, user, dev))) return null;
      if (isGeo(g) && !g.invite && m.room !== current && !isAdminOf(g, user, dev)) {
        const [mb, gm] = await Promise.all([store.get(`mb/${m.room}/${user.uid}`), store.get(`gm/${m.room}/${user.uid}`)]);
        if (mb && mb.posted === undefined) {     // members from before this rule: look at their past messages once
          let posted = false;
          for (const k of (await store.list(`m/${m.room}/`)).reverse()) { if ((await store.get(k))?.uid === user.uid) { posted = true; break; } }
          mb.posted = posted; await store.set(`mb/${m.room}/${user.uid}`, mb);
        }
        const near = loc && distanceM(loc, g.center) <= g.radius + Math.min(loc.acc || 0, ACCURACY_SLACK);
        if (!near && !mb?.posted && !gm?.approved) return null;
      }
    }
    // Locked groups: hide message previews unless this account has joined with the current password (or is the admin)
    if (m.locked) {
      const g = await store.get(`g/${m.room}`);
      access = await hasAccess(store, g, m.room, user, dev);
      if (!access && last) last = { ts: last.ts, key: last.key };
    }
    return { room: m.room, title: m.title || null, photo: m.photo || null, geo: !!m.geo, locked: !!m.locked, invite: !!m.invite, access, radius: m.radius || null, last, unread };
  }));
  return out.filter(Boolean).sort((a, b) => (b.last?.ts || 0) - (a.last?.ts || 0) || a.room.localeCompare(b.room));
}

async function friendsRoute(action, { store, body, user, vapidEnv, waitUntil, pushSender, origin }) {
  const me = user.uid;
  const rel = async other => (await store.get(`fr/${me}/${other}`))?.state || null;
  const card = async (uid, state) => { const u = await store.get(`u/${uid}`); return u && { uid, name: u.name, username: u.username, photo: u.photo || null, status: activeStatus(u.status), state, lastSeen: await lastSeenOf(store, uid) }; };
  const ping = (uid, title, text, url) => {           // push a friend notification to all of that person's devices
    const job = getVapid(store, vapidEnv).then(vapid => notifyUser(store, uid, { type: 'friend', title, body: text, url }, { vapid, sender: pushSender, siteOrigin: origin }));
    if (waitUntil) waitUntil(job); else return job;
  };
  const target = async () => {
    const uid = typeof body.uid === 'string' && ID.test(body.uid) ? body.uid : null;
    if (uid) return uid !== me && (await store.get(`u/${uid}`)) ? uid : null;
    const un = clean(body.username, 21).toLowerCase().replace(/^@/, '');
    const ref = USERNAME.test(un) && await store.get(`un/${un}`);
    return ref && ref.uid !== me ? ref.uid : null;
  };
  const now = Date.now();

  if (action === 'list') {
    const keys = await store.list(`fr/${me}/`);
    const all = (await Promise.all(keys.map(async k => { const r = await store.get(k); return r && card(r.uid, r.state); }))).filter(Boolean);
    const by = st => all.filter(x => x.state === st).sort((a, b) => a.name.localeCompare(b.name));
    return json({ friends: by('friends'), incoming: by('in'), outgoing: by('out') });
  }
  if (action === 'search') {
    const q = clean(body.q, 20).toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_.]/g, '');
    if (q.length < 2) return json({ users: [] });
    const keys = (await store.list(`un/${q}`)).slice(0, 15);
    const users = (await Promise.all(keys.map(async k => { const ref = await store.get(k); return ref && ref.uid !== me ? card(ref.uid, await rel(ref.uid)) : null; }))).filter(Boolean);
    return json({ users });
  }
  const other = await target();
  if (!other) return json({ error: 'No one with that username', field: 'username' }, 404);
  const state = await rel(other);

  if (action === 'request') {
    if (state === 'friends') return json({ ok: true, state });
    if (state === 'in') {   // they already asked you → you're friends now
      await Promise.all([store.set(`fr/${me}/${other}`, { uid: other, state: 'friends', at: now }), store.set(`fr/${other}/${me}`, { uid: me, state: 'friends', at: now })]);
      await ping(other, 'New friend', `${user.name} accepted your friend request`, `/#/dm/${me}`);   // opens your 1:1 chat
      return json({ ok: true, state: 'friends' });
    }
    await Promise.all([store.set(`fr/${me}/${other}`, { uid: other, state: 'out', at: now }), store.set(`fr/${other}/${me}`, { uid: me, state: 'in', at: now })]);
    await ping(other, 'Friend request', `${user.name} (@${user.username}) wants to be friends`, `/#/u/${me}`);   // opens their profile with Accept
    return json({ ok: true, state: 'out' });
  }
  if (action === 'respond') {
    if (state !== 'in') return json({ error: 'No request from this person' }, 404);
    if (body.accept) {
      await Promise.all([store.set(`fr/${me}/${other}`, { uid: other, state: 'friends', at: now }), store.set(`fr/${other}/${me}`, { uid: me, state: 'friends', at: now })]);
      await ping(other, 'New friend', `${user.name} accepted your friend request`, `/#/dm/${me}`);   // opens your 1:1 chat
      return json({ ok: true, state: 'friends' });
    }
    await Promise.all([store.del(`fr/${me}/${other}`), store.del(`fr/${other}/${me}`)]);
    return json({ ok: true, state: null });
  }
  if (action === 'remove') {
    await Promise.all([store.del(`fr/${me}/${other}`), store.del(`fr/${other}/${me}`)]);
    return json({ ok: true, state: null });
  }
  // Open (or create) the private 1:1 chat with a friend
  if (action === 'dm') {
    if (state !== 'friends') return json({ error: 'You can only message your friends — send a friend request first' }, 403);
    return json({ room: (await openDm(store, user, other)).room });
  }
  return json({ error: 'Not found' }, 404);
}

async function membersList(store, room, group) {
  const keys = await store.list(`mb/${room}/`);
  const pwv = group?.pw?.v || 0;
  const list = (await Promise.all(keys.map(k => store.get(k)))).filter(m => m?.uid && (!pwv || m.pwv === pwv || isAdminUid(group, m.uid)))
    .map(m => ({ uid: m.uid, name: m.name, username: m.username || null, admin: isAdminUid(group, m.uid), owner: !!group && m.uid === group.adminUid, joined: m.joined || 0 }))
    .sort((a, b) => b.owner - a.owner || b.admin - a.admin || a.name.localeCompare(b.name));
  return json({ members: list });
}

async function deleteRoom(store, room, group) {
  const files = new Set();
  const fileOf = u => u?.match?.(LOCAL_FILE)?.[1];
  const msgKeys = await store.list(`m/${room}/`);
  for (const k of msgKeys) { const m = await store.get(k); for (const id of [fileOf(m?.gif?.url), fileOf(m?.audio?.url)]) if (id) files.add(id); }
  for (const e of (await store.get(`tk/${room}`)) || []) { const id = fileOf(e.url); if (id) files.add(id); }
  if (fileOf(group?.photo)) files.add(fileOf(group.photo));
  const perRoom = (await Promise.all(['p', 'rd', 'gm', 'mb', 'ga', 'iv'].map(x => store.list(`${x}/${room}/`)))).flat();
  const jobs = [];
  for (const k of [...(await store.list('sc/')), ...(await store.list('rm/'))]) { const j = await store.get(k); if (j?.room === room) jobs.push(k); }
  const gp = await store.list(`gp/${room}/`);
  const keys = [...msgKeys, ...perRoom, ...jobs, ...gp, ...['g', 'r', 'v', 'x', 'tk', 'wt', 'pn', 'gs', 'ch'].map(x => `${x}/${room}`)];
  for (let i = 0; i < keys.length; i += 50) await Promise.all(keys.slice(i, i + 50).map(k => store.del(k)));
  await Promise.all([...files].map(id => store.delFile(`f/${id}`)));
}

async function groupRoute(action, { store, body, room, user, dev, loc, now, group, push }) {
  const bump = () => store.set(`v/${room}`, { v: newVersion(now) });
  const radiusOf = v => Math.round(Math.min(Math.max(Number(v) || 0, MIN_RADIUS), MAX_RADIUS));
  const pwOk = p => typeof p === 'string' && p.length >= 4 && p.length <= 64;
  const name = user.name;

  if (action === 'create') {
    if (room.startsWith('d-')) return json({ error: 'That group name isn’t allowed — try another' }, 400);   // reserved for 1:1 chats
    const type = ['open', 'private', 'geo', 'invite'].includes(body.type) ? body.type : 'open';
    const [msgs, meta] = await Promise.all([store.list(`m/${room}/`), store.get(`r/${room}`)]);
    if (room === 'general' || group || msgs.length || meta) return json({ error: 'That group name is already taken — try another', code: 'taken' }, 409);
    const password = typeof body.password === 'string' ? body.password : '';
    if (type === 'private' && !pwOk(password)) return json({ error: 'Choose a password of at least 4 characters' }, 400);
    if (password && !pwOk(password)) return json({ error: 'Passwords need 4–64 characters' }, 400);
    if (type === 'geo' && !loc) return json({ error: 'Your location is needed to create a location group' }, 400);
    const title = clean(body.title, 40) || room;
    const g = { room, title, adminUid: user.uid, adminName: name, admin: dev || null, created: now };
    if (type === 'geo') { g.center = { lat: loc.lat, lng: loc.lng }; g.radius = radiusOf(body.radius); }
    if (password && type !== 'invite') g.pw = { ...hashPassword(password), v: 1 };
    if (type === 'invite') g.invite = { code: crypto.randomBytes(9).toString('base64url') };
    await store.set(`g/${room}`, g);
    if (g.invite) await store.set(`iv/${room}/${user.uid}`, { by: user.uid, at: now });
    await store.del(`gx/${room}`);
    await saveRoomMeta(store, room, g, null);
    await touchMember(store, room, user, g);
    if (type === 'geo') await store.set(`gm/${room}/${user.uid}`, { uid: user.uid, name, inside: true, dist: 0, acc: Math.round(loc.acc), approved: true, req: null, at: now, seenAt: now });
    return json({ group: groupView(g, user, dev) });
  }

  if (action === 'members' && !group) return membersList(store, room, null);   // e.g. #general
  if (!group) return json({ error: 'Group not found' }, 404);
  const isAdmin = isAdminOf(group, user, dev);

  if (action === 'join' && group.invite) {         // invite-only: the invite link carries a code
    if (await hasAccess(store, group, room, user, dev)) return json({ ok: true });
    if (typeof body.code !== 'string' || body.code !== group.invite.code) return json({ error: 'This invite link is no longer valid — ask an admin for a new one', code: 'invite_only' }, 403);
    await store.set(`iv/${room}/${user.uid}`, { by: 'link', at: now });
    await touchMember(store, room, user, group);
    await store.set(`v/${room}`, { v: newVersion(now) });
    return json({ ok: true });
  }
  if (action === 'join') {
    if (!group.pw || await hasAccess(store, group, room, user, dev)) return json({ ok: true });
    const fk = room + user.uid, f = failedJoins.get(fk);
    if (f && f.until > now) return json({ error: 'Too many wrong attempts — wait a minute and try again' }, 429);
    if (!checkPassword(String(body.password || ''), group.pw)) {
      await sleep(400);
      const n = (f?.n || 0) + 1;
      failedJoins.set(fk, { n, until: n >= 5 ? now + 60_000 : 0 });
      return json({ error: 'That password isn’t right', code: 'bad_password' }, 401);
    }
    failedJoins.delete(fk);
    await store.set(`ga/${room}/${user.uid}`, { v: group.pw.v, at: now });
    await touchMember(store, room, user, group);
    return json({ ok: true });
  }

  if (!(await hasAccess(store, group, room, user, dev))) return json({ error: 'This group needs a password', code: 'locked' }, 403);

  // Members list (everyone who has opened the group), with who's admin
  if (action === 'members') return membersList(store, room, group);
  if (group.dm) return json({ error: 'Not available in a 1:1 chat' }, 400);

  // Add friends to the group (owner/admins). In invite-only groups this is how people get in.
  if (action === 'invite') {
    if (!isAdmin) return json({ error: 'Only group admins can add people' }, 403);
    const ids = [...new Set((Array.isArray(body.uids) ? body.uids : []).filter(x => typeof x === 'string' && ID.test(x) && x !== user.uid))].slice(0, 50);
    const added = [];
    for (const uid of ids) {
      if ((await store.get(`fr/${user.uid}/${uid}`))?.state !== 'friends') continue;      // only your friends
      const u = await store.get(`u/${uid}`); if (!u) continue;
      await store.set(`iv/${room}/${uid}`, { by: user.uid, at: now });
      if (group.pw) await store.set(`ga/${room}/${uid}`, { v: group.pw.v, at: now });   // added people skip the password
      if (isGeo(group)) { const gk = `gm/${room}/${uid}`, gmr = (await store.get(gk)) || { uid, name: u.name, inside: null, dist: null }; await store.set(gk, { ...gmr, approved: true, req: null }); }
      await touchMember(store, room, u, group);
      added.push({ uid, name: u.name });
    }
    if (added.length) {
      await bump();
      const job = getVapid(store, push?.vapidEnv).then(vapid => Promise.all(added.map(a => notifyUser(store, a.uid,
        { type: 'group', room, title: group.title || room, body: `${name} added you to the group`, url: `/#/g/${room}` }, { vapid, sender: push?.pushSender, siteOrigin: push?.origin }))));
      if (push?.waitUntil) push.waitUntil(job); else await job.catch(() => {});
    }
    return json({ ok: true, added });
  }

  if (action === 'update') {
    if (!isAdmin) return json({ error: 'Only the group admin can change this' }, 403);
    // Who can join: anyone with the link / password / invite only
    if (['open', 'password', 'invite'].includes(body.access)) {
      if (body.access === 'invite') {
        if (!group.invite) {
          group.invite = { code: crypto.randomBytes(9).toString('base64url') };
          // everyone who is already in the group stays in
          for (const k of await store.list(`mb/${room}/`)) { const mm = await store.get(k); if (mm?.uid && (!group.pw || mm.pwv === group.pw.v || isAdminUid(group, mm.uid))) await store.set(`iv/${room}/${mm.uid}`, { by: 'existing', at: now }); }
        }
        delete group.pw;
      } else {
        delete group.invite;
        if (body.access === 'open') delete group.pw;
        else if (!pwOk(body.password) && !group.pw) return json({ error: 'Choose a password of at least 4 characters' }, 400);
        else if (pwOk(body.password)) group.pw = { ...hashPassword(body.password), v: (group.pw?.v || 0) + 1 };
      }
      body.password = undefined;
    }
    if (body.resetLink && group.invite) group.invite = { code: crypto.randomBytes(9).toString('base64url') };   // old links stop working
    // Location limit on / off
    if (body.location === false && isGeo(group)) { delete group.center; delete group.radius; }
    if (body.location === true && !isGeo(group)) {
      if (!loc) return json({ error: 'Your location is needed to set the group’s area' }, 400);
      group.center = { lat: loc.lat, lng: loc.lng }; group.radius = radiusOf(body.radius || 300);
      await store.set(`gm/${room}/${user.uid}`, { uid: user.uid, name, inside: true, dist: 0, acc: Math.round(loc.acc), approved: true, req: null, at: now, seenAt: now });
    }
    const geoChange = isGeo(group) && (body.radius != null || body.recenter);
    if (isGeo(group) && body.radius != null) group.radius = radiusOf(body.radius);
    if (isGeo(group) && body.recenter) { if (!loc) return json({ error: 'Location needed' }, 400); group.center = { lat: loc.lat, lng: loc.lng }; }
    if (body.title) group.title = clean(body.title, 40) || group.title;
    if (body.photo === null && group.photo) { const id = group.photo.match(LOCAL_FILE)?.[1]; if (id) await store.delFile(`f/${id}`); delete group.photo; }
    if (body.password !== undefined) {
      if (body.password === null || body.password === '') delete group.pw;
      else if (!pwOk(body.password)) return json({ error: 'Passwords need 4–64 characters' }, 400);
      else group.pw = { ...hashPassword(body.password), v: (group.pw?.v || 0) + 1 };   // new version → everyone else must re-enter it
    }
    await store.set(`g/${room}`, group);
    await saveRoomMeta(store, room, group);
    if (group.pw) await touchMember(store, room, user, group);
    // Re-evaluate everyone's inside/outside against the new fence using their last known distance
    if (geoChange) {
      const keys = await store.list(`gm/${room}/`);
      await Promise.all(keys.map(async k => { const m = await store.get(k); if (m && m.uid !== user.uid) { m.inside = body.recenter ? null : (m.dist != null ? m.dist <= group.radius + Math.min(m.acc || 0, ACCURACY_SLACK) : null); await store.set(k, m); } }));
    }
    await bump();
    return json({ group: groupView(group, user, dev) });
  }

  // More admins: the owner or any admin can make a member an admin
  if (action === 'admin/add') {
    if (!isAdmin) return json({ error: 'Only group admins can do this' }, 403);
    const target = typeof body.member === 'string' && ID.test(body.member) ? await store.get(`mb/${room}/${body.member}`) : null;
    const tu = target && await store.get(`u/${target.uid}`);
    if (!tu) return json({ error: 'Pick someone who is a member of this group' }, 404);
    if (isAdminUid(group, tu.uid)) return json({ ok: true, group: groupView(group, user, dev) });
    group.admins = [...new Set([...(group.admins || []), tu.uid])].slice(0, 50);
    await store.set(`g/${room}`, group);
    if (isGeo(group)) {   // admins can always chat
      const gk = `gm/${room}/${tu.uid}`, gmr = (await store.get(gk)) || { uid: tu.uid, name: tu.name, inside: null, dist: null };
      await store.set(gk, { ...gmr, approved: true, req: null });
    }
    if (group.pw) await store.set(`ga/${room}/${tu.uid}`, { v: group.pw.v, at: now });
    await bump();
    return json({ ok: true, group: groupView(group, user, dev) });
  }
  // Remove an admin: the owner can remove anyone except themselves; an admin can step down. The owner is never removed.
  if (action === 'admin/remove') {
    const uid = typeof body.member === 'string' && ID.test(body.member) ? body.member : null;
    if (!uid) return json({ error: 'Pick an admin' }, 400);
    if (uid === group.adminUid) return json({ error: 'The group owner is always an admin', code: 'owner' }, 403);
    if (!(isOwnerOf(group, user, dev) || uid === user.uid)) return json({ error: 'Only the group owner can remove admins' }, 403);
    group.admins = (group.admins || []).filter(x => x !== uid);
    await store.set(`g/${room}`, group);
    await bump();
    return json({ ok: true, group: groupView(group, user, dev) });
  }
  // Delete the whole group (owner only): messages, members, files — for everyone
  if (action === 'delete') {
    if (!isOwnerOf(group, user, dev)) return json({ error: 'Only the group owner can delete the group' }, 403);
    if (clean(body.confirm, 40).toLowerCase() !== String(group.title || room).toLowerCase()) return json({ error: 'Type the group name to confirm' }, 400);
    await deleteRoom(store, room, group);
    await store.set(`gx/${room}`, { title: group.title || room, by: user.name, at: now });
    return json({ ok: true });
  }

  if (!isGeo(group)) return json({ error: 'Not a location group' }, 404);

  if (action === 'request') {
    const mk = `gm/${room}/${user.uid}`;
    const m = (await store.get(mk)) || { uid: user.uid, name, inside: null, dist: null, approved: false, at: 0 };
    if (m.approved) return json({ ok: true, already: true });
    if (m.req === 'pending') return json({ ok: true });
    Object.assign(m, { name, req: 'pending', reqAt: now, note: clean(body.note, 140) });
    await store.set(mk, m);
    await bump();
    return json({ ok: true });
  }

  if (action === 'decide') {
    if (!isAdmin) return json({ error: 'Only the group admin can do this' }, 403);
    const id = typeof body.member === 'string' && ID.test(body.member) ? body.member : null;
    const mk = id && `gm/${room}/${id}`;
    const m = mk && await store.get(mk);
    if (!m) return json({ error: 'Member not found' }, 404);
    if (body.action === 'approve') Object.assign(m, { approved: true, req: null });
    else if (body.action === 'deny') Object.assign(m, { approved: false, req: 'denied' });
    else if (body.action === 'revoke') Object.assign(m, { approved: false, req: null });
    else return json({ error: 'Unknown action' }, 400);
    await store.set(mk, m);
    await bump();
    return json({ ok: true });
  }

  return json({ error: 'Not found' }, 404);
}

// Adapter for @netlify/blobs stores
export function blobsAdapter(s) {
  return {
    list: async prefix => (await s.list({ prefix })).blobs.map(b => b.key),
    get: key => s.get(key, { type: 'json' }),
    set: (key, value) => s.setJSON(key, value),
    del: key => s.delete(key),
    setFile: (key, data, type) => s.set(key, data, { metadata: { type } }),
    getFile: async key => {
      const r = await s.getWithMetadata(key, { type: 'arrayBuffer' });
      return r && { data: r.data, type: r.metadata?.type || 'application/octet-stream' };
    },
    delFile: key => s.delete(key),
  };
}
