// Shared chat API used by both the Netlify Function and the local LAN server.
// Storage is a tiny key/value interface: list(prefix) -> keys[], get(key), set(key, value), del(key).
import crypto from 'node:crypto';
import { getVapid, cleanSubscription, touchMembership, notifyMembers } from './push.mjs';

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
  return { url: a.url, dur, peaks };
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

// Work out (and persist when it changes) a member's standing in a location group
async function memberState(store, group, room, dev, name, loc, now) {
  const isAdmin = !!dev && group.admin === dev;
  const key = dev && `gm/${room}/${dev}`;
  const old = (key && await store.get(key)) || null;
  let inside = null, dist = null;
  if (loc) {
    dist = Math.round(distanceM(group.center, loc));
    inside = dist <= group.radius + Math.min(loc.acc || 0, ACCURACY_SLACK);
  }
  const rec = { dev, name, inside: inside ?? old?.inside ?? null, dist: dist ?? old?.dist ?? null, acc: loc ? Math.round(loc.acc) : old?.acc ?? null,
    approved: !!old?.approved, req: old?.req || null, reqAt: old?.reqAt || 0, note: old?.note || '', at: loc ? now : old?.at || 0 };
  let changed = false;
  if (key && (!old || old.inside !== rec.inside || old.name !== name || now - (old.seenAt || 0) > 60_000 || (loc && Math.abs((old.dist ?? 0) - rec.dist) > 100))) {
    rec.seenAt = now;
    changed = !old || old.inside !== rec.inside;
    await store.set(key, rec);
  }
  const fresh = loc != null;
  const canChat = isAdmin || rec.approved || (fresh && rec.inside === true);
  return { isAdmin, changed, rec, canChat, fresh };
}
// ---------- Group access (per-group passwords) ----------
// Groups are "open" (anyone with the link) or locked with their own password set by the group's admin.
// Joining with the right password returns a key (HMAC of room + password version); changing the password
// bumps the version so old keys stop working. Passwords are stored only as salted scrypt hashes.
let secretCache = null;
async function serverSecret(store) {
  if (secretCache) return secretCache;
  let rec = await store.get('cfg/secret');
  if (!rec?.s) { await store.set('cfg/secret', { s: crypto.randomBytes(32).toString('hex') }); rec = await store.get('cfg/secret'); }
  return (secretCache = rec.s);
}
const hashPassword = (pw, salt = crypto.randomBytes(16).toString('hex')) => ({ salt, hash: crypto.scryptSync(String(pw), salt, 32).toString('hex') });
const checkPassword = (pw, rec) => !!rec && crypto.timingSafeEqual(Buffer.from(hashPassword(pw, rec.salt).hash, 'hex'), Buffer.from(rec.hash, 'hex'));
const roomKey = (secret, room, v) => crypto.createHmac('sha256', secret).update(`${room}:${v}`).digest('hex').slice(0, 32);
async function hasAccess(store, group, room, dev, key) {
  if (!group?.pw) return true;
  if (dev && group.admin === dev) return true;
  if (typeof key !== 'string' || key.length !== 32) return false;
  const expected = roomKey(await serverSecret(store), room, group.pw.v);
  return crypto.timingSafeEqual(Buffer.from(key), Buffer.from(expected));
}
const isGeo = g => !!g?.center;
const groupView = g => g && { title: g.title, geo: isGeo(g), locked: !!g.pw, radius: isGeo(g) ? g.radius : null, adminName: g.adminName || null };
const previewOf = m => m.text ? m.text.slice(0, 90) : m.audio ? '🎤 Voice message' : m.gif ? '🎞️ GIF' : '';
async function saveRoomMeta(store, room, g, last) {
  const old = (await store.get(`r/${room}`)) || {};
  await store.set(`r/${room}`, { room, title: g?.title || old.title || null, geo: isGeo(g), locked: !!g?.pw, radius: isGeo(g) ? g.radius : null, last: last === undefined ? old.last || null : last });
}
const failedJoins = new Map();
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
}   // room+device -> { n, until } (simple brute-force brake per server instance)

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
  const key = req.headers.get('x-room-key') || '';

  if (route === 'upload') {
    // Uploads are tied to a room the uploader can access
    const room = cleanRoom(req.headers.get('x-chat-room'));
    const group = await store.get(`g/${room}`);
    if (!(await hasAccess(store, group, room, dev, key))) return json({ error: 'This group is locked', code: 'locked' }, 403);
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
  const name = clean(body.name, 24);
  if (!name) return json({ error: 'Name required' }, 400);
  const room = cleanRoom(body.room);
  const loc = cleanLoc(body.loc);
  const now = Date.now();
  const presenceKey = `p/${room}/${encodeURIComponent(name)}`;

  // Push notifications for this device
  if (route === 'push/key') return json({ publicKey: (await getVapid(store, vapidEnv)).publicKey });
  if (route === 'push/subscribe') {
    const sub = cleanSubscription(body.subscription);
    if (!dev || !sub) return json({ error: 'Invalid subscription' }, 400);
    await store.set(`ps/${dev}`, { sub, name, at: now });
    return json({ ok: true });
  }
  if (route === 'push/unsubscribe') { if (dev) await store.del(`ps/${dev}`); return json({ ok: true }); }

  // Chat list. The client passes the keys it holds so it gets message previews for locked groups it has joined.
  if (route === 'rooms') return json({ rooms: await listRooms(store, room, dev, body.keys) });

  if (route === 'gifs') return gifSearch(giphyKey, clean(body.q, 50));

  if (route.startsWith('group/')) return groupRoute(route.slice(6), { store, body, room, dev, key, name, loc, now });

  // Everything below needs access to the room
  const group = await store.get(`g/${room}`);
  if (!(await hasAccess(store, group, room, dev, key)))
    return json({ error: 'This group needs a password', code: 'locked', group: groupView(group) }, 403);

  if (route === 'send') {
    const text = clean(body.text, MAX_TEXT);
    const gif = cleanGif(body.gif);
    const audio = cleanAudio(body.audio);
    if (!text && !gif && !audio) return json({ error: 'Empty message' }, 400);
    if (isGeo(group)) {
      const st = await memberState(store, group, room, dev, name, loc, now);
      if (!st.canChat) return json({ error: st.fresh ? 'You’re outside this group’s range. Ask the admin to let you chat.' : 'Your location is needed to chat in this group', code: 'out_of_range' }, 403);
    }
    seq = (seq + 1) % 1e6;
    const mkey = `m/${room}/${String(now).padStart(13, '0')}-${String(seq).padStart(6, '0')}-${crypto.randomBytes(3).toString('hex')}`;
    // Optional quoted reply: { key, name, text } of the message being answered
    let replyTo;
    const r = body.replyTo;
    if (r && typeof r.key === 'string' && r.key.startsWith(`m/${room}/`) && r.key.length < 80) {
      replyTo = { key: r.key, name: clean(r.name, 24), text: clean(r.text, 140) };
    }
    const msg = { key: mkey, room, name, text, gif, audio, ts: now, cid: clean(body.cid, 40) || undefined, replyTo, dev: dev || undefined };
    await store.set(mkey, msg);
    await Promise.all([store.set(`v/${room}`, { v: newVersion(now) }), saveRoomMeta(store, room, group, { name, text: previewOf(msg), ts: now, key: mkey })]);
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
    const pushJob = getVapid(store, vapidEnv).then(vapid => notifyMembers(store, { room, group, msg, senderDev: dev, vapid, sender: pushSender, siteOrigin: new URL(req.url).origin }));
    if (waitUntil) waitUntil(pushJob); else await pushJob;
    return json({ message: pub(msg) });
  }

  // Mute this group's notifications on this device until a time (0 = unmute, -1 = always)
  if (route === 'push/mute') {
    if (!dev) return json({ error: 'Device id missing' }, 400);
    const until = Number(body.until) === -1 ? 8.64e15 : Math.max(0, Math.min(Number(body.until) || 0, 8.64e15));
    const k = `pm/${room}/${dev}`;
    const m = (await store.get(k)) || { dev, name, pwv: group?.pw?.v || 0, at: now };
    m.muteUntil = until; await store.set(k, m);
    return json({ ok: true, muteUntil: until });
  }

  // Emoji reaction (one per person; picking the same one again removes it)
  if (route === 'react') {
    const mkey = typeof body.key === 'string' && body.key.startsWith(`m/${room}/`) ? body.key : null;
    if (!mkey || !(await store.get(mkey))) return json({ error: 'Message not found' }, 404);
    if (body.emoji && !REACTIONS.includes(body.emoji)) return json({ error: 'Unsupported reaction' }, 400);
    const x = (await store.get(`x/${room}`)) || {};
    const reactions = { ...(x[mkey]?.reactions || {}) };
    const had = (reactions[body.emoji] || []).includes(name);
    for (const e of Object.keys(reactions)) { reactions[e] = reactions[e].filter(n => n !== name); if (!reactions[e].length) delete reactions[e]; }
    if (body.emoji && !had) reactions[body.emoji] = [...(reactions[body.emoji] || []), name];
    const edit = await recordEdit(store, room, mkey, { reactions });
    await store.set(`v/${room}`, { v: newVersion(now) });
    return json({ ok: true, edit });
  }

  // Delete for everyone: the sender (same device) or the group admin
  if (route === 'delete') {
    const mkey = typeof body.key === 'string' && body.key.startsWith(`m/${room}/`) ? body.key : null;
    const m = mkey && await store.get(mkey);
    if (!m) return json({ error: 'Message not found' }, 404);
    const isAdmin = !!dev && group?.admin === dev;
    if (!((dev && m.dev === dev) || isAdmin)) return json({ error: 'You can only delete your own messages' }, 403);
    const ids = [m.gif?.url, m.audio?.url].map(u => u?.match(LOCAL_FILE)?.[1]).filter(Boolean);
    await Promise.all([store.set(mkey, { key: mkey, room, name: m.name, ts: m.ts, deleted: true, dev: m.dev }), ...ids.map(id => store.delFile(`f/${id}`))]);
    await recordEdit(store, room, mkey, { deleted: true, reactions: {} });
    const meta = await store.get(`r/${room}`);
    if (meta?.last?.key === mkey) await saveRoomMeta(store, room, group, { ...meta.last, text: '🚫 Message deleted' });
    await store.set(`v/${room}`, { v: newVersion(now) });
    return json({ ok: true });
  }

  if (route === 'typing') {
    await Promise.all([store.set(presenceKey, { name, seen: now, typingAt: now }), store.set(`v/${room}`, { v: newVersion(now) })]);
    return json({ ok: true });
  }

  if (route === 'poll') {
    const prev = await store.get(presenceKey);
    const presenceWrite = store.set(presenceKey, { name, seen: now, typingAt: prev?.typingAt || 0 });
    const membership = touchMembership(store, room, dev, name, group?.pw?.v);

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
      const rk = `rd/${room}/${encodeURIComponent(name)}`;
      const old = (await store.get(rk)) || {};
      const read = [old.read || '', ackR].sort().pop();
      const delivered = [old.delivered || '', ackD, read].sort().pop();
      if (read !== (old.read || '') || delivered !== (old.delivered || '')) {
        await store.set(rk, { name, delivered, read, at: now });
        await bumpOwn();                                         // wake senders so their ticks update
      }
    }

    // Location groups: update this member's standing; status flips wake the admin's screen
    if (isGeo(group)) {
      const st = await memberState(store, group, room, dev, name, loc, now);
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
    // Fetch messages, presence, rooms, receipts and group info in parallel to keep latency low
    const loadMessages = async () => {
      const allKeys = (await store.list(`m/${room}/`)).sort();
      const sinceTs = Number(since.split('/')[2]?.slice(0, 13)) || 0;
      const cutoff = `m/${room}/${String(Math.max(0, sinceTs - OVERLAP_MS)).padStart(13, '0')}`;
      const newKeys = since ? allKeys.filter(k => k > cutoff) : allKeys.slice(-INITIAL_LOAD);
      return (await Promise.all(newKeys.map(k => store.get(k)))).filter(Boolean).map(pub);
    };
    // Reactions / deletions changed since the client's last look
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
        if (!p || t - p.seen > STALE_MS) { stale.push(k); continue; }
        if (t - p.seen <= ONLINE_MS) users.push({ name: p.name, typing: t - (p.typingAt || 0) < TYPING_MS });
      }
      await Promise.all(stale.map(k => store.del(k)));
      return users;
    };
    const loadGroup = async () => {
      if (!group) return null;
      const g = (await store.get(`g/${room}`)) || group;          // may have been edited while we waited
      const isAdmin = !!dev && g.admin === dev;
      // Admin rights belong to the device that created the group; keep the shown admin name in step with that device's current name
      if (isAdmin && g.adminName !== name) { g.adminName = name; await store.set(`g/${room}`, g); }
      const out = { ...groupView(g), isAdmin };
      if (!isGeo(g)) return out;
      const me = await memberState(store, g, room, dev, name, loc, Date.now());
      out.me = { inside: me.rec.inside, dist: me.rec.dist, acc: me.rec.acc, canChat: me.canChat, approved: me.rec.approved, req: me.rec.req, hasLocation: me.fresh };
      if (isAdmin) {
        out.center = g.center;
        const keys = await store.list(`gm/${room}/`);
        out.members = (await Promise.all(keys.map(k => store.get(k)))).filter(m => m && m.dev !== g.admin)
          .map(m => ({ id: m.dev, name: m.name, inside: m.inside, dist: m.dist, acc: m.acc, approved: m.approved, req: m.req, note: m.note, reqAt: m.reqAt, at: m.at }))
          .sort((a, b) => (b.req === 'pending') - (a.req === 'pending') || (b.at || 0) - (a.at || 0));
      }
      return out;
    };
    const loadReceipts = async () => {
      const keys = await store.list(`rd/${room}/`);
      return (await Promise.all(keys.map(k => store.get(k)))).filter(Boolean).map(r => ({ name: r.name, delivered: r.delivered, read: r.read }));
    };
    const [messages, users, rooms, receipts, groupInfo, edits] = await Promise.all([loadMessages(), loadUsers(), listRooms(store, room, dev, body.keys), loadReceipts(), loadGroup(), loadEdits()]);
    const mem = await membership;
    await presenceWrite;
    return json({ messages, users, rooms, receipts, group: groupInfo, edits, xt: t, muteUntil: mem?.muteUntil || 0, version });
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

async function listRooms(store, current, dev, keys) {
  const metaKeys = await store.list('r/');
  const metas = (await Promise.all(metaKeys.map(k => store.get(k)))).filter(m => m?.room);
  const map = new Map([['general', { room: 'general' }]]);
  for (const m of metas) map.set(m.room, m);
  if (current && !map.has(current)) map.set(current, { room: current });
  const held = keys && typeof keys === 'object' ? keys : {};
  const out = await Promise.all([...map.values()].map(async m => {
    let last = m.last || null;
    // Hide previews of locked groups unless the caller holds a valid key (or is the admin)
    if (m.locked && last) {
      const g = await store.get(`g/${m.room}`);
      if (!(await hasAccess(store, g, m.room, dev, held[m.room]))) last = { ts: last.ts, key: last.key };
    }
    return { room: m.room, title: m.title || null, geo: !!m.geo, locked: !!m.locked, radius: m.radius || null, last };
  }));
  return out.sort((a, b) => (b.last?.ts || 0) - (a.last?.ts || 0) || a.room.localeCompare(b.room));
}

async function groupRoute(action, { store, body, room, dev, key, name, loc, now }) {
  if (!dev) return json({ error: 'Device id missing' }, 400);
  const bump = () => store.set(`v/${room}`, { v: newVersion(now) });
  const radiusOf = v => Math.round(Math.min(Math.max(Number(v) || 0, MIN_RADIUS), MAX_RADIUS));
  const pwOk = p => typeof p === 'string' && p.length >= 4 && p.length <= 64;

  if (action === 'create') {
    const type = ['open', 'private', 'geo'].includes(body.type) ? body.type : 'open';
    const [existing, msgs, meta] = await Promise.all([store.get(`g/${room}`), store.list(`m/${room}/`), store.get(`r/${room}`)]);
    if (room === 'general' || existing || msgs.length || meta) return json({ error: 'That group name is already taken — try another', code: 'taken' }, 409);
    const password = typeof body.password === 'string' ? body.password : '';
    if (type === 'private' && !pwOk(password)) return json({ error: 'Choose a password of at least 4 characters' }, 400);
    if (password && !pwOk(password)) return json({ error: 'Passwords need 4–64 characters' }, 400);
    if (type === 'geo' && !loc) return json({ error: 'Your location is needed to create a location group' }, 400);
    const title = clean(body.title, 40) || room;
    const group = { room, title, admin: dev, adminName: name, created: now };
    if (type === 'geo') { group.center = { lat: loc.lat, lng: loc.lng }; group.radius = radiusOf(body.radius); }
    if (password) group.pw = { ...hashPassword(password), v: 1 };
    await store.set(`g/${room}`, group);
    await saveRoomMeta(store, room, group, null);
    if (type === 'geo') await store.set(`gm/${room}/${dev}`, { dev, name, inside: true, dist: 0, acc: Math.round(loc.acc), approved: true, req: null, at: now, seenAt: now });
    return json({ group: groupView(group), key: group.pw ? roomKey(await serverSecret(store), room, group.pw.v) : null });
  }

  const group = await store.get(`g/${room}`);
  if (!group) return json({ error: 'Group not found' }, 404);
  const isAdmin = group.admin === dev;

  if (action === 'join') {
    if (!group.pw) return json({ ok: true, key: null });
    const fk = room + dev, f = failedJoins.get(fk);
    if (f && f.until > now) return json({ error: 'Too many wrong attempts — wait a minute and try again' }, 429);
    if (!checkPassword(String(body.password || ''), group.pw)) {
      await sleep(400);
      const n = (f?.n || 0) + 1;
      failedJoins.set(fk, { n, until: n >= 5 ? now + 60_000 : 0 });
      return json({ error: 'That password isn’t right', code: 'bad_password' }, 401);
    }
    failedJoins.delete(fk);
    return json({ ok: true, key: roomKey(await serverSecret(store), room, group.pw.v) });
  }

  if (!(await hasAccess(store, group, room, dev, key))) return json({ error: 'This group needs a password', code: 'locked' }, 403);

  if (action === 'update') {
    if (!isAdmin) return json({ error: 'Only the group admin can change this' }, 403);
    const geoChange = isGeo(group) && (body.radius != null || body.recenter);
    if (isGeo(group) && body.radius != null) group.radius = radiusOf(body.radius);
    if (isGeo(group) && body.recenter) { if (!loc) return json({ error: 'Location needed' }, 400); group.center = { lat: loc.lat, lng: loc.lng }; }
    if (body.title) group.title = clean(body.title, 40) || group.title;
    if (body.password !== undefined) {
      if (body.password === null || body.password === '') delete group.pw;
      else if (!pwOk(body.password)) return json({ error: 'Passwords need 4–64 characters' }, 400);
      else group.pw = { ...hashPassword(body.password), v: (group.pw?.v || 0) + 1 };   // new version → old keys stop working
    }
    await store.set(`g/${room}`, group);
    await saveRoomMeta(store, room, group);
    // Re-evaluate everyone's inside/outside against the new fence using their last known distance
    if (geoChange) {
      const keys = await store.list(`gm/${room}/`);
      await Promise.all(keys.map(async k => { const m = await store.get(k); if (m && m.dev !== dev) { m.inside = body.recenter ? null : (m.dist != null ? m.dist <= group.radius + Math.min(m.acc || 0, ACCURACY_SLACK) : null); await store.set(k, m); } }));
    }
    await bump();
    return json({ group: groupView(group), key: group.pw ? roomKey(await serverSecret(store), room, group.pw.v) : null });
  }

  if (!isGeo(group)) return json({ error: 'Not a location group' }, 404);

  if (action === 'request') {
    const mk = `gm/${room}/${dev}`;
    const m = (await store.get(mk)) || { dev, name, inside: null, dist: null, approved: false, at: 0 };
    if (m.approved) return json({ ok: true, already: true });
    if (m.req === 'pending') return json({ ok: true });
    Object.assign(m, { name, req: 'pending', reqAt: now, note: clean(body.note, 140) });
    await store.set(mk, m);
    await bump();
    return json({ ok: true });
  }

  if (action === 'decide') {
    if (!isAdmin) return json({ error: 'Only the group admin can do this' }, 403);
    const id = typeof body.member === 'string' && /^[a-f0-9]{24}$/.test(body.member) ? body.member : null;
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
