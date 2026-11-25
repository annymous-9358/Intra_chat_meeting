import { ok } from '../helpers.mjs';
import crypto from 'node:crypto';
import { handle } from '../../lib/chat.mjs';
const m = new Map();
const store = { list: async p => [...m.keys()].filter(k => k.startsWith(p)), get: async k => structuredClone(m.get(k) ?? null), set: async (k, v) => { m.set(k, structuredClone(v)); }, del: async k => { m.delete(k); }, setFile: async () => {}, getFile: async () => null, delFile: async () => {} };
const hdr = u => ({ authorization: 'Bearer ' + u.token, 'x-chat-device': (u.uid + 'a'.repeat(40)).slice(0, 32).replace(/[^a-f0-9]/g, 'b') });
const call = async (route, body = {}, u, origin = 'https://chat.example') => { const r = await handle(new Request(origin + '/api/' + route, { method: 'POST', headers: u ? hdr(u) : {}, body: JSON.stringify({ room: 'general', ...body }) }), store, {}); return [r.status, await r.json()]; };
const signup = async (un, name) => { const [, d] = await call('auth/signup', { username: un, name, password: 'secret1' }); return { token: d.token, uid: d.user.uid }; };
const K = await signup('kunik', 'Kunik'), H = await signup('himanshu', 'Himanshu');
await call('privacy/pin', { pin: '2468' }, K);
// --- Android-style key: sign the raw challenge ---
const and = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }), andSpki = and.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
let [s, d] = await call('privacy/bio/add', { kind: 'android', id: 'andkey-12345678', spki: andSpki, pin: '1111' }, K); ok(s === 401, 'adding a fingerprint key needs the right PIN');
[s, d] = await call('privacy/bio/add', { kind: 'android', id: 'andkey-12345678', spki: andSpki, pin: '2468', label: 'Pixel' }, K); ok(s === 200 && d.bio.length === 1 && !('spki' in d.bio[0]), 'Android key registered (public key never sent back)');
const signAnd = async (u, key = and.privateKey, id = 'andkey-12345678') => { const [, c] = await call('privacy/bio/challenge', {}, u); return { id, sig: crypto.sign('sha256', Buffer.from(c.challenge, 'base64url'), key).toString('base64') }; };
[s, d] = await call('privacy/unlock', { bio: await signAnd(K) }, K); ok(s === 200 && d.ok, 'fingerprint on Android unlocks hidden chats');
{ const b = await signAnd(K); await call('privacy/unlock', { bio: b }, K); [s] = await call('privacy/unlock', { bio: b }, K); ok(s === 401, 'a signed challenge can’t be reused'); }
[s] = await call('privacy/unlock', { bio: await signAnd(K, crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey) }, K); ok(s === 401, 'another device’s key is rejected');
[s] = await call('privacy/unlock', { bio: await signAnd(H) }, H); ok(s === 401, 'someone else can’t use your key');
// --- passkey (WebAuthn) ---
const wa = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }), waSpki = wa.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
[s, d] = await call('privacy/bio/add', { kind: 'webauthn', id: 'cred_AbCdEf0123', spki: waSpki, pin: '2468' }, K); ok(s === 200 && d.bio.length === 2, 'browser passkey registered');
const waAssert = async ({ origin = 'https://chat.example', rp = 'chat.example', flags = 0x05, type = 'webauthn.get', challenge } = {}) => {
  const [, c] = await call('privacy/bio/challenge', {}, K);
  const cd = Buffer.from(JSON.stringify({ type, challenge: challenge || c.challenge, origin }));
  const ad = Buffer.concat([crypto.createHash('sha256').update(rp).digest(), Buffer.from([flags]), Buffer.alloc(4)]);
  const sig = crypto.sign('sha256', Buffer.concat([ad, crypto.createHash('sha256').update(cd).digest()]), wa.privateKey);
  return { id: 'cred_AbCdEf0123', authData: ad.toString('base64url'), clientData: cd.toString('base64url'), sig: sig.toString('base64url') };
};
[s, d] = await call('privacy/unlock', { bio: await waAssert() }, K); ok(s === 200, 'face/fingerprint passkey unlocks in the browser');
[s, d] = await call('privacy/unlock', { bio: await waAssert({ flags: 0x01 }) }, K); ok(s === 401 && /confirmed/.test(d.error), 'without fingerprint/face verification (only a tap) it’s refused');
[s] = await call('privacy/unlock', { bio: await waAssert({ origin: 'https://evil.example', rp: 'evil.example' }) }, K); ok(s === 401, 'a passkey used on another site is refused');
[s] = await call('privacy/unlock', { bio: await waAssert({ challenge: 'old-challenge' }) }, K); ok(s === 401, 'wrong challenge refused');
// unhide with fingerprint, remove key
await call('privacy/hide', { room: 'general', on: true }, K);
[s, d] = await call('privacy/hide', { room: 'general', on: false, bio: await signAnd(K) }, K); ok(s === 200 && !d.rooms.includes('general'), 'unhide a chat with fingerprint');
[s, d] = await call('privacy/bio/remove', { id: 'andkey-12345678' }, K); ok(d.bio.length === 1, 'turning it off removes this device’s key');
[s] = await call('privacy/unlock', { bio: await signAnd(K) }, K); ok(s === 401, 'removed key no longer works');
[s] = await call('privacy/unlock', { pin: '2468' }, K); ok(s === 200, 'PIN still works');
