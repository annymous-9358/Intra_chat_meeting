// Fun mode: friends in a chat can set your phone's lock screen / home screen wallpaper — a photo, or a doodle that
// updates live while they draw. Strictly opt-in: each person turns it on for themselves, per chat, and only the
// Android app can apply it (browsers can't change wallpapers).
//   fm/<room>/<uid>   { uid, name, lock, home, at }      what this person allows in this chat
//   fl/<room>/<uid>   { url, target, by, byName, at }    the last picture set for them here
//   fd/<sid>          { url, at }                        a live doodle's latest frame (older frames are deleted)
import { clean, json, LOCAL_FILE } from './core.mjs';
import { isAdminUid } from './groups.mjs';
import { postMessage } from './messages.mjs';
import { sendFcmToUser } from './push.mjs';

const TARGETS = ['lock', 'home', 'both'];
const LIVE_GAP_MS = 1500;          // live doodle frames: at most one per 1.5 s per receiver
const SID = /^[a-z0-9]{8,24}$/;

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
      .filter(p => p && p.uid !== me && (p.lock || p.home)).map(p => ({ uid: p.uid, name: p.name, lock: !!p.lock, home: !!p.home }));
    const live = [];
    for (const p of people) if (await isMember(store, room, group, p.uid)) live.push(p);
    return json({ me: { lock: !!mine.lock, home: !!mine.home }, people: live, last: await store.get(`fl/${room}/${me}`) });
  }

  if (action === 'settings') {        // what I allow in this chat (turned on from the Android app)
    const prev = (await store.get(`fm/${room}/${me}`)) || {};
    const rec = { uid: me, name: user.name, lock: body.lock === true, home: body.home === true, at: Date.now() };
    await store.set(`fm/${room}/${me}`, rec);
    const was = prev.lock || prev.home, now = rec.lock || rec.home;
    if (now && !was) {
      const what = rec.lock && rec.home ? 'lock screen and home screen' : rec.lock ? 'lock screen' : 'home screen';
      await postMessage(store, { room, group, user, text: `${user.name} turned on fun mode — you can doodle on their ${what}`, sys: 'fun' }, push);
    }
    return json({ me: { lock: rec.lock, home: rec.home } });
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
      const last = await store.get(`fl/${room}/${p.uid}`);
      if (live && last && last.by === me && now - last.at < LIVE_GAP_MS) continue;          // too soon after the last frame
      const eff = lock && home ? 'both' : lock ? 'lock' : 'home';
      await store.set(`fl/${room}/${p.uid}`, { url, target: eff, by: me, byName: user.name, at: now });
      const n = await sendFcmToUser(store, p.uid, { dataOnly: true, data: { type: 'fun', room, url, target: eff, from: user.name, at: now } }).catch(() => 0);
      (n ? sent : skipped).push(p.name);
    }
    // a live doodle keeps only its newest frame
    if (sid) {
      const prev = await store.get(`fd/${sid}`);
      if (prev?.url && prev.url !== url && prev.by === me) { const id = prev.url.match(LOCAL_FILE)?.[1]; if (id) await store.delFile(`f/${id}`); }
      if (body.final) await store.del(`fd/${sid}`); else await store.set(`fd/${sid}`, { url, by: me, at: now });
    }
    if (body.final && sent.length) {
      const where = target === 'both' ? 'lock and home screen' : target === 'home' ? 'home screen' : 'lock screen';
      const who = sent.length === 1 ? `${sent[0]}’s` : `${sent.length} people’s`;
      await postMessage(store, { room, group, user, text: `${user.name} ${body.kind === 'photo' ? 'changed' : 'drew on'} ${who} ${where}`, sys: 'fun' }, push);
    }
    return json({ ok: true, sent, skipped, label: clean(body.kind, 10) });
  }
  return json({ error: 'Not found' }, 404);
}
