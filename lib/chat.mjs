// The HTTP API: routes each /api/* request to the feature modules, and holds the chat core itself (sending,
// the long-poll, rooms, uploads, reactions). Used by the Cloudflare Worker, the Netlify Function and the LAN server.
// Storage is a tiny key/value interface: list(prefix) -> keys[], get(key), set(key, value), del(key), plus files.
import { challengeRoute } from './challenges.mjs';
import crypto from 'node:crypto';
import { getVapid, cleanSubscription, wakeWalkie } from './push.mjs';
import { gameRoute, loadGame, gameView } from './games.mjs';
import { funRoute } from './fun.mjs';
import { ID, authRoute, deviceId, publicUser, sessionUser, sha256 } from './accounts.mjs';
import { CHECK_MS, FILE_ID, GIPHY_URL, INITIAL_LOAD, LOCAL_FILE, MAX_TEXT, MAX_UPLOAD, MAX_WAIT_MS, ONLINE_MS, OVERLAP_MS, STALE_MS, TYPING_MS, clean, cleanAudio, cleanGif, cleanRoom, entries, json, newVersion, sleep, sniffImage, sniffMedia } from './core.mjs';
import { friendsRoute } from './friends.mjs';
import { claimLegacyAdmin, groupRoute, groupView, hasAccess, isAdminOf, isGeo, previewOf, saveRoomMeta, touchMember } from './groups.mjs';
import { healthCallback, healthRoute } from './health.mjs';
import { ACCURACY_SLACK, cleanLoc, distanceM, memberState } from './location.mjs';
import { REACTIONS, findMentions, lastSeenOf, peerInfo, postMessage, pub, recordEdit, resolveReply } from './messages.mjs';
import { privacyRoute } from './privacy.mjs';
import { stepDays, stepsRoute } from './steps.mjs';
import { storyRoute } from './stories.mjs';
import { TALK_ID, TALK_LEASE_MS, appendTalk, talkFloor } from './walkie.mjs';

export async function handle(req, store, { giphyKey, vapid: vapidEnv, waitUntil, pushSender, health, livekit, youtubeKey, country, maxWaitMs, checkMs } = {}) {
  const route = new URL(req.url).pathname.replace(/^\/api\/?/, '');
  // Google sends the person back here after they allow step access (a normal browser navigation, no session header)
  if (req.method === 'GET' && route === 'health/callback') return healthCallback(req, store, health, { vapidEnv, waitUntil, pushSender, origin: new URL(req.url).origin });

  // Uploaded files are public by unguessable id so <img>/<audio> tags can load them without headers
  if (req.method === 'GET' && route.startsWith('file/')) {
    const id = route.slice(5);
    const file = FILE_ID.test(id) && await store.getFile(`f/${id}`);
    if (!file) return new Response('Not found', { status: 404 });
    return new Response(file.data, { headers: {
      'content-type': file.type, 'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'",
    } });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const dev = deviceId(req.headers.get('x-chat-device'));
  const user = await sessionUser(store, req);

  // Walkie-talkie audio piece (binary body). Only the person holding the channel can send.
  if (route === 'talk/chunk') {
    if (!user) return json({ error: 'Please sign in', code: 'auth' }, 401);
    const room = cleanRoom(req.headers.get('x-chat-room'));
    const talkId = req.headers.get('x-talk-id') || '', seq = Math.max(0, Math.min(Number(req.headers.get('x-talk-seq')) || 0, 10_000));
    const final = req.headers.get('x-talk-final') === '1';
    const group = await store.get(`g/${room}`);
    if (!(await hasAccess(store, group, room, user, dev))) return json({ error: 'This group is locked', code: 'locked' }, 403);
    const now = Date.now();
    const floor = await talkFloor(store, room, now);
    if (!TALK_ID.test(talkId) || !floor || floor.uid !== user.uid || floor.talkId !== talkId) return json({ error: 'You’re not holding the channel', code: 'no_floor' }, 409);
    const data = Buffer.from(await req.arrayBuffer());
    if (data.length > 512 * 1024) return json({ error: 'Audio piece too large' }, 413);
    const type = data.length ? sniffMedia(data) : null;
    let url = null;
    if (data.length) {
      if (!type?.startsWith('audio/')) return json({ error: 'Not an audio recording' }, 415);
      const id = crypto.randomBytes(12).toString('hex');
      await store.setFile(`f/${id}`, data, type);
      url = `/api/file/${id}`;
    }
    if (url) await appendTalk(store, room, { talkId, seq, uid: user.uid, name: user.name, url, at: now, final });
    await store.set(`wt/${room}`, final ? { ...floor, until: 0 } : { ...floor, until: now + TALK_LEASE_MS });
    await store.set(`v/${room}`, { v: newVersion(now) });
    return json({ ok: true });
  }

  // Profile photo (yours, or a group's photo when you're its admin)
  if (route === 'avatar') {
    if (!user) return json({ error: 'Please sign in', code: 'auth' }, 401);
    const data = Buffer.from(await req.arrayBuffer());
    if (data.length > 2 * 1024 * 1024) return json({ error: 'Photo too large (max 2 MB)' }, 413);
    const type = sniffImage(data);
    if (!type) return json({ error: 'Choose a photo (JPEG, PNG, WebP or GIF)' }, 415);
    const groupRoom = req.headers.get('x-chat-room') ? cleanRoom(req.headers.get('x-chat-room')) : null;
    let g = null;
    if (groupRoom) {
      g = await store.get(`g/${groupRoom}`);
      if (!g || g.dm || !isAdminOf(g, user, dev)) return json({ error: 'Only the group admin can change the group photo' }, 403);
    }
    const id = crypto.randomBytes(12).toString('hex');
    await store.setFile(`f/${id}`, data, type);
    const url = `/api/file/${id}`;
    const old = (g ? g.photo : user.photo)?.match(LOCAL_FILE)?.[1];
    if (old) await store.delFile(`f/${old}`);
    if (g) { g.photo = url; await store.set(`g/${groupRoom}`, g); await saveRoomMeta(store, groupRoom, g); await store.set(`v/${groupRoom}`, { v: newVersion(Date.now()) }); return json({ photo: url }); }
    user.photo = url; await store.set(`u/${user.uid}`, user);
    return json({ user: publicUser(user) });
  }

  // Challenge banner image
  if (route === 'challenge/banner') {
    if (!user) return json({ error: 'Please sign in', code: 'auth' }, 401);
    const data = Buffer.from(await req.arrayBuffer());
    if (data.length > 3 * 1024 * 1024) return json({ error: 'Banner too large (max 3 MB)' }, 413);
    const type = sniffImage(data);
    if (!type) return json({ error: 'Choose an image (JPEG, PNG, WebP or GIF)' }, 415);
    const id = crypto.randomBytes(12).toString('hex');
    await store.setFile(`f/${id}`, data, type);
    return json({ url: `/api/file/${id}` });
  }
  // Story photo (stored until the story is deleted or expires)
  if (route === 'story/photo') {
    if (!user) return json({ error: 'Please sign in', code: 'auth' }, 401);
    const data = Buffer.from(await req.arrayBuffer());
    if (data.length > 3 * 1024 * 1024) return json({ error: 'Photo too large (max 3 MB)' }, 413);
    const type = sniffImage(data);
    if (!type) return json({ error: 'Choose a photo (JPEG, PNG, WebP or GIF)' }, 415);
    const id = crypto.randomBytes(12).toString('hex');
    await store.setFile(`f/${id}`, data, type);
    return json({ url: `/api/file/${id}` });
  }

  if (route === 'upload') {
    if (!user) return json({ error: 'Please sign in', code: 'auth' }, 401);
    // Uploads are tied to a room the uploader can access
    const room = cleanRoom(req.headers.get('x-chat-room'));
    const group = await store.get(`g/${room}`);
    if (!(await hasAccess(store, group, room, user, dev))) return json({ error: 'This group is locked', code: 'locked' }, 403);
    if (Number(req.headers.get('content-length')) > MAX_UPLOAD) return json({ error: 'File too large (max 4 MB)' }, 413);
    const data = Buffer.from(await req.arrayBuffer());
    if (data.length > MAX_UPLOAD) return json({ error: 'File too large (max 4 MB)' }, 413);
    const type = sniffMedia(data);
    if (!type) return json({ error: 'Only images (GIF, PNG, JPEG, WebP) and voice recordings are allowed' }, 415);
    const id = crypto.randomBytes(12).toString('hex');
    await store.setFile(`f/${id}`, data, type);
    return json({ url: `/api/file/${id}` });
  }

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }

  if (route.startsWith('auth/')) return authRoute(route.slice(5), { store, req, body, user });
  if (!user) return json({ error: 'Please sign in', code: 'auth' }, 401);

  const name = user.name;
  const room = cleanRoom(body.room);
  const loc = cleanLoc(body.loc);
  const now = Date.now();
  const presenceKey = `p/${room}/${user.uid}`;
  const pushOpts = { vapidEnv, waitUntil, pushSender, origin: new URL(req.url).origin };

  // Push notifications for this device (stored under the account, so every signed-in device gets them)
  if (route === 'push/key') return json({ publicKey: (await getVapid(store, vapidEnv)).publicKey });
  if (route === 'push/subscribe') {
    const sub = cleanSubscription(body.subscription);
    if (!dev || !sub) return json({ error: 'Invalid subscription' }, 400);
    await store.set(`ps/${user.uid}/${dev}`, { sub, at: now });
    return json({ ok: true });
  }
  if (route === 'push/unsubscribe') { if (dev) await store.del(`ps/${user.uid}/${dev}`); return json({ ok: true }); }
  // Native app (Firebase Cloud Messaging) token for this device. One account per token: signing in as someone else moves it.
  if (route === 'push/native') {
    const token = typeof body.token === 'string' && /^[\w:\-.]{20,4096}$/.test(body.token) ? body.token : null;
    if (!dev || !token) return json({ error: 'Invalid token' }, 400);
    const ik = `pt/${sha256(token).slice(0, 32)}`, prev = await store.get(ik);
    if (prev && (prev.uid !== user.uid || prev.dev !== dev)) await store.del(`pf/${prev.uid}/${prev.dev}`);
    const old = await store.get(`pf/${user.uid}/${dev}`);
    await Promise.all([store.set(`pf/${user.uid}/${dev}`, { token, platform: body.platform === 'ios' ? 'ios' : 'android', at: now, walkieWake: old?.walkieWake !== false }), store.set(ik, { uid: user.uid, dev })]);
    return json({ ok: true });
  }
  // "Hear the walkie-talkie when the app is closed" for this phone
  if (route === 'push/native/walkie') {
    const k = dev && `pf/${user.uid}/${dev}`, rec = k && await store.get(k);
    if (!rec) return json({ error: 'Turn on notifications in the app first', code: 'no_device' }, 400);
    rec.walkieWake = body.on === true; await store.set(k, rec);
    return json({ ok: true, on: rec.walkieWake });
  }
  if (route === 'push/native/remove') { if (dev) await store.del(`pf/${user.uid}/${dev}`); return json({ ok: true }); }

  if (route === 'rooms') { const hd = (await store.get(`hd/${user.uid}`))?.rooms || []; return json({ rooms: (await listRooms(store, room, user, dev, body.reads, loc || cleanLoc(body.listLoc))).map(r => hd.includes(r.room) ? { ...r, hidden: true } : r) }); }
  if (route === 'profile/get' || route === 'profile/batch') {
    const ids = (route === 'profile/get' ? [body.uid] : Array.isArray(body.uids) ? body.uids : []).filter(x => typeof x === 'string' && ID.test(x)).slice(0, 60);
    const out = {};
    await Promise.all(ids.map(async id => {
      const u = await store.get(`u/${id}`); if (!u) return;
      out[id] = { ...publicUser(u), lastSeen: await lastSeenOf(store, id) };
      if (route === 'profile/get') out[id].friend = (await store.get(`fr/${user.uid}/${id}`))?.state || null;
    }));
    return json(route === 'profile/get' ? { profile: out[body.uid] || null } : { profiles: out });
  }
  if (route.startsWith('health/')) return healthRoute(route.slice(7), { store, body, user, health, origin: new URL(req.url).origin, push: { vapidEnv, waitUntil, pushSender, origin: new URL(req.url).origin } });
  if (route.startsWith('challenge/')) return challengeRoute(route.slice(10), { store, body, user, stepDays, today: body.today });
  if (route.startsWith('privacy/')) return privacyRoute(route.slice(8), { store, body, user, req });
  if (route.startsWith('story/')) return storyRoute(route.slice(6), { store, body, user, vapidEnv, waitUntil, pushSender, origin: new URL(req.url).origin });
  if (route.startsWith('friends/')) return friendsRoute(route.slice(8), { store, body, user, vapidEnv, waitUntil, pushSender, origin: new URL(req.url).origin });
  if (route === 'gifs') return gifSearch(giphyKey, clean(body.q, 50));

  let group = await store.get(`g/${room}`);
  if (!group && route !== 'group/create' && room !== 'general') {
    const gone = await store.get(`gx/${room}`);
    if (gone) return json({ error: `“${gone.title}” was deleted by ${gone.by}`, code: 'deleted' }, 410);
  }
  await claimLegacyAdmin(store, room, group, user, dev);
  if (route.startsWith('group/')) return groupRoute(route.slice(6), { store, body, room, user, dev, loc, now, group, push: { vapidEnv, waitUntil, pushSender, origin: new URL(req.url).origin } });

  // Everything below needs access to the room
  if (!(await hasAccess(store, group, room, user, dev)))
    return group?.invite ? json({ error: 'This group is invite-only — ask its owner or an admin to add you, or for an invite link', code: 'invite_only', group: { title: group.title } }, 403)
      : json({ error: 'This group needs a password', code: 'locked', group: groupView(group, user, dev) }, 403);
  const isAdmin = isAdminOf(group, user, dev);

  if (route === 'send') {
    const text = clean(body.text, MAX_TEXT);
    const gif = cleanGif(body.gif);
    const audio = cleanAudio(body.audio);
    if (!text && !gif && !audio) return json({ error: 'Empty message' }, 400);
    if (isGeo(group)) {
      const st = await memberState(store, group, room, user, dev, loc, now);
      if (!st.canChat) return json({ error: st.fresh ? 'You’re outside this group’s range. Ask the admin to let you chat.' : 'Your location is needed to chat in this group', code: 'out_of_range' }, 403);
    }
    const msg = await postMessage(store, { room, group, user, text, gif, audio, replyTo: await resolveReply(store, room, body.replyTo), cid: clean(body.cid, 40) }, pushOpts);
    return json({ message: pub(msg) });
  }

  // ⏰ Schedule a message for later (delivered by the scheduler, to the minute)
  if (route === 'schedule') {
    const text = clean(body.text, MAX_TEXT), at = Math.round(Number(body.at) || 0);
    if (!text) return json({ error: 'Write a message to schedule' }, 400);
    if (at < now + 30_000 || at > now + 60 * 864e5) return json({ error: 'Pick a time between 1 minute and 60 days from now' }, 400);
    if (isGeo(group)) { const st = await memberState(store, group, room, user, dev, loc, now); if (!st.canChat) return json({ error: 'You can’t send messages in this group right now', code: 'out_of_range' }, 403); }
    const mine = (await Promise.all((await store.list('sc/')).map(k => store.get(k)))).filter(j => j?.uid === user.uid);
    if (mine.length >= 25) return json({ error: 'You already have 25 scheduled messages' }, 400);
    const id = `${String(at).padStart(13, '0')}-${crypto.randomBytes(4).toString('hex')}`;
    await store.set(`sc/${id}`, { id, room, uid: user.uid, text, replyTo: await resolveReply(store, room, body.replyTo), at, created: now });
    return json({ ok: true, id, at });
  }
  if (route === 'schedule/list') {
    const jobs = (await Promise.all((await store.list('sc/')).map(k => store.get(k)))).filter(j => j?.uid === user.uid && j.room === room).sort((a, b) => a.at - b.at);
    return json({ scheduled: jobs.map(j => ({ id: j.id, text: j.text, at: j.at })) });
  }
  if (route === 'schedule/cancel') {
    const id = String(body.id || ''), j = /^\d{13}-[a-f0-9]{8}$/.test(id) && await store.get(`sc/${id}`);
    if (!j || j.uid !== user.uid) return json({ error: 'Not found' }, 404);
    await store.del(`sc/${id}`);
    return json({ ok: true });
  }
  // 🔔 Remind me about a message later (push notification at that time)
  if (route === 'remind') {
    const mkey = typeof body.key === 'string' && body.key.startsWith(`m/${room}/`) ? body.key : null;
    const m = mkey && await store.get(mkey), at = Math.round(Number(body.at) || 0);
    if (!m) return json({ error: 'Message not found' }, 404);
    if (at < now + 30_000 || at > now + 365 * 864e5) return json({ error: 'Pick a time in the future' }, 400);
    const id = `${String(at).padStart(13, '0')}-${crypto.randomBytes(4).toString('hex')}`;
    await store.set(`rm/${id}`, { uid: user.uid, room, key: mkey, preview: `${m.name}: ${previewOf(m)}`.slice(0, 140), at });
    return json({ ok: true, at });
  }
  // ✏️ Edit your own message (any time; shown as "edited")
  if (route === 'edit') {
    const mkey = typeof body.key === 'string' && body.key.startsWith(`m/${room}/`) ? body.key : null;
    const m = mkey && await store.get(mkey), text = clean(body.text, MAX_TEXT);
    if (!m || m.deleted) return json({ error: 'Message not found' }, 404);
    if (m.uid !== user.uid) return json({ error: 'You can only edit your own messages' }, 403);
    if (!text && !m.gif && !m.audio) return json({ error: 'A message can’t be empty — delete it instead' }, 400);
    m.text = text; m.edited = now;
    const mentions = await findMentions(store, text, user.uid); m.mentions = mentions.length ? mentions : undefined;
    await store.set(mkey, m);
    const edit = await recordEdit(store, room, mkey, { text, edited: now, mentions: m.mentions || [] });
    const meta = await store.get(`r/${room}`);
    if (meta?.last?.key === mkey) await saveRoomMeta(store, room, group, { ...meta.last, text: previewOf(m) });
    await store.set(`v/${room}`, { v: newVersion(now) });
    return json({ ok: true, edit });
  }
  // 📌 Pin / unpin a message for everyone in the chat (up to 10)
  if (route === 'pin') {
    const mkey = typeof body.key === 'string' && body.key.startsWith(`m/${room}/`) ? body.key : null;
    if (!mkey || !(await store.get(mkey))) return json({ error: 'Message not found' }, 404);
    let pins = ((await store.get(`pn/${room}`)) || []).filter(p => p.key !== mkey);
    if (body.on) { pins.push({ key: mkey, by: user.name, at: now }); pins = pins.slice(-10); }
    await store.set(`pn/${room}`, pins);
    await store.set(`v/${room}`, { v: newVersion(now) });
    return json({ ok: true });
  }
  // 🔍 Search this chat's history
  if (route.startsWith('game/')) {
    // mini-games: a short note in the chat when one starts or ends (these notes notify like messages)
    const announce = (text, extra) => postMessage(store, { room, group, user, text, sys: 'game', notify: !!extra?.game }, { vapidEnv, waitUntil, pushSender, origin: new URL(req.url).origin });
    return gameRoute(route.slice(5), body, { store, room, user, group, isAdmin, announce, youtubeKey, country });
  }
  if (route.startsWith('steps/')) return stepsRoute(route.slice(6), { store, body, room, group, user, isAdmin, push: pushOpts });
  if (route.startsWith('fun/')) return funRoute(route.slice(4), { store, body, room, group, user, push: pushOpts });
  if (route === 'search') {
    const q = clean(body.q, 60).toLowerCase();
    if (q.length < 2) return json({ results: [] });
    const keys = (await store.list(`m/${room}/`)).sort().reverse();
    const msgs = (await Promise.all(keys.map(k => store.get(k)))).filter(m => m && !m.deleted && ((m.text || '').toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q)));
    return json({ results: msgs.slice(0, 50).map(m => ({ key: m.key, name: m.name, uid: m.uid, text: previewOf(m), ts: m.ts })) });
  }

  // Mute this group's notifications for this account until a time (0 = unmute, -1 = always)
  if (route === 'push/mute') {
    const until = Number(body.until) === -1 ? 8.64e15 : Math.max(0, Math.min(Number(body.until) || 0, 8.64e15));
    await touchMember(store, room, user, group);
    const k = `mb/${room}/${user.uid}`;
    const m = await store.get(k);
    m.muteUntil = until; await store.set(k, m);
    return json({ ok: true, muteUntil: until });
  }

  // Emoji reaction (one per person; picking the same one again removes it)
  if (route === 'react') {
    const mkey = typeof body.key === 'string' && body.key.startsWith(`m/${room}/`) ? body.key : null;
    if (!mkey || !(await store.get(mkey))) return json({ error: 'Message not found' }, 404);
    if (body.emoji && !REACTIONS.includes(body.emoji)) return json({ error: 'Unsupported reaction' }, 400);
    const x = (await store.get(`x/${room}`)) || {};
    const reactions = {};
    let had = false;
    for (const [e, list] of Object.entries(x[mkey]?.reactions || {})) {
      const kept = list.filter(p => { const mine = typeof p === 'string' ? p === name : p.uid === user.uid; if (mine && e === body.emoji) had = true; return !mine; });
      if (kept.length) reactions[e] = kept;
    }
    if (body.emoji && !had) reactions[body.emoji] = [...(reactions[body.emoji] || []), { uid: user.uid, name }];
    const edit = await recordEdit(store, room, mkey, { reactions });
    await store.set(`v/${room}`, { v: newVersion(now) });
    return json({ ok: true, edit });
  }

  // Delete for everyone: the sender or the group admin
  if (route === 'delete') {
    const mkey = typeof body.key === 'string' && body.key.startsWith(`m/${room}/`) ? body.key : null;
    const m = mkey && await store.get(mkey);
    if (!m) return json({ error: 'Message not found' }, 404);
    const own = m.uid ? m.uid === user.uid : !!dev && m.dev === dev;
    if (!(own || isAdmin)) return json({ error: 'You can only delete your own messages' }, 403);
    const ids = [m.gif?.url, m.audio?.url].map(u => u?.match(LOCAL_FILE)?.[1]).filter(Boolean);
    await Promise.all([store.set(mkey, { key: mkey, room, uid: m.uid, name: m.name, ts: m.ts, deleted: true }), ...ids.map(id => store.delFile(`f/${id}`))]);
    await recordEdit(store, room, mkey, { deleted: true, reactions: {} });
    const meta = await store.get(`r/${room}`);
    if (meta?.last?.key === mkey) await saveRoomMeta(store, room, group, { ...meta.last, text: 'Message deleted' });
    await store.set(`v/${room}`, { v: newVersion(now) });
    return json({ ok: true });
  }

  // Walkie-talkie: take / release the channel
  if (route === 'talk/start') {
    const talkId = String(body.talkId || '');
    if (!TALK_ID.test(talkId)) return json({ error: 'Bad talk id' }, 400);
    if (isGeo(group)) {
      const st = await memberState(store, group, room, user, dev, loc, now);
      if (!st.canChat) return json({ error: 'You’re outside this group’s range, so you can listen but not talk', code: 'out_of_range' }, 403);
    }
    const floor = await talkFloor(store, room, now);
    if (floor && floor.uid !== user.uid) return json({ error: `${floor.name} is talking`, code: 'busy', floor: { uid: floor.uid, name: floor.name } }, 409);
    await store.set(`wt/${room}`, { uid: user.uid, name, talkId, until: now + TALK_LEASE_MS, since: now });
    await store.set(`v/${room}`, { v: newVersion(now) });
    if (!floor || floor.talkId !== talkId) {           // a new turn: wake phones that listen with the app closed
      const title = group?.dm ? name : group?.title || (room === 'general' ? '#general' : `#${room}`);
      const job = wakeWalkie(store, { room, group, talkerUid: user.uid, talkerName: name, title });
      if (waitUntil) waitUntil(job); else await job;
    }
    return json({ ok: true });
  }
  // Real-time walkie-talkie voice (LiveKit / WebRTC): a short-lived pass for this chat's voice room.
  // Talking still goes through talk/start (one speaker at a time); without LiveKit set up, the app uses audio pieces.
  if (route === 'talk/lk') {
    if (!livekit?.url || !livekit?.apiKey || !livekit?.apiSecret) return json({ enabled: false });
    let canTalk = true;
    if (isGeo(group)) canTalk = (await memberState(store, group, room, user, dev, loc, now)).canChat;
    const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url'), t = Math.floor(now / 1000);
    const head = b64({ alg: 'HS256', typ: 'JWT' });
    const claims = b64({ iss: livekit.apiKey, sub: user.uid, name, nbf: t - 10, exp: t + 6 * 3600,
      video: { room: `walkie-${room}`, roomJoin: true, canSubscribe: true, canPublish: canTalk, canPublishData: false, canPublishSources: ['microphone'] } });
    const sig = crypto.createHmac('sha256', livekit.apiSecret).update(`${head}.${claims}`).digest('base64url');
    return json({ enabled: true, url: livekit.url, token: `${head}.${claims}.${sig}`, canTalk });
  }
  // Lightweight live-audio feed for the native app playing the walkie-talkie with the app closed
  if (route === 'talk/feed') {
    const tsince = Number(body.tsince) || 0;
    const [floor, log] = await Promise.all([talkFloor(store, room, now), store.get(`tk/${room}`)]);
    return json({ now, floor: floor && { uid: floor.uid, name: floor.name, since: floor.since },
      chunks: (log || []).filter(e => e.at > tsince && e.uid !== user.uid).sort((a, b) => a.at - b.at || a.seq - b.seq) });
  }
  if (route === 'talk/end') {
    const floor = await store.get(`wt/${room}`);
    if (floor && floor.uid === user.uid) { await store.set(`wt/${room}`, { ...floor, until: 0 }); await store.set(`v/${room}`, { v: newVersion(now) }); }
    return json({ ok: true });
  }

  if (route === 'typing') {
    await Promise.all([store.set(presenceKey, { uid: user.uid, name, seen: now, typingAt: now }), store.set(`v/${room}`, { v: newVersion(now) })]);
    return json({ ok: true });
  }

  if (route === 'poll') {
    const prev = await store.get(presenceKey);
    const presenceWrite = store.set(presenceKey, { uid: user.uid, name, seen: now, typingAt: prev?.typingAt || 0, walkie: body.walkie === true });
    const membership = touchMember(store, room, user, group);
    const ls = await store.get(`ls/${user.uid}`);
    if (!ls || now - ls.at > 60_000) await store.set(`ls/${user.uid}`, { at: now });

    const since = typeof body.since === 'string' ? body.since : '';
    // Long-poll: hold the request until the room changes (new message / typing) or the wait expires.
    let known = typeof body.version === 'string' ? body.version : '';
    const wait = Math.min(Math.max(Number(body.wait) || 0, 0), maxWaitMs || MAX_WAIT_MS);     // each host sets its own cap
    let version = (await store.get(`v/${room}`))?.v || '';
    const bumpOwn = async () => {
      const bumped = newVersion(now);
      await store.set(`v/${room}`, { v: bumped });
      if (version === known) known = bumped;                  // our own change shouldn't end our wait
      version = bumped;
    };

    // Read receipts: the client reports the newest message it has received ("delivered")
    // and the newest one it has had on screen ("read"). Both only ever move forward.
    const ack = body.ack && typeof body.ack === 'object' ? body.ack : {};
    const validKey = k => typeof k === 'string' && k.startsWith(`m/${room}/`) && k.length < 80 ? k : '';
    const ackD = validKey(ack.delivered), ackR = validKey(ack.read);
    if (ackD || ackR) {
      const rk = `rd/${room}/${user.uid}`;
      const old = (await store.get(rk)) || {};
      const read = [old.read || '', ackR].sort().pop();
      const delivered = [old.delivered || '', ackD, read].sort().pop();
      if (read !== (old.read || '') || delivered !== (old.delivered || '')) {
        await store.set(rk, { uid: user.uid, name, delivered, read, at: now });
        await bumpOwn();                                         // wake senders so their ticks update
      }
    }

    // Location groups: update this member's standing; status flips wake the admin's screen
    if (isGeo(group)) {
      const st = await memberState(store, group, room, user, dev, loc, now);
      if (st.changed) await bumpOwn();
    }

    if (version === known && wait) {                        // nothing new (also when the room has no version yet): hold
      const deadline = Date.now() + wait;
      while (Date.now() < deadline && !req.signal?.aborted) {
        await sleep(checkMs || CHECK_MS);
        version = (await store.get(`v/${room}`))?.v || '';
        if (version !== known) break;
      }
    }
    const t = Date.now();
    // Fetch messages, presence, rooms, receipts, edits and group info in parallel to keep latency low
    const loadMessages = async () => {
      const sinceTs = Number(since.split('/')[2]?.slice(0, 13)) || 0;
      const cutoff = `m/${room}/${String(Math.max(0, sinceTs - OVERLAP_MS)).padStart(13, '0')}`;
      const rows = await entries(store, `m/${room}/`, since ? { after: cutoff } : { last: INITIAL_LOAD });
      return rows.map(([, v]) => v).filter(Boolean).map(pub);
    };
    const tsince = Number(body.tsince) || 0;
    const loadTalk = async () => {
      const [floor, log] = await Promise.all([talkFloor(store, room, Date.now()), store.get(`tk/${room}`)]);
      return { floor: floor && { uid: floor.uid, name: floor.name, since: floor.since }, chunks: (log || []).filter(e => e.at > tsince && e.uid !== user.uid) };
    };
    const xsince = Number(body.xsince) || 0;
    const loadPins = async () => {
      const pins = (await store.get(`pn/${room}`)) || [];
      const msgs = await Promise.all(pins.map(p => store.get(p.key)));
      return pins.map((p, i) => msgs[i] && !msgs[i].deleted ? { key: p.key, by: p.by, name: msgs[i].name, text: previewOf(msgs[i]) } : null).filter(Boolean);
    };
    const loadEdits = async () => {
      const x = (await store.get(`x/${room}`)) || {};
      const out = {};
      for (const [k, v] of Object.entries(x)) if (v.at > xsince) out[k] = v;
      return out;
    };
    const loadUsers = async () => {
      const users = [], stale = [];
      for (const [k, p] of await entries(store, `p/${room}/`)) {
        if (!p || !p.uid || t - p.seen > STALE_MS) { stale.push(k); continue; }
        if (t - p.seen <= ONLINE_MS) users.push({ uid: p.uid, name: p.name, typing: t - (p.typingAt || 0) < TYPING_MS, walkie: !!p.walkie });
      }
      await Promise.all(stale.map(k => store.del(k)));
      return users;
    };
    const loadGroup = async () => {
      if (!group) return null;
      const g = (await store.get(`g/${room}`)) || group;          // may have been edited while we waited
      const out = groupView(g, user, dev);
      if (g.dm) { const peer = await peerInfo(store, g, user), ch = await store.get(`ch/${room}`); return { dm: true, title: peer.name, peer, isAdmin: false, locked: false, geo: false, steps: ch ? { title: ch.title, goal: ch.goal, start: ch.start, end: ch.end, days: ch.days } : null }; }
      // keep the admin name in step with the admin account's current name
      if (out.isOwner && g.adminName !== name) { g.adminName = name; out.adminName = name; await store.set(`g/${room}`, g); }
      const ch = await store.get(`ch/${room}`);
      if (ch) out.steps = { title: ch.title, goal: ch.goal, start: ch.start, end: ch.end, days: ch.days };
      if (!isGeo(g)) return out;
      const me = await memberState(store, g, room, user, dev, loc, Date.now());
      out.me = { inside: me.rec.inside, dist: me.rec.dist, acc: me.rec.acc, canChat: me.canChat, approved: me.rec.approved, req: me.rec.req, hasLocation: me.fresh };
      out.center = g.center;     // the group's area, shown on the map to members (members' own positions are never shared)
      if (out.isAdmin) {
        out.members = (await entries(store, `gm/${room}/`)).map(([, m]) => m).filter(m => m?.uid && m.uid !== g.adminUid)
          .map(m => ({ uid: m.uid, name: m.name, inside: m.inside, dist: m.dist, acc: m.acc, approved: m.approved, req: m.req, note: m.note, reqAt: m.reqAt, at: m.at }))
          .sort((a, b) => (b.req === 'pending') - (a.req === 'pending') || (b.at || 0) - (a.at || 0));
      }
      return out;
    };
    const loadReceipts = async () => {
      return (await entries(store, `rd/${room}/`)).map(([, r]) => r).filter(r => r?.uid).map(r => ({ uid: r.uid, name: r.name, delivered: r.delivered, read: r.read }));
    };
    const loadGameView = async () => gameView(await loadGame(store, room, { announce: text => postMessage(store, { room, group, user, text, sys: 'game' }, {}) }), user.uid);
    const [messages, users, rooms, receipts, groupInfo, edits, talk, pins, game] = await Promise.all([loadMessages(), loadUsers(), Promise.all([listRooms(store, room, user, dev, body.reads, loc || cleanLoc(body.listLoc)), store.get(`hd/${user.uid}`)]).then(([rs, hd]) => rs.map(r => hd?.rooms?.includes(r.room) ? { ...r, hidden: true } : r)), loadReceipts(), loadGroup(), loadEdits(), loadTalk(), loadPins(), loadGameView()]);
    const mem = await membership;
    await presenceWrite;
    return json({ messages, users, rooms, receipts, group: groupInfo, edits, talk, pins, game, xt: t, muteUntil: mem?.muteUntil || 0, version });
  }

  return json({ error: 'Not found' }, 404);
}

// GIF search / trending through GIPHY (the API key stays on the server)
async function gifSearch(giphyKey, q) {
  if (!giphyKey) return json({ error: 'GIF search is not set up', configured: false }, 501);
  const params = new URLSearchParams({ api_key: giphyKey, limit: '24', rating: 'pg', bundle: 'messaging_non_clips' });
  if (q) params.set('q', q);
  const r = await fetch(`https://api.giphy.com/v1/gifs/${q ? 'search' : 'trending'}?${params}`).catch(() => null);
  if (!r?.ok) return json({ error: 'GIF search failed' }, 502);
  const { data = [] } = await r.json();
  const pick = (im, ...names) => names.map(n => im?.[n]).find(x => x?.url);
  const gifs = data.map(g => {
    const preview = pick(g.images, 'fixed_width_downsampled', 'fixed_width', 'downsized');
    const full = pick(g.images, 'fixed_width', 'downsized', 'original');
    return preview && full && GIPHY_URL.test(full.url) ? {
      title: g.title || 'GIF',
      preview: { url: preview.url, w: +preview.width, h: +preview.height },
      full: { url: full.url, w: +full.width, h: +full.height },
    } : null;
  }).filter(Boolean);
  return json({ gifs });
}

async function listRooms(store, current, user, dev, reads, loc) {
  const metaKeys = await store.list('r/');
  const metas = (await Promise.all(metaKeys.map(k => store.get(k)))).filter(m => m?.room && (!m.dm || m.members?.includes(user?.uid)));
  const map = new Map([['general', { room: 'general' }]]);
  for (const m of metas) map.set(m.room, m);
  if (current && !map.has(current) && !current.startsWith('d-')) map.set(current, { room: current });
  const wantCounts = reads && typeof reads === 'object' ? reads : null;
  const out = await Promise.all([...map.values()].map(async m => {
    let last = m.last || null, access = true, unread;
    const since = wantCounts ? (typeof wantCounts[m.room] === 'string' ? wantCounts[m.room] : m.dm ? '' : null) : null;
    if (since !== null) {         // unread = messages newer than what this person has read (a 1:1 chat never opened: all of it)
      unread = Math.min((await store.list(`m/${m.room}/`)).filter(k => k > since).length, 99);
    }
    if (m.dm) {
      const peer = await peerInfo(store, { members: m.members }, user);
      return { room: m.room, dm: true, title: peer.name, peer, last, unread, access: true };
    }
    // Invite-only groups: members only. Location groups: people in range now, people who have posted there, admins.
    if (m.invite || m.geo) {
      const g = await store.get(`g/${m.room}`);
      if (!g) return null;
      if (g.invite && !(await hasAccess(store, g, m.room, user, dev))) return null;
      if (isGeo(g) && !g.invite && m.room !== current && !isAdminOf(g, user, dev)) {
        const [mb, gm] = await Promise.all([store.get(`mb/${m.room}/${user.uid}`), store.get(`gm/${m.room}/${user.uid}`)]);
        if (mb && mb.posted === undefined) {     // members from before this rule: look at their past messages once
          let posted = false;
          for (const k of (await store.list(`m/${m.room}/`)).reverse()) { if ((await store.get(k))?.uid === user.uid) { posted = true; break; } }
          mb.posted = posted; await store.set(`mb/${m.room}/${user.uid}`, mb);
        }
        const near = loc && distanceM(loc, g.center) <= g.radius + Math.min(loc.acc || 0, ACCURACY_SLACK);
        if (!near && !mb?.posted && !gm?.approved) return null;
      }
    }
    // Locked groups: hide message previews unless this account has joined with the current password (or is the admin)
    if (m.locked) {
      const g = await store.get(`g/${m.room}`);
      access = await hasAccess(store, g, m.room, user, dev);
      if (!access && last) last = { ts: last.ts, key: last.key };
    }
    return { room: m.room, title: m.title || null, photo: m.photo || null, geo: !!m.geo, locked: !!m.locked, invite: !!m.invite, access, radius: m.radius || null, last, unread };
  }));
  return out.filter(Boolean).sort((a, b) => (b.last?.ts || 0) - (a.last?.ts || 0) || a.room.localeCompare(b.room));
}

// Public API (entry points and tests import these from here)
export { runScheduler } from './scheduler.mjs';
export { blobsAdapter } from './stores/blobs.mjs';
export { _setHealthFetch } from './health.mjs';
