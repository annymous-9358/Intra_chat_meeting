// Shared chat API used by both the Netlify Function and the local LAN server.
// Storage is a tiny key/value interface: list(prefix) -> keys[], get(key), set(key, value), del(key).
import crypto from 'node:crypto';
import { getVapid, cleanSubscription, notifyMembers, notifyUser } from './push.mjs';

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
const publicUser = u => u && { uid: u.uid, username: u.username, name: u.name };
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
const isAdminOf = (g, user, dev) => !!g && ((g.adminUid && user?.uid === g.adminUid) || (!g.adminUid && !!dev && g.admin === dev));
async function claimLegacyAdmin(store, room, g, user, dev) {
  if (g && !g.adminUid && user && dev && g.admin === dev) { g.adminUid = user.uid; g.adminName = user.name; await store.set(`g/${room}`, g); }
}
async function hasAccess(store, g, room, user, dev) {
  if (g?.dm) return !!user && g.members.includes(user.uid);      // 1:1 chats: only the two people
  if (!g?.pw) return true;
  if (isAdminOf(g, user, dev)) return true;
  const a = user && await store.get(`ga/${room}/${user.uid}`);
  return !!a && a.v === g.pw.v;            // joined with the current password
}
const groupView = (g, user, dev) => g && { title: g.title, geo: isGeo(g), locked: !!g.pw, radius: isGeo(g) ? g.radius : null, adminName: g.adminName || null, adminUid: g.adminUid || null, isAdmin: isAdminOf(g, user, dev) };
const previewOf = m => m.deleted ? '🚫 Message deleted' : m.text ? m.text.slice(0, 90) : m.audio ? (m.audio.walkie ? '📻 Walkie-talkie' : '🎤 Voice message') : m.gif ? '🎞️ GIF' : '';
async function saveRoomMeta(store, room, g, last) {
  const old = (await store.get(`r/${room}`)) || {};
  // the preview only moves forward (two quick sends can finish out of order)
  const keepOld = last && old.last?.key && old.last.key > last.key;
  const meta = { room, title: g?.title || old.title || null, geo: isGeo(g), locked: !!g?.pw, radius: isGeo(g) ? g.radius : null, last: last === undefined || keepOld ? old.last || null : last };
  if (g?.dm) { meta.dm = true; meta.members = g.members; meta.title = null; }
  await store.set(`r/${room}`, meta);
}
// ---------- Friends & 1:1 chats ----------
const dmRoomId = (a, b) => 'd-' + sha256([a, b].sort().join(':')).slice(0, 24);
const lastSeenOf = async (store, uid) => (await store.get(`ls/${uid}`))?.at || 0;
async function peerInfo(store, g, me) {
  const peerUid = g.members.find(u => u !== me.uid) || me.uid;
  const p = await store.get(`u/${peerUid}`);
  return { uid: peerUid, name: p?.name || 'Deleted account', username: p?.username || null, lastSeen: await lastSeenOf(store, peerUid) };
}
// Group membership (anyone who has opened the group). Used for the members list and notifications.
async function touchMember(store, room, user, g) {
  const key = `mb/${room}/${user.uid}`;
  const old = await store.get(key);
  const pwv = g?.pw?.v || 0;
  if (!old || old.name !== user.name || old.pwv !== pwv || old.username !== user.username) {
    await store.set(key, { uid: user.uid, name: user.name, username: user.username, pwv, muteUntil: old?.muteUntil || 0, joined: old?.joined || Date.now() });
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

export async function handle(req, store, { giphyKey, vapid: vapidEnv, waitUntil, pushSender } = {}) {
  const route = new URL(req.url).pathname.replace(/^\/api\/?/, '');

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

  // Push notifications for this device (stored under the account, so every signed-in device gets them)
  if (route === 'push/key') return json({ publicKey: (await getVapid(store, vapidEnv)).publicKey });
  if (route === 'push/subscribe') {
    const sub = cleanSubscription(body.subscription);
    if (!dev || !sub) return json({ error: 'Invalid subscription' }, 400);
    await store.set(`ps/${user.uid}/${dev}`, { sub, at: now });
    return json({ ok: true });
  }
  if (route === 'push/unsubscribe') { if (dev) await store.del(`ps/${user.uid}/${dev}`); return json({ ok: true }); }

  if (route === 'rooms') return json({ rooms: await listRooms(store, room, user, dev, body.reads) });
  if (route.startsWith('friends/')) return friendsRoute(route.slice(8), { store, body, user, vapidEnv, waitUntil, pushSender, origin: new URL(req.url).origin });
  if (route === 'gifs') return gifSearch(giphyKey, clean(body.q, 50));

  let group = await store.get(`g/${room}`);
  await claimLegacyAdmin(store, room, group, user, dev);
  if (route.startsWith('group/')) return groupRoute(route.slice(6), { store, body, room, user, dev, loc, now, group });

  // Everything below needs access to the room
  if (!(await hasAccess(store, group, room, user, dev)))
    return json({ error: 'This group needs a password', code: 'locked', group: groupView(group, user, dev) }, 403);
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
    seq = (seq + 1) % 1e6;
    const mkey = `m/${room}/${String(now).padStart(13, '0')}-${String(seq).padStart(6, '0')}-${crypto.randomBytes(3).toString('hex')}`;
    // Optional quoted reply: { key, name, text } of the message being answered
    let replyTo;
    const r = body.replyTo;
    if (r && typeof r.key === 'string' && r.key.startsWith(`m/${room}/`) && r.key.length < 80) {
      const orig = await store.get(r.key);
      replyTo = { key: r.key, name: orig?.name || clean(r.name, 24), uid: orig?.uid, text: clean(r.text, 140) };
    }
    const msg = { key: mkey, room, uid: user.uid, name, text, gif, audio, ts: now, cid: clean(body.cid, 40) || undefined, replyTo };
    await Promise.all([store.set(mkey, msg), store.set(`ls/${user.uid}`, { at: now })]);
    await Promise.all([store.set(`v/${room}`, { v: newVersion(now) }), saveRoomMeta(store, room, group, { name, uid: user.uid, text: previewOf(msg), ts: now, key: mkey }), touchMember(store, room, user, group),
      store.set(presenceKey, { uid: user.uid, name, seen: now, typingAt: 0 })]);   // sending ends "typing…"
    const keys = (await store.list(`m/${room}/`)).sort();
    if (keys.length > KEEP_PER_ROOM) {
      // Prune old messages, and any uploaded files they used
      await Promise.all(keys.slice(0, keys.length - KEEP_PER_ROOM).map(async k => {
        const old = await store.get(k);
        const ids = [old?.gif?.url, old?.audio?.url].map(u => u?.match(LOCAL_FILE)?.[1]).filter(Boolean);
        await Promise.all([store.del(k), ...ids.map(id => store.delFile(`f/${id}`))]);
      }));
    }
    // Notify the other members (runs after the response where the platform allows it)
    const pushJob = getVapid(store, vapidEnv).then(vapid => notifyMembers(store, { room, group, msg, senderUid: user.uid, vapid, sender: pushSender, siteOrigin: new URL(req.url).origin }));
    if (waitUntil) waitUntil(pushJob); else await pushJob;
    return json({ message: pub(msg) });
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
    if (meta?.last?.key === mkey) await saveRoomMeta(store, room, group, { ...meta.last, text: '🚫 Message deleted' });
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
    return json({ ok: true });
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
      if (g.dm) { const peer = await peerInfo(store, g, user); return { dm: true, title: peer.name, peer, isAdmin: false, locked: false, geo: false }; }
      // keep the admin name in step with the admin account's current name
      if (out.isAdmin && g.adminName !== name) { g.adminName = name; out.adminName = name; await store.set(`g/${room}`, g); }
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
    const [messages, users, rooms, receipts, groupInfo, edits, talk] = await Promise.all([loadMessages(), loadUsers(), listRooms(store, room, user, dev, body.reads), loadReceipts(), loadGroup(), loadEdits(), loadTalk()]);
    const mem = await membership;
    await presenceWrite;
    return json({ messages, users, rooms, receipts, group: groupInfo, edits, talk, xt: t, muteUntil: mem?.muteUntil || 0, version });
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

async function listRooms(store, current, user, dev, reads) {
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
    // Locked groups: hide message previews unless this account has joined with the current password (or is the admin)
    if (m.locked) {
      const g = await store.get(`g/${m.room}`);
      access = await hasAccess(store, g, m.room, user, dev);
      if (!access && last) last = { ts: last.ts, key: last.key };
    }
    return { room: m.room, title: m.title || null, geo: !!m.geo, locked: !!m.locked, access, radius: m.radius || null, last, unread };
  }));
  return out.sort((a, b) => (b.last?.ts || 0) - (a.last?.ts || 0) || a.room.localeCompare(b.room));
}

async function friendsRoute(action, { store, body, user, vapidEnv, waitUntil, pushSender, origin }) {
  const me = user.uid;
  const rel = async other => (await store.get(`fr/${me}/${other}`))?.state || null;
  const card = async (uid, state) => { const u = await store.get(`u/${uid}`); return u && { uid, name: u.name, username: u.username, state, lastSeen: await lastSeenOf(store, uid) }; };
  const ping = (uid, title, text, url) => {           // push a friend notification to all of that person's devices
    const job = getVapid(store, vapidEnv).then(vapid => notifyUser(store, uid, { type: 'friend', room: 'friends', title, body: text, url }, { vapid, sender: pushSender, siteOrigin: origin }));
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
      await ping(other, '🤝 New friend', `${user.name} accepted your friend request`, '/#/friends');
      return json({ ok: true, state: 'friends' });
    }
    await Promise.all([store.set(`fr/${me}/${other}`, { uid: other, state: 'out', at: now }), store.set(`fr/${other}/${me}`, { uid: me, state: 'in', at: now })]);
    await ping(other, '👋 Friend request', `${user.name} (@${user.username}) wants to be friends`, '/#/friends');
    return json({ ok: true, state: 'out' });
  }
  if (action === 'respond') {
    if (state !== 'in') return json({ error: 'No request from this person' }, 404);
    if (body.accept) {
      await Promise.all([store.set(`fr/${me}/${other}`, { uid: other, state: 'friends', at: now }), store.set(`fr/${other}/${me}`, { uid: me, state: 'friends', at: now })]);
      await ping(other, '🤝 New friend', `${user.name} accepted your friend request`, '/#/friends');
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
    const room = dmRoomId(me, other);
    let g = await store.get(`g/${room}`);
    if (!g) {
      g = { room, dm: true, members: [me, other].sort(), created: now };
      await store.set(`g/${room}`, g);
      await saveRoomMeta(store, room, g, null);
    }
    const ou = await store.get(`u/${other}`);
    await Promise.all([touchMember(store, room, user, g), ou && touchMember(store, room, ou, g)]);   // both get notifications from the start
    return json({ room });
  }
  return json({ error: 'Not found' }, 404);
}

async function membersList(store, room, group) {
  const keys = await store.list(`mb/${room}/`);
  const pwv = group?.pw?.v || 0;
  const list = (await Promise.all(keys.map(k => store.get(k)))).filter(m => m?.uid && (!pwv || m.pwv === pwv || m.uid === group?.adminUid))
    .map(m => ({ uid: m.uid, name: m.name, username: m.username || null, admin: !!group && m.uid === group.adminUid, joined: m.joined || 0 }))
    .sort((a, b) => b.admin - a.admin || a.name.localeCompare(b.name));
  return json({ members: list });
}

async function groupRoute(action, { store, body, room, user, dev, loc, now, group }) {
  const bump = () => store.set(`v/${room}`, { v: newVersion(now) });
  const radiusOf = v => Math.round(Math.min(Math.max(Number(v) || 0, MIN_RADIUS), MAX_RADIUS));
  const pwOk = p => typeof p === 'string' && p.length >= 4 && p.length <= 64;
  const name = user.name;

  if (action === 'create') {
    if (room.startsWith('d-')) return json({ error: 'That group name isn’t allowed — try another' }, 400);   // reserved for 1:1 chats
    const type = ['open', 'private', 'geo'].includes(body.type) ? body.type : 'open';
    const [msgs, meta] = await Promise.all([store.list(`m/${room}/`), store.get(`r/${room}`)]);
    if (room === 'general' || group || msgs.length || meta) return json({ error: 'That group name is already taken — try another', code: 'taken' }, 409);
    const password = typeof body.password === 'string' ? body.password : '';
    if (type === 'private' && !pwOk(password)) return json({ error: 'Choose a password of at least 4 characters' }, 400);
    if (password && !pwOk(password)) return json({ error: 'Passwords need 4–64 characters' }, 400);
    if (type === 'geo' && !loc) return json({ error: 'Your location is needed to create a location group' }, 400);
    const title = clean(body.title, 40) || room;
    const g = { room, title, adminUid: user.uid, adminName: name, admin: dev || null, created: now };
    if (type === 'geo') { g.center = { lat: loc.lat, lng: loc.lng }; g.radius = radiusOf(body.radius); }
    if (password) g.pw = { ...hashPassword(password), v: 1 };
    await store.set(`g/${room}`, g);
    await saveRoomMeta(store, room, g, null);
    await touchMember(store, room, user, g);
    if (type === 'geo') await store.set(`gm/${room}/${user.uid}`, { uid: user.uid, name, inside: true, dist: 0, acc: Math.round(loc.acc), approved: true, req: null, at: now, seenAt: now });
    return json({ group: groupView(g, user, dev) });
  }

  if (action === 'members' && !group) return membersList(store, room, null);   // e.g. #general
  if (!group) return json({ error: 'Group not found' }, 404);
  const isAdmin = isAdminOf(group, user, dev);

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

  if (action === 'update') {
    if (!isAdmin) return json({ error: 'Only the group admin can change this' }, 403);
    const geoChange = isGeo(group) && (body.radius != null || body.recenter);
    if (isGeo(group) && body.radius != null) group.radius = radiusOf(body.radius);
    if (isGeo(group) && body.recenter) { if (!loc) return json({ error: 'Location needed' }, 400); group.center = { lat: loc.lat, lng: loc.lng }; }
    if (body.title) group.title = clean(body.title, 40) || group.title;
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

  // Hand the group over to another member
  if (action === 'transfer') {
    if (!isAdmin) return json({ error: 'Only the group admin can do this' }, 403);
    const target = typeof body.member === 'string' && ID.test(body.member) && body.member !== user.uid ? await store.get(`mb/${room}/${body.member}`) : null;
    if (!target) return json({ error: 'Pick someone who is a member of this group' }, 404);
    const tu = await store.get(`u/${target.uid}`);
    if (!tu) return json({ error: 'That person no longer has an account' }, 404);
    group.adminUid = tu.uid; group.adminName = tu.name; group.admin = null;
    await store.set(`g/${room}`, group);
    if (isGeo(group)) {   // the new admin can always chat; the previous admin becomes a normal member
      const gk = `gm/${room}/${tu.uid}`, gmr = (await store.get(gk)) || { uid: tu.uid, name: tu.name, inside: null, dist: null };
      await store.set(gk, { ...gmr, approved: true, req: null });
    }
    if (group.pw) await store.set(`ga/${room}/${user.uid}`, { v: group.pw.v, at: now });   // old admin keeps access
    await bump();
    return json({ ok: true, group: groupView(group, user, dev) });
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
