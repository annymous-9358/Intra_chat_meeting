// Runs the browser tests against a fresh LAN server (own port + throwaway data folder), or against E2E_URL.
// Usage: npm run test:e2e [-- name ...]   e.g. npm run test:e2e -- chat app-lock
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..');
const only = process.argv.slice(2);
const tests = fs.readdirSync(here).filter(f => f.endsWith('.e2e.cjs') && (!only.length || only.some(o => f.startsWith(o)))).sort();
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });

let url = process.env.E2E_URL, server, dataDir;
if (!url) {
  const port = await freePort(); dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intra-chat-e2e-'));
  server = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir }, stdio: 'ignore' });
  url = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) { try { if ((await fetch(url)).ok) break; } catch {} await new Promise(r => setTimeout(r, 200)); }
}
const out = path.join(here, '.out'); fs.mkdirSync(out, { recursive: true });
let failed = 0;
for (const t of tests) {
  process.stdout.write(`\n▶ ${t}\n`);
  const code = await new Promise(r => { const p = spawn(process.execPath, [path.join(here, t), url, out], { stdio: 'inherit' }); p.on('exit', r); });
  if (code !== 0) failed++;
}
server?.kill(); if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
console.log(`\n${tests.length - failed}/${tests.length} browser test files passed`);
process.exit(failed ? 1 : 0);
