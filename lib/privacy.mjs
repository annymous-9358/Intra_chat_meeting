// Hidden chats: PIN, and fingerprint / face unlock (passkeys or Android Keystore keys).
import crypto from 'node:crypto';
import { checkPassword, hashPassword } from './accounts.mjs';
import { clean, cleanRoom, json, sleep } from './core.mjs';

// ---------- Hidden chats ----------
// hd/<uid>: { rooms: [...], pin: {salt, hash} } — chats this person moved into a PIN-protected folder (all their devices).
export const PIN = /^\d{4,8}$/;
export const pinTries = new Map();      // uid -> { n, until }
// Fingerprint / face for hidden chats. Each device registers a public key (a passkey in the browser, or an Android
// Keystore key that only works after fingerprint/face/phone lock); unlocking signs a one-time challenge from here.
//   bc/<uid>  { c, at }  the current challenge (2 minutes, used once)
export const b64u = b => Buffer.from(b).toString('base64url');
export const fromB64 = s => Buffer.from(String(s || ''), /[-_]/.test(String(s)) ? 'base64url' : 'base64');
export async function bioChallenge(store, uid) { const c = b64u(crypto.randomBytes(32)); await store.set(`bc/${uid}`, { c, at: Date.now() }); return c; }
export async function bioVerify(store, uid, rec, b, req) {
  const key = (rec.bio || []).find(x => x.id === b?.id); if (!key) return 'This device’s fingerprint/face isn’t set up for hidden chats — use your PIN';
  const ch = await store.get(`bc/${uid}`); await store.del(`bc/${uid}`);
  if (!ch || Date.now() - ch.at > 120_000) return 'That took too long — try again';
  let pub; try { pub = crypto.createPublicKey({ key: fromB64(key.spki), format: 'der', type: 'spki' }); } catch { return 'This device’s key is broken — set fingerprint/face up again'; }
  const sig = fromB64(b.sig);
  if (key.kind === 'android') return crypto.verify('sha256', Buffer.from(ch.c, 'base64url'), pub, sig) ? null : 'Fingerprint check failed';
  // passkey (WebAuthn): check what was signed, where, and that the person was verified
  let cd; try { cd = JSON.parse(fromB64(b.clientData).toString('utf8')); } catch { return 'Fingerprint check failed'; }
  const host = new URL(req.url).host, origin = (() => { try { return new URL(cd.origin); } catch { return null; } })();
  if (cd.type !== 'webauthn.get' || cd.challenge !== ch.c || !origin || origin.host !== host) return 'Fingerprint check failed';
  const ad = fromB64(b.authData);
  if (ad.length < 37 || !ad.subarray(0, 32).equals(crypto.createHash('sha256').update(origin.hostname).digest())) return 'Fingerprint check failed';
  if ((ad[32] & 0x05) !== 0x05) return 'Fingerprint or face wasn’t confirmed';           // user present + verified
  const data = Buffer.concat([ad, crypto.createHash('sha256').update(fromB64(b.clientData)).digest()]);
  return crypto.verify('sha256', data, pub, sig) ? null : 'Fingerprint check failed';
}
export async function privacyRoute(action, { store, body, user, req }) {
  const me = user.uid, k = `hd/${me}`, rec = (await store.get(k)) || { rooms: [] };
  const view = () => ({ rooms: rec.rooms, hasPin: !!rec.pin, bio: (rec.bio || []).map(({ id, kind, label, at }) => ({ id, kind, label, at })) });
  const checkPin = async pin => {
    const t = pinTries.get(me);
    if (t && t.until > Date.now()) return { error: 'Too many wrong PINs — wait a minute', status: 429 };
    if (!rec.pin || !PIN.test(String(pin || '')) || !checkPassword(String(pin), rec.pin)) {
      await sleep(300); const n = (t?.n || 0) + 1; pinTries.set(me, { n, until: n >= 5 ? Date.now() + 60_000 : 0 });
      return { error: 'Wrong PIN', status: 401 };
    }
    pinTries.delete(me); return null;
  };
  const checkAuth = async () => {                 // PIN, or this device's fingerprint/face
    if (body.bio) { const e = await bioVerify(store, me, rec, body.bio, req); return e ? { error: e, status: 401 } : null; }
    return checkPin(body.pin);
  };
  if (action === 'hidden') return json(view());
  if (action === 'bio/challenge') return json({ challenge: await bioChallenge(store, me) });
  if (action === 'bio/add') {                     // register this device (needs the PIN)
    const e = await checkPin(body.pin); if (e) return json({ error: e.error }, e.status);
    const kind = body.kind === 'android' ? 'android' : 'webauthn', id = String(body.id || '');
    if (!/^[A-Za-z0-9_-]{8,200}$/.test(id)) return json({ error: 'Bad key id' }, 400);
    try { const pk = crypto.createPublicKey({ key: fromB64(body.spki), format: 'der', type: 'spki' }); if (!['ec', 'rsa'].includes(pk.asymmetricKeyType)) throw 0; }
    catch { return json({ error: 'That key isn’t usable' }, 400); }
    rec.bio = [...(rec.bio || []).filter(x => x.id !== id), { id, kind, spki: String(body.spki), label: clean(body.label, 40) || (kind === 'android' ? 'Android phone' : 'This browser'), at: Date.now() }].slice(-10);
    await store.set(k, rec); return json(view());
  }
  if (action === 'bio/remove') { rec.bio = (rec.bio || []).filter(x => x.id !== String(body.id || '')); await store.set(k, rec); return json(view()); }
  if (action === 'pin') {                         // set the PIN the first time, or change it (needs the old one)
    if (!PIN.test(String(body.pin || ''))) return json({ error: 'Use 4–8 digits' }, 400);
    if (rec.pin) { const e = await checkPin(body.old); if (e) return json({ error: e.error }, e.status); }
    rec.pin = hashPassword(String(body.pin)); await store.set(k, rec);
    return json(view());
  }
  if (action === 'unlock') { const e = await checkAuth(); if (e) return json({ error: e.error }, e.status); return json({ ok: true, ...view() }); }
  if (action === 'hide') {
    const room = cleanRoom(body.room);
    if (!room) return json({ error: 'Pick a chat' }, 400);
    if (body.on) {
      if (!rec.pin) return json({ error: 'Set a PIN first', code: 'no_pin' }, 400);
      rec.rooms = [...new Set([...rec.rooms, room])].slice(0, 200);
    } else {
      const e = await checkAuth(); if (e) return json({ error: e.error }, e.status);
      rec.rooms = rec.rooms.filter(r => r !== room);
    }
    await store.set(k, rec);
    return json(view());
  }
  return json({ error: 'Not found' }, 404);
}
