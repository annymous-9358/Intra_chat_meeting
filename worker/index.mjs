// Cloudflare Workers entry: the web app (files from public/, packed in) and the /api server on one address,
// data in D1, and the background job (reminders, scheduled messages, step sync, leaderboards) on a Cron Trigger.
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
    return handle(req, d1Adapter(env.DB), {
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
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduler(d1Adapter(env.DB), { vapidEnv: vapid(env), origin: env.VAPID_SUBJECT || '', health: health(env) }));
  },
};
