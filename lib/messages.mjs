// Posting messages (with mentions, replies and push notifications) and 1:1 chat helpers.
import crypto from 'node:crypto';
import { getVapid, notifyMembers } from './push.mjs';
import { activeStatus, sha256 } from './accounts.mjs';
import { KEEP_PER_ROOM, LOCAL_FILE, clean, newVersion } from './core.mjs';
import { previewOf, saveRoomMeta, touchMember } from './groups.mjs';

export let seq = 0;

// ---------- Friends & 1:1 chats ----------
export async function openDm(store, user, other) {
  const room = dmRoomId(user.uid, other);
  let g = await store.get(`g/${room}`);
  if (!g) {
    g = { room, dm: true, members: [user.uid, other].sort(), created: Date.now() };
    await store.set(`g/${room}`, g);
    await saveRoomMeta(store, room, g, null);
  }
  const ou = await store.get(`u/${other}`);
  await Promise.all([touchMember(store, room, user, g), ou && touchMember(store, room, ou, g)]);   // both get notifications from the start
  return { room, group: g };
}
export const dmRoomId = (a, b) => 'd-' + sha256([a, b].sort().join(':')).slice(0, 24);
export const lastSeenOf = async (store, uid) => (await store.get(`ls/${uid}`))?.at || 0;
export async function peerInfo(store, g, me) {
  const peerUid = g.members.find(u => u !== me.uid) || me.uid;
  const p = await store.get(`u/${peerUid}`);
  return { uid: peerUid, name: p?.name || 'Deleted account', username: p?.username || null, photo: p?.photo || null, status: activeStatus(p?.status), lastSeen: await lastSeenOf(store, peerUid) };
}
// @mentions: "@priya" → that account (max 10 per message, never yourself)
export async function findMentions(store, text, selfUid) {
  const names = [...new Set((text || '').toLowerCase().match(/@[a-z0-9_.]{3,20}/g) || [])].slice(0, 10).map(x => x.slice(1));
  const refs = await Promise.all(names.map(n => store.get(`un/${n}`)));
  return [...new Set(refs.filter(r => r && r.uid !== selfUid).map(r => r.uid))];
}
// Store a message and notify people — used by "send" and by the scheduler for scheduled messages
export async function postMessage(store, { room, group, user, text, gif, audio, replyTo, cid, scheduled, sys, notify }, { vapidEnv, waitUntil, pushSender, origin } = {}) {
  const now = Date.now();
  seq = (seq + 1) % 1e6;
  const mkey = `m/${room}/${String(now).padStart(13, '0')}-${String(seq).padStart(6, '0')}-${crypto.randomBytes(3).toString('hex')}`;
  const mentions = await findMentions(store, text, user.uid);
  const msg = { key: mkey, room, uid: user.uid, name: user.name, text, gif, audio, ts: now, cid: cid || undefined, replyTo, mentions: mentions.length ? mentions : undefined, scheduled: scheduled || undefined, sys: sys || undefined };
  await Promise.all([store.set(mkey, msg), store.set(`ls/${user.uid}`, { at: now })]);
  await Promise.all([store.set(`v/${room}`, { v: newVersion(now) }), saveRoomMeta(store, room, group, { name: user.name, uid: user.uid, text: previewOf(msg), ts: now, key: mkey }), touchMember(store, room, user, group, { posted: !sys }),
    store.set(`p/${room}/${user.uid}`, { uid: user.uid, name: user.name, seen: now, typingAt: 0 })]);   // sending ends "typing…"
  const keys = (await store.list(`m/${room}/`)).sort();
  if (keys.length > KEEP_PER_ROOM) {
    // Prune old messages, and any uploaded files they used
    await Promise.all(keys.slice(0, keys.length - KEEP_PER_ROOM).map(async k => {
      const old = await store.get(k);
      const ids = [old?.gif?.url, old?.audio?.url].map(u => u?.match(LOCAL_FILE)?.[1]).filter(Boolean);
      await Promise.all([store.del(k), ...ids.map(id => store.delFile(`f/${id}`))]);
    }));
  }
  // Notify the other members (runs after the response where the platform allows it); celebration notes stay quiet
  if (sys && !notify) return msg;
  // Notify the other members (runs after the response where the platform allows it)
  const pushJob = getVapid(store, vapidEnv).then(vapid => notifyMembers(store, { room, group, msg, senderUid: user.uid, vapid, sender: pushSender, siteOrigin: origin }));
  if (waitUntil) waitUntil(pushJob); else await pushJob;
  return msg;
}
export async function resolveReply(store, room, r) {
  if (!(r && typeof r.key === 'string' && r.key.startsWith(`m/${room}/`) && r.key.length < 80)) return undefined;
  const orig = await store.get(r.key);
  return { key: r.key, name: orig?.name || clean(r.name, 24), uid: orig?.uid, text: clean(r.text, 140) };
}
export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
export const pub = m => { if (!m) return m; const { dev, ...rest } = m; return rest; };      // never send device ids to clients
// Per-room log of message edits (reactions, deletions) so open chats can update older messages live
export async function recordEdit(store, room, key, patch) {
  const x = (await store.get(`x/${room}`)) || {};
  const at = Date.now();
  x[key] = { ...(x[key] || {}), ...patch, at };
  const keys = Object.keys(x);
  if (keys.length > 400) for (const k of keys.sort((a, b) => x[a].at - x[b].at).slice(0, keys.length - 400)) delete x[k];
  await store.set(`x/${room}`, x);
  return x[key];
}
