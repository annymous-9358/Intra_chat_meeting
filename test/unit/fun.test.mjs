// Fun mode: opt-in per chat, setting a friend's lock/home screen (photo or live doodle) through a data push to their Android app.
import crypto from 'node:crypto';
import { handle } from '../../lib/chat.mjs';
import { _setFcmFetch } from '../../lib/push.mjs';
import { ok, memStore } from '../helpers.mjs';
const { m, files, store } = memStore();
const pushes = [];
_setFcmFetch(async (url, init) => {
  if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
  pushes.push(JSON.parse(init.body).message); return new Response('{}');
});
await store.set('cfg/fcm', { projectId: 'p', clientEmail: 'x@p.iam.gserviceaccount.com', privateKey: crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }) });
const hdr = u => ({ authorization: 'Bearer ' + u.token, 'x-chat-device': (u.uid + 'a'.repeat(40)).slice(0, 32).replace(/[^a-f0-9]/g, 'b') });
const call = async (route, body = {}, u) => { const r = await handle(new Request('https://x/api/' + route, { method: 'POST', headers: u ? hdr(u) : {}, body: JSON.stringify(body) }), store, {}); return [r.status, await r.json()]; };
const signup = async (username, name) => { const [, d] = await call('auth/signup', { username, name, password: 'secret1' }); return { token: d.token, uid: d.user.uid, name }; };
const upload = async u => { const r = await handle(new Request('https://x/api/upload', { method: 'POST', headers: { ...hdr(u), 'x-chat-room': 'floor' }, body: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(200)]) }), store, {}); return (await r.json()).url; };
const K = await signup('kunik', 'Kunik'), B = await signup('bob', 'Bob'), C = await signup('chin', 'Chin'), W = await signup('web', 'Webby');
await call('group/create', { room: 'floor', title: 'Floor', type: 'open' }, K);
for (const u of [B, C, W]) await call('poll', { room: 'floor' }, u);
for (const u of [B, C]) await call('push/native', { room: 'floor', token: 'tok-' + u.name + '-' + 'x'.repeat(30), platform: 'android' }, u);
let s, d;

[, d] = await call('fun/state', { room: 'floor' }, K); ok(!d.me.lock && !d.me.home && d.people.length === 0, 'fun mode is off for everyone by default');
const url1 = await upload(K);
[, d] = await call('fun/send', { room: 'floor', url: url1, target: 'lock', final: true, kind: 'photo' }, K); ok(d.sent.length === 0 && pushes.length === 0, 'nobody’s screen changes until they turn fun mode on');
[s, d] = await call('fun/settings', { room: 'floor', lock: true, home: false }, B); ok(s === 200 && d.me.lock && !d.me.home, 'Bob allows his lock screen (not home)');
[, d] = await call('poll', { room: 'floor' }, K); ok(d.messages.some(x => x.sys === 'fun' && x.text.includes('Bob turned on fun mode')), 'the chat is told Bob turned fun mode on');
await call('fun/settings', { room: 'floor', lock: true, home: true }, C);
await call('fun/settings', { room: 'floor', lock: true, home: true }, W);       // no Android app
[, d] = await call('fun/state', { room: 'floor' }, K); ok(d.people.map(p => p.name).sort().join() === 'Bob,Chin,Webby', 'Kunik sees who he can draw on');
// photo to lock screens
pushes.length = 0;
[s, d] = await call('fun/send', { room: 'floor', url: url1, target: 'lock', final: true, kind: 'photo' }, K);
ok(s === 200 && d.sent.sort().join() === 'Bob,Chin' && d.skipped.join() === 'Webby', 'photo sent to Bob and Chin; Webby has no Android app');
ok(pushes.length === 2 && pushes.every(p => p.data.type === 'fun' && p.data.url === url1 && p.data.target === 'lock' && p.data.from === 'Kunik' && !p.notification && p.android.priority === 'HIGH'), 'a silent high-priority data push wakes each phone with the picture');
[, d] = await call('poll', { room: 'floor' }, B); ok(d.messages.some(x => x.sys === 'fun' && x.text === 'Kunik changed 2 people’s lock screen'), 'the chat says who changed what');
[, d] = await call('fun/state', { room: 'floor' }, B); ok(d.last?.url === url1 && d.last.byName === 'Kunik', 'Bob can see the last picture set for him');
// home screen only goes to people who allow it
pushes.length = 0;
[, d] = await call('fun/send', { room: 'floor', url: url1, target: 'home', final: true, kind: 'photo' }, K); ok(d.sent.join() === 'Chin' && pushes.length === 1, 'home screen: only Chin allows it');
[, d] = await call('fun/send', { room: 'floor', url: url1, target: 'both', final: true, kind: 'photo' }, K);
ok(pushes.filter(p => p.data.target === 'both').length === 1 && pushes.some(p => p.data.target === 'lock'), '“both”: Chin gets both, Bob only his lock screen');
// chosen person only
pushes.length = 0;
[, d] = await call('fun/send', { room: 'floor', url: url1, target: 'lock', to: [B.uid], final: true }, K); ok(d.sent.join() === 'Bob' && pushes.length === 1, 'can send to just one person');
// live doodle: frames limited, old frames deleted, final kept
{ const x = m.get(`fl/floor/${B.uid}`); x.at -= 2000; m.set(`fl/floor/${B.uid}`, x); }     // the photo above was just now
pushes.length = 0;
const sid = 'doodle' + Date.now().toString(36);
const f1 = await upload(K); [, d] = await call('fun/send', { room: 'floor', url: f1, target: 'lock', to: [B.uid], live: true, sid }, K);
const f2 = await upload(K); [, d] = await call('fun/send', { room: 'floor', url: f2, target: 'lock', to: [B.uid], live: true, sid }, K);
ok(pushes.length === 1 && d.sent.length === 0, 'live frames: at most one every 1.5 s per person');
ok(!files.has('f/' + f1.split('/').pop()), 'the previous live frame is deleted');
{ const x = m.get(`fl/floor/${B.uid}`); x.at -= 2000; m.set(`fl/floor/${B.uid}`, x); }
const f3 = await upload(K); [, d] = await call('fun/send', { room: 'floor', url: f3, target: 'lock', to: [B.uid], live: true, final: true, sid, kind: 'doodle' }, K);
ok(d.sent.join() === 'Bob' && files.has('f/' + f3.split('/').pop()) && !m.has(`fd/${sid}`), 'final frame delivered and kept');
[, d] = await call('poll', { room: 'floor' }, B); ok(d.messages.some(x => x.text === 'Kunik drew on Bob’s lock screen'), '“Kunik drew on Bob’s lock screen”');
// turning it off / leaving stops it
await call('fun/settings', { room: 'floor', lock: false, home: false }, B); pushes.length = 0;
[, d] = await call('fun/send', { room: 'floor', url: url1, target: 'lock', final: true }, K); ok(!d.sent.includes('Bob') && pushes.every(p => !p.token.includes('Bob')), 'after Bob turns it off, his screen is left alone');
[s] = await call('group/update', { room: 'floor', password: 'newpass1' }, K); pushes.length = 0;     // members must enter the new password
[, d] = await call('fun/send', { room: 'floor', url: url1, target: 'lock', final: true }, K); ok(s === 200 && !d.sent.includes('Chin') && pushes.length === 0, 'after a password change, people who are no longer members get nothing');
// input checks
[s] = await call('fun/send', { room: 'floor', url: 'https://evil.example/x.jpg', target: 'lock' }, K); ok(s === 400, 'only pictures uploaded to the app can be sent');
