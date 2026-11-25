// Stories: photo and text stories for friends, with views, reactions, polls and replies.
import crypto from 'node:crypto';
import { getVapid, notifyUser } from './push.mjs';
import { ID } from './accounts.mjs';
import { LOCAL_FILE, MAX_TEXT, clean, json } from './core.mjs';
import { openDm, postMessage, pub } from './messages.mjs';

// ---------- Stories ----------
// st/<uid>/<id>: a photo or text story shown to friends (or only "close friends") for 6–48 hours, with views,
// emoji reactions, an optional poll, and replies that arrive as a 1:1 message quoting the story.
export const STORY_BGS = ['#00a884', '#7c3aed', '#e11d48', '#ea580c', '#0284c7', '#0f172a', '#16a34a', '#db2777', '#ca8a04', 'grad1', 'grad2', 'grad3'];
export const STORY_FONTS = ['sans', 'serif', 'mono', 'hand', 'bold'];
export const STORY_ID = /^\d{13}-[a-f0-9]{6}$/;
export const STORY_REACTS = ['❤️', '😂', '😮', '😢', '👏', '🔥'];
export async function liveStories(store, uid, now = Date.now()) {
  const keys = await store.list(`st/${uid}/`);
  const out = [];
  for (const k of keys.sort()) {
    const st = await store.get(k);
    if (!st) continue;
    if (st.until <= now) {                                  // expired: clean up
      await store.del(k);
      const id = st.url?.match(LOCAL_FILE)?.[1]; if (id) await store.delFile(`f/${id}`);
      continue;
    }
    out.push(st);
  }
  return out;
}
export function storyFor(st, viewer) {
  const mine = st.uid === viewer;
  const view = { id: st.id, uid: st.uid, type: st.type, url: st.url || null, text: st.text || '', bg: st.bg || null, font: st.font || null, caption: st.caption || '',
    at: st.at, until: st.until, audience: st.audience, seen: mine || !!st.views?.[viewer], myReact: st.reacts?.[viewer] || null };
  if (st.poll) {
    const votes = Object.values(st.poll.votes || {}), myVote = st.poll.votes?.[viewer];
    const showCounts = mine || myVote !== undefined;
    view.poll = { q: st.poll.q, opts: st.poll.opts, myVote: myVote ?? null, counts: showCounts ? st.poll.opts.map((_, i) => votes.filter(v => v === i).length) : null };
  }
  if (mine) { view.views = Object.keys(st.views || {}).length; view.reacts = Object.keys(st.reacts || {}).length; }
  return view;
}
export async function canSeeStory(store, st, viewerUid) {
  if (st.uid === viewerUid) return true;
  if ((await store.get(`fr/${st.uid}/${viewerUid}`))?.state !== 'friends') return false;
  if (st.audience === 'close') return ((await store.get(`cf/${st.uid}`)) || []).includes(viewerUid);
  return true;
}
export async function storyRoute(action, { store, body, user, vapidEnv, waitUntil, pushSender, origin }) {
  const me = user.uid, now = Date.now();
  const ping = (uid, title, text, url = '/#/stories') => {
    const job = getVapid(store, vapidEnv).then(vapid => notifyUser(store, uid, { type: 'story', title, body: text, url }, { vapid, sender: pushSender, siteOrigin: origin }));
    if (waitUntil) waitUntil(job); else return job;
  };
  const findStory = async () => {
    const uid = typeof body.uid === 'string' && ID.test(body.uid) ? body.uid : me;
    const id = typeof body.id === 'string' && STORY_ID.test(body.id) ? body.id : null;
    const st = id && await store.get(`st/${uid}/${id}`);
    if (!st || st.until <= now || !(await canSeeStory(store, st, me))) return null;
    return st;
  };

  if (action === 'feed') {
    const friendKeys = await store.list(`fr/${me}/`);
    const rels = await Promise.all(friendKeys.map(k => store.get(k)));
    const friendIds = friendKeys.map((k, i) => rels[i]?.state === 'friends' ? k.split('/')[2] : null).filter(Boolean);
    const muted = (await store.get(`sm/${me}`)) || [];
    const people = [];
    for (const uid of [me, ...friendIds]) {
      const list = [];
      for (const st of await liveStories(store, uid, now)) if (await canSeeStory(store, st, me)) list.push(storyFor(st, me));
      if (!list.length && uid !== me) continue;
      const u = uid === me ? user : await store.get(`u/${uid}`);
      if (!u) continue;
      people.push({ uid, name: u.name, username: u.username, photo: u.photo || null, mine: uid === me, muted: muted.includes(uid),
        stories: list, allSeen: list.every(x => x.seen), latest: list.length ? list[list.length - 1].at : 0 });
    }
    const [mine, ...others] = people;
    others.sort((a, b) => a.muted - b.muted || a.allSeen - b.allSeen || b.latest - a.latest);
    return json({ people: [mine, ...others], closeFriends: (await store.get(`cf/${me}`)) || [], muted });
  }

  if (action === 'post') {
    const type = body.type === 'photo' ? 'photo' : 'text';
    const text = clean(body.text, 300), caption = clean(body.caption, 200);
    const url = typeof body.url === 'string' && LOCAL_FILE.test(body.url) ? body.url : null;
    if (type === 'text' && !text) return json({ error: 'Write something for your story' }, 400);
    if (type === 'photo' && !url) return json({ error: 'Choose a photo' }, 400);
    const hours = [6, 24, 48].includes(Number(body.hours)) ? Number(body.hours) : 24;
    let poll = null;
    if (body.poll && typeof body.poll === 'object') {
      const q = clean(body.poll.q, 80), opts = (Array.isArray(body.poll.opts) ? body.poll.opts : []).map(o => clean(o, 30)).filter(Boolean).slice(0, 4);
      if (q && opts.length >= 2) poll = { q, opts, votes: {} };
      else return json({ error: 'A poll needs a question and at least 2 options' }, 400);
    }
    if ((await store.list(`st/${me}/`)).length >= 30) return json({ error: 'You can have up to 30 stories at a time' }, 400);
    const id = `${String(now).padStart(13, '0')}-${crypto.randomBytes(3).toString('hex')}`;
    const st = { id, uid: me, type, text: type === 'text' ? text : '', caption: type === 'photo' ? caption : '', url: type === 'photo' ? url : null,
      bg: STORY_BGS.includes(body.bg) ? body.bg : STORY_BGS[0], font: STORY_FONTS.includes(body.font) ? body.font : 'sans',
      audience: body.audience === 'close' ? 'close' : 'friends', at: now, until: now + hours * 3600e3, poll, views: {}, reacts: {} };
    await store.set(`st/${me}/${id}`, st);
    return json({ story: storyFor(st, me) });
  }

  if (action === 'view') {
    const st = await findStory(); if (!st) return json({ error: 'This story is no longer available' }, 404);
    if (st.uid !== me && !st.views?.[me]) { st.views = { ...(st.views || {}), [me]: now }; await store.set(`st/${st.uid}/${st.id}`, st); }
    return json({ ok: true });
  }

  if (action === 'react') {
    const st = await findStory(); if (!st) return json({ error: 'This story is no longer available' }, 404);
    if (st.uid === me) return json({ error: 'That’s your own story' }, 400);
    const emoji = STORY_REACTS.includes(body.emoji) ? body.emoji : null;
    st.reacts = { ...(st.reacts || {}) };
    if (!emoji || st.reacts[me] === emoji) delete st.reacts[me]; else st.reacts[me] = emoji;
    st.views = { ...(st.views || {}), [me]: st.views?.[me] || now };
    await store.set(`st/${st.uid}/${st.id}`, st);
    if (st.reacts[me]) await ping(st.uid, `${user.name} reacted ${st.reacts[me]}`, 'to your story', `/#/story/${st.uid}/${st.id}?viewers=1`);
    return json({ ok: true, myReact: st.reacts[me] || null });
  }

  if (action === 'vote') {
    const st = await findStory(); if (!st?.poll) return json({ error: 'This poll is no longer available' }, 404);
    const opt = Number(body.opt);
    if (!(opt >= 0 && opt < st.poll.opts.length)) return json({ error: 'Pick an option' }, 400);
    st.poll.votes = { ...(st.poll.votes || {}), [me]: opt };
    st.views = { ...(st.views || {}), [me]: st.views?.[me] || now };
    await store.set(`st/${st.uid}/${st.id}`, st);
    return json({ ok: true, story: storyFor(st, me) });
  }

  if (action === 'reply') {
    const st = await findStory(); if (!st) return json({ error: 'This story is no longer available' }, 404);
    if (st.uid === me) return json({ error: 'That’s your own story' }, 400);
    const text = clean(body.text, MAX_TEXT); if (!text) return json({ error: 'Write a reply' }, 400);
    const { room, group } = await openDm(store, user, st.uid);
    const owner = await store.get(`u/${st.uid}`);
    const replyTo = { key: `story:${st.id}`, story: true, uid: st.uid, name: owner?.name || '', text: st.type === 'photo' ? (st.caption || 'Photo') : st.text.slice(0, 140), thumb: st.url || null, bg: st.bg };
    const msg = await postMessage(store, { room, group, user, text, replyTo }, { vapidEnv, waitUntil, pushSender, origin });
    return json({ ok: true, room, message: pub(msg) });
  }

  if (action === 'viewers') {
    const id = typeof body.id === 'string' && STORY_ID.test(body.id) ? body.id : null;
    const st = id && await store.get(`st/${me}/${id}`);
    if (!st) return json({ error: 'Story not found' }, 404);
    const uids = [...new Set([...Object.keys(st.views || {}), ...Object.keys(st.reacts || {})])];
    const list = (await Promise.all(uids.map(async uid => {
      const u = await store.get(`u/${uid}`); if (!u) return null;
      return { uid, name: u.name, username: u.username, photo: u.photo || null, at: st.views?.[uid] || 0, react: st.reacts?.[uid] || null, vote: st.poll?.votes?.[uid] ?? null };
    }))).filter(Boolean).sort((a, b) => b.at - a.at);
    return json({ viewers: list, poll: st.poll ? { q: st.poll.q, opts: st.poll.opts } : null });
  }

  if (action === 'delete') {
    const id = typeof body.id === 'string' && STORY_ID.test(body.id) ? body.id : null;
    const st = id && await store.get(`st/${me}/${id}`);
    if (!st) return json({ error: 'Story not found' }, 404);
    await store.del(`st/${me}/${id}`);
    const fid = st.url?.match(LOCAL_FILE)?.[1]; if (fid) await store.delFile(`f/${fid}`);
    return json({ ok: true });
  }

  if (action === 'close-friends') {
    if (Array.isArray(body.uids)) {
      const ids = [...new Set(body.uids.filter(x => typeof x === 'string' && ID.test(x)))].slice(0, 200);
      const ok = await Promise.all(ids.map(async x => (await store.get(`fr/${me}/${x}`))?.state === 'friends'));
      await store.set(`cf/${me}`, ids.filter((_, i) => ok[i]));
    }
    return json({ closeFriends: (await store.get(`cf/${me}`)) || [] });
  }

  if (action === 'mute') {
    const uid = typeof body.uid === 'string' && ID.test(body.uid) ? body.uid : null;
    if (!uid || uid === me) return json({ error: 'Pick a friend' }, 400);
    const list = new Set((await store.get(`sm/${me}`)) || []);
    if (body.on) list.add(uid); else list.delete(uid);
    await store.set(`sm/${me}`, [...list]);
    return json({ muted: [...list] });
  }
  return json({ error: 'Not found' }, 404);
}
