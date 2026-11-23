// Web Push (like WhatsApp notifications): every account that has opened a group is a member of it;
// when someone sends a message, each other member's signed-in devices with notifications turned on get a push,
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

const defaultSender = (sub, payload, opts) => webpush.sendNotification(sub, payload, opts);

/** Push a new message to every other member's signed-in devices. Never throws. */
export async function notifyMembers(store, { room, group, msg, senderUid, vapid, sender = defaultSender, siteOrigin }) {
  try {
    const now = Date.now();
    const memberKeys = await store.list(`mb/${room}/`);
    const members = (await Promise.all(memberKeys.map(k => store.get(k)))).filter(m => m?.uid);
    const pwv = group?.pw?.v || 0;
    const title = group?.dm ? msg.name : group?.title || (room === 'general' ? '#general' : `#${room}`);
    const body = msg.text ? msg.text.slice(0, 160) : msg.audio ? (msg.audio.walkie ? '📻 Walkie-talkie message' : '🎤 Voice message') : msg.gif ? '🎞️ GIF' : 'New message';
    const subject = vapid.subject || (siteOrigin?.startsWith('https://') ? siteOrigin : 'https://example.com');
    const opts = { vapidDetails: { subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey }, TTL: 60 * 60 * 24, urgency: 'high', topic: crypto.createHash('sha1').update(room).digest('hex').slice(0, 32) };
    let sent = 0;
    await Promise.all(members.map(async m => {
      if (m.uid === senderUid) return;                                    // not to yourself
      if (m.muteUntil && m.muteUntil > now) return;                       // muted
      if (pwv && (m.pwv || 0) !== pwv && m.uid !== group?.adminUid) return; // lost access after a password change
      const payload = JSON.stringify({ room, title, name: group?.dm ? null : msg.name, body, key: msg.key, ts: msg.ts, replyToYou: msg.replyTo?.uid === m.uid, audio: !!msg.audio, walkie: !!msg.audio?.walkie, url: `/#/g/${room}` });
      const devKeys = await store.list(`ps/${m.uid}/`);
      await Promise.all(devKeys.map(async k => {
        const ps = await store.get(k);
        if (!ps?.sub) return;
        try { await sender(ps.sub, payload, opts); sent++; }
        catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await store.del(k); }   // subscription expired
      }));
    }));
    return sent;
  } catch { return 0; }
}

/** Push a one-off notification (e.g. a friend request) to every signed-in device of one account. */
export async function notifyUser(store, uid, data, { vapid, sender = defaultSender, siteOrigin } = {}) {
  try {
    const subject = vapid.subject || (siteOrigin?.startsWith('https://') ? siteOrigin : 'https://example.com');
    const opts = { vapidDetails: { subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey }, TTL: 60 * 60 * 24, urgency: 'normal' };
    const payload = JSON.stringify({ ...data, ts: Date.now() });
    const keys = await store.list(`ps/${uid}/`);
    await Promise.all(keys.map(async k => {
      const ps = await store.get(k);
      if (!ps?.sub) return;
      try { await sender(ps.sub, payload, opts); } catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await store.del(k); }
    }));
  } catch {}
}
