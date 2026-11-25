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
// profile
let s, d, r;
const friends = async (a, b, un) => { await call('friends/request', { username: un }, a); await call('friends/respond', { uid: a.uid, accept: true }, b); };
await friends(K, H, 'himanshu'); await friends(K, C, 'chin');
const S = await signup('stranger', 'Stranger');
// text story to friends
[s, d] = await call('story/post', { type: 'text', text: 'Launch day!', bg: '#7c3aed', font: 'serif', hours: 24, poll: { q: 'Ready?', opts: ['Yes', 'Almost'] } }, K);
ok(s === 200 && d.story.poll.opts.length === 2 && d.story.until - d.story.at === 24 * 3600e3, 'Kunik posts a text story with a poll');
const sid = d.story.id;
[s] = await call('story/post', { type: 'text', text: '' }, K); ok(s === 400, 'empty story rejected');
[s] = await call('story/post', { type: 'text', text: 'x', poll: { q: 'q', opts: ['only one'] } }, K); ok(s === 400, 'poll needs 2 options');
// photo story to close friends only
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001', 'hex');
r = await handle(new Request('https://x/api/story/photo', { method: 'POST', headers: hdr(K), body: png }), store, opts); d = await r.json(); ok(r.status === 200 && d.url, 'photo uploaded');
[, d] = await call('story/close-friends', { uids: [C.uid, S.uid] }, K); ok(d.closeFriends.length === 1 && d.closeFriends[0] === C.uid, 'close friends saved (non-friends ignored)');
[s, d] = await call('story/post', { type: 'photo', url: d.url || (await (await handle(new Request('https://x/api/story/photo', { method: 'POST', headers: hdr(K), body: png }), store, opts)).json()).url, caption: 'Team lunch', audience: 'close', hours: 6 }, K);
ok(s === 200 && d.story.audience === 'close', 'close-friends photo story');
const pid = d.story.id;
// feeds
[, d] = await call('story/feed', {}, H); let k = d.people.find(p => p.uid === K.uid); ok(k && k.stories.length === 1 && !k.allSeen, 'Himanshu (friend) sees 1 story, unseen');
[, d] = await call('story/feed', {}, C); k = d.people.find(p => p.uid === K.uid); ok(k && k.stories.length === 2, 'Chin (close friend) sees both');
[, d] = await call('story/feed', {}, S); ok(!d.people.some(p => p.uid === K.uid), 'stranger sees nothing');
[s] = await call('story/view', { uid: K.uid, id: pid }, H); ok(s === 404, 'Himanshu cannot open the close-friends story');
[, d] = await call('story/feed', {}, K); ok(d.people[0].mine && d.people[0].stories.length === 2, 'my own stories first');
// view, react, vote
await call('story/view', { uid: K.uid, id: sid }, H);
[, d] = await call('story/feed', {}, H); ok(d.people.find(p => p.uid === K.uid).allSeen, 'marked seen');
[, d] = await call('story/feed', {}, H); ok(d.people.find(p => p.uid === K.uid).stories[0].poll.counts === null, 'poll results hidden until you vote');
sent.length = 0; [s, d] = await call('story/react', { uid: K.uid, id: sid, emoji: '🔥' }, H); ok(s === 200 && d.myReact === '🔥' && sent.some(x => x.to === 'k'), 'reaction + push to Kunik');
[s, d] = await call('story/vote', { uid: K.uid, id: sid, opt: 1 }, H); ok(d.story.poll.myVote === 1 && d.story.poll.counts.join() === '0,1', 'vote shows results');
await call('story/vote', { uid: K.uid, id: sid, opt: 0 }, C);
[, d] = await call('story/viewers', { id: sid }, K); ok(d.viewers.length === 2 && d.viewers.find(v => v.uid === H.uid).react === '🔥' && d.viewers.find(v => v.uid === H.uid).vote === 1, 'owner sees viewers with reaction + vote');
[s] = await call('story/viewers', { id: sid }, H); ok(s === 404, 'others cannot see the viewers list');
// reply → DM
[s, d] = await call('story/reply', { uid: K.uid, id: sid, text: 'Congrats!' }, H); ok(s === 200 && d.message.replyTo.story && d.message.replyTo.text === 'Launch day!', 'reply arrives as a DM quoting the story');
[, d] = await call('rooms', {}, K); ok(d.rooms.some(x => x.dm && x.last?.text === 'Congrats!'), 'Kunik has the reply in his chats');
// mute
[, d] = await call('story/mute', { uid: K.uid, on: true }, H); [, d] = await call('story/feed', {}, H); ok(d.people.find(p => p.uid === K.uid).muted, 'mute stories');
// delete + expiry
[s] = await call('story/delete', { id: pid }, H); ok(s === 404, 'cannot delete someone else’s story');
[s] = await call('story/delete', { id: pid }, K); ok(s === 200, 'delete own story');
const key = `st/${K.uid}/${sid}`; const st = m.get(key); st.until = Date.now() - 1; m.set(key, st);
[, d] = await call('story/feed', {}, H); ok(!d.people.some(p => p.uid === K.uid) && !m.has(key), 'expired story disappears and is cleaned up');
