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
[, d] = await call('challenge/create', { title: 'Mission Moon', publishAt: ymd(-3), start: ymd(-3), end: ymd(6), today,
  activity: { per: 'day', target: 8000, every: 1000, points: 5, cap: 15000, bonus: 10 }, tiebreak: 'steps',
  tasks: [{ kind: 'steps', title: 'Walk 5,000 steps', target: 5000, points: 10 }, { kind: 'check', title: 'Drink water', points: 5 }] }, K);
const id = d.challenge.id;
await call('challenge/join', { id, today }, H);
const t1 = Date.now() - 3600e3;
m.set(`sp/${H.uid}/${ymd(-3)}`, { steps: 20000, at: t1 });      // capped 15000 → 75 + bonus 10 + task 10 = 95
m.set(`sp/${H.uid}/${ymd(-2)}`, { steps: 9000, at: t1 });       // 45 + 10 + 10 = 65
m.set(`sp/${H.uid}/${ymd(-1)}`, { steps: 8500, at: t1 });       // 40 + 10 + 10 = 60
m.set(`sp/${H.uid}/${today}`, { steps: 3000, at: t1 });         // 15 (not hit yet today)
[, d] = await call('challenge/task', { id, task: m.get(`cg/${id}`).tasks[1].id, today }, H);
[s, d] = await call('challenge/history', { id, today }, H);
ok(s === 200 && d.days.length === 4 && d.days[0].date === today, 'statement: one entry per day, newest first');
const day1 = d.days.find(x => x.date === ymd(-3));
ok(day1.capped && day1.counted === 15000 && day1.stepPts === 75 && day1.bonus === 10 && day1.tasks.length === 1 && day1.total === 95 && day1.at === t1, 'day 1: capped steps, step points, bonus, task, credit time');
const dToday = d.days[0];
ok(dToday.total === 15 + 5 && dToday.tasks.some(t => t.title === 'Drink water' && t.at > Date.now() - 5000), 'today: water task with tick time');
ok(d.points === 95 + 65 + 60 + 20 && d.totals.stepPts === 75 + 45 + 40 + 15 && d.totals.bonus === 30 && d.totals.taskPts === 35, `totals split: ${JSON.stringify(d.totals)} = ${d.points}`);
ok(d.streak === 3 && d.bestStreak === 3, 'streak: 3 days on target (today doesn’t break it yet)');
ok(d.level.name && d.level.next && d.level.next.min > d.points, `level ${d.level.name}, next ${d.level.next.name} at ${d.level.next.min} (perfect ${d.level.perfect})`);
[s] = await call('challenge/history', { id, today }, C); ok(s === 400, 'non-participants have no statement');
// others' summary card
[s, d] = await call('challenge/member', { id, uid: H.uid, today }, K);
ok(s === 200 && d.points === 240 && d.streak === 3 && d.bestDay.steps === 15000 && d.week.length === 4 && !d.days, 'summary card: points, streak, best day, recent days (no full statement)');
[, d] = await call('challenge/get', { id, today }, H); ok(d.mine.level.name && d.mine.streak === 3 && d.mine.todayPts === 20, 'challenge page has my level, streak and today’s points');
