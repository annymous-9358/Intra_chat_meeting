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

/* ---------- Native app notifications (Firebase Cloud Messaging) ----------
   The Android app registers an FCM token (pf/<uid>/<dev>). The sender key (service account) lives in the store at
   cfg/fcm = { projectId, clientEmail, privateKey }. Without it, native notifications are simply skipped. */
let fcmCfg = null, fcmCfgAt = 0, fcmTok = null;
let fcmFetch = (...a) => fetch(...a);
export const _setFcmFetch = f => { fcmFetch = f; fcmTok = null; fcmCfg = null; fcmCfgAt = 0; };   // tests
async function fcmConfig(store) {
  if (Date.now() - fcmCfgAt > 10 * 60_000) { fcmCfg = await store.get('cfg/fcm').catch(() => null); fcmCfgAt = Date.now(); }
  return fcmCfg?.privateKey && fcmCfg?.clientEmail && fcmCfg?.projectId ? fcmCfg : null;
}
const b64u = x => Buffer.from(x).toString('base64url');
async function fcmAccess(cfg) {
  if (fcmTok && fcmTok.exp > Date.now() + 60_000) return fcmTok.token;
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64u(JSON.stringify({ iss: cfg.clientEmail, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${claims}`).sign(cfg.privateKey).toString('base64url');
  const r = await fcmFetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${sig}` }).toString() });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error('FCM auth failed: ' + (d.error || r.status));
  fcmTok = { token: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 };
  return fcmTok.token;
}
// Send to every native device of one account. Returns how many were sent; drops tokens that are no longer valid.
async function sendFcmToUser(store, uid, { title, body, data, tag, high = true, dataOnly = false, onlyWalkieWake = false }) {
  const keys = await store.list(`pf/${uid}/`);
  if (!keys.length) return 0;
  const cfg = await fcmConfig(store); if (!cfg) return 0;
  const access = await fcmAccess(cfg);
  let n = 0;
  await Promise.all(keys.map(async k => {
    const rec = await store.get(k); if (!rec?.token || (onlyWalkieWake && rec.walkieWake === false)) return;
    const strData = Object.fromEntries(Object.entries(data || {}).filter(([, v]) => v != null).map(([a, v]) => [a, String(v)]));
    const r = await fcmFetch(`https://fcm.googleapis.com/v1/projects/${cfg.projectId}/messages:send`, { method: 'POST',
      headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: dataOnly
        ? { token: rec.token, data: strData, android: { priority: 'HIGH', ttl: '20s' } }            // wakes the app; it plays the audio itself
        : { token: rec.token, notification: { title: String(title || 'Intra Chat').slice(0, 120), body: String(body || '').slice(0, 300) }, data: strData,
        android: { priority: high ? 'HIGH' : 'NORMAL', ttl: '86400s', notification: { channel_id: 'messages', tag: tag || undefined, default_sound: true, notification_priority: high ? 'PRIORITY_HIGH' : 'PRIORITY_DEFAULT' } } } }) }).catch(() => null);
    if (r?.ok) { n++; return; }
    const e = r && await r.json().catch(() => ({}));
    const code = e?.error?.details?.find?.(x => x.errorCode)?.errorCode;
    if (r && (r.status === 404 || code === 'UNREGISTERED' || code === 'INVALID_ARGUMENT')) await store.del(k);
  }));
  return n;
}

/** Someone started talking on the walkie-talkie: wake the phones of members who turned on
 *  "Hear the walkie-talkie when the app is closed", so the app can play it live. Never throws. */
export async function wakeWalkie(store, { room, group, talkerUid, talkerName, title }) {
  try {
    const now = Date.now(), pwv = group?.pw?.v || 0;
    const uids = group?.dm ? group.members : (await Promise.all((await store.list(`mb/${room}/`)).map(k => store.get(k))))
      .filter(m => m?.uid && !(m.muteUntil && m.muteUntil > now) && !(pwv && (m.pwv || 0) !== pwv && m.uid !== group?.adminUid && !group?.admins?.includes(m.uid))).map(m => m.uid);
    let n = 0;
    await Promise.all(uids.filter(u => u !== talkerUid).map(async uid => {
      n += await sendFcmToUser(store, uid, { dataOnly: true, onlyWalkieWake: true, data: { type: 'walkie', room, name: talkerName, title, at: now } }).catch(() => 0);
    }));
    return n;
  } catch { return 0; }
}

/** Push a new message to every other member's signed-in devices. Never throws. */
export async function notifyMembers(store, { room, group, msg, senderUid, vapid, sender = defaultSender, siteOrigin }) {
  try {
    const now = Date.now();
    const memberKeys = await store.list(`mb/${room}/`);
    const members = (await Promise.all(memberKeys.map(k => store.get(k)))).filter(m => m?.uid);
    const pwv = group?.pw?.v || 0;
    const title = group?.dm ? msg.name : group?.title || (room === 'general' ? '#general' : `#${room}`);
    const body = msg.text ? msg.text.slice(0, 160) : msg.audio ? (msg.audio.walkie ? 'Walkie-talkie message' : 'Voice message') : msg.gif ? 'GIF' : 'New message';
    const subject = vapid.subject || (siteOrigin?.startsWith('https://') ? siteOrigin : 'https://example.com');
    const opts = { vapidDetails: { subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey }, TTL: 60 * 60 * 24, urgency: 'high', topic: crypto.createHash('sha1').update(room).digest('hex').slice(0, 32) };
    let sent = 0;
    await Promise.all(members.map(async m => {
      if (m.uid === senderUid) return;                                    // not to yourself
      const mentioned = !!msg.mentions?.includes(m.uid);
      if (m.muteUntil && m.muteUntil > now && !mentioned) return;         // muted (an @mention still gets through)
      if (pwv && (m.pwv || 0) !== pwv && m.uid !== group?.adminUid && !group?.admins?.includes(m.uid)) return; // lost access after a password change
      const payload = JSON.stringify({ room, title, name: group?.dm ? null : msg.name, body, key: msg.key, ts: msg.ts, replyToYou: msg.replyTo?.uid === m.uid, mentioned, audio: !!msg.audio, walkie: !!msg.audio?.walkie, url: `/#/g/${room}` });
      const devKeys = await store.list(`ps/${m.uid}/`);
      await Promise.all(devKeys.map(async k => {
        const ps = await store.get(k);
        if (!ps?.sub) return;
        try { await sender(ps.sub, payload, opts); sent++; }
        catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await store.del(k); }   // subscription expired
      }));
      try {
        const head = (mentioned ? 'Mentioned you · ' : msg.replyTo?.uid === m.uid ? 'Replied to you · ' : '') + title;
        sent += await sendFcmToUser(store, m.uid, { title: head, body: group?.dm ? body : `${msg.name}: ${body}`, tag: 'room-' + room,
          data: { room, key: msg.key, url: `/#/g/${room}`, audio: msg.audio ? '1' : '', type: 'message' } });
      } catch {}
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
    try { await sendFcmToUser(store, uid, { title: data.title, body: data.body, tag: data.type === 'reminder' ? 'reminder-' + Date.now() : data.type || undefined, high: data.type !== 'story',
      data: { room: data.room || '', url: data.url || '/', type: data.type || '' } }); } catch {}
  } catch {}
}
