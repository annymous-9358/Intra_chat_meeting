import { ok } from '../helpers.mjs';
import { handle } from '../../lib/chat.mjs';
import crypto from 'node:crypto';
const devId = sec => crypto.createHash('sha256').update(sec).digest('hex').slice(0, 24);
const m = new Map(); const sent = [];
const store = { list: async p => [...m.keys()].filter(k => k.startsWith(p)), get: async k => structuredClone(m.get(k) ?? null), set: async (k, v) => { m.set(k, structuredClone(v)); }, del: async k => { m.delete(k); },
  setFile: async () => {}, getFile: async () => null, delFile: async () => {} };
const opts = { pushSender: async (sub, payload) => sent.push({ to: sub.endpoint, ...JSON.parse(payload) }) };
const call = async (route, body = {}, { token, dev } = {}) => {
  const r = await handle(new Request('https://chat.example/api/' + route, { method: 'POST', headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(dev ? { 'x-chat-device': dev } : {}) }, body: JSON.stringify(body) }), store, opts);
  return [r.status, await r.json()];
};
let s, d;
// Accounts
[s, d] = await call('poll', { room: 'general' }); ok(s === 401 && d.code === 'auth', 'no session → sign in required');
[s, d] = await call('auth/signup', { username: 'Ku', name: 'Kunik', password: 'secret1' }); ok(s === 400 && d.field === 'username', 'short username rejected');
[s, d] = await call('auth/signup', { username: 'kunik', name: 'Kunik', password: '123' }); ok(s === 400 && d.field === 'password', 'short password rejected');
[s, d] = await call('auth/signup', { username: 'Kunik', name: 'Kunik J', password: 'secret1' }); ok(s === 200 && d.token?.length === 64 && d.user.username === 'kunik', 'sign up (username lower-cased)');
const kunik = { token: d.token, uid: d.user.uid, dev: 'a'.repeat(32) };
[s, d] = await call('auth/signup', { username: 'kunik', name: 'Fake', password: 'secret1' }); ok(s === 409, 'duplicate username rejected');
[s, d] = await call('auth/signup', { username: 'chin', name: 'Chin', password: 'pass123' }); const chin = { token: d.token, uid: d.user.uid, dev: 'b'.repeat(32) };
[s, d] = await call('auth/signup', { username: 'himanshu', name: 'Himanshu', password: 'pass123' }); const him = { token: d.token, uid: d.user.uid, dev: 'c'.repeat(32) };
[s, d] = await call('auth/login', { username: 'kunik', password: 'nope' }); ok(s === 401, 'wrong password rejected');
[s, d] = await call('auth/login', { username: '@Kunik', password: 'secret1' }); ok(s === 200 && d.user.name === 'Kunik J', 'log in (with @ and caps) on another device');
const kunik2 = { token: d.token, dev: 'd'.repeat(32) };
for (let i = 0; i < 5; i++) await call('auth/login', { username: 'chin', password: 'bad' + i });
[s] = await call('auth/login', { username: 'chin', password: 'pass123' }); ok(s === 429, 'login brake after 5 wrong tries');
// Name comes from the account, not the request
[s, d] = await call('send', { room: 'general', text: 'hi', name: 'Pretend Boss' }, kunik); ok(s === 200 && d.message.name === 'Kunik J' && d.message.uid === kunik.uid, 'server uses account name (no impersonation)');
// Legacy device-owned group: account signing in on that device becomes admin
m.set('g/floor-1', { room: 'floor-1', title: 'Floor', radius: 150, center: { lat: 28.6, lng: 77.2 }, admin: devId(kunik.dev), adminName: 'Kunik', created: 1 });
m.set('r/floor-1', { room: 'floor-1', title: 'Floor', geo: true, radius: 150 });
m.set(`gm/floor-1/${devId(chin.dev)}`, { dev: devId(chin.dev), name: 'Chin chapk', approved: true, inside: false, dist: 3200 });
[s, d] = await call('poll', { room: 'floor-1', loc: { lat: 28.6, lng: 77.2, acc: 10 } }, chin); ok(s === 200 && !d.group.isAdmin && d.group.me.approved, 'legacy member approval carried over to account');
ok(!m.has(`gm/floor-1/${devId(chin.dev)}`) && m.has(`gm/floor-1/${chin.uid}`), 'old device record moved to account');
[s, d] = await call('poll', { room: 'floor-1', loc: { lat: 28.6, lng: 77.2, acc: 10 } }, kunik); ok(d.group.isAdmin && m.get('g/floor-1').adminUid === kunik.uid, 'account on the creating device claims legacy admin');
[s, d] = await call('poll', { room: 'floor-1', loc: { lat: 28.6, lng: 77.2, acc: 10 } }, kunik2); ok(d.group.isAdmin, 'admin follows the account to another device');
// Private group: joining is remembered for the account on every device
[s, d] = await call('group/create', { room: 'hr', title: 'HR', type: 'private', password: 'tea-time' }, chin); ok(s === 200 && d.group.isAdmin, 'Chin creates private HR group');
[s, d] = await call('poll', { room: 'hr' }, kunik); ok(s === 403, 'Kunik locked out before joining');
[s] = await call('group/join', { room: 'hr', password: 'tea-time' }, kunik); ok(s === 200, 'Kunik joins with password');
[s] = await call('poll', { room: 'hr' }, kunik2); ok(s === 200, '…and has access on his other device too');
[s, d] = await call('rooms', {}, him); ok(d.rooms.find(r => r.room === 'hr')?.access === false, 'outsider sees locked group without access');
// Members list + transfer admin
await call('group/join', { room: 'hr', password: 'tea-time' }, him); await call('poll', { room: 'hr' }, him);
[s, d] = await call('group/members', { room: 'hr' }, him); ok(s === 200 && d.members.length === 3 && d.members[0].admin && d.members[0].name === 'Chin', 'members list, admin first: ' + d.members.map(x => x.name + (x.admin ? '★' : '')).join(', '));
[s, d] = await call('group/admin/add', { room: 'hr', member: kunik.uid }, him); ok(s === 403, 'non-admin cannot add admins');
[s, d] = await call('group/admin/add', { room: 'hr', member: 'f'.repeat(24) }, chin); ok(s === 404, 'cannot make a non-member admin');
[s, d] = await call('group/admin/add', { room: 'hr', member: kunik.uid }, chin); ok(s === 200 && d.group.isOwner && d.group.isAdmin, 'owner Chin makes Kunik an admin (and stays owner)');
[s, d] = await call('poll', { room: 'hr' }, kunik2); ok(d.group.isAdmin && !d.group.isOwner && d.group.adminName === 'Chin', 'Kunik is admin on any device; Chin still owner');
[s, d] = await call('group/admin/add', { room: 'hr', member: him.uid }, kunik); ok(s === 200, 'admin Kunik can make more admins');
[s, d] = await call('group/members', { room: 'hr' }, him); ok(d.members[0].owner && d.members.filter(x => x.admin).length === 3, 'members list: owner first, 3 admins');
[s, d] = await call('group/admin/remove', { room: 'hr', member: chin.uid }, kunik); ok(s === 403, 'nobody can remove the owner');
[s, d] = await call('group/admin/remove', { room: 'hr', member: chin.uid }, chin); ok(s === 403, 'not even the owner themselves');
[s, d] = await call('group/admin/remove', { room: 'hr', member: him.uid }, kunik); ok(s === 403, 'admins cannot remove other admins');
[s, d] = await call('group/admin/remove', { room: 'hr', member: him.uid }, him); ok(s === 200, 'an admin can step down');
[s, d] = await call('group/admin/remove', { room: 'hr', member: kunik.uid }, chin); ok(s === 200, 'owner removes an admin');
[s, d] = await call('group/update', { room: 'hr', title: 'HR team' }, kunik); ok(s === 403, 'removed admin can no longer change settings');
await call('group/admin/add', { room: 'hr', member: kunik.uid }, chin);
[s, d] = await call('group/update', { room: 'hr', password: 'new-pass' }, kunik); ok(s === 200, 'admin changes password');
[s] = await call('poll', { room: 'hr' }, chin); ok(s === 200, 'owner keeps access after password change');
[s] = await call('poll', { room: 'hr' }, him); ok(s === 403, 'members must re-enter new password');
[s, d] = await call('group/delete', { room: 'hr', confirm: 'HR' }, kunik); ok(s === 403, 'admins cannot delete the group');
[s, d] = await call('group/delete', { room: 'hr', confirm: 'nope' }, chin); ok(s === 400, 'delete needs the group name typed');
await call('send', { room: 'hr', text: 'bye' }, chin);
[s, d] = await call('group/delete', { room: 'hr', confirm: 'hr' }, chin); ok(s === 200, 'owner deletes the group');
ok(![...m.keys()].some(k => k.split('/')[1] === 'hr' && !k.startsWith('gx/')), 'all group data removed: ' + [...m.keys()].filter(k => k.split('/')[1] === 'hr').join(','));
[s, d] = await call('poll', { room: 'hr' }, kunik); ok(s === 410 && d.code === 'deleted', 'open chats are told it was deleted: ' + d.error);
[s, d] = await call('rooms', {}, kunik); ok(!d.rooms.some(r => r.room === 'hr'), 'gone from chat lists');
[s, d] = await call('group/create', { room: 'hr', title: 'HR', type: 'open' }, him); ok(s === 200, 'the name can be used again');
// Geo: a new admin can always chat
[s, d] = await call('group/admin/add', { room: 'floor-1', member: chin.uid }, kunik); ok(s === 200, 'floor-1: Chin made admin');
[s, d] = await call('send', { room: 'floor-1', text: 'from far away', loc: { lat: 28.7, lng: 77.2, acc: 10 } }, chin); ok(s === 200, 'geo admin can chat from anywhere');
// Notifications go to every device of each member account, not the sender
await call('push/subscribe', { subscription: { endpoint: 'https://push.example/kunik-phone', keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) } } }, kunik);
await call('push/subscribe', { subscription: { endpoint: 'https://push.example/kunik-laptop', keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) } } }, kunik2);
await call('push/subscribe', { subscription: { endpoint: 'https://push.example/chin', keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) } } }, chin);
sent.length = 0;
const [, msg] = await call('send', { room: 'floor-1', text: 'Meeting at 3', loc: { lat: 28.6, lng: 77.2, acc: 10 } }, chin);
ok(sent.map(x => x.to.split('/').pop()).sort().join() === 'kunik-laptop,kunik-phone', 'push to both of Kunik’s devices, not sender: ' + sent.map(x => x.to.split('/').pop()));
sent.length = 0;
await call('send', { room: 'floor-1', text: 'ok!', replyTo: { key: msg.message.key, text: 'Meeting at 3' }, loc: { lat: 28.6, lng: 77.2, acc: 10 } }, kunik);
ok(sent.length === 1 && sent[0].replyToYou === true && sent[0].name === 'Kunik J', 'reply flagged for the person replied to');
// Reactions & delete by account
[, d] = await call('react', { room: 'floor-1', key: msg.message.key, emoji: '👍' }, kunik2);
ok(d.edit.reactions['👍'][0].uid === kunik.uid, 'reaction stored per account');
[s] = await call('delete', { room: 'floor-1', key: msg.message.key }, him); ok(s === 403, 'a member cannot delete someone else’s message');
[s] = await call('delete', { room: 'floor-1', key: msg.message.key }, chin); ok(s === 200, 'sender deletes own message');
// Profile update
[s, d] = await call('auth/update', { name: 'Kunik Jain' }, kunik); ok(d.user.name === 'Kunik Jain', 'display name changed');
[s, d] = await call('auth/update', { password: 'wrong', newPassword: 'newsecret' }, kunik); ok(s === 401, 'password change needs current password');
[s, d] = await call('auth/update', { password: 'secret1', newPassword: 'newsecret' }, kunik); ok(s === 200, 'password changed');
[s] = await call('auth/logout', {}, kunik2); [s, d] = await call('poll', { room: 'general' }, kunik2); ok(s === 401, 'logout ends that session');
