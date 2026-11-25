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
const base = { title: 'Mission Moon', desc: 'Reach the moon in 30 days', publishAt: ymd(-3), start: ymd(-2), end: ymd(27), today,
  activity: { per: 'day', target: 8000, every: 1000, points: 5, cap: 15000, bonus: 10 }, tiebreak: 'steps',
  tasks: [{ kind: 'steps', title: 'Walk 5,000 steps', target: 5000, points: 10 }, { kind: 'check', title: 'Drink 8 glasses of water', points: 5 }] };
[s, d] = await call('challenge/create', { ...base, start: ymd(5), end: ymd(1) }, K); ok(s === 400, 'end before start rejected');
[s, d] = await call('challenge/create', { ...base, publishAt: ymd(3) }, K); ok(s === 400, 'publish after start rejected');
[s, d] = await call('challenge/create', base, K); ok(s === 200 && d.challenge.status === 'live' && d.challenge.tasks.length === 2, 'Kunik creates a live challenge');
const id = d.challenge.id;
// draft (publish in the future) is invisible to others
[, d] = await call('challenge/create', { ...base, title: 'Secret draft', publishAt: ymd(2), start: ymd(3), end: ymd(9) }, K); const draft = d.challenge.id;
[, d] = await call('challenge/list', {}, H); ok(d.challenges.some(c => c.id === id) && !d.challenges.some(c => c.id === draft), 'others see published challenges, not drafts');
[, d] = await call('challenge/list', {}, K); ok(d.challenges.find(c => c.id === draft)?.status === 'draft', 'creator sees the draft');
[s] = await call('challenge/join', { id: draft }, H); ok(s === 404, 'cannot join a draft');
// join + steps
[s] = await call('challenge/join', { id }, H); [s] = await call('challenge/join', { id }, C); ok(s === 200, 'friends join');
const setSteps = (u, day, n) => m.set(`sp/${u.uid}/${day}`, { steps: n, at: Date.now() });
setSteps(H, ymd(-2), 20000); setSteps(H, ymd(-1), 3000); setSteps(H, today, 9000);   // capped 15000 → 15 pts*5=75 +bonus10 +task10 ; 3000 → 15 ; 9000 → 45 +10 +10
setSteps(C, ymd(-2), 9000); setSteps(C, ymd(-1), 9000); setSteps(C, today, 9000);     // 3×(45+10+10)=195
setSteps(K, today, 4000); setSteps(K, ymd(-3), 50000);                                 // before start: not counted; 4000 → 20
{ const sn = m.get(`cgl/${id}`); sn.at = 0; m.set(`cgl/${id}`, sn); }
[s, d] = await call('challenge/refresh', { id, today }, K);
const row = u => d.board.rows.find(r => r.uid === u.uid);
ok(row(H).points === 75 + 10 + 10 + 15 + 45 + 10 + 10 && row(H).steps === 15000 + 3000 + 9000, `daily cap + points + bonus + step task: Himanshu ${row(H).points} pts, ${row(H).steps} steps`);
ok(row(C).points === 195 && row(K).points === 20, `Chin ${row(C).points}, Kunik ${row(K).points} (steps before the start don't count)`);
ok(d.board.rows[0].uid === C.uid && d.board.rows[0].rank === 1 && d.board.me.uid === K.uid, 'ranked by points; my row returned');
ok(d.tasks.find(t => t.kind === 'steps').done === false && d.todaySteps === 4000, 'Kunik’s 5k task not done yet today');
// check-off task
[s, d] = await call('challenge/task', { id, task: d.tasks.find(t => t.kind === 'check').id, today }, K); ok(s === 200, 'tick a daily task');
[s, d] = await call('challenge/refresh', { id, today }, K);   // within a minute → cached snapshot
ok(d.board.rows.find(r => r.uid === K.uid).points === 20, 'refresh at most once a minute (cached)');
const snap = m.get(`cgl/${id}`); snap.at = 0; m.set(`cgl/${id}`, snap);
setSteps(K, today, 30000);
[s, d] = await call('challenge/refresh', { id, today }, K);
const k = d.board.rows.find(r => r.uid === K.uid);
ok(k.points === 75 + 10 + 10 + 5 && k.rank === 3 && k.prev === 3, `Kunik ${k.points} pts (cap+bonus+tasks) rank ${k.rank} (was ${k.prev})`);
ok(d.board.at > Date.now() - 5000, 'shows when the board was updated');
// tie-breaker by steps
const ch = m.get(`cg/${id}`); ch.activity.cap = 0; ch.tasks = []; ch.activity.bonus = 0; m.set(`cg/${id}`, ch);
setSteps(H, ymd(-2), 1999); setSteps(H, ymd(-1), 0); setSteps(H, today, 1000);   // 1 + 1 → 2 blocks = 10 pts, 2999 steps
setSteps(C, ymd(-2), 0); setSteps(C, ymd(-1), 0); setSteps(C, today, 2500);       // 2 blocks = 10 pts, 2500 steps
setSteps(K, today, 0);
const sn2 = m.get(`cgl/${id}`); sn2.at = 0; m.set(`cgl/${id}`, sn2);
[, d] = await call('challenge/refresh', { id, today }, K);
ok(d.board.rows[0].uid === H.uid && d.board.rows[1].uid === C.uid && d.board.rows[0].points === d.board.rows[1].points, 'tie on points → more steps wins');
ok(d.board.rows[0].prev === 2, 'rank change kept (Himanshu was 2nd, now 1st)');
// scheduler refreshes every 15 min
const sn3 = m.get(`cgl/${id}`); sn3.at = Date.now() - 16 * 60_000; m.set(`cgl/${id}`, sn3);
await runScheduler(store, opts); ok(m.get(`cgl/${id}`).at > Date.now() - 5000, 'scheduler recalculates the board every 15 min');
// group audience
await call('group/create', { room: 'walkers', title: 'Walkers', type: 'open' }, K);
[s, d] = await call('challenge/create', { ...base, title: 'Walkers only', audience: 'walkers' }, K); const gid = d.challenge.id;
[, d] = await call('challenge/list', {}, H); ok(!d.challenges.some(c => c.id === gid), 'group challenge hidden from non-members');
await call('poll', { room: 'walkers' }, H); [, d] = await call('challenge/list', {}, H); ok(d.challenges.some(c => c.id === gid), '…visible once they’re in the group');
// edit + delete
[s] = await call('challenge/update', { ...base, id, title: 'Hacked' }, H); ok(s === 403, 'only the creator edits');
[s] = await call('challenge/delete', { id }, H); ok(s === 403, 'only the creator deletes');
[s] = await call('challenge/delete', { id }, K); ok(s === 200 && !m.has(`cg/${id}`) && ![...m.keys()].some(x => x.startsWith(`cgm/${id}/`)), 'creator deletes; members removed');
