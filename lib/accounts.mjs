// Accounts: usernames, passwords (scrypt), sessions and devices.
import crypto from 'node:crypto';
import { LOCAL_FILE, clean, json, sleep } from './core.mjs';

export const deviceId = secret => typeof secret === 'string' && /^[a-f0-9]{32,64}$/.test(secret)
  ? crypto.createHash('sha256').update(secret).digest('hex').slice(0, 24) : null;


// ---------- Accounts ----------
// People sign up with a username, a display name and a password. A session token (kept in the browser) proves who
// they are; the server fills in names itself, so nobody can post as someone else. Passwords are scrypt-hashed.
export const USERNAME = /^[a-z0-9_.]{3,20}$/;
export const ID = /^[a-f0-9]{24}$/;
export const sha256 = v => crypto.createHash('sha256').update(String(v)).digest('hex');
export const hashPassword = (pw, salt = crypto.randomBytes(16).toString('hex')) => ({ salt, hash: crypto.scryptSync(String(pw), salt, 32).toString('hex') });
export const checkPassword = (pw, rec) => !!rec && crypto.timingSafeEqual(Buffer.from(hashPassword(pw, rec.salt).hash, 'hex'), Buffer.from(rec.hash, 'hex'));
// A status ("🏖️ On leave") disappears by itself after its end time
export const activeStatus = st => st && (st.emoji || st.text) && (!st.until || st.until > Date.now()) ? { emoji: st.emoji || '', text: st.text || '', until: st.until || 0 } : null;
export const publicUser = u => u && { uid: u.uid, username: u.username, name: u.name, photo: u.photo || null, about: u.about || '', status: activeStatus(u.status) };
export const bearer = req => (req.headers.get('authorization') || '').match(/^Bearer ([a-f0-9]{64})$/)?.[1] || null;
export async function sessionUser(store, req) {
  const t = bearer(req); if (!t) return null;
  const s = await store.get(`ss/${sha256(t)}`); if (!s?.uid) return null;
  return await store.get(`u/${s.uid}`);
}
export async function newSession(store, uid) {
  const t = crypto.randomBytes(32).toString('hex');
  await store.set(`ss/${sha256(t)}`, { uid, at: Date.now() });
  return t;
}

export async function authRoute(action, { store, req, body, user }) {
  const now = Date.now();
  if (action === 'signup') {
    const username = clean(body.username, 20).toLowerCase();
    const name = clean(body.name, 24).replace(/\s+/g, ' ');
    const password = typeof body.password === 'string' ? body.password : '';
    if (!USERNAME.test(username)) return json({ error: 'Usernames are 3–20 characters: letters, numbers, dots or underscores', field: 'username' }, 400);
    if (!name) return json({ error: 'Enter the name people will see', field: 'name' }, 400);
    if (password.length < 6 || password.length > 128) return json({ error: 'Use a password of at least 6 characters', field: 'password' }, 400);
    if (await store.get(`un/${username}`)) return json({ error: 'That username is taken — try another', field: 'username' }, 409);
    const uid = crypto.randomBytes(12).toString('hex');
    const u = { uid, username, name, pw: hashPassword(password), created: now };
    await store.set(`u/${uid}`, u);
    await store.set(`un/${username}`, { uid });
    return json({ token: await newSession(store, uid), user: publicUser(u) });
  }
  if (action === 'login') {
    const username = clean(body.username, 20).toLowerCase().replace(/^@/, '');
    const lf = (await store.get(`lf/${username}`)) || { n: 0, until: 0 };
    if (lf.until > now) return json({ error: 'Too many wrong attempts — try again in a few minutes' }, 429);
    const ref = USERNAME.test(username) && await store.get(`un/${username}`);
    const u = ref && await store.get(`u/${ref.uid}`);
    if (!u || !checkPassword(String(body.password || ''), u.pw)) {
      await sleep(400);
      const n = lf.n + 1;
      await store.set(`lf/${username}`, { n, until: n >= 5 ? now + 5 * 60_000 : 0 });
      return json({ error: 'Wrong username or password', field: 'password' }, 401);
    }
    if (lf.n) await store.del(`lf/${username}`);
    return json({ token: await newSession(store, u.uid), user: publicUser(u) });
  }
  if (!user) return json({ error: 'Please sign in', code: 'auth' }, 401);
  if (action === 'me') return json({ user: publicUser(user) });
  if (action === 'logout') { const t = bearer(req); if (t) await store.del(`ss/${sha256(t)}`); return json({ ok: true }); }
  if (action === 'update') {
    if (body.about !== undefined) user.about = clean(body.about, 140);
    if (body.status !== undefined) {
      const st = body.status;
      user.status = st && (st.emoji || st.text) ? { emoji: clean(st.emoji, 20), text: clean(st.text, 60), until: Math.max(0, Math.min(Number(st.until) || 0, 8.64e15)) } : null;
    }
    if (body.photo === null && user.photo) {
      const id = user.photo.match(LOCAL_FILE)?.[1]; if (id) await store.delFile(`f/${id}`);
      user.photo = null;
    }
    if (body.name !== undefined) {
      const name = clean(body.name, 24).replace(/\s+/g, ' ');
      if (!name) return json({ error: 'Your name can’t be empty' }, 400);
      user.name = name;
    }
    if (body.newPassword !== undefined) {
      if (!checkPassword(String(body.password || ''), user.pw)) return json({ error: 'Your current password isn’t right', field: 'password' }, 401);
      if (String(body.newPassword).length < 6) return json({ error: 'Use at least 6 characters', field: 'newPassword' }, 400);
      user.pw = hashPassword(body.newPassword);
    }
    await store.set(`u/${user.uid}`, user);
    return json({ user: publicUser(user) });
  }
  return json({ error: 'Not found' }, 404);
}
