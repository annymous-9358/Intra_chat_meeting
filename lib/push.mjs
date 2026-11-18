// Web Push (like WhatsApp notifications): every device that has opened a group is a member of it;
// when someone sends a message, each other member device with notifications turned on gets a push,
// even if the app is closed or the member is outside a location group's range.
import webpush from 'web-push';
import crypto from 'node:crypto';

let vapidCache = null;
// VAPID keys identify this server to the browsers' push services. Prefer env vars (stable across instances);
// otherwise create a pair once and keep it in the store.
export async function getVapid(store, env = {}) {
  if (env.publicKey && env.privateKey) return env;
  if (vapidCache) return vapidCache;
  let rec = await store.get('cfg/vapid');
  if (!rec?.publicKey) {
    const k = webpush.generateVAPIDKeys();
    await store.set('cfg/vapid', k);
    rec = await store.get('cfg/vapid');
  }
  return (vapidCache = { ...rec, subject: env.subject });
}

export function cleanSubscription(s) {
  if (!s || typeof s !== 'object' || typeof s.endpoint !== 'string' || !/^https:\/\/[^\s]{10,800}$/.test(s.endpoint)) return null;
  const k = s.keys || {};
  if (typeof k.p256dh !== 'string' || typeof k.auth !== 'string' || k.p256dh.length > 200 || k.auth.length > 100) return null;
  return { endpoint: s.endpoint, keys: { p256dh: k.p256dh, auth: k.auth } };
}

// Remember that this device belongs to this group (written only when something changes)
export async function touchMembership(store, room, dev, name, pwv) {
  if (!dev) return null;
  const key = `pm/${room}/${dev}`;
  const old = await store.get(key);
  if (!old || old.name !== name || (old.pwv || 0) !== (pwv || 0)) {
    await store.set(key, { dev, name, pwv: pwv || 0, muteUntil: old?.muteUntil || 0, at: Date.now() });
  }
  return old;
}

const defaultSender = (sub, payload, opts) => webpush.sendNotification(sub, payload, opts);

/** Push a new message to every other member device. Never throws. */
export async function notifyMembers(store, { room, group, msg, senderDev, vapid, sender = defaultSender, siteOrigin }) {
  try {
    const now = Date.now();
    const memberKeys = await store.list(`pm/${room}/`);
    const members = (await Promise.all(memberKeys.map(k => store.get(k)))).filter(Boolean);
    const pwv = group?.pw?.v || 0;
    const title = group?.title || (room === 'general' ? '#general' : `#${room}`);
    const body = msg.text ? msg.text.slice(0, 160) : msg.audio ? '🎤 Voice message' : msg.gif ? '🎞️ GIF' : 'New message';
    const payload = JSON.stringify({
      room, title, name: msg.name, body, key: msg.key, ts: msg.ts,
      replyToYou: msg.replyTo?.name || null,
      url: `/#/g/${room}`,
    });
    const subject = vapid.subject || (siteOrigin?.startsWith('https://') ? siteOrigin : 'https://example.com');
    const opts = { vapidDetails: { subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey }, TTL: 60 * 60 * 24, urgency: 'high', topic: crypto.createHash('sha1').update(room).digest('hex').slice(0, 32) };
    let sent = 0;
    await Promise.all(members.map(async m => {
      if (m.dev === senderDev || m.name === msg.name) return;            // not to yourself
      if (m.muteUntil && m.muteUntil > now) return;                       // muted
      if (pwv && (m.pwv || 0) !== pwv) return;                            // lost access after a password change
      const ps = await store.get(`ps/${m.dev}`);
      if (!ps?.sub) return;
      try { await sender(ps.sub, payload, opts); sent++; }
      catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) await store.del(`ps/${m.dev}`);   // subscription expired
      }
    }));
    return sent;
  } catch { return 0; }
}
