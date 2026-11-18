// Shared chat API used by both the Netlify Function and the local LAN server.
// Storage is a tiny key/value interface: list(prefix) -> keys[], get(key), set(key, value), del(key).
import crypto from 'node:crypto';

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
const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const samePassword = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

export async function handle(req, store, { password } = {}) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (password && !samePassword(req.headers.get('x-chat-password') || '', password))
    return json({ error: 'Wrong password' }, 401);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
  const name = clean(body.name, 24);
  if (!name) return json({ error: 'Name required' }, 400);
  const room = cleanRoom(body.room);
  const route = new URL(req.url).pathname.replace(/^\/api\/?/, '');
  const now = Date.now();
  const presenceKey = `p/${room}/${encodeURIComponent(name)}`;

  if (route === 'send') {
    const text = clean(body.text, MAX_TEXT);
    if (!text) return json({ error: 'Empty message' }, 400);
    seq = (seq + 1) % 1e6;
    const key = `m/${room}/${String(now).padStart(13, '0')}-${String(seq).padStart(6, '0')}-${crypto.randomBytes(3).toString('hex')}`;
    // Optional quoted reply: { key, name, text } of the message being answered
    let replyTo;
    const r = body.replyTo;
    if (r && typeof r.key === 'string' && r.key.startsWith(`m/${room}/`) && r.key.length < 80) {
      replyTo = { key: r.key, name: clean(r.name, 24), text: clean(r.text, 140) };
    }
    const msg = { key, room, name, text, ts: now, cid: clean(body.cid, 40) || undefined, replyTo };
    await Promise.all([store.set(key, msg), store.set(`r/${room}`, { room })]);
    await store.set(`v/${room}`, { v: newVersion(now) });   // wakes up waiting long-polls
    const keys = (await store.list(`m/${room}/`)).sort();
    if (keys.length > KEEP_PER_ROOM) await Promise.all(keys.slice(0, keys.length - KEEP_PER_ROOM).map(k => store.del(k)));
    return json({ message: msg });
  }

  if (route === 'typing') {
    await Promise.all([store.set(presenceKey, { name, seen: now, typingAt: now }), store.set(`v/${room}`, { v: newVersion(now) })]);
    return json({ ok: true });
  }

  if (route === 'poll') {
    const prev = await store.get(presenceKey);
    const presenceWrite = store.set(presenceKey, { name, seen: now, typingAt: prev?.typingAt || 0 });

    const since = typeof body.since === 'string' ? body.since : '';
    // Long-poll: hold the request until the room changes (new message / typing) or the wait expires.
    const known = typeof body.version === 'string' ? body.version : '';
    const wait = Math.min(Math.max(Number(body.wait) || 0, 0), MAX_WAIT_MS);
    let version = (await store.get(`v/${room}`))?.v || '';
    if (since && known && version === known && wait) {
      const deadline = Date.now() + wait;
      while (Date.now() < deadline && !req.signal?.aborted) {
        await sleep(CHECK_MS);
        version = (await store.get(`v/${room}`))?.v || '';
        if (version !== known) break;
      }
    }
    const t = Date.now();
    // Fetch messages, presence and rooms in parallel to keep latency low
    const loadMessages = async () => {
      const allKeys = (await store.list(`m/${room}/`)).sort();
      const sinceTs = Number(since.split('/')[2]?.slice(0, 13)) || 0;
      const cutoff = `m/${room}/${String(Math.max(0, sinceTs - OVERLAP_MS)).padStart(13, '0')}`;
      const newKeys = since ? allKeys.filter(k => k > cutoff) : allKeys.slice(-INITIAL_LOAD);
      return (await Promise.all(newKeys.map(k => store.get(k)))).filter(Boolean);
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
    const loadRooms = async () => [...new Set(['general', room, ...(await store.list('r/')).map(k => k.slice(2))])].sort();
    const [messages, users, rooms] = await Promise.all([loadMessages(), loadUsers(), loadRooms()]);
    await presenceWrite;
    return json({ messages, users, rooms, version });
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
  };
}
