import { ok } from '../helpers.mjs';
import { handle, runScheduler, _setHealthFetch } from '../../lib/chat.mjs';
const m = new Map(); const sent = []; const files = new Map();
const store = { list: async p => [...m.keys()].filter(k => k.startsWith(p)), get: async k => structuredClone(m.get(k) ?? null), set: async (k, v) => { m.set(k, structuredClone(v)); }, del: async k => { m.delete(k); }, setFile: async (k, d) => { files.set(k, d); }, getFile: async () => null, delFile: async k => { files.delete(k); } };
const opts = { pushSender: async (sub, payload) => sent.push({ to: sub.endpoint.split('/').pop(), ...JSON.parse(payload) }) };
const hdr = (u, extra = {}) => ({ authorization: 'Bearer ' + u.token, 'x-chat-device': (u.uid + 'a'.repeat(40)).slice(0, 32).replace(/[^a-f0-9]/g, 'b'), ...extra });
const call = async (route, body = {}, u) => { const r = await handle(new Request('https://x/api/' + route, { method: 'POST', headers: u ? hdr(u) : {}, body: JSON.stringify(body) }), store, opts); return [r.status, await r.json()]; };
const signup = async (un, name) => { const [, d] = await call('auth/signup', { username: un, name, password: 'secret1' }); return { token: d.token, uid: d.user.uid }; };
// profile
const health = { clientId: 'cid.apps.googleusercontent.com', clientSecret: 'shh' };
opts.health = health;
const K = await signup('kunik', 'Kunik'), H = await signup('himanshu', 'Himanshu');
let s, d, r;

// ---- mock Google ----
const today = new Date().toISOString().slice(0, 10), ymd = n => { const t = new Date(); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const G = { calls: [], refreshOk: true, steps: { [ymd(-1)]: 9100, [today]: 4321 }, linked: true };
_setHealthFetch(async (url, init = {}) => {
  G.calls.push({ url: String(url), init });
  const reply = (code, body) => new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json' } });
  if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
    const p = new URLSearchParams(init.body);
    if (p.get('grant_type') === 'authorization_code') return p.get('code') === 'good' && p.get('redirect_uri') === 'https://x/api/health/callback' ? reply(200, { access_token: 'AT1', refresh_token: 'RT1', expires_in: 3599, refresh_token_expires_in: 604799, scope: 'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly', token_type: 'Bearer' }) : reply(400, { error: 'invalid_grant' });
    return G.refreshOk ? reply(200, { access_token: 'AT2', expires_in: 3599 }) : reply(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
  }
  if (String(url).endsWith('/v4/users/me/identity')) return G.linked ? reply(200, { name: 'users/me/identity', healthUserId: '111' }) : reply(400, { error: { code: 400, status: 'FAILED_PRECONDITION', details: [{ reason: 'ACCOUNT_NOT_LINKED' }] } });
  if (String(url).endsWith('/v4/users/me/dataTypes/steps/dataPoints:dailyRollUp')) {
    const b = JSON.parse(init.body); G.lastBody = b;
    if (!G.linked) return reply(400, { error: { code: 400, message: 'The account is not linked to Google Health.', status: 'FAILED_PRECONDITION', details: [{ reason: 'ACCOUNT_NOT_LINKED' }] } });
    return reply(200, { rollupDataPoints: Object.entries(G.steps).map(([k, v]) => { const [y, m, dd] = k.split('-').map(Number); return { civilStartTime: { date: { year: y, month: m, day: dd }, time: {} }, steps: { countSum: String(v) } }; }) });
  }
  if (String(url).startsWith('https://oauth2.googleapis.com/revoke')) return reply(200, {});
  return reply(404, {});
});
const get = async path => handle(new Request('https://x' + path, { method: 'GET' }), store, opts);
// not configured
const o2 = { ...opts, health: {} };
r = await handle(new Request('https://x/api/health/status', { method: 'POST', headers: hdr(K), body: '{}' }), store, o2); d = await r.json(); ok(!d.configured, 'status says not configured without credentials');
// start
[s, d] = await call('health/start', { tz: 0 }, K);
const u = new URL(d.url); ok(s === 200 && u.origin === 'https://accounts.google.com' && u.searchParams.get('scope') === 'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly' && u.searchParams.get('access_type') === 'offline' && u.searchParams.get('redirect_uri') === 'https://x/api/health/callback', 'auth URL has the right scope, offline access and redirect');
const state = u.searchParams.get('state');
r = await get(`/api/health/callback?state=${'a'.repeat(32)}&code=good`); ok(r.status === 302 && r.headers.get('location').includes('health=error'), 'unknown state rejected');
r = await get(`/api/health/callback?state=${state}&code=good`); const loc = r.headers.get('location');
ok(r.status === 302 && loc.includes('health=ok') && loc.includes('today=4321'), 'callback stores tokens and syncs: ' + loc);
ok(G.lastBody.windowSizeDays === 1 && G.lastBody.range.start.date.day && !G.lastBody.dataSourceFamily, 'dailyRollUp: 1-day windows, all sources');
r = await get(`/api/health/callback?state=${state}&code=good`); ok(r.headers.get('location').includes('health=error'), 'state can be used once');
ok(m.get(`sp/${K.uid}/${today}`).steps === 4321 && m.get(`sp/${K.uid}/${ymd(-1)}`).steps === 9100 && m.get(`sp/${K.uid}/${today}`).src === 'google', 'steps saved for today and yesterday');
[, d] = await call('health/status', {}, K); ok(d.configured && d.connected && d.lastSync > 0 && d.today === 4321, 'status: connected');
// manual higher value is kept; Google catching up wins later
await call('steps/log', { steps: 6000, today }, K);
G.steps[today] = 5000; [s, d] = await call('health/sync', {}, K); ok(s === 200 && m.get(`sp/${K.uid}/${today}`).steps === 6000, 'never lowers a day');
G.steps[today] = 7000; await call('health/sync', {}, K); ok(m.get(`sp/${K.uid}/${today}`).steps === 7000, 'higher Google count replaces it');
// refresh when the access token is old
const rec = m.get(`hc/${K.uid}`); rec.exp = 0; m.set(`hc/${K.uid}`, rec); G.calls.length = 0;
await call('health/sync', {}, K); ok(G.calls.some(c => c.url.includes('/token')) && m.get(`hc/${K.uid}`).access === 'AT2', 'refreshes an expired access token');
// scheduler syncs at most every 30 minutes
G.calls.length = 0; await runScheduler(store, opts); ok(!G.calls.some(c => c.url.includes('dailyRollUp')), 'scheduler skips recently-synced accounts');
const r2 = m.get(`hc/${K.uid}`); r2.lastTry = Date.now() - 31 * 60_000; m.set(`hc/${K.uid}`, r2); G.steps[today] = 8800;
await runScheduler(store, opts); ok(m.get(`sp/${K.uid}/${today}`).steps === 8800, 'scheduler auto-syncs every 30 min');
// expired refresh token (7-day testing limit)
const r3 = m.get(`hc/${K.uid}`); r3.exp = 0; m.set(`hc/${K.uid}`, r3); G.refreshOk = false;
[s, d] = await call('health/sync', {}, K); ok(s === 401 && d.code === 'expired', 'expired sign-in → asks to reconnect');
[, d] = await call('health/status', {}, K); ok(d.error === 'expired', 'status shows expired');
// not linked to Google Health
G.refreshOk = true; G.linked = false;
[s, d] = await call('health/start', {}, H); const st2 = new URL(d.url).searchParams.get('state');
r = await get(`/api/health/callback?state=${st2}&code=good`); ok(r.headers.get('location').includes('health=error') && new URLSearchParams(r.headers.get('location').split('?')[1]).get('msg').includes('Google Health app'), 'account not linked → clear message');
// disconnect revokes
G.calls.length = 0; [s] = await call('health/disconnect', {}, K); ok(s === 200 && !m.has(`hc/${K.uid}`) && G.calls.some(c => c.url.startsWith('https://oauth2.googleapis.com/revoke')), 'disconnect revokes Google access');
