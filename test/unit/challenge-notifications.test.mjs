import { ok } from '../helpers.mjs';
import { challengeNotifications, computeBoard } from '../../lib/challenges.mjs';
const m = new Map(); const store = { list: async p => [...m.keys()].filter(k => k.startsWith(p)), get: async k => structuredClone(m.get(k) ?? null), set: async (k, v) => { m.set(k, structuredClone(v)); }, del: async k => { m.delete(k); } };
const steps = {}; const stepDays = async (s, uid) => steps[uid] || {};
const sent = []; const notify = async (uid, d) => sent.push({ uid, ...d });
const U = ['aaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbb', 'cccccccccccccccccccccccc'];
for (const [i, u] of U.entries()) m.set(`u/${u}`, { uid: u, name: ['Asha', 'Ben', 'Chin'][i] });
// IST user: tz -330. Pick a fixed "now": 2026-12-01 10:00 IST = 04:30 UTC
const IST = (date, h, mi = 0) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), h, mi) - 330 * 60_000;
const ch = { id: 'abcdefghij', title: 'Mission Moon', publishAt: '2026-11-28', start: '2026-12-02', end: '2026-12-10', audience: 'all', createdBy: U[0],
  activity: { per: 'day', target: 8000, every: 1000, points: 5, cap: 0, bonus: 10 }, tiebreak: 'steps', tasks: [] };
m.set(`cg/${ch.id}`, ch);
for (const u of U) m.set(`cgm/${ch.id}/${u}`, { uid: u, joinedAt: 1, tasks: {}, tz: -330 });
m.set(`cgm/${ch.id}/${U[2]}`, { uid: U[2], joinedAt: 1, tasks: {}, tz: -330, notify: false });   // Chin muted it
const run = async t => { m.delete('cfg/cn-last'); sent.length = 0; await challengeNotifications(store, { stepDays, notify, now: t }); return sent.slice(); };
let r = await run(IST('2026-12-01', 6, 30)); ok(r.length === 0, 'quiet hours: nothing at 6:30 AM');
r = await run(IST('2026-12-01', 10)); ok(r.length === 2 && r.every(x => x.title === 'Challenge starts tomorrow' && x.url === `/#/challenge/${ch.id}`) && !r.some(x => x.uid === U[2]), 'day before: "starts tomorrow" to members (not the one who muted)');
r = await run(IST('2026-12-01', 12)); ok(r.length === 0, '…only once');
r = await run(IST('2026-12-01', 10)); ok(r.length === 0, 'runs at most every 15 min (and never repeats)');
// rank change during the challenge
steps[U[1]] = { '2026-12-03': 12000 }; steps[U[0]] = { '2026-12-03': 3000 };
// fake the dates inside computeBoard by building rows directly
m.set(`cgl/${ch.id}`, { at: Date.now(), rows: [{ uid: U[1], rank: 1, prev: 2, points: 70, steps: 12000 }, { uid: U[0], rank: 2, prev: 1, points: 15, steps: 3000 }] });
r = await run(IST('2026-12-03', 11)); ok(r.length === 1 && r[0].uid === U[1] && r[0].title === 'You moved up to #1', 'rank up → "You moved up to #1" (only to the one who moved up)');
r = await run(IST('2026-12-03', 12)); ok(r.length === 0, 'rank notice at most once a day');
// evening: close to the target
steps[U[0]] = { '2026-12-03': 7400 };
r = await run(IST('2026-12-03', 18)); ok(r.length === 1 && r[0].uid === U[0] && r[0].title === 'You’re 600 steps from today’s target', 'evening nudge: "You’re 600 steps from today’s target"');
r = await run(IST('2026-12-03', 19)); ok(r.length === 0, 'nudge once a day');
steps[U[1]] = { '2026-12-03': 2000 };
r = await run(IST('2026-12-03', 18, 30)); ok(r.length === 0, 'no nudge when far from the target');
// daily limit: Asha already got 1 today; give her another reason → second allowed, third not
m.set(`cgl/${ch.id}`, { at: Date.now(), rows: [{ uid: U[0], rank: 1, prev: 2, points: 90, steps: 9000 }, { uid: U[1], rank: 2, prev: 1, points: 70, steps: 12000 }] });
r = await run(IST('2026-12-03', 19, 30)); ok(r.length === 1 && r[0].uid === U[0] && r[0].title === 'You moved up to #1', 'second notification of the day allowed');
const c2 = { ...ch, id: 'zzzzzzzzzz', title: 'Second', start: '2026-12-04', end: '2026-12-12' }; m.set(`cg/${c2.id}`, c2); m.set(`cgm/${c2.id}/${U[0]}`, { uid: U[0], joinedAt: 1, tasks: {}, tz: -330 });
r = await run(IST('2026-12-03', 20)); ok(!r.some(x => x.uid === U[0]), 'daily limit (2) reached → no third one, even from another challenge');
// two days left
r = await run(IST('2026-12-08', 9)); ok(r.some(x => x.title === '2 days left' && x.uid === U[1]), '"2 days left" two days before the end');
r = await run(IST('2026-12-08', 15)); ok(!r.some(x => x.title === '2 days left'), '…once');
