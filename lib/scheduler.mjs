// The background job (every minute): scheduled messages, reminders, challenge boards and step sync.
import { refreshBoards, challengeNotifications } from './challenges.mjs';
import { getVapid, notifyUser } from './push.mjs';
import { hasAccess } from './groups.mjs';
import { syncAllHealth } from './health.mjs';
import { postMessage } from './messages.mjs';
import { stepDays } from './steps.mjs';

// ---------- Scheduler: scheduled messages + reminders (run every minute by a scheduled function) ----------
export async function runScheduler(store, push = {}) {
  await refreshBoards(store, { stepDays }).catch(() => 0);          // challenge leaderboards: every 15 minutes
  await (async () => {                                               // challenge reminders (rare, see challenges.mjs)
    const vapid = await getVapid(store, push.vapidEnv);
    await challengeNotifications(store, { stepDays, notify: (uid, data) => notifyUser(store, uid, data, { vapid, sender: push.pushSender, siteOrigin: push.origin }) });
  })().catch(() => 0);
  if (push.health) await syncAllHealth(store, push.health, push).catch(() => 0);
  const now = Date.now(), at = k => Number(k.split('/')[1].slice(0, 13));
  const due = [...(await store.list('sc/')), ...(await store.list('rm/'))].filter(k => at(k) <= now);
  let sent = 0;
  for (const k of due) {
    const job = await store.get(k);
    await store.del(k);                                 // claim it first so it's delivered once
    if (!job) continue;
    const user = await store.get(`u/${job.uid}`);
    if (!user) continue;
    const group = await store.get(`g/${job.room}`);
    if (!(await hasAccess(store, group, job.room, user, null))) continue;
    if (k.startsWith('sc/')) {
      await postMessage(store, { room: job.room, group, user, text: job.text, replyTo: job.replyTo, scheduled: job.created }, push);
    } else {
      const vapid = await getVapid(store, push.vapidEnv);
      await notifyUser(store, job.uid, { type: 'reminder', room: job.room, title: 'Reminder', body: job.preview, url: `/#/g/${job.room}?a=show&k=${encodeURIComponent(job.key)}` }, { vapid, sender: push.pushSender, siteOrigin: push.origin });
    }
    sent++;
  }
  return sent;
}
