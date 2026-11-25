// Location groups: members inside the radius can chat; outside they're read-only until the admin approves.
import { handle } from '../../lib/chat.mjs';
import { ok, memStore } from '../helpers.mjs';
const { store } = memStore();
const hdr = u => ({ authorization: 'Bearer ' + u.token, 'x-chat-device': (u.uid + 'a'.repeat(40)).slice(0, 32).replace(/[^a-f0-9]/g, 'b') });
const call = async (route, body = {}, u) => { const r = await handle(new Request('https://x/api/' + route, { method: 'POST', headers: u ? hdr(u) : {}, body: JSON.stringify(body) }), store, {}); return [r.status, await r.json()]; };
const signup = async (username, name) => { const [, d] = await call('auth/signup', { username, name, password: 'secret1' }); return { token: d.token, uid: d.user.uid }; };
const office = { lat: 28.6139, lng: 77.2090, acc: 20 };
const near = { lat: 28.6160, lng: 77.2090, acc: 20 };      // ~233 m north
const far = { lat: 28.6400, lng: 77.2090, acc: 20 };       // ~2.9 km north
const ADMIN = await signup('admin', 'Admin'), BOB = await signup('bob', 'Bob'), EVE = await signup('eve', 'Eve');

let [s, d] = await call('group/create', { room: 'floor3', title: 'Floor 3', type: 'geo', radius: 500, loc: office }, ADMIN); ok(s === 200, 'admin creates a 500 m group');
[s] = await call('group/create', { room: 'floor3', title: 'X', type: 'geo', radius: 500, loc: office }, EVE); ok(s === 409, 'duplicate group name rejected');
[s, d] = await call('poll', { room: 'floor3', loc: near }, BOB); ok(d.group.me.inside && d.group.me.canChat && !d.group.isAdmin && d.group.center, `Bob 233 m away is inside (dist ${d.group.me.dist}); members see the group's area`);
[s] = await call('send', { room: 'floor3', text: 'hi', loc: near }, BOB); ok(s === 200, 'Bob inside can send');
[s, d] = await call('rooms', {}, BOB); ok(d.rooms.some(r => r.room === 'floor3' && r.geo && r.radius === 500), 'group listed as a location group');
[s, d] = await call('send', { room: 'floor3', text: 'hi', loc: far }, BOB); ok(s === 403 && d.code === 'out_of_range', 'Bob 2.9 km away is blocked: ' + d.error);
[s, d] = await call('send', { room: 'floor3', text: 'no loc' }, BOB); ok(s === 403, 'send without location blocked: ' + d.error);
[s, d] = await call('poll', { room: 'floor3', loc: far }, BOB); ok(d.group.me.inside === false && !d.group.me.canChat && d.messages.some(x => x.text === 'hi'), 'outside, Bob is read-only but still sees messages');
[s] = await call('group/decide', { room: 'floor3', member: ADMIN.uid, action: 'approve' }, BOB); ok(s === 403, 'non-admin cannot approve');
[s] = await call('group/request', { room: 'floor3', note: 'working from home today' }, BOB); ok(s === 200, 'Bob asks to chat from outside');
[s, d] = await call('poll', { room: 'floor3', loc: office }, ADMIN);
const bobRow = d.group.members?.find(x => x.uid === BOB.uid); ok(d.group.isAdmin && bobRow?.req === 'pending' && bobRow.note === 'working from home today' && d.group.center, 'admin sees the pending request with its note');
[s] = await call('group/decide', { room: 'floor3', member: BOB.uid, action: 'approve' }, ADMIN); ok(s === 200, 'admin approves');
[s] = await call('send', { room: 'floor3', text: 'from home', loc: far }, BOB); ok(s === 200, 'approved Bob can send from outside');
await call('group/decide', { room: 'floor3', member: BOB.uid, action: 'revoke' }, ADMIN);
[s] = await call('send', { room: 'floor3', text: 'x', loc: far }, BOB); ok(s === 403, 'after revoke, Bob is blocked again');
await call('group/request', { room: 'floor3' }, BOB); await call('group/decide', { room: 'floor3', member: BOB.uid, action: 'deny' }, ADMIN);
[s, d] = await call('poll', { room: 'floor3', loc: far }, BOB); ok(d.group.me.req === 'denied', 'a denied request shows as denied to Bob');
[s] = await call('group/update', { room: 'floor3', radius: 5000 }, ADMIN); ok(s === 200, 'admin widens the range to 5 km');
[s] = await call('send', { room: 'floor3', text: 'now inside', loc: far }, BOB); ok(s === 200, 'Bob 2.9 km away is now inside the 5 km range');
[s] = await call('group/update', { room: 'floor3', radius: 50000 }, BOB); ok(s === 403, 'non-admin cannot change the range');
[s] = await call('send', { room: 'general', text: 'open room still works' }, EVE); ok(s === 200, 'open rooms are unaffected');
// voice upload sniffing
const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(100)]);
const up = await handle(new Request('https://x/api/upload', { method: 'POST', headers: { ...hdr(EVE), 'x-chat-room': 'general' }, body: webm }), store, {});
const { url } = await up.json(); ok(up.status === 200 && url, 'webm voice upload accepted');
const fr = await handle(new Request('https://x' + url), store, {}); ok(fr.headers.get('content-type') === 'audio/webm', 'served as audio/webm');
[s, d] = await call('send', { room: 'general', audio: { url, dur: 3.4, peaks: [10, 50, 900, 'x'] } }, EVE); ok(s === 200 && d.message.audio.dur === 3.4 && d.message.audio.peaks[2] === 100, 'voice message stored, peaks clamped');
[s] = await call('send', { room: 'general', audio: { url: 'https://evil.example/x.mp3', dur: 3 } }, EVE); ok(s === 400, 'external audio URL rejected');
