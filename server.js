// Local / LAN server: serves public/ and the same /api used on Netlify, with a JSON-file store.
// Usage: node server.js            (optional: PORT=8080, DATA_DIR=./data, GIPHY_API_KEY=...)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { handle, runScheduler } from './lib/chat.mjs';
import { fileStore } from './lib/stores/file.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

// Key/value store + uploaded files on disk (DATA_DIR, default ./data)
const store = fileStore(process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data'));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { store.flush(); process.exit(0); });

// Deliver scheduled messages and reminders
const healthEnv = { clientId: process.env.GOOGLE_HEALTH_CLIENT_ID, clientSecret: process.env.GOOGLE_HEALTH_CLIENT_SECRET };
setInterval(() => runScheduler(store, { vapidEnv: { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY, subject: process.env.VAPID_SUBJECT }, health: healthEnv }).catch(() => {}), 30_000);

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname.startsWith('/api/')) {
    const chunks = [];
    let size = 0;
    const limit = ['/api/upload', '/api/avatar', '/api/story/photo', '/api/talk/chunk', '/api/challenge/banner'].includes(url.pathname) ? 4 * 1024 * 1024 + 1 : 16384;
    for await (const c of req) { size += c.length; if (size > limit) { res.writeHead(413); return res.end(); } chunks.push(c); }
    const request = new Request(url, { method: req.method, headers: req.headers, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined });
    // GIF search on a LAN install needs GIPHY_API_KEY in the environment (and internet access)
    const response = await handle(request, store, {
      giphyKey: process.env.GIPHY_API_KEY,
      maxWaitMs: 25_000,                      // a plain server can hold a poll open longer than Netlify
      vapid: { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY, subject: process.env.VAPID_SUBJECT },
      waitUntil: p => p.catch(() => {}),     // send pushes in the background
      health: healthEnv,                      // Google Health step sync (optional)
      youtubeKey: process.env.YOUTUBE_API_KEY,   // Episode Recall search (optional)
      livekit: { url: process.env.LIVEKIT_URL, apiKey: process.env.LIVEKIT_API_KEY, apiSecret: process.env.LIVEKIT_API_SECRET },   // real-time walkie voice (optional)
    });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    return res.end(Buffer.from(await response.arrayBuffer()));
  }

  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  const file = path.normalize(path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(PORT, '0.0.0.0', () => {
  console.log(`\nIntra Chat running. Open on any device in your network:\n`);
  console.log(`  http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log(`  http://${a.address}:${PORT}`);
  console.log('');
});
