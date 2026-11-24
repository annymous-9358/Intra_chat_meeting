// Challenges (step challenges like a company "Stepathon"): anyone can create one with a banner, publish / start / end
// dates, a steps activity (daily or weekly target, points for every N steps, a daily step cap, target bonus), a
// tie-breaker and daily tasks. The leaderboard is recalculated every 15 minutes (scheduler) or on Refresh, and keeps
// the previous ranks so everyone sees who moved up or down and when it was last updated.
import crypto from 'node:crypto';

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanText = (v, max) => String(v ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim().slice(0, max);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CID = /^[a-z0-9]{10}$/;
const TID = /^[a-z0-9]{6}$/;
const LOCAL_FILE = /^\/api\/file\/([a-f0-9]{24})$/;
export const BOARD_EVERY_MS = 15 * 60_000;
const rid = n => crypto.randomBytes(16).toString('base64').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, n);
const dayShift = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const todayUtc = () => new Date().toISOString().slice(0, 10);
const num = (v, lo, hi, dflt) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };

function status(ch, today) {
  if (today < ch.publishAt) return 'draft';            // not published yet (only the creator sees it)
  if (today < ch.start) return 'upcoming';
  if (today > ch.end) return 'ended';
  return 'live';
}

// Validate and normalise a challenge from the create / edit form
function parseChallenge(body, old) {
  const title = clean(body.title, 60);
  if (!title) return { error: 'Give the challenge a name' };
  const start = String(body.start || ''), end = String(body.end || ''), publishAt = String(body.publishAt || start);
  if (![start, end, publishAt].every(d => DAY.test(d))) return { error: 'Pick publish, start and end dates' };
  if (end < start) return { error: 'The end date must be on or after the start date' };
  if (publishAt > start) return { error: 'Publish on or before the start date, so people can join' };
  const days = Math.round((new Date(end) - new Date(start)) / 864e5) + 1;
  if (days > 366) return { error: 'Challenges can last up to a year' };
  const a = body.activity || {};
  const activity = {
    type: 'steps',
    per: a.per === 'week' ? 'week' : 'day',
    target: num(a.target, 0, a.per === 'week' ? 700000 : 100000, 8000),
    every: num(a.every, 1, 100000, 1000),           // every N counted steps …
    points: num(a.points, 0, 10000, 5),             // … earn P points
    cap: num(a.cap, 0, 100000, 0),                  // daily step cap (0 = no cap); steps above it don't count
    bonus: num(a.bonus, 0, 10000, 0),               // extra points for each day / week the target is reached
  };
  const tiebreak = ['steps', 'days', 'joined'].includes(body.tiebreak) ? body.tiebreak : 'steps';
  const tasks = (Array.isArray(body.tasks) ? body.tasks : []).slice(0, 12).map(t => {
    const kind = t.kind === 'check' ? 'check' : 'steps';
    const title = clean(t.title, 60) || (kind === 'steps' ? `Walk ${Number(t.target || 0).toLocaleString('en-US')} steps` : '');
    if (!title) return null;
    return { id: TID.test(t.id || '') ? t.id : rid(6), kind, title, target: kind === 'steps' ? num(t.target, 100, 100000, 5000) : 0, points: num(t.points, 0, 10000, 10) };
  }).filter(Boolean);
  const room = typeof body.audience === 'string' && /^[a-z0-9_-]{1,40}$/.test(body.audience) ? body.audience : null;   // a group, or everyone
  return { ch: { ...(old || {}), title, desc: cleanText(body.desc, 600), publishAt, start, end, activity, tiebreak, tasks, audience: room ? { room } : 'all' } };
}

// Points and steps for one participant
function scoreFor(ch, days, mem, today) {
  const a = ch.activity, last = today < ch.end ? today : ch.end;
  let steps = 0, points = 0, targetDays = 0, taskPts = 0;
  const weekSteps = {};
  for (let d = ch.start; d <= last; d = dayShift(d, 1)) {
    const raw = days[d] || 0, counted = a.cap ? Math.min(raw, a.cap) : raw;
    steps += counted;
    points += Math.floor(counted / a.every) * a.points;
    if (a.per === 'day') { if (a.target && counted >= a.target) { targetDays++; points += a.bonus; } }
    else { const wk = Math.floor((new Date(d) - new Date(ch.start)) / (7 * 864e5)); weekSteps[wk] = (weekSteps[wk] || 0) + counted; }
    for (const t of ch.tasks) {
      const done = t.kind === 'steps' ? raw >= t.target : (mem.tasks?.[d] || []).includes(t.id);
      if (done) taskPts += t.points;
    }
  }
  if (a.per === 'week') for (const s of Object.values(weekSteps)) if (a.target && s >= a.target) { targetDays++; points += a.bonus; }
  return { steps, points: points + taskPts, targetDays };
}

async function canSee(store, ch, uid) {
  if (ch.createdBy === uid) return true;
  if (status(ch, todayUtc()) === 'draft') return false;
  if (ch.audience === 'all') return true;
  return !!(await store.get(`mb/${ch.audience.room}/${uid}`));
}

// Recalculate the leaderboard snapshot (keeps everyone's previous rank for ▲/▼)
export async function computeBoard(store, ch, { stepDays }) {
  const today = todayUtc();
  const memKeys = await store.list(`cgm/${ch.id}/`);
  const mems = (await Promise.all(memKeys.map(k => store.get(k)))).filter(m => m?.uid);
  const old = (await store.get(`cgl/${ch.id}`)) || { rows: [] };
  const prevRank = new Map(old.rows.map(r => [r.uid, r.rank]));
  const rows = (await Promise.all(mems.map(async m => {
    const u = await store.get(`u/${m.uid}`); if (!u) return null;
    const s = scoreFor(ch, await stepDays(store, m.uid), m, today);
    return { uid: m.uid, name: u.name, photo: u.photo || null, ...s, joinedAt: m.joinedAt };
  }))).filter(Boolean);
  const tb = { steps: (a, b) => b.steps - a.steps, days: (a, b) => b.targetDays - a.targetDays || b.steps - a.steps, joined: (a, b) => a.joinedAt - b.joinedAt }[ch.tiebreak];
  rows.sort((a, b) => b.points - a.points || tb(a, b) || a.name.localeCompare(b.name));
  rows.forEach((r, i) => { r.rank = i + 1; r.prev = prevRank.get(r.uid) ?? null; });
  const snap = { at: Date.now(), rows };
  await store.set(`cgl/${ch.id}`, snap);
  return snap;
}

export async function refreshBoards(store, deps) {
  const today = todayUtc();
  let n = 0;
  for (const k of await store.list('cg/')) {
    const ch = await store.get(k); if (!ch) continue;
    if (today < dayShift(ch.start, -1) || today > dayShift(ch.end, 2)) continue;     // only around the live dates
    const snap = await store.get(`cgl/${ch.id}`);
    if (snap && Date.now() - snap.at < BOARD_EVERY_MS - 30_000) continue;
    await computeBoard(store, ch, deps); n++;
  }
  return n;
}

const view = (ch, me, extra = {}) => ({ id: ch.id, title: ch.title, desc: ch.desc, banner: ch.banner || null, publishAt: ch.publishAt, start: ch.start, end: ch.end,
  activity: ch.activity, tiebreak: ch.tiebreak, tasks: ch.tasks, audience: ch.audience, createdBy: ch.createdBy, createdName: ch.createdName,
  mine: ch.createdBy === me, status: status(ch, todayUtc()), ...extra });

export async function challengeRoute(action, { store, body, user, stepDays, today: clientToday, isGroupAdmin }) {
  const me = user.uid;
  const today = DAY.test(clientToday || '') ? clientToday : todayUtc();
  const load = async () => { const id = String(body.id || ''); const ch = CID.test(id) && await store.get(`cg/${id}`); return ch && await canSee(store, ch, me) ? ch : null; };

  if (action === 'list') {
    const out = [];
    for (const k of await store.list('cg/')) {
      const ch = await store.get(k); if (!ch || !(await canSee(store, ch, me))) continue;
      const [count, joined] = await Promise.all([store.list(`cgm/${ch.id}/`).then(x => x.length), store.get(`cgm/${ch.id}/${me}`)]);
      out.push(view(ch, me, { participants: count, joined: !!joined }));
    }
    const order = { live: 0, upcoming: 1, draft: 2, ended: 3 };
    out.sort((a, b) => order[a.status] - order[b.status] || (a.status === 'ended' ? b.end.localeCompare(a.end) : a.start.localeCompare(b.start)));
    return json({ challenges: out });
  }

  if (action === 'create' || action === 'update') {
    let old = null;
    if (action === 'update') { old = await load(); if (!old) return json({ error: 'Challenge not found' }, 404); if (old.createdBy !== me) return json({ error: 'Only the person who created it can edit it' }, 403); }
    const { ch, error } = parseChallenge(body, old);
    if (error) return json({ error }, 400);
    if (ch.audience !== 'all' && !(await store.get(`mb/${ch.audience.room}/${me}`))) return json({ error: 'You can only make a challenge for a group you’re in' }, 403);
    if (typeof body.banner === 'string' && LOCAL_FILE.test(body.banner)) {
      if (old?.banner && old.banner !== body.banner) { const id = old.banner.match(LOCAL_FILE)?.[1]; if (id) await store.delFile(`f/${id}`); }
      ch.banner = body.banner;
    } else if (body.banner === null && old?.banner) { const id = old.banner.match(LOCAL_FILE)?.[1]; if (id) await store.delFile(`f/${id}`); ch.banner = null; }
    if (!old) Object.assign(ch, { id: rid(10), createdBy: me, createdName: user.name, created: Date.now() });
    await store.set(`cg/${ch.id}`, ch);
    if (!old) await store.set(`cgm/${ch.id}/${me}`, { uid: me, joinedAt: Date.now(), tasks: {} });    // the creator takes part
    await store.del(`cgl/${ch.id}`).catch(() => {});
    return json({ challenge: view(ch, me) });
  }

  const ch = await load();
  if (!ch) return json({ error: 'Challenge not found' }, 404);

  if (action === 'get') {
    let snap = await store.get(`cgl/${ch.id}`);
    if (!snap || (status(ch, today) === 'live' && Date.now() - snap.at > BOARD_EVERY_MS)) snap = await computeBoard(store, ch, { stepDays });
    const mem = await store.get(`cgm/${ch.id}/${me}`);
    const days = await stepDays(store, me);
    const todayRaw = days[today] || 0;
    const tasks = ch.tasks.map(t => ({ ...t, done: t.kind === 'steps' ? todayRaw >= t.target : (mem?.tasks?.[today] || []).includes(t.id), progress: t.kind === 'steps' ? Math.min(todayRaw, t.target) : null }));
    // this week's / today's progress towards the target
    const a = ch.activity, capped = d => a.cap ? Math.min(days[d] || 0, a.cap) : (days[d] || 0);
    let period = capped(today);
    if (a.per === 'week') { const wk = Math.floor((new Date(today) - new Date(ch.start)) / (7 * 864e5)); period = 0; for (let i = 0; i < 7; i++) { const d = dayShift(ch.start, wk * 7 + i); if (d <= today && d >= ch.start && d <= ch.end) period += capped(d); } }
    const all = body.all === true;
    const myRow = snap.rows.find(r => r.uid === me) || null;
    return json({ challenge: view(ch, me, { participants: snap.rows.length }), joined: !!mem, today, todaySteps: todayRaw, period,
      tasks, board: { at: snap.at, total: snap.rows.length, rows: all ? snap.rows : snap.rows.slice(0, 10), me: myRow } });
  }

  if (action === 'refresh') {
    const snap = await store.get(`cgl/${ch.id}`);
    if (!snap || Date.now() - snap.at > 60_000) await computeBoard(store, ch, { stepDays });     // at most once a minute
    return challengeRoute('get', { store, body, user, stepDays, today: clientToday });
  }

  if (action === 'join') {
    const st = status(ch, today);
    if (st === 'ended') return json({ error: 'This challenge has ended' }, 400);
    if (st === 'draft' && ch.createdBy !== me) return json({ error: 'This challenge isn’t open yet' }, 400);
    if (!(await store.get(`cgm/${ch.id}/${me}`))) await store.set(`cgm/${ch.id}/${me}`, { uid: me, joinedAt: Date.now(), tasks: {} });
    await computeBoard(store, ch, { stepDays });
    return json({ ok: true });
  }

  if (action === 'leave') {
    if (ch.createdBy === me) return json({ error: 'You created this challenge — delete it instead' }, 400);
    await store.del(`cgm/${ch.id}/${me}`);
    await computeBoard(store, ch, { stepDays });
    return json({ ok: true });
  }

  if (action === 'task') {       // tick a daily check-off task (today, or yesterday if you forgot)
    const mem = await store.get(`cgm/${ch.id}/${me}`); if (!mem) return json({ error: 'Join the challenge first' }, 400);
    const t = ch.tasks.find(x => x.id === body.task && x.kind === 'check'); if (!t) return json({ error: 'Task not found' }, 404);
    const d = body.date === dayShift(today, -1) ? body.date : today;
    if (d < ch.start || d > ch.end) return json({ error: 'The challenge isn’t running that day' }, 400);
    const done = new Set(mem.tasks?.[d] || []);
    body.done === false ? done.delete(t.id) : done.add(t.id);
    mem.tasks = { ...(mem.tasks || {}), [d]: [...done] };
    await store.set(`cgm/${ch.id}/${me}`, mem);
    return json({ ok: true, done: [...done] });
  }

  if (action === 'delete') {
    if (ch.createdBy !== me) return json({ error: 'Only the person who created it can delete it' }, 403);
    for (const k of await store.list(`cgm/${ch.id}/`)) await store.del(k);
    await store.del(`cgl/${ch.id}`); await store.del(`cg/${ch.id}`);
    const fid = ch.banner?.match(LOCAL_FILE)?.[1]; if (fid) await store.delFile(`f/${fid}`);
    return json({ ok: true });
  }
  return json({ error: 'Not found' }, 404);
}
