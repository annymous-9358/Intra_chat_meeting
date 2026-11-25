import { ok } from '../helpers.mjs';
import { handle, runScheduler } from '../../lib/chat.mjs';
const m = new Map(); const sent = []; const files = new Map();
const store = { list: async p => [...m.keys()].filter(k => k.startsWith(p)), get: async k => structuredClone(m.get(k) ?? null), set: async (k, v) => { m.set(k, structuredClone(v)); }, del: async k => { m.delete(k); }, setFile: async (k, d) => { files.set(k, d); }, getFile: async () => null, delFile: async k => { files.delete(k); } };
const opts = { pushSender: async (sub, payload) => sent.push({ to: sub.endpoint.split('/').pop(), ...JSON.parse(payload) }) };
const hdr = (u, extra = {}) => ({ authorization: 'Bearer ' + u.token, 'x-chat-device': (u.uid + 'a'.repeat(40)).slice(0, 32).replace(/[^a-f0-9]/g, 'b'), ...extra });
const call = async (route, body = {}, u) => { const r = await handle(new Request('https://x/api/' + route, { method: 'POST', headers: u ? hdr(u) : {}, body: JSON.stringify(body) }), store, opts); return [r.status, await r.json()]; };
const signup = async (un, name) => { const [, d] = await call('auth/signup', { username: un, name, password: 'secret1' }); return { token: d.token, uid: d.user.uid }; };
const K = await signup('kunik', 'Kunik'), H = await signup('himanshu', 'Himanshu'), C = await signup('chin', 'Chin');
for (const [u, n] of [[K, 'k'], [H, 'h'], [C, 'c']]) await call('push/subscribe', { subscription: { endpoint: 'https://push.example/' + n, keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) } } }, u);
let s, d;
// profile
[s, d] = await call('auth/update', { about: 'Building things', status: { emoji: '🏖️', text: 'On leave', until: Date.now() + 3600e3 } }, K);
ok(s === 200 && d.user.about === 'Building things' && d.user.status.text === 'On leave', 'about + status saved');
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001', 'hex');
let r = await handle(new Request('https://x/api/avatar', { method: 'POST', headers: hdr(K, { 'content-type': 'image/png' }), body: png }), store, opts); d = await r.json();
ok(r.status === 200 && /^\/api\/file\/[a-f0-9]{24}$/.test(d.user.photo), 'profile photo uploaded: ' + d.user?.photo);
[, d] = await call('profile/get', { uid: K.uid }, H); ok(d.profile.photo && d.profile.about === 'Building things' && d.profile.status.emoji === '🏖️', 'others see photo/about/status');
const u = m.get(`u/${K.uid}`); u.status.until = Date.now() - 1; m.set(`u/${K.uid}`, u);
[, d] = await call('profile/batch', { uids: [K.uid, H.uid] }, H); ok(d.profiles[K.uid].status === null && d.profiles[H.uid], 'expired status disappears; batch works');
// group & admin photo
await call('group/create', { room: 'team', title: 'Team', type: 'open' }, K);
await call('poll', { room: 'team' }, H); await call('poll', { room: 'team' }, C);
r = await handle(new Request('https://x/api/avatar', { method: 'POST', headers: hdr(H, { 'x-chat-room': 'team' }), body: png }), store, opts); ok(r.status === 403, 'non-admin cannot set group photo');
r = await handle(new Request('https://x/api/avatar', { method: 'POST', headers: hdr(K, { 'x-chat-room': 'team' }), body: png }), store, opts); d = await r.json(); ok(r.status === 200 && d.photo, 'admin sets group photo');
[, d] = await call('rooms', {}, C); ok(d.rooms.find(x => x.room === 'team')?.photo === m.get('g/team').photo, 'group photo in chat list');
// mentions: Himanshu mutes the group, still gets @mention
await call('push/mute', { room: 'team', until: Date.now() + 8 * 3600e3 }, H);
sent.length = 0; [, d] = await call('send', { room: 'team', text: 'hey all' }, K); ok(!sent.some(x => x.to === 'h') && sent.some(x => x.to === 'c'), 'muted member not notified');
sent.length = 0; [, d] = await call('send', { room: 'team', text: 'ping @himanshu please' }, K);
ok(d.message.mentions?.[0] === H.uid && sent.some(x => x.to === 'h' && x.mentioned), '@mention notifies even when muted');
const mk = d.message.key;
// edit
[s] = await call('edit', { room: 'team', key: mk, text: 'nope' }, C); ok(s === 403, 'cannot edit someone else’s message');
[s, d] = await call('edit', { room: 'team', key: mk, text: 'ping @himanshu please (updated)' }, K); ok(s === 200 && d.edit.text.includes('updated') && d.edit.edited, 'edit own message');
[, d] = await call('poll', { room: 'team' }, H); ok(d.edits[mk]?.text.includes('updated') && d.rooms.find(x => x.room === 'team').last.text.includes('updated'), 'edit reaches others + list preview');
// pin
[s] = await call('pin', { room: 'team', key: mk, on: true }, C); [, d] = await call('poll', { room: 'team' }, H); ok(d.pins.length === 1 && d.pins[0].text.includes('updated'), 'pinned message in poll');
await call('pin', { room: 'team', key: mk, on: false }, K); [, d] = await call('poll', { room: 'team' }, H); ok(d.pins.length === 0, 'unpin');
// search
[, d] = await call('search', { room: 'team', q: 'UPDATED' }, C); ok(d.results.length === 1 && d.results[0].key === mk, 'search finds message');
// schedule
[s] = await call('schedule', { room: 'team', text: 'later', at: Date.now() + 1000 }, K); ok(s === 400, 'schedule rejects too-soon time');
[s, d] = await call('schedule', { room: 'team', text: 'Good morning team ☀️', at: Date.now() + 120e3 }, K); ok(s === 200, 'schedule a message');
const sid = d.id;
[, d] = await call('schedule/list', { room: 'team' }, K); ok(d.scheduled.length === 1, 'listed'); [, d] = await call('schedule/list', { room: 'team' }, H); ok(d.scheduled.length === 0, 'others don’t see it');
[s] = await call('schedule/cancel', { room: 'team', id: sid }, H); ok(s === 404, 'others cannot cancel');
ok(await runScheduler(store, opts) === 0, 'not delivered early');
const job = m.get(`sc/${sid}`); m.delete(`sc/${sid}`); const past = String(Date.now() - 1000).padStart(13, '0') + sid.slice(13); job.id = past; m.set(`sc/${past}`, job);
sent.length = 0; ok(await runScheduler(store, opts) === 1, 'delivered when due');
[, d] = await call('poll', { room: 'team' }, H); const last = d.messages.at(-1); ok(last.text.startsWith('Good morning') && last.uid === K.uid && last.scheduled, 'scheduled message appears from Kunik'); ok(sent.some(x => x.to === 'c'), 'and pushes');
ok(await runScheduler(store, opts) === 0, 'delivered once');
const s2 = (await call('schedule', { room: 'team', text: 'x', at: Date.now() + 120e3 }, K))[1].id; [s] = await call('schedule/cancel', { room: 'team', id: s2 }, K); ok(s === 200 && !m.has(`sc/${s2}`), 'cancel own');
// remind
[s] = await call('remind', { room: 'team', key: mk, at: Date.now() + 60e3 }, C); ok(s === 200, 'remind me set');
for (const k of [...m.keys()].filter(k => k.startsWith('rm/'))) { const j = m.get(k); m.delete(k); m.set('rm/' + String(Date.now() - 1).padStart(13, '0') + k.slice(16), j); }
sent.length = 0; await runScheduler(store, opts); ok(sent.length === 1 && sent[0].to === 'c' && sent[0].type === 'reminder' && sent[0].body.includes('updated'), 'reminder push to Chin only');
// DM privacy for schedule
await call('friends/request', { username: 'himanshu' }, K); await call('friends/respond', { uid: K.uid, accept: true }, H);
const dm = (await call('friends/dm', { uid: H.uid }, K))[1].room; [s] = await call('schedule', { room: dm, text: 'x', at: Date.now() + 120e3 }, C); ok(s === 403, 'cannot schedule into someone else’s DM');
[, d] = await call('rooms', {}, H); ok(d.rooms.find(x => x.room === dm)?.peer.photo, 'DM row shows peer photo');
