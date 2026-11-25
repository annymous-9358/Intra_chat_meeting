// Walkie-talkie: who holds the floor, and the recent audio pieces of a room.
import { LOCAL_FILE } from './core.mjs';

// ---------- Walkie-talkie ----------
// One person holds the channel at a time ("floor", a short lease renewed by each audio piece). While talking, the
// browser records ~1 s pieces; each piece is stored and listed in a short-lived per-room log that open chats poll and
// play straight away. Pieces older than a minute are deleted.
export const TALK_LEASE_MS = 6_000, TALK_KEEP_MS = 60_000;
export const TALK_ID = /^[a-z0-9]{8,24}$/;
export async function talkFloor(store, room, now = Date.now()) {
  const f = await store.get(`wt/${room}`);
  return f && f.until > now ? f : null;
}
export async function appendTalk(store, room, entry) {
  const now = Date.now();
  const log = ((await store.get(`tk/${room}`)) || []);
  const keep = [], drop = [];
  for (const e of log) (now - e.at > TALK_KEEP_MS ? drop : keep).push(e);
  keep.push(entry);
  await store.set(`tk/${room}`, keep.slice(-60));
  await Promise.all(drop.map(e => { const id = e.url.match(LOCAL_FILE)?.[1]; return id && store.delFile(`f/${id}`); }));
}
