// Cloudflare Workers entry: the web app (files from public/, packed in) and the /api server on one address,
// data in D1, uploaded files in R2, and the background job (reminders, scheduled messages, step sync, leaderboards) on a Cron Trigger.
import { handle, runScheduler } from '../lib/chat.mjs';
import { d1Adapter } from '../lib/d1store.mjs';
import ASSETS from './assets.gen.mjs';

// The web app's files (packed from public/ at build time)
const decoded = new Map();
function serveAsset(req, url) {
  let p = decodeURIComponent(url.pathname); if (p.endsWith('/')) p += 'index.html';
  const a = ASSETS[p] || (!p.includes('.') && ASSETS['/index.html']);
  if (!a) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  const headers = { 'content-type': a.type, etag: a.etag, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' };
  if (p === '/sw.js') headers['service-worker-allowed'] = '/';
  if (req.headers.get('if-none-match') === a.etag) return new Response(null, { status: 304, headers });
  let body = decoded.get(p);
  if (!body) { body = Uint8Array.from(atob(a.b64), c => c.charCodeAt(0)); decoded.set(p, body); }
  return new Response(req.method === 'HEAD' ? null : body, { headers });
}

const clean = v => (v || '').trim().replace(/^["']|["']$/g, '') || undefined;
const vapid = env => ({ publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT });
const health = env => ({ clientId: env.GOOGLE_HEALTH_CLIENT_ID, clientSecret: env.GOOGLE_HEALTH_CLIENT_SECRET });

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return serveAsset(req, url);
    const t0 = Date.now(), qs = [];                                  // time each D1 query (reported in Server-Timing)
    const timed = { prepare: sql => { const st = env.DB.prepare(sql), wrap = st2 => new Proxy(st2, { get: (o, k) => k === 'bind' ? (...a) => wrap(o.bind(...a)) : ['first', 'all', 'run'].includes(k) ? async (...a) => { const t = Date.now(); try { return await o[k](...a); } finally { qs.push(Date.now() - t); } } : typeof o[k] === 'function' ? o[k].bind(o) : o[k] }); return wrap(st); },
      batch: async b => { const t = Date.now(); try { return await env.DB.batch(b); } finally { qs.push(Date.now() - t); } } };
    const res = await handle(req, d1Adapter(timed, env.FILES), {
      giphyKey: env.GIPHY_API_KEY,
      vapid: vapid(env),
      waitUntil: p => ctx.waitUntil(p),
      country: req.cf?.country,
      health: health(env),
      youtubeKey: clean(env.YOUTUBE_API_KEY),
      livekit: { url: env.LIVEKIT_URL, apiKey: env.LIVEKIT_API_KEY, apiSecret: env.LIVEKIT_API_SECRET },
      maxWaitMs: 25_000,       // waiting costs no CPU on Workers, so hold polls open longer…
      checkMs: 500,            // …and check D1 twice a second (about 2 reads per second per open app: well inside the free plan)
    });
    const out = new Response(res.body, res);                       // how long the server spent (handy for checking speed)
    out.headers.set('server-timing', `app;dur=${Date.now() - t0}, db;dur=${qs.reduce((x, y) => x + y, 0)};desc="${qs.length} queries"`);
    return out;
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduler(d1Adapter(env.DB, env.FILES), { vapidEnv: vapid(env), origin: env.VAPID_SUBJECT || '', health: health(env) }));
  },
};
