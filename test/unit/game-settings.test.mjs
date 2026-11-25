import { ok } from '../helpers.mjs';
import { gameRoute, GAME_LIST } from '../../lib/games.mjs';
const m = new Map(); const store = { get: async k => structuredClone(m.get(k) ?? null), set: async (k, v) => { m.set(k, structuredClone(v)); }, del: async k => { m.delete(k); }, list: async p => [...m.keys()].filter(k => k.startsWith(p)) };
const A = { uid: 'u1', name: 'A' }, B = { uid: 'u2', name: 'B' };
const ctx = u => ({ store, room: 'floor', user: u, group: {}, announce: async () => {} });
const R = async (a, b, u = A) => (await gameRoute(a, b, ctx(u))).json();
ok(GAME_LIST.find(g => g.kind === 'emoji').set.defRounds === 5 && GAME_LIST.find(g => g.kind === 'ttt').set === null, 'game list says what each game lets you set');
// emoji: 3 rounds, 20 s
let d = await R('start', { kind: 'emoji', rounds: 3, secs: 20 }); ok(d.game.rounds === 3 && d.game.cfg.secs === 20, 'emoji started with 3 rounds × 20 s');
d = await R('begin', {}); ok(Math.abs(d.game.deadline - d.game.now - 20000) < 50, 'first puzzle has a 20 s timer');
for (let r = 1; r <= 3; r++) { const g = m.get('gs/floor'); g.deadline = Date.now() - 1; m.set('gs/floor', g); await R('next', {}).catch(() => {}); await gameRoute('end', {}, ctx(A)).catch(() => {}); break; }
await R('end', {}); await R('end', {});
// out-of-range values are clamped; no values = defaults
d = await R('start', { kind: 'emoji', rounds: 99, secs: 2 }); ok(d.game.rounds === 20 && d.game.cfg.secs === 15, 'out-of-range values kept within limits (20 rounds, 15 s)');
await R('end', {}); await R('end', {});
d = await R('start', { kind: 'wyr' }); ok(d.game.rounds === 5 && d.game.cfg.secs === 25, 'no choice → defaults (5 rounds, 25 s)');
await R('end', {}); await R('end', {});
// emoji really ends after the chosen rounds
d = await R('start', { kind: 'emoji', rounds: 3, secs: 15 }); await R('begin', {});
let rounds = 0;
for (let k = 0; k < 10 && m.get('gs/floor').phase !== 'over'; k++) { const g = m.get('gs/floor'); if (g.phase === 'guess') rounds++; g.deadline = Date.now() - 1; m.set('gs/floor', g); await R('poll' === 'x' ? '' : 'join', {}); }
ok(m.get('gs/floor').phase === 'over' && rounds === 3, `emoji game over after the chosen 3 rounds (played ${rounds})`);
await R('end', {});
// rps first to 1, 10 s throws
d = await R('start', { kind: 'rps', wins: 1, secs: 10 }); await R('join', {}, B); d = await R('begin', {});
ok(d.game.cfg.wins === 1 && Math.abs(d.game.deadline - d.game.now - 10000) < 50, 'rps: first to 1, 10 s per throw');
await R('move', { hand: 'rock' }, A); d = await R('move', { hand: 'scissors' }, B);
let g = m.get('gs/floor'); g.deadline = Date.now() - 1; m.set('gs/floor', g); d = await R('join', {}, A);
ok(m.get('gs/floor').data.champ === 'u1' && m.get('gs/floor').phase === 'reveal', 'rps ends after a single win when set to first to 1');
// sounds
await R('end', {}).catch(() => {}); await R('end', {}).catch(() => {}); m.delete('gs/floor');
d = await R('start', { kind: 'ttt', sounds: { wrong: 'trombone', right: '/api/file/' + 'ab'.repeat(12) } });
ok(d.game.cfg.sounds.wrong === 'trombone' && d.game.cfg.sounds.right === '/api/file/' + 'ab'.repeat(12), 'tic-tac-toe keeps the chosen sounds (built-in + uploaded clip)');
await R('end', {}); await R('end', {});
d = await R('start', { kind: 'emoji', sounds: { wrong: 'https://evil.example/x.mp3', right: '<script>' } });
ok(d.game.cfg.sounds.wrong === 'fahh' && d.game.cfg.sounds.right === 'crore', 'outside links / junk fall back to Fahh + Crorepati');
await R('end', {}); await R('end', {});
d = await R('start', { kind: 'wyr' }); ok(d.game.cfg.sounds.wrong === 'fahh' && d.game.cfg.sounds.right === 'crore', 'default sounds');
