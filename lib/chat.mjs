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

const MAX_UPLOAD = 4 * 1024 * 1024;
const FILE_ID = /^[a-f0-9]{24}$/;
// Only these image types are accepted, detected from the file's bytes (never trusted from the client)
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

export async function handle(req, store, { password, giphyKey } = {}) {
  const route = new URL(req.url).pathname.replace(/^\/api\/?/, '');

  // Uploaded files are public by unguessable id so <img> tags can load them without the password header
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
  if (password && !samePassword(req.headers.get('x-chat-password') || '', password))
    return json({ error: 'Wrong password' }, 401);

  if (route === 'upload') {
    if (Number(req.headers.get('content-length')) > MAX_UPLOAD) return json({ error: 'File too large (max 4 MB)' }, 413);
    const data = Buffer.from(await req.arrayBuffer());
    if (data.length > MAX_UPLOAD) return json({ error: 'File too large (max 4 MB)' }, 413);
    const type = sniffImage(data);
    if (!type) return json({ error: 'Only GIF, PNG, JPEG or WebP images are allowed' }, 415);
    const id = crypto.randomBytes(12).toString('hex');
    await store.setFile(`f/${id}`, data, type);
    return json({ url: `/api/file/${id}` });
  }

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
  const name = clean(body.name, 24);
  if (!name) return json({ error: 'Name required' }, 400);
  const room = cleanRoom(body.room);
  const now = Date.now();
  const presenceKey = `p/${room}/${encodeURIComponent(name)}`;

  if (route === 'send') {
    const text = clean(body.text, MAX_TEXT);
    const gif = cleanGif(body.gif);
    if (!text && !gif) return json({ error: 'Empty message' }, 400);
    seq = (seq + 1) % 1e6;
    const key = `m/${room}/${String(now).padStart(13, '0')}-${String(seq).padStart(6, '0')}-${crypto.randomBytes(3).toString('hex')}`;
    // Optional quoted reply: { key, name, text } of the message being answered
    let replyTo;
    const r = body.replyTo;
    if (r && typeof r.key === 'string' && r.key.startsWith(`m/${room}/`) && r.key.length < 80) {
      replyTo = { key: r.key, name: clean(r.name, 24), text: clean(r.text, 140) };
    }
    const msg = { key, room, name, text, gif, ts: now, cid: clean(body.cid, 40) || undefined, replyTo };
    await Promise.all([store.set(key, msg), store.set(`r/${room}`, { room })]);
    await store.set(`v/${room}`, { v: newVersion(now) });   // wakes up waiting long-polls
    const keys = (await store.list(`m/${room}/`)).sort();
    if (keys.length > KEEP_PER_ROOM) {
      // Prune old messages, and any uploaded files they used
      await Promise.all(keys.slice(0, keys.length - KEEP_PER_ROOM).map(async k => {
        const old = await store.get(k);
        const id = old?.gif?.url?.match(/^\/api\/file\/([a-f0-9]{24})$/)?.[1];
        await Promise.all([store.del(k), id && store.delFile(`f/${id}`)]);
      }));
    }
    return json({ message: msg });
  }

  // GIF search / trending through GIPHY (the API key stays on the server)
  if (route === 'gifs') {
    if (!giphyKey) return json({ error: 'GIF search is not set up', configured: false }, 501);
    const q = clean(body.q, 50);
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

  if (route === 'typing') {
    await Promise.all([store.set(presenceKey, { name, seen: now, typingAt: now }), store.set(`v/${room}`, { v: newVersion(now) })]);
    return json({ ok: true });
  }

  if (route === 'poll') {
    const prev = await store.get(presenceKey);
    const presenceWrite = store.set(presenceKey, { name, seen: now, typingAt: prev?.typingAt || 0 });

    const since = typeof body.since === 'string' ? body.since : '';
    // Long-poll: hold the request until the room changes (new message / typing) or the wait expires.
    let known = typeof body.version === 'string' ? body.version : '';
    const wait = Math.min(Math.max(Number(body.wait) || 0, 0), MAX_WAIT_MS);
    let version = (await store.get(`v/${room}`))?.v || '';

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
        const bumped = newVersion(now);
        await store.set(`v/${room}`, { v: bumped });            // wake senders so their ticks update
        if (version === known) known = bumped;                  // our own change shouldn't end our wait
        version = bumped;
      }
    }

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
    const loadReceipts = async () => {
      const keys = await store.list(`rd/${room}/`);
      return (await Promise.all(keys.map(k => store.get(k)))).filter(Boolean).map(r => ({ name: r.name, delivered: r.delivered, read: r.read }));
    };
    const [messages, users, rooms, receipts] = await Promise.all([loadMessages(), loadUsers(), loadRooms(), loadReceipts()]);
    await presenceWrite;
    return json({ messages, users, rooms, receipts, version });
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
