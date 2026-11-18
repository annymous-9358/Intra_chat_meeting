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
    const msg = { key, room, name, text, ts: now };
    await Promise.all([store.set(key, msg), store.set(`r/${room}`, { room })]);
    const keys = (await store.list(`m/${room}/`)).sort();
    if (keys.length > KEEP_PER_ROOM) await Promise.all(keys.slice(0, keys.length - KEEP_PER_ROOM).map(k => store.del(k)));
    return json({ message: msg });
  }

  if (route === 'typing') {
    await store.set(presenceKey, { name, seen: now, typingAt: now });
    return json({ ok: true });
  }

  if (route === 'poll') {
    const prev = await store.get(presenceKey);
    await store.set(presenceKey, { name, seen: now, typingAt: prev?.typingAt || 0 });

    const since = typeof body.since === 'string' ? body.since : '';
    const allKeys = (await store.list(`m/${room}/`)).sort();
    const sinceTs = Number(since.split('/')[2]?.slice(0, 13)) || 0;
    const cutoff = `m/${room}/${String(Math.max(0, sinceTs - OVERLAP_MS)).padStart(13, '0')}`;
    const newKeys = since ? allKeys.filter(k => k > cutoff) : allKeys.slice(-INITIAL_LOAD);
    const messages = (await Promise.all(newKeys.map(k => store.get(k)))).filter(Boolean);

    const pKeys = await store.list(`p/${room}/`);
    const entries = await Promise.all(pKeys.map(async k => [k, await store.get(k)]));
    const users = [];
    for (const [k, p] of entries) {
      if (!p || now - p.seen > STALE_MS) { await store.del(k); continue; }
      if (now - p.seen <= ONLINE_MS) users.push({ name: p.name, typing: now - (p.typingAt || 0) < TYPING_MS });
    }
    const rooms = [...new Set(['general', room, ...(await store.list('r/')).map(k => k.slice(2))])].sort();
    return json({ messages, users, rooms });
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
