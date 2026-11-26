// Voice and video calls (1:1 and groups) over LiveKit, and voice chat in games (the same call, joined quietly).
//   cl/<room>   { id, by, byName, video, at, joined: { uid: { name, at } }, ended }   the chat's current call
// Each person in the call checks in every 20 s; someone not heard from for 60 s counts as gone, and the call ends
// (with a note in the chat) when the last person leaves.
import crypto from 'node:crypto';
import { clean, json } from './core.mjs';
import { postMessage } from './messages.mjs';

const GONE_MS = 60_000;
const alive = (c, now) => Object.entries(c?.joined || {}).filter(([, p]) => now - p.at < GONE_MS);
const fmtDur = ms => { const m = Math.round(ms / 60_000); return m < 1 ? 'under a minute' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };

// What a chat's poll shows about its call (or null)
export async function callView(store, room, now = Date.now()) {
  const c = await store.get(`cl/${room}`);
  if (!c || c.ended) return null;
  const people = alive(c, now);
  if (!people.length && now - c.at > GONE_MS) return null;
  return { id: c.id, video: !!c.video, byName: c.byName, at: c.at, game: !!c.game, people: people.map(([uid, p]) => ({ uid, name: p.name })) };
}

async function endCall(store, room, group, user, c, push, now) {
  c.ended = now; await store.set(`cl/${room}`, c);
  if (!c.game) await postMessage(store, { room, group, user, text: `${c.video ? 'Video' : 'Voice'} call ended · ${fmtDur(now - c.at)}`, sys: 'call' }, push);
}

export async function callRoute(action, { store, body, room, group, user, push, livekit }) {
  const now = Date.now(), me = user.uid, k = `cl/${room}`;
  if (!livekit?.url || !livekit?.apiKey || !livekit?.apiSecret) return json({ error: 'Calls aren’t set up on this server', code: 'no_calls' }, 501);
  let c = await store.get(k);
  const live = c && !c.ended && (alive(c, now).length || now - c.at < GONE_MS) ? c : null;

  if (action === 'start') {               // start a call, or join the one already going
    if (!live) {
      c = { id: crypto.randomBytes(6).toString('hex'), by: me, byName: user.name, video: body.video === true, game: body.game === true, at: now, joined: {} };
      await store.set(k, c);
      // a game's voice chat starts quietly; a real call tells everyone (a notification, like a message)
      if (!c.game) await postMessage(store, { room, group, user, text: `${user.name} started a ${c.video ? 'video' : 'voice'} call — tap to join`, sys: 'call', ref: c.id, notify: true }, push);
    } else c = live;
    c.joined[me] = { name: user.name, at: now }; await store.set(k, c);
    return json({ call: await callView(store, room, now), ...token(livekit, room, c.id, user) });
  }
  if (action === 'join') {
    if (!live) return json({ error: 'This call has ended', code: 'ended' }, 410);
    c.joined[me] = { name: user.name, at: now }; await store.set(k, c);
    return json({ call: await callView(store, room, now), ...token(livekit, room, c.id, user) });
  }
  if (action === 'ping') {                // still here
    if (!live || live.id !== body.id) return json({ ended: true });
    c.joined[me] = { name: user.name, at: now }; await store.set(k, c);
    return json({ call: await callView(store, room, now) });
  }
  if (action === 'leave') {
    if (!live || live.id !== body.id) return json({ ok: true });
    delete c.joined[me];
    if (!alive(c, now).length) await endCall(store, room, group, user, c, push, now); else await store.set(k, c);
    return json({ ok: true });
  }
  return json({ error: 'Not found' }, 404);
}

// A LiveKit pass for this chat's call: microphone and camera, valid for 4 hours
function token(livekit, room, id, user) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url'), t = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const claims = b64({ iss: livekit.apiKey, sub: user.uid, name: clean(user.name, 40), nbf: t - 10, exp: t + 4 * 3600,
    video: { room: `call-${room}-${id}`, roomJoin: true, canSubscribe: true, canPublish: true, canPublishData: false, canPublishSources: ['microphone', 'camera'] } });
  const sig = crypto.createHmac('sha256', livekit.apiSecret).update(`${head}.${claims}`).digest('base64url');
  return { url: livekit.url, token: `${head}.${claims}.${sig}` };
}
