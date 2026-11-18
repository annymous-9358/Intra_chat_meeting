// Intra Chat - zero-dependency LAN chat server (Node.js >= 18)
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_FILE = path.join(__dirname, 'data', 'messages.json');
const MAX_HISTORY = 500; // per room
const MAX_TEXT = 2000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---- state ----
let history = {}; // room -> [messages]
try { history = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { history = {}; }
if (!history.general) history.general = [];

const clients = new Map(); // id -> { res, name, room }

let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFile(DATA_FILE, JSON.stringify(history), () => {});
  }, 500);
}

function saveNow() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(history));
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { clearTimeout(saveTimer); saveNow(); process.exit(0); });

function clean(s, max) {
  return String(s ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
}
function cleanRoom(s) {
  return clean(s, 30).toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'general';
}

function send(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function broadcast(event, data, room) {
  for (const c of clients.values()) if (!room || c.room === room) send(c.res, event, data);
}
function presence() {
  const users = [...clients.values()].map(c => ({ name: c.name, room: c.room }));
  broadcast('presence', { users, rooms: Object.keys(history) });
}
function addMessage(room, msg) {
  (history[room] ||= []).push(msg);
  if (history[room].length > MAX_HISTORY) history[room].splice(0, history[room].length - MAX_HISTORY);
  saveSoon();
  broadcast('message', msg, room);
}
function systemMsg(room, text) {
  addMessage(room, { id: crypto.randomUUID(), room, system: true, text, ts: Date.now() });
}

function readBody(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > limit) { reject(new Error('too large')); req.destroy(); }
    });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (e) { reject(e); } });
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  // Real-time stream
  if (req.method === 'GET' && url.pathname === '/events') {
    const name = clean(url.searchParams.get('name'), 24);
    if (!name) { res.writeHead(400); return res.end('name required'); }
    const room = cleanRoom(url.searchParams.get('room'));
    const id = crypto.randomUUID();
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    clients.set(id, { res, name, room });
    if (!history[room]) history[room] = [];
    send(res, 'hello', { id, room, history: history[room].slice(-100) });
    systemMsg(room, `${name} joined`);
    presence();
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(id);
      systemMsg(room, `${name} left`);
      presence();
    });
    return;
  }

  // Send message
  if (req.method === 'POST' && url.pathname === '/send') {
    try {
      const body = await readBody(req);
      const client = clients.get(body.clientId);
      if (!client) { res.writeHead(401); return res.end('not connected'); }
      const text = clean(body.text, MAX_TEXT);
      if (!text) { res.writeHead(400); return res.end('empty'); }
      addMessage(client.room, { id: crypto.randomUUID(), room: client.room, name: client.name, text, ts: Date.now() });
      res.writeHead(204); return res.end();
    } catch { res.writeHead(400); return res.end('bad request'); }
  }

  // Typing indicator
  if (req.method === 'POST' && url.pathname === '/typing') {
    try {
      const body = await readBody(req);
      const client = clients.get(body.clientId);
      if (client) broadcast('typing', { name: client.name }, client.room);
    } catch {}
    res.writeHead(204); return res.end();
  }

  // Static files
  if (req.method === 'GET') {
    const file = path.normalize(path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
    return fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  }

  res.writeHead(405); res.end();
});

server.listen(PORT, HOST, () => {
  console.log(`\nIntra Chat running. Open one of these on any device in your network:\n`);
  console.log(`  http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || [])
      if (a.family === 'IPv4' && !a.internal) console.log(`  http://${a.address}:${PORT}`);
  console.log('');
});
