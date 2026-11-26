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
ok(pushes.length === 2 && pushes.every(p => p.data.type === 'fun' && p.data.url === url1 && p.data.target === 'lock' && p.data.by === 'Kunik' && !('from' in p.data) && !p.notification && p.android.priority === 'HIGH'), 'a silent high-priority data push wakes each phone with the picture');
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
// Firebase rejects messages using reserved data keys ("from", "google.*", "gcm.*", "message_type", "collapse_key")
{ const bad = pushes.concat().flatMap(p => Object.keys(p.data)).filter(k => k === 'from' || k.startsWith('google') || k.startsWith('gcm') || k === 'message_type' || k === 'collapse_key');
  ok(bad.length === 0, 'fun pushes use no reserved Firebase data keys'); }
// a rejected message never makes the server forget a working phone
{ const { _setFcmFetch: setF } = await import('../../lib/push.mjs');
  await call('group/update', { room: 'floor', password: null }, K); await call('fun/settings', { room: 'floor', lock: true }, B);
  setF(async (url) => url.includes('oauth2') ? new Response(JSON.stringify({ access_token: 't', expires_in: 3600 })) : new Response(JSON.stringify({ error: { status: 'INVALID_ARGUMENT', details: [{ errorCode: 'INVALID_ARGUMENT' }] } }), { status: 400 }));
  const before = [...m.keys()].filter(k => k.startsWith(`pf/${B.uid}/`)).length;
  { const [, dd] = await call('fun/send', { room: 'floor', url: url1, target: 'lock', to: [B.uid], final: true }, K); ok(dd.skipped.includes('Bob'), 'a rejected push counts as not delivered'); }
  ok(before === 1 && [...m.keys()].filter(k => k.startsWith(`pf/${B.uid}/`)).length === 1, 'an "invalid argument" reply keeps the phone registered');
  setF(async (url) => url.includes('oauth2') ? new Response(JSON.stringify({ access_token: 't', expires_in: 3600 })) : new Response(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }), { status: 404 }));
  await call('fun/send', { room: 'floor', url: url1, target: 'lock', to: [B.uid], final: true }, K);
  ok([...m.keys()].filter(k => k.startsWith(`pf/${B.uid}/`)).length === 0, 'a dead token ("unregistered") is forgotten'); }
// wake-only phones get fun / walkie pushes but no visible notifications
{ const { _setFcmFetch: setF } = await import('../../lib/push.mjs'); const sent = [];
  setF(async (url, init) => { if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 })); sent.push(JSON.parse(init.body).message); return new Response('{}'); });
  await call('push/native', { room: 'floor', token: 'tok-wake-' + 'y'.repeat(30), platform: 'android', notify: false }, B);
  await call('fun/send', { room: 'floor', url: url1, target: 'lock', final: true }, K);
  ok(sent.some(x => x.data?.type === 'fun' && x.token.startsWith('tok-wake')), 'a wake-only phone still gets fun mode');
  sent.length = 0; await call('send', { room: 'floor', text: 'hello Bob' }, K); await new Promise(r => setTimeout(r, 50));
  ok(!sent.some(x => x.token.startsWith('tok-wake') && x.notification), 'but no message notifications'); }
// ---- live strokes: watching a doodle in the app while it's drawn, and replaying it
{ const { _setFcmFetch: setF } = await import('../../lib/push.mjs');
  setF(async (url) => url.includes('oauth2') ? new Response(JSON.stringify({ access_token: 't', expires_in: 3600 })) : new Response('{}'));
  var D = await signup('dee', 'Dee'); await call('poll', { room: 'floor' }, D);                  // in the chat, fun mode off
  const sid = 'live' + Date.now().toString(36);
  let [st, r] = await call('fun/live', { room: 'floor', sid, target: 'lock', ops: [{ i: 0, tool: 'pen', color: '#FF0000', size: 9, seed: 5, from: 0, pts: [[10, 10], [20, 25], [99999, -5]] }] }, K);
  ok(st === 200 && r.watchers >= 1, 'Kunik starts a live doodle; Bob is watching');
  let [, p] = await call('poll', { room: 'floor' }, B);
  ok(p.fun?.sid === sid && p.fun.reset && p.fun.strokes.length === 1 && p.fun.strokes[0][1].color === '#ff0000' && JSON.stringify(p.fun.strokes[0][1].pts) === '[[10,10],[20,25],[1080,0]]', 'Bob’s poll brings the strokes (cleaned: colour, points kept on the canvas)');
  [, p] = await call('poll', { room: 'floor' }, D); ok(!p.fun, 'someone who didn’t turn on fun mode doesn’t get it');
  [, p] = await call('poll', { room: 'floor', fsid: sid, fseq: r.seq }, B); ok(!p.fun, 'nothing new → nothing sent');
  const seen = r.seq;
  [, r] = await call('fun/live', { room: 'floor', sid, ops: [{ i: 0, tool: 'pen', color: '#ff0000', size: 9, seed: 5, from: 3, pts: [[30, 40]] }, { i: 1, tool: 'heart', color: '#ec4899', size: 10, from: 0, pts: [[100, 100], [300, 300], [9, 9]] }] }, K);
  [, p] = await call('poll', { room: 'floor', fsid: sid, fseq: seen }, B);
  ok(!p.fun.reset && p.fun.strokes.length === 2 && p.fun.strokes[0][1].pts.length === 4 && p.fun.strokes[1][1].pts.length === 2, 'only new strokes go out: the pen line grew, a heart appeared (shapes keep 2 points)');
  [s] = await call('fun/live', { room: 'floor', sid, ops: [] }, B); ok(s === 403, 'nobody else can write into Kunik’s doodle');
  [, r] = await call('fun/live', { room: 'floor', sid, ops: [{ i: 0, tool: 'laser', color: '#fff', size: 9, from: 0, pts: [[1, 1]] }] }, K);
  ok(m.get(`fv/floor/${sid}`).strokes[0].tool === 'pen', 'unknown tools are ignored');
  [, r] = await call('fun/live', { room: 'floor', sid, reset: true, ops: [{ i: 0, tool: 'star', color: '#facc15', size: 10, from: 0, pts: [[50, 50], [150, 150]] }], bg: '#FDE68A' }, K);
  [, p] = await call('poll', { room: 'floor', fsid: sid, fseq: seen }, B);
  ok(p.fun.reset && p.fun.n === 1 && p.fun.strokes[0][1].tool === 'star' && p.fun.bg === '#fde68a', 'undo / clear: watchers start over; background colour changes too');
  const big = Array.from({ length: 4000 }, (_, i) => [i % 1000, i % 2000]);
  for (let n = 0; n < 5; n++) [s] = await call('fun/live', { room: 'floor', sid, ops: [{ i: n + 1, tool: 'pen', color: '#ffffff', size: 4, from: 0, pts: big }] }, K);
  ok(s === 413, 'a huge doodle is refused instead of filling the database');
  // finish → note with a replay link; replay; finished doodles don't pop up for people opening the chat later
  const final = await upload(K);
  [, r] = await call('fun/send', { room: 'floor', url: final, target: 'lock', to: [B.uid], sid, live: true, final: true, kind: 'doodle' }, K);
  [, p] = await call('poll', { room: 'floor', fsid: sid, fseq: seen }, B);
  ok(p.fun?.done && p.messages.some(x => x.sys === 'fun' && x.ref === sid), 'Bob sees it finish; the chat note links to the doodle');
  [, p] = await call('poll', { room: 'floor' }, B); ok(!p.fun, 'a finished doodle doesn’t pop up again when you open the chat later');
  [st, r] = await call('fun/replay', { room: 'floor', sid }, D); ok(st === 200 && r.doodle.strokes.length >= 1 && r.doodle.byName === 'Kunik', 'anyone in the chat can replay it from the note');
  [st] = await call('fun/replay', { room: 'floor', sid: 'nosuchdoodle1' }, D); ok(st === 404, 'unknown doodle → not found'); }
// the final picture is never held back by the live-frame limit
{ const sid2 = 'last' + Date.now().toString(36); pushes.length = 0;
  const { _setFcmFetch: setF } = await import('../../lib/push.mjs');
  setF(async (url, init) => { if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 })); pushes.push(JSON.parse(init.body).message); return new Response('{}'); });
  await call('fun/send', { room: 'floor', url: await upload(K), target: 'lock', to: [B.uid], sid: sid2, live: true }, K);
  const fin = await upload(K);
  [, d] = await call('fun/send', { room: 'floor', url: fin, target: 'lock', to: [B.uid], sid: sid2, live: true, final: true, kind: 'doodle' }, K);
  ok(d.sent.includes('Bob') && pushes.at(-1)?.data.url === fin, 'Done right after a live frame still delivers the final picture'); }
// ---- videos and the live wallpaper
{ const { _setFcmFetch: setF } = await import('../../lib/push.mjs'); const sent = [];
  setF(async (url, init) => { if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 })); sent.push(JSON.parse(init.body).message); return new Response('{}'); });
  const up = async (bytes, kind) => { const r = await handle(new Request('https://x/api/upload', { method: 'POST', headers: { ...hdr(K), 'x-chat-room': 'floor', ...(kind ? { 'x-upload-kind': kind } : {}) }, body: bytes }), store, {}); return [r.status, await r.json()]; };
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), crypto.randomBytes(5000)]);
  let [st, r] = await up(mp4, 'video'); ok(st === 200 && files.get('f/' + r.url.split('/').pop()).type === 'video/mp4', 'an MP4 video uploads as video/mp4');
  const vurl = r.url;
  [st] = await up(Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypqt  '), crypto.randomBytes(100)]), 'video'); ok(st === 200, 'an iPhone MOV is accepted');
  [st] = await up(Buffer.alloc(21 * 1024 * 1024), 'video'); ok(st === 413, 'videos over 20 MB are refused');
  [st] = await up(Buffer.alloc(5 * 1024 * 1024)); ok(st === 413, 'non-video uploads keep the 4 MB limit');
  [st] = await up(Buffer.from('not a video at all'), 'video'); ok(st === 415, 'something that isn’t a video is refused');
  // Bob: live wallpaper on; Chin rejoined without it
  await call('fun/settings', { room: 'floor', lock: true, home: true, live: true }, B);
  [, r] = await call('fun/state', { room: 'floor' }, K); ok(r.people.find(p => p.name === 'Bob')?.live === true, 'others can see Bob uses the live wallpaper');
  await call('fun/settings', { room: 'floor', lock: true, home: false }, B);
  [, r] = await call('fun/state', { room: 'floor' }, B); ok(r.me.live === true, 'changing lock/home keeps the live-wallpaper setting');
  await call('fun/settings', { room: 'floor', lock: true, home: true }, W);           // Webby: no live wallpaper
  sent.length = 0;
  [, r] = await call('fun/send', { room: 'floor', url: vurl, target: 'lock', final: true, kind: 'video' }, K);
  ok(r.sent.includes('Bob') && r.skipped.includes('Webby') && sent.every(x => x.data.kind === 'video'), 'a video goes only to people with the live wallpaper');
  // a live doodle starting wakes live-wallpaper phones; they pull strokes with fun/watch
  sent.length = 0; const sid = 'lw' + Date.now().toString(36);
  [, r] = await call('fun/live', { room: 'floor', sid, target: 'lock', ops: [{ i: 0, tool: 'pen', color: '#ffffff', size: 8, from: 0, pts: [[5, 5], [50, 50]] }] }, K);
  ok(sent.some(x => x.data.type === 'fun-live' && x.data.sid === sid && x.token.includes('wake')), 'starting a live doodle wakes Bob’s live wallpaper');
  ok(!sent.some(x => x.data.type === 'fun-live' && x.token.includes('Webby')), 'phones without the live wallpaper aren’t woken for it');
  let [st2, w] = await call('fun/watch', { room: 'floor', sid, seq: -1 }, B); ok(st2 === 200 && w.doodle.strokes.length === 1 && !w.done, 'the live wallpaper pulls the strokes');
  [, w] = await call('fun/watch', { room: 'floor', sid, seq: w.seq }, B); ok(w.doodle === null, '…and gets nothing when nothing changed');
  [st2] = await call('fun/watch', { room: 'floor', sid, seq: -1 }, D); ok(st2 === 403, 'someone it isn’t for can’t pull it');
  [, r] = await call('fun/send', { room: 'floor', url: await upload(K), target: 'lock', to: [B.uid], sid, live: true, final: true, kind: 'doodle' }, K);
  ok(sent.some(x => x.data.type === 'fun' && x.data.sid === sid && x.data.kind === 'doodle'), 'the final picture tells the phone which doodle it belongs to');
  [, w] = await call('fun/watch', { room: 'floor', sid, seq: 0 }, B); ok(w.done, 'the live wallpaper sees the doodle finish'); }
