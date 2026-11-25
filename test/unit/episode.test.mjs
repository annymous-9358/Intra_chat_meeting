import { ok } from '../helpers.mjs';
import { findEpisode } from '../../lib/games.mjs';
import { handle } from '../../lib/chat.mjs';
// mock YouTube: three uploads of episode 3102 — one blocked in India, one only allowed in the US, one that plays everywhere
const vids = {
  blockedIN: { id: 'blockedIN00', title: 'TMKOC Episode 3102', rr: { blocked: ['IN', 'PK'] } },
  usOnly: { id: 'usOnly00000', title: 'TMKOC Ep 3102 full', rr: { allowed: ['US'] } },
  open: { id: 'openEvery00', title: 'Taarak Mehta Episode 3102 | Full Episode', rr: null },
  wrong: { id: 'wrongNum000', title: 'Taarak Mehta Episode 31020', rr: null },
};
let searches = [];
globalThis.fetch = async url => {
  const u = new URL(url), reply = b => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  if (u.pathname.endsWith('/search')) { searches.push(Object.fromEntries(u.searchParams)); return reply({ items: Object.values(vids).map(v => ({ id: { videoId: v.id }, snippet: { title: v.title } })) }); }
  if (u.pathname.endsWith('/videos')) { const ids = u.searchParams.get('id').split(','); return reply({ items: Object.values(vids).filter(v => ids.includes(v.id)).map(v => ({ id: v.id, snippet: { title: v.title }, status: { embeddable: true, privacyStatus: 'public' }, contentDetails: { duration: 'PT22M10S', ...(v.rr ? { regionRestriction: v.rr } : {}) } })) }); }
  return new Response('{}', { status: 404 });
};
let r = await findEpisode('k', 'TMKOC', 3102, { regions: ['IN'] });
ok(r?.id === 'openEvery00', 'India: skips the India-blocked and US-only uploads → ' + r?.id);
ok(searches.at(-1).regionCode === 'IN' && searches.at(-1).videoSyndicated === 'true', 'search asks YouTube for videos viewable in IN and playable outside YouTube');
r = await findEpisode('k', 'TMKOC', 3102, { regions: ['US'] }); ok(r?.id === 'blockedIN00', 'US player can get the first upload');
r = await findEpisode('k', 'TMKOC', 3102, { regions: ['IN', 'US'] }); ok(r?.id === 'openEvery00' && !searches.at(-1).regionCode, 'mixed countries: a clip that plays for everyone');
r = await findEpisode('k', 'TMKOC', 3102, { regions: ['IN'], exclude: ['openEvery00'] }); ok(r === null, 'nothing left after the playable one failed → null');
ok(!(await findEpisode('k', 'TMKOC', 3102, {}))?.id.startsWith('wrongNum'), 'never picks episode 31020 for 3102');

// full game: players in India; a clip error swaps to another upload, then back to picking
const m = new Map();
const store = { list: async p => [...m.keys()].filter(k => k.startsWith(p)), get: async k => structuredClone(m.get(k) ?? null), set: async (k, v) => { m.set(k, structuredClone(v)); }, del: async k => { m.delete(k); }, setFile: async () => {}, getFile: async () => null, delFile: async () => {} };
const opts = { youtubeKey: 'k', country: 'IN' };
const hdr = u => ({ authorization: 'Bearer ' + u.token, 'x-chat-device': (u.uid + 'a'.repeat(40)).slice(0, 32).replace(/[^a-f0-9]/g, 'b') });
const call = async (route, body, u) => { const res = await handle(new Request('https://x/api/' + route, { method: 'POST', headers: u ? hdr(u) : {}, body: JSON.stringify(body) }), store, opts); return [res.status, await res.json()]; };
const signup = async (un, name) => { const [, d] = await call('auth/signup', { username: un, name, password: 'secret1' }); return { token: d.token, uid: d.user.uid }; };
const K = await signup('kunik', 'Kunik'), H = await signup('himanshu', 'Himanshu');
await call('group/create', { room: 'friends', title: 'Friends', type: 'open' }, K); await call('poll', { room: 'friends' }, H);
let s, d;
[s, d] = await call('game/start', { room: 'friends', kind: 'episode', series: 'TMKOC' }, K); ok(s === 200, 'start Episode Recall: ' + (d.error || ''));
if (d.game?.phase === 'lobby' || d.game?.phase === 'join') { await call('game/join', { room: 'friends' }, H); [s, d] = await call('game/begin', { room: 'friends' }, K); }
const g0 = m.get('gs/friends'); const teller = g0.data?.teller === K.uid ? K : H;
console.log('  phase:', g0.phase, '| teller:', teller === K ? 'Kunik' : 'Himanshu');
[s, d] = await call('game/move', { room: 'friends', episode: 3102 }, teller);
ok(s === 200 && m.get('gs/friends').data.clip?.id === 'openEvery00', 'picks the clip that plays in India: ' + (d.error || m.get('gs/friends').data.clip?.id));
const firstClip = m.get('gs/friends').data.clip.id;
// pretend YouTube still refused it on a phone → another upload, or back to pick
vids.open2 = { id: 'openTwo0000', title: 'TMKOC Episode 3102 (HD)', rr: null };
[s, d] = await call('game/move', { room: 'friends', clipFailed: true, clipId: firstClip }, H);
const g1 = m.get('gs/friends'); ok(g1.phase === 'watch' && g1.data.clip.id === 'openTwo0000' && g1.badClips.includes(firstClip), 'clip error → swaps to another upload of the same episode');
[s, d] = await call('game/move', { room: 'friends', clipFailed: true, clipId: firstClip }, K); ok(m.get('gs/friends').data.clip.id === 'openTwo0000', 'a late duplicate report is ignored');
[s, d] = await call('game/move', { room: 'friends', clipFailed: true, clipId: 'openTwo0000' }, H);
const g2 = m.get('gs/friends'); ok(g2.phase === 'pick' && /can’t play here/.test(g2.data.notice), 'no playable upload left → back to picking with a notice: ' + g2.data.notice);
