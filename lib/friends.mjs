// Friends and 1:1 chats route.
import { getVapid, notifyUser } from './push.mjs';
import { ID, USERNAME, activeStatus } from './accounts.mjs';
import { clean, json } from './core.mjs';
import { lastSeenOf, openDm } from './messages.mjs';

export async function friendsRoute(action, { store, body, user, vapidEnv, waitUntil, pushSender, origin }) {
  const me = user.uid;
  const rel = async other => (await store.get(`fr/${me}/${other}`))?.state || null;
  const card = async (uid, state) => { const u = await store.get(`u/${uid}`); return u && { uid, name: u.name, username: u.username, photo: u.photo || null, status: activeStatus(u.status), state, lastSeen: await lastSeenOf(store, uid) }; };
  const ping = (uid, title, text, url) => {           // push a friend notification to all of that person's devices
    const job = getVapid(store, vapidEnv).then(vapid => notifyUser(store, uid, { type: 'friend', title, body: text, url }, { vapid, sender: pushSender, siteOrigin: origin }));
    if (waitUntil) waitUntil(job); else return job;
  };
  const target = async () => {
    const uid = typeof body.uid === 'string' && ID.test(body.uid) ? body.uid : null;
    if (uid) return uid !== me && (await store.get(`u/${uid}`)) ? uid : null;
    const un = clean(body.username, 21).toLowerCase().replace(/^@/, '');
    const ref = USERNAME.test(un) && await store.get(`un/${un}`);
    return ref && ref.uid !== me ? ref.uid : null;
  };
  const now = Date.now();

  if (action === 'list') {
    const keys = await store.list(`fr/${me}/`);
    const all = (await Promise.all(keys.map(async k => { const r = await store.get(k); return r && card(r.uid, r.state); }))).filter(Boolean);
    const by = st => all.filter(x => x.state === st).sort((a, b) => a.name.localeCompare(b.name));
    return json({ friends: by('friends'), incoming: by('in'), outgoing: by('out') });
  }
  if (action === 'search') {
    const q = clean(body.q, 20).toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_.]/g, '');
    if (q.length < 2) return json({ users: [] });
    const keys = (await store.list(`un/${q}`)).slice(0, 15);
    const users = (await Promise.all(keys.map(async k => { const ref = await store.get(k); return ref && ref.uid !== me ? card(ref.uid, await rel(ref.uid)) : null; }))).filter(Boolean);
    return json({ users });
  }
  const other = await target();
  if (!other) return json({ error: 'No one with that username', field: 'username' }, 404);
  const state = await rel(other);

  if (action === 'request') {
    if (state === 'friends') return json({ ok: true, state });
    if (state === 'in') {   // they already asked you → you're friends now
      await Promise.all([store.set(`fr/${me}/${other}`, { uid: other, state: 'friends', at: now }), store.set(`fr/${other}/${me}`, { uid: me, state: 'friends', at: now })]);
      await ping(other, 'New friend', `${user.name} accepted your friend request`, `/#/dm/${me}`);   // opens your 1:1 chat
      return json({ ok: true, state: 'friends' });
    }
    await Promise.all([store.set(`fr/${me}/${other}`, { uid: other, state: 'out', at: now }), store.set(`fr/${other}/${me}`, { uid: me, state: 'in', at: now })]);
    await ping(other, 'Friend request', `${user.name} (@${user.username}) wants to be friends`, `/#/u/${me}`);   // opens their profile with Accept
    return json({ ok: true, state: 'out' });
  }
  if (action === 'respond') {
    if (state !== 'in') return json({ error: 'No request from this person' }, 404);
    if (body.accept) {
      await Promise.all([store.set(`fr/${me}/${other}`, { uid: other, state: 'friends', at: now }), store.set(`fr/${other}/${me}`, { uid: me, state: 'friends', at: now })]);
      await ping(other, 'New friend', `${user.name} accepted your friend request`, `/#/dm/${me}`);   // opens your 1:1 chat
      return json({ ok: true, state: 'friends' });
    }
    await Promise.all([store.del(`fr/${me}/${other}`), store.del(`fr/${other}/${me}`)]);
    return json({ ok: true, state: null });
  }
  if (action === 'remove') {
    await Promise.all([store.del(`fr/${me}/${other}`), store.del(`fr/${other}/${me}`)]);
    return json({ ok: true, state: null });
  }
  // Open (or create) the private 1:1 chat with a friend
  if (action === 'dm') {
    if (state !== 'friends') return json({ error: 'You can only message your friends — send a friend request first' }, 403);
    return json({ room: (await openDm(store, user, other)).room });
  }
  return json({ error: 'Not found' }, 404);
}
