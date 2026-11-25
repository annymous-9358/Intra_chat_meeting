// Step challenge inside a chat: daily steps, goals, streaks, badges and the team journey.
import { getVapid, notifyUser } from './push.mjs';
import { ID } from './accounts.mjs';
import { clean, json, newVersion } from './core.mjs';
import { mergeStepDays } from './health.mjs';
import { postMessage } from './messages.mjs';

// ---------- Step challenge ----------
// sp/<uid>/<YYYY-MM-DD>: steps for a day (the phone's own date). sg/<uid>: personal daily goal.
// ch/<room>: a group's challenge { title, goal, days, teamKm, start (date), end (date), by }.
export const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const STEP_M = 0.75;                                       // ~0.75 m per step
export const dayShift = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
export const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5);
export function cleanDay(d) {
  if (typeof d !== 'string' || !DAY.test(d)) return null;
  const today = new Date().toISOString().slice(0, 10), diff = daysBetween(today, d);
  return diff >= -7 && diff <= 1 ? d : null;               // your local "today" (± time zones), or up to a week back
}
export async function stepDays(store, uid) {
  const keys = await store.list(`sp/${uid}/`), out = {};
  const old = dayShift(new Date().toISOString().slice(0, 10), -70);
  await Promise.all(keys.map(async k => { const d = k.split('/')[2]; if (d < old) return store.del(k); const r = await store.get(k); if (r) out[d] = r.steps || 0; }));
  return out;
}
export const goalOf = async (store, uid) => (await store.get(`sg/${uid}`))?.goal || 8000;
export function streakOf(days, today, goal) {
  let n = 0, d = (days[today] || 0) >= goal ? today : dayShift(today, -1);   // today counts once you reach it
  while ((days[d] || 0) >= goal) { n++; d = dayShift(d, -1); }
  return n;
}
export function badgesOf(days, today, goal) {
  const vals = Object.values(days), total = vals.reduce((a, b) => a + b, 0), best = Math.max(0, ...vals), streak = streakOf(days, today, goal);
  let longest = 0, run = 0; for (const d of Object.keys(days).sort()) { if (days[d] >= goal && days[dayShift(d, -1)] >= goal) run++; else run = days[d] >= goal ? 1 : 0; longest = Math.max(longest, run); }
  const list = [
    ['first', 'First steps', 'Logged your first steps', vals.some(v => v > 0)],
    ['goal', 'Goal getter', 'Reached your daily goal', vals.some(v => v >= goal)],
    ['10k', '10K club', '10,000 steps in a day', best >= 10000],
    ['20k', 'Trailblazer', '20,000 steps in a day', best >= 20000],
    ['streak3', 'On a roll', '3-day goal streak', longest >= 3],
    ['streak7', 'Unstoppable', '7-day goal streak', longest >= 7],
    ['km42', 'Marathoner', '42 km walked in total', total * STEP_M >= 42195],
    ['km100', 'Explorer', '100 km walked in total', total * STEP_M >= 100000],
  ];
  return { streak, longest, total, best, badges: list.map(([id, name, desc, got]) => ({ id, name, desc, got })) };
}
export const TEAM_STOPS = [[0, 'Start line'], [.25, 'First water stop'], [.5, 'Halfway camp'], [.75, 'Final climb'], [1, 'Finish line']];
export async function stepsRoute(action, { store, body, room, group, user, isAdmin, push }) {
  const me = user.uid;
  const today = cleanDay(body.today) || new Date().toISOString().slice(0, 10);

  if (action === 'log') {
    const day = cleanDay(body.date || today); if (!day) return json({ error: 'Pick a day in the last week' }, 400);
    const n = Math.round(Number(body.steps));
    if (!(n >= 0 && n <= 100000)) return json({ error: 'Enter a number of steps between 0 and 100,000' }, 400);
    const k = `sp/${me}/${day}`, rec = (await store.get(k)) || { steps: 0, announced: [] };
    const before = rec.steps || 0;
    rec.steps = Math.min(100000, body.mode === 'add' ? before + n : n); rec.at = Date.now(); rec.src = body.mode === 'add' ? 'walk' : 'manual';
    // Celebrate in groups with a running challenge, once a day, when you cross that challenge's daily goal
    const announce = [];
    if (day === today && rec.steps > before) {
      for (const r of (await store.list('ch/')).map(k => k.slice(3))) {
        if ((rec.announced || []).includes(r)) continue;
        const [ch, mb] = await Promise.all([store.get(`ch/${r}`), store.get(`mb/${r}/${me}`)]);
        if (!ch || !mb || today < ch.start || today > ch.end || !(before < ch.goal && rec.steps >= ch.goal)) continue;
        announce.push([r, ch.goal]);
      }
      rec.announced = [...(rec.announced || []), ...announce.map(x => x[0])];
    }
    await store.set(k, rec);
    if (announce.length) {
      const days = await stepDays(store, me);
      for (const [r, goal] of announce) {
        const g = await store.get(`g/${r}`), streak = streakOf(days, today, goal);
        await postMessage(store, { room: r, group: g, user, sys: 'steps', text: `${user.name} hit the ${goal.toLocaleString('en-US')}-step goal today${streak > 1 ? ` · ${streak}-day streak` : ''}` }, push);
      }
    }
    return json({ ok: true, steps: rec.steps, celebrated: announce.length > 0 });
  }

  // Daily totals read on the phone (Health Connect on Android, Apple Health on iPhone) by the native app
  if (action === 'import') {
    const src = body.src === 'apple-health' ? 'apple-health' : 'health-connect';
    const days = {};
    for (const [d, v] of Object.entries(body.days && typeof body.days === 'object' ? body.days : {}).slice(0, 14)) {
      const day = cleanDay(d), n = Math.round(Number(v));
      if (day && n >= 0 && n <= 100000) days[day] = n;
    }
    const updated = await mergeStepDays(store, user, days, src, today, push);
    await store.set(`hi/${me}`, { src, at: Date.now(), today: days[today] ?? null });
    const rec = await store.get(`sp/${me}/${today}`);
    return json({ ok: true, updated, steps: rec?.steps || 0 });
  }

  if (action === 'goal') {
    const goal = Math.round(Number(body.goal));
    if (!(goal >= 1000 && goal <= 50000)) return json({ error: 'Choose a goal between 1,000 and 50,000 steps' }, 400);
    await store.set(`sg/${me}`, { goal });
    return json({ ok: true, goal });
  }

  if (action === 'me') {
    const [days, goal] = await Promise.all([stepDays(store, me), goalOf(store, me)]);
    const week = Array.from({ length: 7 }, (_, i) => { const d = dayShift(today, i - 6); return { date: d, steps: days[d] || 0 }; });
    return json({ today, steps: days[today] || 0, goal, week, ...badgesOf(days, today, goal) });
  }

  if (action === 'board') {
    const ch = await store.get(`ch/${room}`);
    const active = ch && today >= ch.start && today <= ch.end;
    const range = body.range === 'week' ? 'week' : body.range === 'challenge' && ch ? 'challenge' : 'today';
    const from = range === 'today' ? today : range === 'week' ? dayShift(today, -6) : ch.start;
    const to = range === 'challenge' ? (today < ch.end ? today : ch.end) : today;
    const memberKeys = await store.list(`mb/${room}/`);
    const members = (await Promise.all(memberKeys.map(k => store.get(k)))).filter(m => m?.uid);
    let teamSteps = 0;
    const rows = (await Promise.all(members.map(async m => {
      const u = await store.get(`u/${m.uid}`); if (!u) return null;
      const [days, pgoal] = await Promise.all([stepDays(store, m.uid), goalOf(store, m.uid)]);
      const goal = active ? ch.goal : pgoal;
      let sum = 0; for (let d = from; d <= to; d = dayShift(d, 1)) sum += days[d] || 0;
      if (ch) for (let d = ch.start; d <= (today < ch.end ? today : ch.end); d = dayShift(d, 1)) teamSteps += days[d] || 0;
      const cheer = await store.get(`cr/${room}/${m.uid}/${me}/${today}`);
      return { uid: m.uid, name: u.name, photo: u.photo || null, steps: sum, today: days[today] || 0, goal, hit: (days[today] || 0) >= goal, streak: streakOf(days, today, goal), cheered: !!cheer };
    }))).filter(Boolean).sort((a, b) => b.steps - a.steps || a.name.localeCompare(b.name));
    rows.forEach((r, i) => { r.rank = r.steps ? i + 1 : null; });
    let challenge = null;
    if (ch) {
      const km = teamSteps * STEP_M / 1000, pct = ch.teamKm ? Math.min(1, km / ch.teamKm) : 0;
      challenge = { ...ch, active, ended: today > ch.end, dayNo: Math.min(ch.days, daysBetween(ch.start, today) + 1), teamKm: ch.teamKm, km: Math.round(km * 10) / 10, pct,
        stops: TEAM_STOPS.map(([p, name]) => ({ p, name, reached: pct >= p })) };
    }
    return json({ today, range, rows, challenge, dm: !!group?.dm, canManage: !!isAdmin || !!group?.dm });
  }

  if (action === 'challenge') {
    // groups: admins run challenges; 1:1 chats: either friend can start or end a duel
    if (!isAdmin && !group?.dm) return json({ error: 'Only group admins can start or end a challenge' }, 403);
    if (body.end) { await store.del(`ch/${room}`); await store.set(`v/${room}`, { v: newVersion(Date.now()) }); return json({ ok: true }); }
    const goal = Math.round(Number(body.goal) || 8000), days = Math.round(Number(body.days) || 7), teamKm = Math.round(Number(body.teamKm) || 0);
    if (!(goal >= 1000 && goal <= 50000)) return json({ error: 'Daily goal: 1,000–50,000 steps' }, 400);
    if (!(days >= 1 && days <= 60)) return json({ error: 'Length: 1–60 days' }, 400);
    if (!(teamKm >= 0 && teamKm <= 100000)) return json({ error: 'Team distance: up to 100,000 km' }, 400);
    const ch = { title: clean(body.title, 40) || (group?.dm ? 'Step duel' : 'Step challenge'), goal, days, teamKm, start: today, end: dayShift(today, days - 1), by: user.name, at: Date.now() };
    await store.set(`ch/${room}`, ch);
    await postMessage(store, { room, group, user, sys: 'steps', text: `${user.name} ${group?.dm ? 'started a step duel' : 'started'} “${ch.title}”: ${goal.toLocaleString('en-US')} steps a day for ${days} day${days > 1 ? 's' : ''}${teamKm ? ` · team goal ${teamKm} km` : ''}` }, push);
    return json({ ok: true, challenge: ch });
  }

  if (action === 'cheer') {
    const uid = typeof body.uid === 'string' && ID.test(body.uid) ? body.uid : null;
    if (!uid || uid === me) return json({ error: 'Pick a teammate' }, 400);
    if (!(await store.get(`mb/${room}/${uid}`))) return json({ error: 'They’re not in this group' }, 404);
    const k = `cr/${room}/${uid}/${me}/${today}`;
    if (await store.get(k)) return json({ error: 'You already cheered them today', code: 'done' }, 429);
    await store.set(k, { at: Date.now() });
    const vapid = await getVapid(store, push.vapidEnv);
    const job = notifyUser(store, uid, { type: 'steps', room, title: `${user.name} is cheering you on`, body: 'Keep walking — you’ve got this!', url: `/#/g/${room}?a=steps` }, { vapid, sender: push.pushSender, siteOrigin: push.origin });
    if (push.waitUntil) push.waitUntil(job); else await job;
    return json({ ok: true });
  }
  return json({ error: 'Not found' }, 404);
}
