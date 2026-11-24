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

// Day-by-day points statement for one participant. recs: { 'YYYY-MM-DD': steps | { steps, at } }
function ledger(ch, recs, mem, today) {
  const a = ch.activity, last = today < ch.end ? today : ch.end;
  const days = [], weeks = {};
  let steps = 0, stepPts = 0, bonus = 0, taskPts = 0, targetDays = 0, streak = 0, best = 0, run = 0, bestDay = null;
  for (let d = ch.start; d <= last; d = dayShift(d, 1)) {
    const rec = recs[d], raw = typeof rec === 'number' ? rec : rec?.steps || 0, at = typeof rec === 'object' ? rec?.at || null : null;
    const counted = a.cap ? Math.min(raw, a.cap) : raw;
    const day = { date: d, raw, counted, capped: !!a.cap && raw > a.cap, stepPts: Math.floor(counted / a.every) * a.points, bonus: 0, tasks: [], at };
    steps += counted; stepPts += day.stepPts;
    const hit = a.per === 'day' ? !!a.target && counted >= a.target : !!a.target && counted >= a.target / 7;
    if (a.per === 'day' && hit) { day.bonus = a.bonus; bonus += a.bonus; targetDays++; }
    run = hit ? run + 1 : 0; best = Math.max(best, run);
    if (a.per === 'week') { const wk = Math.floor((new Date(d) - new Date(ch.start)) / (7 * 864e5)); const w = weeks[wk] ||= { week: wk + 1, start: d, end: d, steps: 0, at: null }; w.end = d; w.steps += counted; if (at && (!w.at || at > w.at)) w.at = at; }
    for (const t of ch.tasks) {
      const done = t.kind === 'steps' ? raw >= t.target : (mem?.tasks?.[d] || []).includes(t.id);
      if (done) { day.tasks.push({ id: t.id, title: t.title, kind: t.kind, points: t.points, at: t.kind === 'steps' ? at : mem?.taskAt?.[d]?.[t.id] || null }); taskPts += t.points; }
    }
    day.total = day.stepPts + day.bonus + day.tasks.reduce((x, y) => x + y.points, 0);
    if (raw && (!bestDay || counted > bestDay.steps)) bestDay = { date: d, steps: counted };
    days.push(day);
  }
  // the current streak counts today only once it's reached; otherwise it runs up to yesterday
  for (let i = days.length - 1; i >= 0; i--) {
    const x = days[i], hit = a.target && x.counted >= (a.per === 'day' ? a.target : a.target / 7);
    if (hit) streak++; else if (x.date === today && i === days.length - 1) continue; else break;
  }
  const weekBonus = [];
  if (a.per === 'week') for (const w of Object.values(weeks)) if (a.target && w.steps >= a.target) { weekBonus.push({ ...w, bonus: a.bonus }); bonus += a.bonus; targetDays++; }
  const points = stepPts + bonus + taskPts;
  return { days, weekBonus, steps, points, targetDays, totals: { stepPts, bonus, taskPts }, streak, bestStreak: best, bestDay, activeDays: days.filter(x => x.raw).length };
}
function scoreFor(ch, days, mem, today) {
  const l = ledger(ch, days, mem, today);
  return { steps: l.steps, points: l.points, targetDays: l.targetDays, streak: l.streak, level: levelFor(ch, l.points).idx };
}
// Levels: a share of the best possible score for this challenge (every day on target with every task done)
export const LEVELS = [['Starter', 0], ['Bronze', .1], ['Silver', .25], ['Gold', .5], ['Platinum', .75], ['Diamond', .9]];
function levelFor(ch, points) {
  const a = ch.activity, days = Math.round((new Date(ch.end) - new Date(ch.start)) / 864e5) + 1;
  const ref = a.per === 'day' ? (a.target || 8000) : (a.target ? a.target / 7 : 8000);
  const dayPts = Math.floor(Math.min(ref, a.cap || Infinity) / a.every) * a.points + (a.per === 'day' ? a.bonus : a.bonus / 7) + ch.tasks.reduce((x, t) => x + t.points, 0);
  const perfect = Math.max(1, Math.round(dayPts * days));
  let idx = 0; LEVELS.forEach(([, f], i) => { if (points >= Math.ceil(perfect * f)) idx = i; });
  const next = LEVELS[idx + 1];
  return { idx, name: LEVELS[idx][0], min: Math.ceil(perfect * LEVELS[idx][1]), next: next ? { name: next[0], min: Math.ceil(perfect * next[1]) } : null, perfect };
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
    const tz = Number(body.tz);
    if (mem && Number.isFinite(tz) && Math.abs(tz) <= 840 && mem.tz !== Math.round(tz)) { mem.tz = Math.round(tz); await store.set(`cgm/${ch.id}/${me}`, mem); }
    const days = await stepDays(store, me);
    const todayRaw = days[today] || 0;
    const tasks = ch.tasks.map(t => ({ ...t, done: t.kind === 'steps' ? todayRaw >= t.target : (mem?.tasks?.[today] || []).includes(t.id), progress: t.kind === 'steps' ? Math.min(todayRaw, t.target) : null }));
    // this week's / today's progress towards the target
    const a = ch.activity, capped = d => a.cap ? Math.min(days[d] || 0, a.cap) : (days[d] || 0);
    let period = capped(today);
    if (a.per === 'week') { const wk = Math.floor((new Date(today) - new Date(ch.start)) / (7 * 864e5)); period = 0; for (let i = 0; i < 7; i++) { const d = dayShift(ch.start, wk * 7 + i); if (d <= today && d >= ch.start && d <= ch.end) period += capped(d); } }
    const all = body.all === true;
    const snapRow = snap.rows.find(r => r.uid === me) || null;
    const myL = mem ? ledger(ch, days, mem, today) : null;
    const mine = myL ? { level: levelFor(ch, myL.points), streak: myL.streak, bestStreak: myL.bestStreak, targetDays: myL.targetDays, todayPts: myL.days.at(-1)?.date === today ? myL.days.at(-1).total : 0 } : null;
    return json({ challenge: view(ch, me, { participants: snap.rows.length }), joined: !!mem, notify: mem ? mem.notify !== false : false, today, todaySteps: todayRaw, period, mine, levels: LEVELS.map(x => x[0]),
      // your own steps and points are always live; your rank comes from the last leaderboard update
      tasks, board: { at: snap.at, total: snap.rows.length, rows: all ? snap.rows : snap.rows.slice(0, 10),
        me: myL ? { ...(snapRow || { uid: me, name: user.name, photo: user.photo || null, rank: null }), steps: myL.steps, points: myL.points, streak: myL.streak, level: mine.level.idx } : snapRow } });
  }

  // Your points statement: every day's steps, points, bonus and tasks, and when each was credited
  if (action === 'history') {
    const mem = await store.get(`cgm/${ch.id}/${me}`); if (!mem) return json({ error: 'Join the challenge to see your points' }, 400);
    const recs = {}; const last = today < ch.end ? today : ch.end;
    for (let d = ch.start; d <= last; d = dayShift(d, 1)) { const r = await store.get(`sp/${me}/${d}`); if (r) recs[d] = { steps: r.steps || 0, at: r.at || null }; }
    const l = ledger(ch, recs, mem, today);
    return json({ ...l, days: l.days.slice().reverse(), level: levelFor(ch, l.points), joinedAt: mem.joinedAt });
  }
  // Someone's public summary (tap a leaderboard row)
  if (action === 'member') {
    const uid = String(body.uid || '');
    const mem = /^[a-f0-9]{24}$/.test(uid) && await store.get(`cgm/${ch.id}/${uid}`); if (!mem) return json({ error: 'Not in this challenge' }, 404);
    const u = await store.get(`u/${uid}`); if (!u) return json({ error: 'Not found' }, 404);
    const l = ledger(ch, await stepDays(store, uid), mem, today);
    const snap = await store.get(`cgl/${ch.id}`), row = snap?.rows.find(r => r.uid === uid);
    return json({ uid, name: u.name, photo: u.photo || null, rank: row?.rank || null, points: l.points, steps: l.steps, targetDays: l.targetDays, streak: l.streak,
      bestStreak: l.bestStreak, bestDay: l.bestDay, activeDays: l.activeDays, avg: l.activeDays ? Math.round(l.steps / l.days.length) : 0, level: levelFor(ch, l.points),
      week: l.days.slice(-7).map(x => ({ date: x.date, steps: x.counted })), joinedAt: mem.joinedAt });
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
    if (!(await store.get(`cgm/${ch.id}/${me}`))) await store.set(`cgm/${ch.id}/${me}`, { uid: me, joinedAt: Date.now(), tasks: {}, tz: Number.isFinite(Number(body.tz)) ? Math.round(Number(body.tz)) : undefined });
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
    mem.taskAt = { ...(mem.taskAt || {}), [d]: { ...(mem.taskAt?.[d] || {}), [t.id]: body.done === false ? undefined : Date.now() } };
    await store.set(`cgm/${ch.id}/${me}`, mem);
    return json({ ok: true, done: [...done] });
  }

  if (action === 'notify') {     // this challenge's reminders on/off for you
    const mem = await store.get(`cgm/${ch.id}/${me}`); if (!mem) return json({ error: 'Join the challenge first' }, 400);
    mem.notify = body.on !== false; await store.set(`cgm/${ch.id}/${me}`, mem);
    return json({ ok: true, notify: mem.notify });
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

// ---------- Challenge notifications (kept rare on purpose) ----------
// • "starts tomorrow" (once) • "2 days left" (once) • "you moved up to #N" (top 10, at most once a day)
// • "you're N steps from today's target" (evenings, at most once a day)
// Never more than 2 a day per person across all challenges, only 8 AM–9 PM in their timezone, and each challenge can be muted.
export const NOTIFY_EVERY_MS = 15 * 60_000;
const DAILY_LIMIT = 2;
export async function challengeNotifications(store, { stepDays, notify, now = Date.now() }) {
  const last = await store.get('cfg/cn-last');
  if (last && now - last.at < NOTIFY_EVERY_MS - 30_000) return 0;
  await store.set('cfg/cn-last', { at: now });
  let sent = 0;
  const utcToday = new Date(now).toISOString().slice(0, 10);
  for (const k of await store.list('cg/')) {
    const ch = await store.get(k); if (!ch) continue;
    if (utcToday < dayShift(ch.start, -2) || utcToday > dayShift(ch.end, 1) || utcToday < dayShift(ch.publishAt, -1)) continue;
    const snap = await store.get(`cgl/${ch.id}`);
    const rows = new Map((snap?.rows || []).map(r => [r.uid, r]));
    for (const mk of await store.list(`cgm/${ch.id}/`)) {
      const mem = await store.get(mk); if (!mem?.uid || mem.notify === false) continue;
      const tz = Number.isFinite(mem.tz) ? mem.tz : -330;                // default: India time
      const local = new Date(now - tz * 60_000), hour = local.getUTCHours(), today = local.toISOString().slice(0, 10);
      if (hour < 8 || hour >= 21) continue;                              // quiet hours
      if (today < ch.publishAt) continue;
      const capKey = `cn/${mem.uid}/${today}`, cap = (await store.get(capKey)) || { n: 0 };
      if (cap.n >= DAILY_LIMIT) continue;
      const s0 = mem.sent || {}, row = rows.get(mem.uid), a = ch.activity;
      let msg = null, mark = null;
      const daysLeft = Math.round((new Date(ch.end) - new Date(today)) / 864e5);
      if (today === dayShift(ch.start, -1) && !s0.tomorrow) {
        msg = { title: 'Challenge starts tomorrow', body: `${ch.title} starts tomorrow${a.target ? ` — target ${a.target.toLocaleString('en-US')} steps a ${a.per}` : ''}. Get ready!` }; mark = { tomorrow: true };
      } else if (today >= ch.start && daysLeft === 2 && !s0.twoLeft) {
        msg = { title: '2 days left', body: `Only 2 days left in ${ch.title}${row ? `. You’re #${row.rank} with ${row.points.toLocaleString('en-US')} points` : ''} — finish strong!` }; mark = { twoLeft: true };
      } else if (row?.prev && row.rank < row.prev && row.rank <= 10 && s0.rankDay !== today && row.rank !== s0.lastRank && today >= ch.start && today <= ch.end) {
        msg = { title: `You moved up to #${row.rank}`, body: `in ${ch.title} — ${row.points.toLocaleString('en-US')} points. Keep going!` }; mark = { rankDay: today, lastRank: row.rank };
      } else if (a.per === 'day' && a.target && today >= ch.start && today <= ch.end && hour >= 17 && s0.nearDay !== today) {
        const raw = (await stepDays(store, mem.uid))[today] || 0, counted = a.cap ? Math.min(raw, a.cap) : raw, gap = a.target - counted;
        if (gap > 0 && gap <= 1500) { msg = { title: `You’re ${gap.toLocaleString('en-US')} steps from today’s target`, body: `${ch.title}: a short walk${a.bonus ? ` earns the +${a.bonus} bonus` : ' gets you there'}.` }; mark = { nearDay: today }; }
      }
      if (!msg) continue;
      mem.sent = { ...s0, ...mark }; await store.set(mk, mem);
      await store.set(capKey, { n: cap.n + 1 });
      await notify(mem.uid, { type: 'challenge', room: '', title: msg.title, body: msg.body, url: `/#/challenge/${ch.id}` });
      sent++;
    }
  }
  return sent;
}
