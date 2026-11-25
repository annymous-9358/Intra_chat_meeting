import { ok } from '../helpers.mjs';
import { handle, runScheduler } from '../../lib/chat.mjs';
const m = new Map(); const sent = []; const files = new Map();
const store = { list: async p => [...m.keys()].filter(k => k.startsWith(p)), get: async k => structuredClone(m.get(k) ?? null), set: async (k, v) => { m.set(k, structuredClone(v)); }, del: async k => { m.delete(k); }, setFile: async (k, d) => { files.set(k, d); }, getFile: async () => null, delFile: async k => { files.delete(k); } };
const opts = { pushSender: async (sub, payload) => sent.push({ to: sub.endpoint.split('/').pop(), ...JSON.parse(payload) }) };
const hdr = (u, extra = {}) => ({ authorization: 'Bearer ' + u.token, 'x-chat-device': (u.uid + 'a'.repeat(40)).slice(0, 32).replace(/[^a-f0-9]/g, 'b'), ...extra });
const call = async (route, body = {}, u) => { const r = await handle(new Request('https://x/api/' + route, { method: 'POST', headers: u ? hdr(u) : {}, body: JSON.stringify(body) }), store, opts); return [r.status, await r.json()]; };
const signup = async (un, name) => { const [, d] = await call('auth/signup', { username: un, name, password: 'secret1' }); return { token: d.token, uid: d.user.uid }; };
const K = await signup('kunik', 'Kunik'), H = await signup('himanshu', 'Himanshu'), C = await signup('chin', 'Chin');
for (const [u, n] of [[K, 'k'], [H, 'h'], [C, 'c']]) await call('push/subscribe', { subscription: { endpoint: 'https://push.example/' + n, keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) } } }, u);
// profile
let s, d;
const today = new Date().toISOString().slice(0, 10), ymd = n => { const t = new Date(); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const mk = async (game, title = 'Brain & Steps') => (await call('challenge/create', { title, publishAt: ymd(-1), start: ymd(-1), end: ymd(5), today, activity: { per: 'day', target: 8000, every: 1000, points: 5, cap: 0, bonus: 0 }, tasks: [], game }, K))[1].challenge.id;
const id = await mk({ kind: 'math', perDay: 2, ptsPer: 2, mode: 'best' });
await call('challenge/join', { id, today }, H);
[s, d] = await call('challenge/get', { id, today }, H); ok(d.gameToday?.name === 'Quick Math' && d.gameToday.playsLeft === 2, 'challenge page shows today’s game with plays left');
// play 1: answer 12 right + 3 wrong
[s, d] = await call('challenge/game/start', { id, today }, H); ok(s === 200 && d.problems.length >= 40 && d.problems[0].ans === undefined, 'math: problems sent without answers');
const solve = p => p.op === '+' ? p.a + p.b : p.op === '-' ? p.a - p.b : p.a * p.b;
const answers = d.problems.slice(0, 15).map((p, i) => i < 12 ? solve(p) : -1);
const sid1 = d.sid;
[s, d] = await call('challenge/game/finish', { id, sid: sid1, answers, today }, H); ok(s === 200 && d.score === 12 && d.points === 24, `server checks the answers: score ${d.score} → ${d.points} pts`);
[s] = await call('challenge/game/finish', { id, sid: sid1, answers, today }, H); ok(s === 400, 'a session can’t be submitted twice');
// leaderboard updated right away
[, d] = await call('challenge/get', { id, today }, K); ok(d.board.rows.find(r => r.uid === H.uid)?.points === 24 && d.board.rows.find(r => r.uid === H.uid)?.gameBest === 12, 'leaderboard updates straight after the game');
// play 2 (lower) → best counts
[, d] = await call('challenge/game/start', { id, today }, H);
[, d] = await call('challenge/game/finish', { id, sid: d.sid, answers: d.problems.slice(0, 5).map(solve), today }, H); ok(d.score === 5 && d.points === 24 && d.playsLeft === 0, 'mode "best": lower second score doesn’t reduce points');
[s, d] = await call('challenge/game/start', { id, today }, H); ok(s === 400 && d.code === 'no_plays', 'plays per day enforced');
// too slow
const sessKey = [...m.keys()].find(k => k.startsWith('cgs/'));
ok(!sessKey, 'no leftover sessions');
// history shows the game
[, d] = await call('challenge/history', { id, today }, H); const day = d.days.find(x => x.date === today);
ok(day.game && day.game.score === 12 && day.game.points === 24 && day.game.plays.length === 2 && d.totals.gamePts === 24, 'points history lists the game and its plays');
// reaction
const id2 = await mk({ kind: 'reaction', perDay: 3, ptsPer: 0.05, mode: 'best' }, 'Fast hands'); await call('challenge/join', { id: id2, today }, H);
[, d] = await call('challenge/game/start', { id: id2, today }, H);
let sid = d.sid; [s, d] = await call('challenge/game/finish', { id: id2, sid, times: [300, 300, 300, 300, 300], today }, H); ok(s === 400, 'reaction: impossible timing rejected (finished faster than the taps)');
[, d] = await call('challenge/game/start', { id: id2, today }, H); sid = d.sid;
const sess = m.get(`cgs/${sid}`); sess.at -= 10_000; m.set(`cgs/${sid}`, sess);
[s, d] = await call('challenge/game/finish', { id: id2, sid, times: [250, 260, 240, 300, 250], today }, H); ok(s === 200 && d.score === 740 && d.points === 37, `reaction: avg 260 ms → score ${d.score} → ${d.points} pts`);
[, d] = await call('challenge/game/start', { id: id2, today }, H); sid = d.sid;
[s] = await call('challenge/game/finish', { id: id2, sid, times: [20, 30, 40, 50, 60], today }, H); ok(s === 400, 'reaction: inhuman times rejected');
// memory
const id3 = await mk({ kind: 'memory', perDay: 1, ptsPer: 5, mode: 'best' }, 'Memory lane'); await call('challenge/join', { id: id3, today }, H);
[, d] = await call('challenge/game/start', { id: id3, today }, H); const path = d.path; sid = d.sid;
const ses3 = m.get(`cgs/${sid}`); ses3.at -= 30_000; m.set(`cgs/${sid}`, ses3);
const levels = [1, 2, 3, 4, 5, 6].map(n => path.slice(0, n)); levels.push([...path.slice(0, 6), (path[6] + 1) % 9]);
[s, d] = await call('challenge/game/finish', { id: id3, sid, levels, today }, H); ok(s === 200 && d.score === 6 && d.points === 30, `memory: verified path of ${d.score} → ${d.points} pts`);
[s] = await call('challenge/game/start', { id: id3, today }, C); ok(s === 400, 'must join to play');
// quitting a game still uses the play
const id4 = await mk({ kind: 'math', perDay: 1, ptsPer: 1, mode: 'best' }, 'One shot'); await call('challenge/join', { id: id4, today }, H);
await call('challenge/game/start', { id: id4, today }, H);    // ...and quit
[s, d] = await call('challenge/game/start', { id: id4, today }, H); ok(s === 400 && d.code === 'no_plays', 'starting and quitting uses up the play (no retry-until-lucky)');
