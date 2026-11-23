// Local / LAN server: serves public/ and the same /api used on Netlify, with a JSON-file store.
// Usage: node server.js            (optional: PORT=8080, GIPHY_API_KEY=...)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { handle, runScheduler } from './lib/chat.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, 'data', 'store.json');
const FILES_DIR = path.join(__dirname, 'data', 'files');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

// In-memory key/value store persisted to disk
const data = new Map();
try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')))) data.set(k, v); } catch {}
let timer;
const saveNow = () => { fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true }); fs.writeFileSync(DATA_FILE, JSON.stringify(Object.fromEntries(data))); };
const saveSoon = () => { clearTimeout(timer); timer = setTimeout(saveNow, 1000); };
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { clearTimeout(timer); saveNow(); process.exit(0); });
const store = {
  list: async prefix => [...data.keys()].filter(k => k.startsWith(prefix)),
  get: async key => data.get(key) ?? null,
  set: async (key, value) => { data.set(key, value); if (!key.startsWith('p/')) saveSoon(); },
  del: async key => { data.delete(key); saveSoon(); },
  // Uploaded files live in data/files/<id>; their type is kept in the key/value store
  setFile: async (key, buf, type) => {
    fs.mkdirSync(FILES_DIR, { recursive: true });
    fs.writeFileSync(path.join(FILES_DIR, key.slice(2)), buf);
    data.set(key, { type }); saveSoon();
  },
  getFile: async key => {
    const meta = data.get(key);
    if (!meta) return null;
    try { return { data: fs.readFileSync(path.join(FILES_DIR, key.slice(2))), type: meta.type }; } catch { return null; }
  },
  delFile: async key => { data.delete(key); fs.rm(path.join(FILES_DIR, key.slice(2)), { force: true }, () => {}); saveSoon(); },
};

// Deliver scheduled messages and reminders
const healthEnv = { clientId: process.env.GOOGLE_HEALTH_CLIENT_ID, clientSecret: process.env.GOOGLE_HEALTH_CLIENT_SECRET };
setInterval(() => runScheduler(store, { vapidEnv: { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY, subject: process.env.VAPID_SUBJECT }, health: healthEnv }).catch(() => {}), 30_000);

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname.startsWith('/api/')) {
    const chunks = [];
    let size = 0;
    const limit = ['/api/upload', '/api/avatar', '/api/story/photo', '/api/talk/chunk'].includes(url.pathname) ? 4 * 1024 * 1024 + 1 : 16384;
    for await (const c of req) { size += c.length; if (size > limit) { res.writeHead(413); return res.end(); } chunks.push(c); }
    const request = new Request(url, { method: req.method, headers: req.headers, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined });
    // GIF search on a LAN install needs GIPHY_API_KEY in the environment (and internet access)
    const response = await handle(request, store, {
      giphyKey: process.env.GIPHY_API_KEY,
      vapid: { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY, subject: process.env.VAPID_SUBJECT },
      waitUntil: p => p.catch(() => {}),     // send pushes in the background
      health: healthEnv,                      // Google Health step sync (optional)
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
