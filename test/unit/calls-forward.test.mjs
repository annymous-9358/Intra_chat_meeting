// Calls (voice / video over LiveKit), voice chat in games, and forwarding messages.
import crypto from 'node:crypto';
import { handle } from '../../lib/chat.mjs';
import { ok, memStore } from '../helpers.mjs';
const { m, files, store } = memStore();
const LK = { url: 'wss://lk.example', apiKey: 'APIkey', apiSecret: 'secret-123' };
const hdr = u => ({ authorization: 'Bearer ' + u.token, 'x-chat-device': (u.uid + 'a'.repeat(40)).slice(0, 32).replace(/[^a-f0-9]/g, 'b') });
const call = async (route, body = {}, u, opts = { livekit: LK }) => { const r = await handle(new Request('https://x/api/' + route, { method: 'POST', headers: u ? hdr(u) : {}, body: JSON.stringify(body) }), store, opts); return [r.status, await r.json()]; };
const signup = async (username, name) => { const [, d] = await call('auth/signup', { username, name, password: 'secret1' }); return { token: d.token, uid: d.user.uid, name }; };
const K = await signup('kunik', 'Kunik'), B = await signup('bob', 'Bob'), E = await signup('eve', 'Eve');
await call('group/create', { room: 'floor', title: 'Floor', type: 'open' }, K); await call('poll', { room: 'floor' }, B);
let s, d;
// ---- calls
[s, d] = await call('call/start', { room: 'floor', video: true }, K, {}); ok(s === 501 && d.code === 'no_calls', 'without LiveKit set up, calls say so');
[s, d] = await call('call/start', { room: 'floor', video: true }, K);
ok(s === 200 && d.call.video && d.call.people.length === 1 && d.url === LK.url, 'Kunik starts a video call');
const [h, c, sig] = d.token.split('.'); const claims = JSON.parse(Buffer.from(c, 'base64url'));
ok(crypto.createHmac('sha256', LK.apiSecret).update(`${h}.${c}`).digest('base64url') === sig && claims.sub === K.uid && claims.video.room === `call-floor-${d.call.id}` && claims.video.canPublishSources.join() === 'microphone,camera',
  'the LiveKit pass is signed, for this call only, with microphone and camera');
const id = d.call.id;
[, d] = await call('poll', { room: 'floor' }, B);
ok(d.call?.id === id && d.call.video && d.messages.some(x => x.sys === 'call' && x.text === 'Kunik started a video call — tap to join' && x.ref === id), 'Bob’s chat shows the call and a "tap to join" note');
[s, d] = await call('call/start', { room: 'floor', video: false }, B); ok(s === 200 && d.call.id === id && d.call.people.length === 2, 'starting while a call is on joins it instead');
[, d] = await call('call/ping', { room: 'floor', id }, B); ok(d.call.people.length === 2, 'check-ins keep you in the call');
[, d] = await call('call/ping', { room: 'floor', id: 'other' }, B); ok(d.ended, 'a check-in for an old call says it ended');
// someone who stops checking in drops out
{ const x = m.get('cl/floor'); x.joined[B.uid].at -= 70_000; m.set('cl/floor', x); }
[, d] = await call('poll', { room: 'floor' }, K); ok(d.call.people.length === 1 && d.call.people[0].name === 'Kunik', 'someone not heard from for a minute drops out');
{ const x = m.get('cl/floor'); x.at -= 5 * 60_000; m.set('cl/floor', x); }
await call('call/leave', { room: 'floor', id }, K);
[, d] = await call('poll', { room: 'floor' }, B);
ok(!d.call && d.messages.some(x => x.sys === 'call' && /^Video call ended · 5 min$/.test(x.text)), 'when the last person leaves the call ends: "Video call ended · 5 min"');
[s] = await call('call/join', { room: 'floor' }, B); ok(s === 410, 'joining an ended call says so');
// game voice chat: quiet (no ringing note), same mechanics
[, d] = await call('call/start', { room: 'floor', game: true }, K);
const msgsBefore = [...m.keys()].filter(k => k.startsWith('m/floor/')).length;
ok(d.call.game && !d.call.video, 'game voice chat is a voice call');
[, d] = await call('poll', { room: 'floor' }, B); ok(d.call?.game && !d.messages.some(x => x.text?.includes('started a voice call')), 'it starts quietly — no "tap to join" note');
await call('call/leave', { room: 'floor', id: d.call.id }, K);
ok([...m.keys()].filter(k => k.startsWith('m/floor/')).length === msgsBefore, '…and ends quietly');
// people outside a private group can't get into its call
await call('group/create', { room: 'secret', title: 'Secret', type: 'private', password: 'pw12345' }, K);
[s] = await call('call/start', { room: 'secret' }, E); ok(s === 403, 'no call pass for a group you can’t open');
// ---- forwarding
const up = async () => { const r = await handle(new Request('https://x/api/upload', { method: 'POST', headers: { ...hdr(K), 'x-chat-room': 'floor' }, body: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(300)]) }), store, {}); return (await r.json()).url; };
const photo = await up();
[, d] = await call('send', { room: 'floor', text: 'look', gif: { url: photo, w: 10, h: 10 } }, K);
await call('group/create', { room: 'team', title: 'Team', type: 'open' }, B);
[s, d] = await call('send', { room: 'team', text: 'look', gif: { url: photo, w: 10, h: 10 }, forwarded: true }, K);
ok(s === 200 && d.message.fwd === true && d.message.gif.url !== photo && files.has('f/' + d.message.gif.url.split('/').pop()), 'forwarding marks it "Forwarded" and gives the photo its own copy');
ok(files.get('f/' + d.message.gif.url.split('/').pop()).type === 'image/jpeg', 'the copy keeps the file type');
[s, d] = await call('send', { room: 'team', text: 'hi', forwarded: true, replyTo: { key: 'x' } }, K); ok(s === 200 && !d.message.replyTo, 'a forwarded message doesn’t carry a reply quote');
[s] = await call('send', { room: 'secret', text: 'sneaky', forwarded: true }, E); ok(s === 403, 'you can’t forward into a group you can’t open');
[s, d] = await call('send', { room: 'team', gif: { url: '/api/file/' + 'f'.repeat(24) }, forwarded: true }, K); ok(s === 400, 'forwarding a photo that no longer exists fails cleanly');
