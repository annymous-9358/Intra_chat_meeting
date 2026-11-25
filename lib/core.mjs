// Shared limits and small helpers used across the server (JSON responses, input cleaning, media sniffing).
import crypto from 'node:crypto';

export const MAX_TEXT = 2000;
export const KEEP_PER_ROOM = 300;     // older messages are pruned
export const INITIAL_LOAD = 100;
export const ONLINE_MS = 20_000;      // considered online if polled within this window
export const STALE_MS = 5 * 60_000;   // presence entries removed after this
export const TYPING_MS = 4_000;
export const OVERLAP_MS = 10_000;    // re-send recent messages so late writes from parallel instances are never missed
// Read every record under a prefix: one query on stores that support it (D1), else list + get.
//   after: only keys after this one; last: only the last n keys
export async function entries(store, prefix, { after, last } = {}) {
  if (store.entries) return store.entries(prefix, { after, last });
  let keys = (await store.list(prefix)).sort();
  if (after) keys = keys.filter(k => k > after);
  if (last) keys = keys.slice(-last);
  return Promise.all(keys.map(async k => [k, await store.get(k)]));
}
export const MAX_WAIT_MS = 7_000;     // long-poll hold time (Netlify sync functions time out at 10 s)
export const CHECK_MS = 150;          // how often a waiting request checks for changes
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const newVersion = now => `${now}-${crypto.randomBytes(4).toString('hex')}`;

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
export const cleanRoom = s => clean(s, 30).toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'general';

export const MAX_UPLOAD = 4 * 1024 * 1024;
export const FILE_ID = /^[a-f0-9]{24}$/;
// Only these image/audio types are accepted, detected from the file's bytes (never trusted from the client)
export function sniffMedia(b) {
  const at = (o, str) => b.length >= o + str.length && b.toString('latin1', o, o + str.length) === str;
  if (b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'audio/webm';   // Chrome/Firefox/Android recordings
  if (at(0, 'OggS')) return 'audio/ogg';
  if (at(4, 'ftyp')) return 'audio/mp4';                                                                       // Safari/iOS recordings (m4a)
  if (at(0, 'RIFF') && at(8, 'WAVE')) return 'audio/wav';
  if (at(0, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && b.length > 4 && !(b[1] === 0xd8))) return 'audio/mpeg';
  return sniffImage(b);
}
export function sniffImage(b) {
  if (b.length > 6 && b.toString('latin1', 0, 6).match(/^GIF8[79]a$/)) return 'image/gif';
  if (b.length > 8 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
// A GIF/image attached to a message: either one uploaded here or one from GIPHY
export const GIPHY_URL = /^https:\/\/(media\d?\.giphy\.com|i\.giphy\.com)\/[\w\-./?=&%]+$/;
export function cleanGif(g) {
  if (!g || typeof g.url !== 'string') return undefined;
  const local = g.url.match(/^\/api\/file\/([a-f0-9]{24})$/);
  if (!local && !GIPHY_URL.test(g.url)) return undefined;
  const dim = v => Math.min(Math.max(Math.round(Number(v) || 0), 0), 4000) || undefined;
  return { url: g.url, w: dim(g.w), h: dim(g.h), title: clean(g.title, 80) || undefined };
}

export const LOCAL_FILE = /^\/api\/file\/([a-f0-9]{24})$/;
export function cleanAudio(a) {
  if (!a || typeof a.url !== 'string' || !LOCAL_FILE.test(a.url)) return undefined;
  const dur = Math.round(Math.min(Math.max(Number(a.dur) || 0, 0), 600) * 10) / 10;
  const peaks = Array.isArray(a.peaks) ? a.peaks.slice(0, 48).map(v => Math.min(Math.max(Math.round(Number(v) || 0), 0), 100)) : undefined;
  return { url: a.url, dur, peaks, walkie: a.walkie === true || undefined };
}
