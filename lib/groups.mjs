// Groups: access, owner/admins, membership, and the group settings route.
import crypto from 'node:crypto';
import { getVapid, notifyUser } from './push.mjs';
import { ID, checkPassword, hashPassword } from './accounts.mjs';
import { LOCAL_FILE, clean, json, newVersion, sleep } from './core.mjs';
import { ACCURACY_SLACK, MAX_RADIUS, MIN_RADIUS } from './location.mjs';

// ---------- Groups: admin, access, members ----------
export const isGeo = g => !!g?.center;
// Admin is an account. Groups made before accounts existed belong to the device that created them,
// until someone signs in on that device — then that account becomes the admin.
// The owner (g.adminUid, the creator) is always an admin and can't be removed; they and other admins can add more admins (g.admins).
export const isOwnerOf = (g, user, dev) => !!g && ((g.adminUid && user?.uid === g.adminUid) || (!g.adminUid && !!dev && g.admin === dev));
export const isAdminOf = (g, user, dev) => isOwnerOf(g, user, dev) || (!!g && !!user && Array.isArray(g.admins) && g.admins.includes(user.uid));
export const isAdminUid = (g, uid) => !!g && (uid === g.adminUid || (Array.isArray(g.admins) && g.admins.includes(uid)));
export async function claimLegacyAdmin(store, room, g, user, dev) {
  if (g && !g.adminUid && user && dev && g.admin === dev) { g.adminUid = user.uid; g.adminName = user.name; await store.set(`g/${room}`, g); }
}
export async function hasAccess(store, g, room, user, dev) {
  if (g?.dm) return !!user && g.members.includes(user.uid);      // 1:1 chats: only the two people
  if (g?.invite) return !!user && (isAdminOf(g, user, dev) || !!(await store.get(`iv/${room}/${user.uid}`)));   // invite-only: members only
  if (!g?.pw) return true;
  if (isAdminOf(g, user, dev)) return true;
  const a = user && await store.get(`ga/${room}/${user.uid}`);
  return !!a && a.v === g.pw.v;            // joined with the current password
}
export const groupView = (g, user, dev) => g && { photo: g.photo || null, title: g.title, geo: isGeo(g), locked: !!g.pw, invite: !!g.invite, inviteCode: g.invite && isAdminOf(g, user, dev) ? g.invite.code : undefined, radius: isGeo(g) ? g.radius : null, adminName: g.adminName || null, adminUid: g.adminUid || null, admins: g.admins || [], isAdmin: isAdminOf(g, user, dev), isOwner: isOwnerOf(g, user, dev) };
export const previewOf = m => m.deleted ? 'Message deleted' : m.text ? m.text.slice(0, 90) : m.audio ? (m.audio.walkie ? 'Walkie-talkie' : 'Voice message') : m.gif ? 'GIF' : '';
export async function saveRoomMeta(store, room, g, last) {
  const old = (await store.get(`r/${room}`)) || {};
  // the preview only moves forward (two quick sends can finish out of order)
  const keepOld = last && old.last?.key && old.last.key > last.key;
  const meta = { room, title: g?.title || old.title || null, geo: isGeo(g), locked: !!g?.pw, invite: !!g?.invite, radius: isGeo(g) ? g.radius : null, last: last === undefined || keepOld ? old.last || null : last };
  if (g?.photo) meta.photo = g.photo;
  if (g?.dm) { meta.dm = true; meta.members = g.members; meta.title = null; }
  await store.set(`r/${room}`, meta);
}
// Group membership (anyone who has opened the group). Used for the members list and notifications.
export async function touchMember(store, room, user, g, { posted } = {}) {
  const key = `mb/${room}/${user.uid}`;
  const old = await store.get(key);
  const pwv = g?.pw?.v || 0;
  if (!old || old.name !== user.name || old.pwv !== pwv || old.username !== user.username || (posted && !old.posted)) {
    await store.set(key, { ...(old || {}), uid: user.uid, name: user.name, username: user.username, pwv, muteUntil: old?.muteUntil || 0, joined: old?.joined || Date.now(), posted: !!(posted || old?.posted) });
  }
  return old;
}

export const failedJoins = new Map();   // room+uid -> { n, until } (brute-force brake per server instance)

export async function membersList(store, room, group) {
  const keys = await store.list(`mb/${room}/`);
  const pwv = group?.pw?.v || 0;
  const list = (await Promise.all(keys.map(k => store.get(k)))).filter(m => m?.uid && (!pwv || m.pwv === pwv || isAdminUid(group, m.uid)))
    .map(m => ({ uid: m.uid, name: m.name, username: m.username || null, admin: isAdminUid(group, m.uid), owner: !!group && m.uid === group.adminUid, joined: m.joined || 0 }))
    .sort((a, b) => b.owner - a.owner || b.admin - a.admin || a.name.localeCompare(b.name));
  return json({ members: list });
}

export async function deleteRoom(store, room, group) {
  const files = new Set();
  const fileOf = u => u?.match?.(LOCAL_FILE)?.[1];
  const msgKeys = await store.list(`m/${room}/`);
  for (const k of msgKeys) { const m = await store.get(k); for (const id of [fileOf(m?.gif?.url), fileOf(m?.audio?.url)]) if (id) files.add(id); }
  for (const e of (await store.get(`tk/${room}`)) || []) { const id = fileOf(e.url); if (id) files.add(id); }
  if (fileOf(group?.photo)) files.add(fileOf(group.photo));
  const perRoom = (await Promise.all(['p', 'rd', 'gm', 'mb', 'ga', 'iv'].map(x => store.list(`${x}/${room}/`)))).flat();
  const jobs = [];
  for (const k of [...(await store.list('sc/')), ...(await store.list('rm/'))]) { const j = await store.get(k); if (j?.room === room) jobs.push(k); }
  const gp = await store.list(`gp/${room}/`);
  const keys = [...msgKeys, ...perRoom, ...jobs, ...gp, ...['g', 'r', 'v', 'x', 'tk', 'wt', 'pn', 'gs', 'ch'].map(x => `${x}/${room}`)];
  for (let i = 0; i < keys.length; i += 50) await Promise.all(keys.slice(i, i + 50).map(k => store.del(k)));
  await Promise.all([...files].map(id => store.delFile(`f/${id}`)));
}

export async function groupRoute(action, { store, body, room, user, dev, loc, now, group, push }) {
  const bump = () => store.set(`v/${room}`, { v: newVersion(now) });
  const radiusOf = v => Math.round(Math.min(Math.max(Number(v) || 0, MIN_RADIUS), MAX_RADIUS));
  const pwOk = p => typeof p === 'string' && p.length >= 4 && p.length <= 64;
  const name = user.name;

  if (action === 'create') {
    if (room.startsWith('d-')) return json({ error: 'That group name isn’t allowed — try another' }, 400);   // reserved for 1:1 chats
    const type = ['open', 'private', 'geo', 'invite'].includes(body.type) ? body.type : 'open';
    const [msgs, meta] = await Promise.all([store.list(`m/${room}/`), store.get(`r/${room}`)]);
    if (room === 'general' || group || msgs.length || meta) return json({ error: 'That group name is already taken — try another', code: 'taken' }, 409);
    const password = typeof body.password === 'string' ? body.password : '';
    if (type === 'private' && !pwOk(password)) return json({ error: 'Choose a password of at least 4 characters' }, 400);
    if (password && !pwOk(password)) return json({ error: 'Passwords need 4–64 characters' }, 400);
    if (type === 'geo' && !loc) return json({ error: 'Your location is needed to create a location group' }, 400);
    const title = clean(body.title, 40) || room;
    const g = { room, title, adminUid: user.uid, adminName: name, admin: dev || null, created: now };
    if (type === 'geo') { g.center = { lat: loc.lat, lng: loc.lng }; g.radius = radiusOf(body.radius); }
    if (password && type !== 'invite') g.pw = { ...hashPassword(password), v: 1 };
    if (type === 'invite') g.invite = { code: crypto.randomBytes(9).toString('base64url') };
    await store.set(`g/${room}`, g);
    if (g.invite) await store.set(`iv/${room}/${user.uid}`, { by: user.uid, at: now });
    await store.del(`gx/${room}`);
    await saveRoomMeta(store, room, g, null);
    await touchMember(store, room, user, g);
    if (type === 'geo') await store.set(`gm/${room}/${user.uid}`, { uid: user.uid, name, inside: true, dist: 0, acc: Math.round(loc.acc), approved: true, req: null, at: now, seenAt: now });
    return json({ group: groupView(g, user, dev) });
  }

  if (action === 'members' && !group) return membersList(store, room, null);   // e.g. #general
  if (!group) return json({ error: 'Group not found' }, 404);
  const isAdmin = isAdminOf(group, user, dev);

  if (action === 'join' && group.invite) {         // invite-only: the invite link carries a code
    if (await hasAccess(store, group, room, user, dev)) return json({ ok: true });
    if (typeof body.code !== 'string' || body.code !== group.invite.code) return json({ error: 'This invite link is no longer valid — ask an admin for a new one', code: 'invite_only' }, 403);
    await store.set(`iv/${room}/${user.uid}`, { by: 'link', at: now });
    await touchMember(store, room, user, group);
    await store.set(`v/${room}`, { v: newVersion(now) });
    return json({ ok: true });
  }
  if (action === 'join') {
    if (!group.pw || await hasAccess(store, group, room, user, dev)) return json({ ok: true });
    const fk = room + user.uid, f = failedJoins.get(fk);
    if (f && f.until > now) return json({ error: 'Too many wrong attempts — wait a minute and try again' }, 429);
    if (!checkPassword(String(body.password || ''), group.pw)) {
      await sleep(400);
      const n = (f?.n || 0) + 1;
      failedJoins.set(fk, { n, until: n >= 5 ? now + 60_000 : 0 });
      return json({ error: 'That password isn’t right', code: 'bad_password' }, 401);
    }
    failedJoins.delete(fk);
    await store.set(`ga/${room}/${user.uid}`, { v: group.pw.v, at: now });
    await touchMember(store, room, user, group);
    return json({ ok: true });
  }

  if (!(await hasAccess(store, group, room, user, dev))) return json({ error: 'This group needs a password', code: 'locked' }, 403);

  // Members list (everyone who has opened the group), with who's admin
  if (action === 'members') return membersList(store, room, group);
  if (group.dm) return json({ error: 'Not available in a 1:1 chat' }, 400);

  // Add friends to the group (owner/admins). In invite-only groups this is how people get in.
  if (action === 'invite') {
    if (!isAdmin) return json({ error: 'Only group admins can add people' }, 403);
    const ids = [...new Set((Array.isArray(body.uids) ? body.uids : []).filter(x => typeof x === 'string' && ID.test(x) && x !== user.uid))].slice(0, 50);
    const added = [];
    for (const uid of ids) {
      if ((await store.get(`fr/${user.uid}/${uid}`))?.state !== 'friends') continue;      // only your friends
      const u = await store.get(`u/${uid}`); if (!u) continue;
      await store.set(`iv/${room}/${uid}`, { by: user.uid, at: now });
      if (group.pw) await store.set(`ga/${room}/${uid}`, { v: group.pw.v, at: now });   // added people skip the password
      if (isGeo(group)) { const gk = `gm/${room}/${uid}`, gmr = (await store.get(gk)) || { uid, name: u.name, inside: null, dist: null }; await store.set(gk, { ...gmr, approved: true, req: null }); }
      await touchMember(store, room, u, group);
      added.push({ uid, name: u.name });
    }
    if (added.length) {
      await bump();
      const job = getVapid(store, push?.vapidEnv).then(vapid => Promise.all(added.map(a => notifyUser(store, a.uid,
        { type: 'group', room, title: group.title || room, body: `${name} added you to the group`, url: `/#/g/${room}` }, { vapid, sender: push?.pushSender, siteOrigin: push?.origin }))));
      if (push?.waitUntil) push.waitUntil(job); else await job.catch(() => {});
    }
    return json({ ok: true, added });
  }

  if (action === 'update') {
    if (!isAdmin) return json({ error: 'Only the group admin can change this' }, 403);
    // Who can join: anyone with the link / password / invite only
    if (['open', 'password', 'invite'].includes(body.access)) {
      if (body.access === 'invite') {
        if (!group.invite) {
          group.invite = { code: crypto.randomBytes(9).toString('base64url') };
          // everyone who is already in the group stays in
          for (const k of await store.list(`mb/${room}/`)) { const mm = await store.get(k); if (mm?.uid && (!group.pw || mm.pwv === group.pw.v || isAdminUid(group, mm.uid))) await store.set(`iv/${room}/${mm.uid}`, { by: 'existing', at: now }); }
        }
        delete group.pw;
      } else {
        delete group.invite;
        if (body.access === 'open') delete group.pw;
        else if (!pwOk(body.password) && !group.pw) return json({ error: 'Choose a password of at least 4 characters' }, 400);
        else if (pwOk(body.password)) group.pw = { ...hashPassword(body.password), v: (group.pw?.v || 0) + 1 };
      }
      body.password = undefined;
    }
    if (body.resetLink && group.invite) group.invite = { code: crypto.randomBytes(9).toString('base64url') };   // old links stop working
    // Location limit on / off
    if (body.location === false && isGeo(group)) { delete group.center; delete group.radius; }
    if (body.location === true && !isGeo(group)) {
      if (!loc) return json({ error: 'Your location is needed to set the group’s area' }, 400);
      group.center = { lat: loc.lat, lng: loc.lng }; group.radius = radiusOf(body.radius || 300);
      await store.set(`gm/${room}/${user.uid}`, { uid: user.uid, name, inside: true, dist: 0, acc: Math.round(loc.acc), approved: true, req: null, at: now, seenAt: now });
    }
    const geoChange = isGeo(group) && (body.radius != null || body.recenter);
    if (isGeo(group) && body.radius != null) group.radius = radiusOf(body.radius);
    if (isGeo(group) && body.recenter) { if (!loc) return json({ error: 'Location needed' }, 400); group.center = { lat: loc.lat, lng: loc.lng }; }
    if (body.title) group.title = clean(body.title, 40) || group.title;
    if (body.photo === null && group.photo) { const id = group.photo.match(LOCAL_FILE)?.[1]; if (id) await store.delFile(`f/${id}`); delete group.photo; }
    if (body.password !== undefined) {
      if (body.password === null || body.password === '') delete group.pw;
      else if (!pwOk(body.password)) return json({ error: 'Passwords need 4–64 characters' }, 400);
      else group.pw = { ...hashPassword(body.password), v: (group.pw?.v || 0) + 1 };   // new version → everyone else must re-enter it
    }
    await store.set(`g/${room}`, group);
    await saveRoomMeta(store, room, group);
    if (group.pw) await touchMember(store, room, user, group);
    // Re-evaluate everyone's inside/outside against the new fence using their last known distance
    if (geoChange) {
      const keys = await store.list(`gm/${room}/`);
      await Promise.all(keys.map(async k => { const m = await store.get(k); if (m && m.uid !== user.uid) { m.inside = body.recenter ? null : (m.dist != null ? m.dist <= group.radius + Math.min(m.acc || 0, ACCURACY_SLACK) : null); await store.set(k, m); } }));
    }
    await bump();
    return json({ group: groupView(group, user, dev) });
  }

  // More admins: the owner or any admin can make a member an admin
  if (action === 'admin/add') {
    if (!isAdmin) return json({ error: 'Only group admins can do this' }, 403);
    const target = typeof body.member === 'string' && ID.test(body.member) ? await store.get(`mb/${room}/${body.member}`) : null;
    const tu = target && await store.get(`u/${target.uid}`);
    if (!tu) return json({ error: 'Pick someone who is a member of this group' }, 404);
    if (isAdminUid(group, tu.uid)) return json({ ok: true, group: groupView(group, user, dev) });
    group.admins = [...new Set([...(group.admins || []), tu.uid])].slice(0, 50);
    await store.set(`g/${room}`, group);
    if (isGeo(group)) {   // admins can always chat
      const gk = `gm/${room}/${tu.uid}`, gmr = (await store.get(gk)) || { uid: tu.uid, name: tu.name, inside: null, dist: null };
      await store.set(gk, { ...gmr, approved: true, req: null });
    }
    if (group.pw) await store.set(`ga/${room}/${tu.uid}`, { v: group.pw.v, at: now });
    await bump();
    return json({ ok: true, group: groupView(group, user, dev) });
  }
  // Remove an admin: the owner can remove anyone except themselves; an admin can step down. The owner is never removed.
  if (action === 'admin/remove') {
    const uid = typeof body.member === 'string' && ID.test(body.member) ? body.member : null;
    if (!uid) return json({ error: 'Pick an admin' }, 400);
    if (uid === group.adminUid) return json({ error: 'The group owner is always an admin', code: 'owner' }, 403);
    if (!(isOwnerOf(group, user, dev) || uid === user.uid)) return json({ error: 'Only the group owner can remove admins' }, 403);
    group.admins = (group.admins || []).filter(x => x !== uid);
    await store.set(`g/${room}`, group);
    await bump();
    return json({ ok: true, group: groupView(group, user, dev) });
  }
  // Delete the whole group (owner only): messages, members, files — for everyone
  if (action === 'delete') {
    if (!isOwnerOf(group, user, dev)) return json({ error: 'Only the group owner can delete the group' }, 403);
    if (clean(body.confirm, 40).toLowerCase() !== String(group.title || room).toLowerCase()) return json({ error: 'Type the group name to confirm' }, 400);
    await deleteRoom(store, room, group);
    await store.set(`gx/${room}`, { title: group.title || room, by: user.name, at: now });
    return json({ ok: true });
  }

  if (!isGeo(group)) return json({ error: 'Not a location group' }, 404);

  if (action === 'request') {
    const mk = `gm/${room}/${user.uid}`;
    const m = (await store.get(mk)) || { uid: user.uid, name, inside: null, dist: null, approved: false, at: 0 };
    if (m.approved) return json({ ok: true, already: true });
    if (m.req === 'pending') return json({ ok: true });
    Object.assign(m, { name, req: 'pending', reqAt: now, note: clean(body.note, 140) });
    await store.set(mk, m);
    await bump();
    return json({ ok: true });
  }

  if (action === 'decide') {
    if (!isAdmin) return json({ error: 'Only the group admin can do this' }, 403);
    const id = typeof body.member === 'string' && ID.test(body.member) ? body.member : null;
    const mk = id && `gm/${room}/${id}`;
    const m = mk && await store.get(mk);
    if (!m) return json({ error: 'Member not found' }, 404);
    if (body.action === 'approve') Object.assign(m, { approved: true, req: null });
    else if (body.action === 'deny') Object.assign(m, { approved: false, req: 'denied' });
    else if (body.action === 'revoke') Object.assign(m, { approved: false, req: null });
    else return json({ error: 'Unknown action' }, 400);
    await store.set(mk, m);
    await bump();
    return json({ ok: true });
  }

  return json({ error: 'Not found' }, 404);
}
