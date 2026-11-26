// Fun mode: friends in a chat can set your phone's lock screen / home screen wallpaper — a photo, or a doodle that
// updates live while they draw. Strictly opt-in: each person turns it on for themselves, per chat, and only the
// Android app can apply it (browsers can't change wallpapers).
//   fm/<room>/<uid>   { uid, name, lock, home, at }      what this person allows in this chat
//   fl/<room>/<uid>   { url, target, by, byName, at }    the last picture set for them here
//   fd/<sid>          { url, at }                        a live doodle's latest frame (older frames are deleted)
//   fv/<room>/<sid>   { by, byName, recips, target, bg, bgUrl, strokes, seq, done }   a doodle as strokes: watched live in the
//                     app while it's drawn (only new strokes go out with each poll), and replayed later from the chat note
//   fva/<room>        { sid, seq, at }                   the doodle being drawn in this chat right now
import { clean, json, LOCAL_FILE, newVersion } from './core.mjs';
import { isAdminUid } from './groups.mjs';
import { postMessage } from './messages.mjs';
import { sendFcmToUser } from './push.mjs';

const TARGETS = ['lock', 'home', 'both'];
const LIVE_GAP_MS = 1500;          // live doodle frames: at most one per 1.5 s per receiver
const SID = /^[a-z0-9]{8,24}$/;
// Strokes: { tool, color, size, seed, pts: [[x, y], …] } on a 1080 × 2340 canvas. Shapes use two points (start, end).
export const FUN_W = 1080, FUN_H = 2340;
const TOOLS = ['pen', 'marker', 'neon', 'rainbow', 'spray', 'eraser', 'line', 'arrow', 'rect', 'circle', 'heart', 'star'];
export const SHAPES = new Set(['line', 'arrow', 'rect', 'circle', 'heart', 'star']);
const HEX = /^#[0-9a-f]{6}$/i, MAX_STROKES = 400, MAX_POINTS = 20000;
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };
function cleanStroke(s) {
  if (!s || !TOOLS.includes(s.tool)) return null;
  const pts = (Array.isArray(s.pts) ? s.pts.slice(0, 4000) : []).map(p => [num(p?.[0], 0, FUN_W), num(p?.[1], 0, FUN_H)]).filter(p => p[0] !== null && p[1] !== null).map(p => [Math.round(p[0]), Math.round(p[1])]);
  return { tool: s.tool, color: HEX.test(s.color) ? s.color.toLowerCase() : '#ffffff', size: Math.round(num(s.size, 1, 120) ?? 12), seed: Math.abs(Math.round(Number(s.seed) || 0)) % 1e9, pts: SHAPES.has(s.tool) ? pts.slice(0, 2) : pts };
}
// What a watcher who has seen up to `known` needs (known < 0: everything)
export function funDelta(v, known) {
  const reset = known < 0 || known < (v.resetSeq || 0);
  return { sid: v.sid, byName: v.byName, target: v.target, seq: v.seq, done: !!v.done, n: v.strokes.length, reset,
    bg: v.bg, bgUrl: v.bgUrl || null, strokes: v.strokes.map((st, i) => st && (reset || st.u > known) ? [i, { tool: st.tool, color: st.color, size: st.size, seed: st.seed, pts: st.pts }] : null).filter(Boolean) };
}

// still in the chat? (same rule as the members list: after a password change, only people who entered the new one)
async function isMember(store, room, group, uid) {
  if (group?.dm) return !!group.members?.includes(uid);
  const mb = await store.get(`mb/${room}/${uid}`); if (!mb) return false;
  const pwv = group?.pw?.v || 0;
  return !pwv || mb.pwv === pwv || isAdminUid(group, uid);
}

export async function funRoute(action, { store, body, room, group, user, push }) {
  const me = user.uid;
  if (action === 'state') {
    const mine = (await store.get(`fm/${room}/${me}`)) || { lock: false, home: false };
    const people = (await Promise.all((await store.list(`fm/${room}/`)).map(k => store.get(k))))
      .filter(p => p && p.uid !== me && (p.lock || p.home)).map(p => ({ uid: p.uid, name: p.name, lock: !!p.lock, home: !!p.home, live: !!p.live }));
    const live = [];
    for (const p of people) if (await isMember(store, room, group, p.uid)) live.push(p);
    return json({ me: { lock: !!mine.lock, home: !!mine.home, live: !!mine.live }, people: live, last: await store.get(`fl/${room}/${me}`) });
  }

  if (action === 'settings') {        // what I allow in this chat (turned on from the Android app)
    const prev = (await store.get(`fm/${room}/${me}`)) || {};
    const rec = { uid: me, name: user.name, lock: body.lock === true, home: body.home === true, live: body.live === undefined ? !!prev.live : body.live === true, at: Date.now() };
    await store.set(`fm/${room}/${me}`, rec);
    const was = prev.lock || prev.home, now = rec.lock || rec.home;
    if (now && !was) {
      const what = rec.lock && rec.home ? 'lock screen and home screen' : rec.lock ? 'lock screen' : 'home screen';
      await postMessage(store, { room, group, user, text: `${user.name} turned on fun mode — you can doodle on their ${what}`, sys: 'fun' }, push);
    }
    return json({ me: { lock: rec.lock, home: rec.home, live: rec.live } });
  }

  if (action === 'live') {            // a doodle's strokes as they're drawn, for anyone watching in the app
    const sid = typeof body.sid === 'string' && SID.test(body.sid) ? body.sid : null;
    if (!sid) return json({ error: 'Bad doodle' }, 400);
    const k = `fv/${room}/${sid}`, now = Date.now();
    let v = await store.get(k);
    if (v && v.by !== me) return json({ error: 'Not your doodle' }, 403);
    if (!v) {                         // who it's for is settled when drawing starts
      const target = TARGETS.includes(body.target) ? body.target : 'lock', only = Array.isArray(body.to) ? new Set(body.to.map(String).slice(0, 50)) : null, recips = [];
      for (const fk of await store.list(`fm/${room}/`)) {
        const p = await store.get(fk);
        if (!p || p.uid === me || (only && !only.has(p.uid))) continue;
        if (!(((target === 'lock' || target === 'both') && p.lock) || ((target === 'home' || target === 'both') && p.home))) continue;
        if (await isMember(store, room, group, p.uid)) recips.push(p.uid);
      }
      v = { sid, by: me, byName: user.name, recips, target, bg: '#101418', bgUrl: null, strokes: [], seq: 0, resetSeq: 0, at: now, done: false };
      // phones showing the live wallpaper start following the strokes straight away
      const wake = Promise.all(recips.map(async uid => { const p = await store.get(`fm/${room}/${uid}`); if (p?.live) await sendFcmToUser(store, uid, { dataOnly: true, data: { type: 'fun-live', room, sid, by: user.name, at: now } }).catch(() => 0); }));
      if (push?.waitUntil) push.waitUntil(wake); else await wake;
    }
    if (v.done) return json({ ok: true, seq: v.seq });
    v.seq++;
    if (typeof body.bg === 'string' && HEX.test(body.bg)) { v.bg = body.bg.toLowerCase(); v.bgUrl = null; }
    if (typeof body.bgUrl === 'string' && LOCAL_FILE.test(body.bgUrl)) v.bgUrl = body.bgUrl;
    if (body.reset) { v.strokes = []; v.resetSeq = v.seq; }
    for (const op of Array.isArray(body.ops) ? body.ops.slice(0, 200) : []) {
      const i = Number(op?.i); if (!Number.isInteger(i) || i < 0 || i >= MAX_STROKES) continue;
      const st = cleanStroke(op); if (!st) continue;
      const cur = v.strokes[i], from = Number(op.from) || 0;
      if (from > 0 && cur && !SHAPES.has(st.tool) && cur.pts.length === from) { cur.pts.push(...st.pts); cur.u = v.seq; }
      else if (from === 0) { while (v.strokes.length < i) v.strokes.push(null); v.strokes[i] = { ...st, u: v.seq }; }
    }
    if (v.strokes.reduce((n, st) => n + (st?.pts.length || 0), 0) > MAX_POINTS) return json({ error: 'That doodle is too big — send it and start a new one' }, 413);
    v.at = now;
    await Promise.all([store.set(k, v), store.set(`fva/${room}`, { sid, seq: v.seq, at: now }), store.set(`v/${room}`, { v: newVersion(now) })]);
    return json({ ok: true, seq: v.seq, watchers: v.recips.length });
  }

  if (action === 'watch') {           // the live wallpaper following a doodle: new strokes since `seq`
    const sid = typeof body.sid === 'string' && SID.test(body.sid) ? body.sid : null;
    const v = sid && await store.get(`fv/${room}/${sid}`);
    if (!v) return json({ error: 'No such doodle' }, 404);
    if (!v.recips?.includes(me)) return json({ error: 'Not for you' }, 403);
    const seq = Number(body.seq); const known = Number.isFinite(seq) ? seq : -1;
    return json({ seq: v.seq, done: !!v.done, doodle: v.seq > known ? funDelta(v, known) : null });
  }

  if (action === 'replay') {          // a finished doodle, to watch it being drawn again
    const sid = typeof body.sid === 'string' && SID.test(body.sid) ? body.sid : null;
    const v = sid && await store.get(`fv/${room}/${sid}`);
    if (!v) return json({ error: 'That doodle isn’t available any more' }, 404);
    return json({ doodle: funDelta(v, -1) });
  }

  if (action === 'send') {            // set the wallpaper of everyone (or the chosen people) who allow it
    const url = typeof body.url === 'string' && LOCAL_FILE.test(body.url) ? body.url : null;
    if (!url) return json({ error: 'Pick a picture first' }, 400);
    const target = TARGETS.includes(body.target) ? body.target : 'lock';
    const live = body.live === true, sid = typeof body.sid === 'string' && SID.test(body.sid) ? body.sid : null;
    const only = Array.isArray(body.to) ? new Set(body.to.map(String).slice(0, 50)) : null;
    const now = Date.now(), sent = [], skipped = [];
    for (const k of await store.list(`fm/${room}/`)) {
      const p = await store.get(k);
      if (!p || p.uid === me || (only && !only.has(p.uid))) continue;
      const lock = (target === 'lock' || target === 'both') && p.lock, home = (target === 'home' || target === 'both') && p.home;
      if (!lock && !home) continue;
      if (!(await isMember(store, room, group, p.uid))) continue;
      if (body.kind === 'video' && !p.live) { skipped.push(p.name); continue; }      // videos need the live wallpaper
      const last = await store.get(`fl/${room}/${p.uid}`);
      if (live && !body.final && last && last.by === me && now - last.at < LIVE_GAP_MS) continue;   // too soon after the last frame (the final one always goes)
      const eff = lock && home ? 'both' : lock ? 'lock' : 'home';
      await store.set(`fl/${room}/${p.uid}`, { url, target: eff, by: me, byName: user.name, at: now });
      // silent data push that wakes their Android app (note: Firebase reserves the key "from", so the sender is "by")
      const n = await sendFcmToUser(store, p.uid, { dataOnly: true, data: { type: 'fun', room, url, target: eff, by: user.name, at: now, kind: ['photo', 'doodle', 'video'].includes(body.kind) ? body.kind : 'photo', sid: sid || '' } }).catch(() => 0);
      (n ? sent : skipped).push(p.name);
    }
    // a live doodle keeps only its newest frame
    if (sid) {
      const prev = await store.get(`fd/${sid}`);
      if (prev?.url && prev.url !== url && prev.by === me) { const id = prev.url.match(LOCAL_FILE)?.[1]; if (id) await store.delFile(`f/${id}`); }
      if (body.final) await store.del(`fd/${sid}`); else await store.set(`fd/${sid}`, { url, by: me, at: now });
      if (body.final) {               // the strokes stay for replays; watchers see it finish
        const v = await store.get(`fv/${room}/${sid}`);
        if (v && v.by === me && !v.done) { v.done = true; v.seq++; await Promise.all([store.set(`fv/${room}/${sid}`, v), store.set(`fva/${room}`, { sid, seq: v.seq, at: now }), store.set(`v/${room}`, { v: newVersion(now) })]); }
      }
    }
    if (body.final && sent.length) {
      const where = target === 'both' ? 'lock and home screen' : target === 'home' ? 'home screen' : 'lock screen';
      const who = sent.length === 1 ? `${sent[0]}’s` : `${sent.length} people’s`;
      const hasStrokes = sid && (await store.get(`fv/${room}/${sid}`))?.strokes?.length;
      await postMessage(store, { room, group, user, text: `${user.name} ${body.kind === 'photo' ? 'changed' : 'drew on'} ${who} ${where}`, sys: 'fun', ref: hasStrokes ? sid : undefined }, push);
    }
    return json({ ok: true, sent, skipped, label: clean(body.kind, 10) });
  }
  return json({ error: 'Not found' }, 404);
}
