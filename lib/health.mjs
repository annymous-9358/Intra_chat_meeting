// Google Health API: connecting an account and syncing steps automatically.
import crypto from 'node:crypto';
import { json } from './core.mjs';
import { dayShift, stepsRoute } from './steps.mjs';

// ---------- Google Health API: automatic step sync ----------
// The person connects once (Google OAuth, read-only "activity & fitness" scope). The server keeps their refresh token,
// and every ~30 minutes (scheduler) or on "Sync now" reads their daily step totals — phone steps (Health Connect),
// Fitbit / Pixel Watch and other connected apps — and stores the higher of that and what's already logged for each day.
export const GH = { auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', revoke: 'https://oauth2.googleapis.com/revoke',
  api: 'https://health.googleapis.com/v4/users/me', scope: 'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly' };
export const HEALTH_SYNC_MS = 15 * 60_000;
export let healthFetch = (...a) => fetch(...a);
export const _setHealthFetch = f => { healthFetch = f; };      // tests
export const ghConfigured = h => !!(h?.clientId && h?.clientSecret);
export async function ghToken(h, params) {
  const r = await healthFetch(GH.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: h.clientId, client_secret: h.clientSecret, ...params }).toString() });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error_description || d.error || `Google sign-in failed (${r.status})`); e.code = d.error; throw e; }
  return d;
}
export async function ghAccess(store, uid, h) {
  const rec = await store.get(`hc/${uid}`); if (!rec) throw Object.assign(new Error('Not connected'), { code: 'not_connected' });
  if (rec.access && rec.exp > Date.now() + 60_000) return { rec, access: rec.access };
  try {
    const t = await ghToken(h, { grant_type: 'refresh_token', refresh_token: rec.refresh });
    rec.access = t.access_token; rec.exp = Date.now() + (t.expires_in || 3600) * 1000;
    if (t.refresh_token) rec.refresh = t.refresh_token;
    rec.error = null; await store.set(`hc/${uid}`, rec);
    return { rec, access: rec.access };
  } catch (e) {
    if (e.code === 'invalid_grant') { rec.error = 'expired'; rec.access = null; await store.set(`hc/${uid}`, rec); throw Object.assign(new Error('Google Health access expired — tap Reconnect'), { code: 'expired' }); }
    throw e;
  }
}
export const civil = (d, end) => { const [y, m, dd] = d.split('-').map(Number); return { date: { year: y, month: m, day: dd }, time: end ? {} : { hours: 0, minutes: 0, seconds: 0, nanos: 0 } }; };
export const localToday = tzMin => new Date(Date.now() - (tzMin || 0) * 60_000).toISOString().slice(0, 10);
// Pull the last 7 days of daily step totals and merge them in. Returns { days, updated }.
// Merge daily totals from a tracker into the log: never lowers a day (walk mode / manual entries may be higher).
export async function mergeStepDays(store, user, days, src, today, push) {
  let updated = 0;
  for (const [day, n] of Object.entries(days)) {
    const have = (await store.get(`sp/${user.uid}/${day}`))?.steps || 0;
    if (n > have) {
      const r = await stepsRoute('log', { store, body: { date: day, steps: n, today }, user, push: push || {} });
      if (r.status !== 200) continue;
      const k = `sp/${user.uid}/${day}`, sp = await store.get(k); if (sp) { sp.src = src; await store.set(k, sp); }
      updated++;
    }
  }
  return updated;
}
export async function syncHealth(store, uid, h, push) {
  const { rec, access } = await ghAccess(store, uid, h);
  const today = localToday(rec.tz), start = dayShift(today, -6), end = dayShift(today, 1);
  const r = await healthFetch(`${GH.api}/dataTypes/steps/dataPoints:dailyRollUp`, { method: 'POST',
    headers: { authorization: `Bearer ${access}`, accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ range: { start: civil(start), end: civil(end) }, windowSizeDays: 1 }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const reason = d?.error?.details?.find?.(x => x.reason)?.reason;
    rec.error = reason === 'ACCOUNT_NOT_LINKED' ? 'not_linked' : `api_${r.status}`; rec.lastTry = Date.now(); await store.set(`hc/${uid}`, rec);
    throw Object.assign(new Error(reason === 'ACCOUNT_NOT_LINKED' ? 'Your Google account isn’t linked to Google Health yet — open the Google Health app and sign in, then try again' : d?.error?.message || `Google Health error (${r.status})`), { code: rec.error });
  }
  const user = await store.get(`u/${uid}`);
  const days = {};
  for (const p of d.rollupDataPoints || []) {
    const dt = p.civilStartTime?.date; if (!dt) continue;
    const key = `${dt.year}-${String(dt.month).padStart(2, '0')}-${String(dt.day).padStart(2, '0')}`;
    days[key] = Math.min(100000, Math.round(Number(p.steps?.countSum) || 0));
  }
  const updated = user ? await mergeStepDays(store, user, days, 'google', today, push) : 0;
  rec.lastSync = Date.now(); rec.lastTry = rec.lastSync; rec.error = null; rec.lastToday = days[today] ?? null;
  await store.set(`hc/${uid}`, rec);
  return { days, updated, today: days[today] ?? 0 };
}
export async function syncAllHealth(store, h, push) {
  if (!ghConfigured(h)) return 0;
  let n = 0;
  for (const k of await store.list('hc/')) {
    const rec = await store.get(k);
    if (!rec || rec.error === 'expired' || Date.now() - (rec.lastTry || 0) < HEALTH_SYNC_MS) continue;
    try { await syncHealth(store, k.slice(3), h, push); n++; } catch {}
  }
  return n;
}
export async function healthRoute(action, { store, body, user, health, origin, push }) {
  const me = user.uid;
  if (action === 'status') {
    const rec = await store.get(`hc/${me}`);
    return json({ configured: ghConfigured(health), connected: !!rec, lastSync: rec?.lastSync || 0, error: rec?.error || null, today: rec?.lastToday ?? null });
  }
  if (!ghConfigured(health)) return json({ error: 'Google Health sync isn’t set up on this server yet', code: 'not_configured' }, 400);
  if (action === 'start') {
    const state = crypto.randomBytes(16).toString('hex');
    await store.set(`hs/${state}`, { uid: me, at: Date.now(), tz: Math.max(-840, Math.min(840, Math.round(Number(body.tz) || 0))) });
    const q = new URLSearchParams({ client_id: health.clientId, redirect_uri: `${origin}/api/health/callback`, response_type: 'code', scope: GH.scope,
      access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state });
    return json({ url: `${GH.auth}?${q}` });
  }
  if (action === 'sync') {
    const rec = await store.get(`hc/${me}`); if (!rec) return json({ error: 'Connect Google Health first', code: 'not_connected' }, 400);
    if (body.tz !== undefined) { rec.tz = Math.max(-840, Math.min(840, Math.round(Number(body.tz) || 0))); await store.set(`hc/${me}`, rec); }
    try { const r = await syncHealth(store, me, health, push); return json({ ok: true, ...r }); }
    catch (e) { return json({ error: e.message, code: e.code || 'sync_failed' }, e.code === 'expired' ? 401 : 502); }
  }
  if (action === 'disconnect') {
    const rec = await store.get(`hc/${me}`);
    if (rec?.refresh) await healthFetch(`${GH.revoke}?token=${encodeURIComponent(rec.refresh)}`, { method: 'POST' }).catch(() => {});
    await store.del(`hc/${me}`);
    return json({ ok: true });
  }
  return json({ error: 'Not found' }, 404);
}
export async function healthCallback(req, store, health, push) {
  const url = new URL(req.url), back = (q) => new Response(null, { status: 302, headers: { location: `${url.origin}/#/steps?${new URLSearchParams(q)}` } });
  const state = url.searchParams.get('state') || '', code = url.searchParams.get('code');
  const st = /^[a-f0-9]{32}$/.test(state) && await store.get(`hs/${state}`);
  if (st) await store.del(`hs/${state}`);
  if (!st || Date.now() - st.at > 15 * 60_000) return back({ health: 'error', msg: 'That sign-in link expired — please try again' });
  if (url.searchParams.get('error')) return back({ health: 'error', msg: url.searchParams.get('error') === 'access_denied' ? 'You didn’t allow access' : 'Google sign-in was cancelled' });
  if (!code || !ghConfigured(health)) return back({ health: 'error', msg: 'Google Health sync isn’t set up on this server' });
  try {
    const t = await ghToken(health, { grant_type: 'authorization_code', code, redirect_uri: `${url.origin}/api/health/callback` });
    if (!t.refresh_token) return back({ health: 'error', msg: 'Google didn’t return offline access — please try again' });
    if (!String(t.scope || GH.scope).includes('activity_and_fitness')) return back({ health: 'error', msg: 'Please allow access to activity & fitness data' });
    const id = await healthFetch(`${GH.api}/identity`, { headers: { authorization: `Bearer ${t.access_token}`, accept: 'application/json' } });
    const idj = await id.json().catch(() => ({}));
    await store.set(`hc/${st.uid}`, { refresh: t.refresh_token, access: t.access_token, exp: Date.now() + (t.expires_in || 3600) * 1000,
      refreshExp: t.refresh_token_expires_in ? Date.now() + t.refresh_token_expires_in * 1000 : null, tz: st.tz, healthUserId: idj.healthUserId || null,
      connectedAt: Date.now(), error: id.ok ? null : 'not_linked' });
    if (!id.ok) return back({ health: 'error', msg: 'Connected, but your Google account isn’t linked to Google Health yet — install the Google Health app and sign in, then tap Sync now' });
    let today = 0; try { today = (await syncHealth(store, st.uid, health, push)).today; } catch {}
    return back({ health: 'ok', today });
  } catch (e) { return back({ health: 'error', msg: e.message }); }
}
