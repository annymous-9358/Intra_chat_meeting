// Local / LAN server: serves public/ and the same /api used on Netlify, with a JSON-file store.
// Usage: node server.js            (optional: PORT=8080, CHAT_PASSWORD=secret)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { handle } from './lib/chat.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, 'data', 'store.json');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

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
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname.startsWith('/api/')) {
    const chunks = [];
    let size = 0;
    for await (const c of req) { size += c.length; if (size > 16384) { res.writeHead(413); return res.end(); } chunks.push(c); }
    const request = new Request(url, { method: req.method, headers: req.headers, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined });
    const response = await handle(request, store, { password: process.env.CHAT_PASSWORD });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    return res.end(await response.text());
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
  console.log(`\nIntra Chat running${process.env.CHAT_PASSWORD ? ' (password protected)' : ''}. Open on any device in your network:\n`);
  console.log(`  http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log(`  http://${a.address}:${PORT}`);
  console.log('');
});
