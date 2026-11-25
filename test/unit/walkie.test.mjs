import { ok } from '../helpers.mjs';
import { handle } from '../../lib/chat.mjs';
const m = new Map(), files = new Map();
const store = { list: async p => [...m.keys()].filter(k => k.startsWith(p)), get: async k => structuredClone(m.get(k) ?? null), set: async (k, v) => { m.set(k, structuredClone(v)); }, del: async k => { m.delete(k); },
  setFile: async (k, d, t) => files.set(k, { d, t }), getFile: async k => files.get(k) ? { data: files.get(k).d, type: files.get(k).t } : null, delFile: async k => files.delete(k) };
const opts = { pushSender: async () => {} };
const call = async (route, body = {}, u) => { const r = await handle(new Request('https://x/api/' + route, { method: 'POST', headers: { authorization: 'Bearer ' + u.token }, body: JSON.stringify({ room: 'general', ...body }) }), store, opts); return [r.status, await r.json()]; };
const chunk = async (u, talkId, seq, final, bytes) => { const r = await handle(new Request('https://x/api/talk/chunk', { method: 'POST', headers: { authorization: 'Bearer ' + u.token, 'x-chat-room': 'general', 'x-talk-id': talkId, 'x-talk-seq': String(seq), ...(final ? { 'x-talk-final': '1' } : {}) }, body: bytes }), store, opts); return [r.status, await r.json()]; };
const signup = async n => { const r = await handle(new Request('https://x/api/auth/signup', { method: 'POST', body: JSON.stringify({ username: n, name: n, password: 'secret1' }) }), store, opts); const d = await r.json(); return { token: d.token, uid: d.user.uid }; };
const A = await signup('asha'), B = await signup('ravi');
const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(200, 7)]);
let s, d;
[s] = await chunk(A, 'talkaaaa1', 0, false, webm); ok(s === 409, 'cannot send audio without holding the channel');
[s] = await call('talk/start', { talkId: 'talkaaaa1' }, A); ok(s === 200, 'Asha takes the channel');
[s, d] = await call('talk/start', { talkId: 'talkbbbb1' }, B); ok(s === 409 && d.code === 'busy' && d.error === 'asha is talking', 'Ravi blocked while Asha talks: ' + d.error);
[s] = await chunk(A, 'talkaaaa1', 0, false, webm); ok(s === 200, 'piece 1 accepted');
[s] = await chunk(A, 'talkaaaa1', 1, false, Buffer.from('<html>not audio</html>')); ok(s === 415, 'non-audio piece rejected');
[s] = await chunk(B, 'talkaaaa1', 1, false, webm); ok(s === 409, 'someone else cannot inject pieces');
[, d] = await call('poll', { walkie: true }, B);
ok(d.talk.floor?.name === 'asha' && d.talk.chunks.length === 1 && d.talk.chunks[0].seq === 0, 'listener sees who is talking + the piece');
ok(d.users.find(u => u.uid === B.uid)?.walkie === true, 'listener marked as listening');
[, d] = await call('poll', {}, A); ok(d.talk.chunks.length === 0, 'talker doesn’t get own pieces back');
[s] = await chunk(A, 'talkaaaa1', 1, true, webm); ok(s === 200, 'final piece releases channel');
[s] = await call('talk/start', { talkId: 'talkbbbb1' }, B); ok(s === 200, 'Ravi can talk now');
await call('talk/end', { talkId: 'talkbbbb1' }, B);
[, d] = await call('poll', {}, A); ok(!d.talk.floor, 'talk/end frees the channel');
// stale lease expires on its own
m.set('wt/general', { uid: B.uid, name: 'ravi', talkId: 'talkbbbb2', until: Date.now() - 1 });
[s] = await call('talk/start', { talkId: 'talkaaaa2' }, A); ok(s === 200, 'expired lease (talker disconnected) does not block the channel');
// saved transmission
const up = await handle(new Request('https://x/api/upload', { method: 'POST', headers: { authorization: 'Bearer ' + A.token, 'x-chat-room': 'general' }, body: webm }), store, opts);
const { url } = await up.json();
[s, d] = await call('send', { audio: { url, dur: 3.2, walkie: true } }, A); ok(s === 200 && d.message.audio.walkie === true, 'transmission saved to chat as walkie-talkie message');
[, d] = await call('rooms', {}, B); ok(d.rooms.find(r => r.room === 'general').last.text === 'Walkie-talkie', 'chat list preview says Walkie-talkie');
