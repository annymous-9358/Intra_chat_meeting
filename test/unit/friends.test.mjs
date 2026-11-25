import { ok } from '../helpers.mjs';
import { handle } from '../../lib/chat.mjs';
const m = new Map(); const sent = [];
const store = { list: async p => [...m.keys()].filter(k => k.startsWith(p)), get: async k => structuredClone(m.get(k) ?? null), set: async (k, v) => { m.set(k, structuredClone(v)); }, del: async k => { m.delete(k); }, setFile: async () => {}, getFile: async () => null, delFile: async () => {} };
const opts = { pushSender: async (sub, payload) => sent.push({ to: sub.endpoint.split('/').pop(), ...JSON.parse(payload) }) };
const call = async (route, body = {}, u) => { const r = await handle(new Request('https://x/api/' + route, { method: 'POST', headers: u ? { authorization: 'Bearer ' + u.token, 'x-chat-device': (u.uid + 'a'.repeat(40)).slice(0, 32).replace(/[^a-f0-9]/g, 'b') } : {}, body: JSON.stringify(body) }), store, opts); return [r.status, await r.json()]; };
const signup = async (un, name) => { const [, d] = await call('auth/signup', { username: un, name, password: 'secret1' }); return { token: d.token, uid: d.user.uid }; };
const K = await signup('kunik', 'Kunik'), H = await signup('himanshu', 'Himanshu'), C = await signup('chin', 'Chin'), H2 = await signup('himesh', 'Himesh');
for (const [u, n] of [[K, 'k'], [H, 'h'], [C, 'c']]) await call('push/subscribe', { subscription: { endpoint: 'https://push.example/' + n, keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) } } }, u);
let s, d;
[, d] = await call('friends/search', { q: '@him' }, K); ok(d.users.map(u => u.username).sort().join() === 'himanshu,himesh', 'search by username prefix: ' + d.users.map(u => '@' + u.username));
[s, d] = await call('friends/dm', { username: 'himanshu' }, K); ok(s === 403, 'cannot message a non-friend');
sent.length = 0;
[s, d] = await call('friends/request', { username: '@Himanshu' }, K); ok(s === 200 && d.state === 'out', 'Kunik sends friend request');
ok(sent.length === 1 && sent[0].to === 'h' && sent[0].body.includes('Kunik'), 'Himanshu gets a push about the request');
[, d] = await call('friends/list', {}, H); ok(d.incoming.length === 1 && d.incoming[0].username === 'kunik', 'Himanshu sees incoming request');
[, d] = await call('friends/list', {}, K); ok(d.outgoing.length === 1, 'Kunik sees it as sent');
[s, d] = await call('friends/respond', { uid: K.uid, accept: true }, H); ok(d.state === 'friends', 'Himanshu accepts');
[, d] = await call('friends/list', {}, K); ok(d.friends.length === 1 && d.friends[0].name === 'Himanshu', 'now friends on both sides');
// mutual requests become friends automatically
await call('friends/request', { username: 'chin' }, K); [, d] = await call('friends/request', { username: 'kunik' }, C); ok(d.state === 'friends', 'requesting someone who already asked you = friends');
// decline
await call('friends/request', { username: 'himesh' }, C); [, d] = await call('friends/respond', { uid: C.uid, accept: false }, H2); [, d] = await call('friends/list', {}, C); ok(!d.outgoing.length, 'declined request disappears');
// DM
[s, d] = await call('friends/dm', { uid: H.uid }, K); const room = d.room; ok(s === 200 && /^d-[a-f0-9]{24}$/.test(room), 'DM room created: ' + room);
[, d] = await call('friends/dm', { uid: K.uid }, H); ok(d.room === room, 'same room from both sides');
sent.length = 0;
[s, d] = await call('send', { room, text: 'Hi Himanshu 👋' }, K); ok(s === 200, 'Kunik messages Himanshu');
ok(sent.length === 1 && sent[0].to === 'h' && sent[0].title === 'Kunik' && sent[0].name === null, 'DM push titled with sender name: ' + JSON.stringify({ title: sent[0]?.title, body: sent[0]?.body }));
[s, d] = await call('poll', { room }, C); ok(s === 403, 'a third person cannot read the DM');
[s] = await call('send', { room, text: 'sneaky' }, C); ok(s === 403, 'or write in it');
[, d] = await call('rooms', {}, C); ok(!d.rooms.some(r => r.room === room), 'DM hidden from others’ chat lists');
[, d] = await call('rooms', { reads: { [room]: '' } }, H); const dmRow = d.rooms.find(r => r.room === room);
ok(dmRow?.dm && dmRow.title === 'Kunik' && dmRow.peer.username === 'kunik' && dmRow.unread === 1 && dmRow.last.text === 'Hi Himanshu 👋', 'Himanshu’s list: DM titled “Kunik”, 1 unread, preview');
[, d] = await call('poll', { room }, H); ok(d.group.dm && d.group.title === 'Kunik' && d.group.peer.lastSeen > 0, 'DM chat header: peer name + last seen');
[s] = await call('group/update', { room, title: 'x' }, K); ok(s >= 400, 'no admin settings in a DM');
[s] = await call('group/create', { room: 'd-123', title: 'x', type: 'open' }, K); ok(s === 400, 'cannot create a group named like a DM');
// unfriend: existing chat stays readable but friends list updates
await call('friends/remove', { uid: H.uid }, K); [, d] = await call('friends/list', {}, H); ok(!d.friends.length, 'remove friend');
// location grace
[, d] = await call('group/create', { room: 'floor', title: 'Floor', type: 'geo', radius: 150, loc: { lat: 28.6, lng: 77.2, acc: 10 } }, K);
await call('poll', { room: 'floor', loc: { lat: 28.6005, lng: 77.2, acc: 10 } }, C);
[s] = await call('send', { room: 'floor', text: 'no fix right now' }, C); ok(s === 200, 'inside in the last 10 min → can chat even without a fresh fix');
const g = m.get(`gm/floor/${C.uid}`); g.at = Date.now() - 11 * 60_000; m.set(`gm/floor/${C.uid}`, g);
[s] = await call('send', { room: 'floor', text: 'stale' }, C); ok(s === 403, 'but not when the last fix is older than 10 min');
