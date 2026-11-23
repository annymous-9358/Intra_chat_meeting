'use strict';
/* Intra Chat client — long-polling chat with per-group access, replies, seen ticks, GIFs, voice notes and location groups. */

const $ = id => document.getElementById(id);
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: k => { try { localStorage.removeItem(k); } catch {} },
  json: (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
  setJson: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const ICON = {
  reply: '<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v3"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
};
const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const finePointer = matchMedia('(pointer: fine)').matches;
const wide = () => matchMedia('(min-width: 768px)').matches;

// A random per-device secret: proves "this is the same device" for group-admin rights and location requests
function deviceSecret() {
  let s = store.get('ic-device');
  if (!s || !/^[a-f0-9]{32}$/.test(s)) {
    s = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
    store.set('ic-device', s);
  }
  return s;
}

// The signed-in account (filled in after sign-in) and this browser's device id
const me = { uid: null, username: '', name: '', token: store.get('ic-token') || '', device: deviceSecret() };
for (const k of ['ic-pw', 'ic-keys', 'ic-name']) store.del(k);   // from before accounts existed
const isMine = m => !!m && (m.uid ? m.uid === me.uid : m.name === me.name);
const lastRead = store.json('ic-read', {});          // room -> newest message key seen, for unread dots
let rooms = [], current = null;
let since = '', version = '', seen = new Set(), pending = new Map(), replyTo = null;
let receipts = [], acked = { delivered: '', read: '' }, openReceipts = new Set();
let ctrl = null, pollTimer = null, polling = false, session = 0, failures = 0, lastTyping = 0;
let group = null;                                    // info about the current group (null for #general)
let lastRendered = null, unseenBelow = 0, presenceCache = [], roomsTimer = null;
let xsince = 0, edits = {}, pushActive = false, muteChangedAt = 0, pollNow = false;
const mutes = store.json('ic-mutes', {});   // room -> muted until (ms)
const isMuted = room => (mutes[room] || 0) > Date.now();

/* ---------------- API ---------------- */
async function api(route, body = {}, signal) {
  const room = body.room || current || 'general';
  const r = await fetch('/api/' + route, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'X-Chat-Device': me.device, ...(me.token ? { Authorization: 'Bearer ' + me.token } : {}) },
    body: JSON.stringify({ room, ...body }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(data.error || `Something went wrong (${r.status})`); e.status = r.status; e.code = data.code; e.field = data.field; e.data = data;
    if (data.code === 'auth' && !route.startsWith('auth/')) sessionExpired();
    throw e;
  }
  return data;
}
async function upload(file) {
  const r = await fetch('/api/upload', { method: 'POST', body: file, headers: {
    'Content-Type': file.type || 'application/octet-stream', 'X-Chat-Device': me.device, 'X-Chat-Room': current,
    Authorization: 'Bearer ' + me.token } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Upload failed');
  return d.url;
}
const markRead = (room, key) => { if (key && key > (lastRead[room] || '')) { lastRead[room] = key; store.setJson('ic-read', lastRead); } };

/* ---------------- Toasts & popups (no browser alert/confirm/prompt) ---------------- */
let toastTimer;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}
/**
 * Custom popup. Resolves with true (confirm), the entered text (input), or null when cancelled.
 * onConfirm(value) may return an error string to keep the popup open and show it inline.
 */
function popup({ icon = '', title, text = '', input = null, ok = 'OK', cancel = 'Cancel', danger = false, onConfirm = null, choices = null, extra = null }) {
  return new Promise(resolve => {
    const dlg = $('modal'), field = $('modalField'), inp = $('modalInput'), eye = $('modalEye');
    $('modalIcon').textContent = icon; $('modalIcon').classList.toggle('danger', danger);
    $('modalTitle').textContent = title; $('modalText').textContent = text; $('modalText').classList.toggle('hidden', !text);
    $('modalErr').textContent = '';
    $('modalOk').textContent = ok; $('modalOk').className = 'btn ' + (danger ? 'danger' : 'primary'); $('modalOk').disabled = false;
    $('modalCancel').textContent = cancel; $('modalCancel').classList.toggle('hidden', !cancel);
    dlg.querySelector('.modal-actions').classList.toggle('single', !cancel);
    field.classList.toggle('hidden', !input);
    if (input) {
      inp.type = input.type || 'text'; inp.value = input.value || ''; inp.placeholder = input.placeholder || '';
      inp.maxLength = input.maxLength || 140; inp.autocomplete = input.type === 'password' ? 'current-password' : 'off';
      eye.classList.toggle('hidden', input.type !== 'password'); eye.textContent = 'Show';
    }
    let done = false;
    const finish = v => { if (done) return; done = true; dlg.close(); resolve(v); };
    // Optional list of choices (resolves with the chosen value) and extra secondary buttons
    let box = $('modalChoices');
    if (!box) { box = document.createElement('div'); box.id = 'modalChoices'; box.className = 'modal-choices'; $('modalErr').after(box); }
    let ex = $('modalExtra');
    if (!ex) { ex = document.createElement('div'); ex.id = 'modalExtra'; ex.className = 'modal-extra'; dlg.querySelector('.modal-actions').after(ex); }
    box.innerHTML = ''; ex.innerHTML = '';
    for (const c of choices || []) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ' + (c.cls || ''); b.textContent = c.label; b.onclick = () => finish(c.value); box.append(b); }
    for (const x of extra || []) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ' + (x.cls || 'ghost'); b.textContent = x.label; b.onclick = () => { finish(null); x.onClick(); }; ex.append(b); }
    $('modalOk').classList.toggle('hidden', !ok);
    dlg.querySelector('.modal-actions').classList.toggle('single', !cancel || !ok);
    $('modalForm').onsubmit = async e => {
      e.preventDefault();
      const value = input ? inp.value.trim() : true;
      if (input?.required && !value) { $('modalErr').textContent = input.requiredMsg || 'Please fill this in'; inp.focus(); return; }
      if (onConfirm) {
        $('modalOk').disabled = true; $('modalErr').textContent = '';
        const err = await onConfirm(value).catch(x => x.message);
        $('modalOk').disabled = false;
        if (err) { $('modalErr').textContent = err; if (input) { inp.select(); inp.focus(); } return; }
      }
      finish(value);
    };
    $('modalCancel').onclick = () => finish(null);
    dlg.oncancel = e => { e.preventDefault(); finish(null); };
    dlg.onclick = e => { if (e.target === dlg) finish(null); };     // tap the backdrop to dismiss
    dlg.showModal();
    if (input) setTimeout(() => inp.focus(), 50); else $('modalOk').focus();
  });
}
for (const btn of document.querySelectorAll('.pw-eye')) btn.onclick = () => {
  const inp = btn.parentElement.querySelector('input'), show = inp.type === 'password';
  inp.type = show ? 'text' : 'password'; btn.textContent = show ? 'Hide' : 'Show';
  btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
};

/* ---------------- Helpers ---------------- */
const slug = s => s.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
function hue(str) { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function initials(s) { const p = s.replace(/^#/, '').replace(/[-_]/g, ' ').trim().split(/\s+/); return ((p[0]?.[0] || '?') + (p[1]?.[0] || '')).toUpperCase(); }
const okPhoto = u => typeof u === 'string' && /^\/api\/file\/[a-f0-9]{24}$/.test(u) ? u : null;
function paintAvatar(el, label, { geo, locked, photo } = {}) {
  label = label || '?'; photo = okPhoto(photo);
  el.textContent = photo ? '' : initials(label);
  el.style.background = photo ? `center / cover no-repeat url("${photo}"), hsl(${hue(label)} 55% 48%)` : `hsl(${hue(label)} 55% 48%)`;
  el.classList.toggle('has-photo', !!photo);
  el.classList.toggle('geo', !!geo); el.classList.toggle('locked', !!locked);
}
const nameColor = n => `hsl(${hue(n)} 60% var(--name-l, 42%))`;
function fmtDist(m) { if (m == null) return '?'; return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`; }
function fmtDur(s) { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function dayLabel(ts) {
  const d = new Date(ts), today = new Date(), y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}
const timeLabel = ts => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
function listTime(ts) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return timeLabel(ts);
  if (now - d < 6 * 864e5) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}
const roomInfo = r => rooms.find(x => x.room === r) || { room: r };
const roomTitle = r => roomInfo(r).title || '#' + r;
const RANGES = [50, 100, 150, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000, 15000, 20000, 30000, 50000];
const sliderToRadius = v => RANGES[Math.min(Math.max(Math.round(v), 0), RANGES.length - 1)];
const radiusToSlider = r => RANGES.reduce((best, x, i) => Math.abs(x - r) < Math.abs(RANGES[best] - r) ? i : best, 0);
const inviteLink = room => `${location.origin}${location.pathname}#/g/${encodeURIComponent(room)}`;
const linkedRoom = () => { const m = location.hash.match(/^#\/g\/([a-z0-9_-]{1,30})(\?.*)?$/i); return m ? m[1].toLowerCase() : null; };
// What a link / notification button asks for: open a group and then talk, reply or play a message
function linkIntent() {
  const h = location.hash;
  if (h === '#/walkie') return { room: store.get('ic-room') || 'general', act: 'walkie' };
  if (h === '#/new') return { act: 'new' };
  if (h === '#/friends') return { act: 'friends' };
  const room = linkedRoom(); if (!room) return null;
  const q = new URLSearchParams(h.split('?')[1] || '');
  return { room, act: q.get('a') || 'open', key: q.get('k') || null };
}
let pendingIntent = null;
function runIntent(intent) {
  if (!intent) return;
  if (intent.act === 'new') { history.replaceState(null, '', location.pathname); return openNewGroup(); }
  if (intent.act === 'friends') { history.replaceState(null, '', location.pathname); return setTab('friends'); }
  pendingIntent = intent.act === 'open' ? null : intent;
  if (intent.room !== current) openRoom(intent.room); else applyIntent();
}
// Runs once the group's messages are on screen
function applyIntent() {
  const it = pendingIntent; if (!it || it.room !== current) return;
  pendingIntent = null;
  history.replaceState(null, '', `#/g/${current}`);
  const el = it.key && [...$('messages').children].find(x => x.dataset.key === it.key);
  if (it.act === 'walkie' || it.act === 'talk') {
    if (!walkie.on) openWalkie();
    if (el && it.act === 'talk') startReply(el, { focus: false });
    toast(el && it.act === 'talk' ? `Hold the button to reply to ${el._msg?.name}` : '📻 Walkie-talkie on — hold the button to talk');
  } else if (el && it.act === 'reply') startReply(el);
  else if (el && (it.act === 'play' || it.act === 'show')) {
    el.scrollIntoView({ block: 'center' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    if (it.act === 'play') el.querySelector('.voice .play')?.click();
  } else if (it.act === 'show') toast('That message is too old to show');
}

/* ---------------- Sign in / create account ---------------- */
let authMode = 'login';
function setAuthMode(mode) {
  authMode = mode;
  const signup = mode === 'signup';
  $('tabLogin').classList.toggle('on', !signup); $('tabLogin').setAttribute('aria-selected', String(!signup));
  $('tabSignup').classList.toggle('on', signup); $('tabSignup').setAttribute('aria-selected', String(signup));
  document.querySelectorAll('.signup-only').forEach(n => n.classList.toggle('hidden', !signup));
  $('password').autocomplete = signup ? 'new-password' : 'current-password';
  $('password').placeholder = signup ? 'At least 6 characters' : 'Your password';
  $('loginBtn').textContent = signup ? 'Create account' : 'Sign in';
  const inv = linkedRoom();
  $('welcomeTitle').textContent = inv ? 'You’re invited to a group' : signup ? 'Create your account' : 'Welcome back';
  $('welcomeText').textContent = inv ? (signup ? 'Create an account and you’ll go straight into the chat.' : 'Sign in and you’ll go straight into the chat.')
    : signup ? 'Pick a username and the name people will see.' : 'Sign in to your Intra Chat account.';
  $('authSwitch').innerHTML = '';
  const b = document.createElement('button'); b.type = 'button'; b.className = 'link-btn'; b.textContent = signup ? 'Sign in' : 'Create an account';
  b.onclick = () => setAuthMode(signup ? 'login' : 'signup');
  $('authSwitch').append(signup ? 'Already have an account? ' : 'New here? ', b);
  $('err').textContent = '';
}
$('tabLogin').onclick = () => setAuthMode('login');
$('tabSignup').onclick = () => setAuthMode('signup');
$('switchToSignup').onclick = () => setAuthMode('signup');
$('username').addEventListener('input', () => { const v = $('username').value, c = v.toLowerCase().replace(/^@/, '').replace(/\s/g, ''); if (c !== v) $('username').value = c; });
$('loginForm').onsubmit = async e => {
  e.preventDefault();
  const username = $('username').value.trim(), password = $('password').value, name = $('name').value.trim();
  const fail = (msg, field) => { $('err').textContent = msg; if (field) $(field).focus(); };
  if (!username) return fail('Enter your username', 'username');
  if (authMode === 'signup' && !name) return fail('Enter the name people will see', 'name');
  if (!password) return fail('Enter your password', 'password');
  $('loginBtn').disabled = true; $('err').textContent = '';
  try {
    const d = await api('auth/' + authMode, { username, password, name });
    me.token = d.token; store.set('ic-token', d.token);
    Object.assign(me, d.user); store.set('ic-user', JSON.stringify(d.user));
    $('password').value = '';
    enterApp();
    if (authMode === 'signup') toast(`Welcome, ${d.user.name}! 👋`);
  } catch (err) { fail(err.message, { username: 'username', name: 'name', password: 'password' }[err.field]); }
  finally { $('loginBtn').disabled = false; }
};
function showLogin(msg) {
  leaveRoom(); clearInterval(roomsTimer);
  $('app').classList.add('hidden'); $('app').classList.remove('in-chat', 'has-room', 'info-open');
  $('login').classList.remove('hidden'); setAuthMode('login');
  if (me.username) $('username').value = me.username;
  if (msg) $('err').textContent = msg;
  setTimeout(() => ($('username').value ? $('password') : $('username')).focus(), 50);
}
let expiredShown = false;
function sessionExpired() {
  if (expiredShown) return; expiredShown = true;
  me.token = ''; store.del('ic-token');
  showLogin('Your session ended — please sign in again.');
}
function enterApp() {
  expiredShown = false;
  $('login').classList.add('hidden'); $('app').classList.remove('hidden');
  paintMe();
  refreshRooms().then(() => {
    const intent = linkIntent();
    if (intent) return runIntent(intent);
    const target = wide() ? (rooms.some(r => r.room === store.get('ic-room')) ? store.get('ic-room') : 'general') : null;
    if (target) openRoom(target);
  });
  clearInterval(roomsTimer);
  roomsTimer = setInterval(() => { if (document.hidden) return; if (!current) refreshRooms(); loadFriends(); }, 15000);
  setupServiceWorker(); updateNotifBanner(); loadFriends(); renderSettings();
}
// Which messages we've read per chat → the server answers with unread counts for the list
function readsPayload() {
  const out = {};
  for (const r of rooms) {
    if (lastRead[r.room]) out[r.room] = lastRead[r.room];
    else if (r.dm) out[r.room] = '';            // a 1:1 chat you've never opened: everything is unread
  }
  return out;
}
let lastCountsAt = 0;
async function refreshRooms() {
  try { setRooms((await api('rooms', { room: current || 'general', reads: readsPayload() })).rooms); lastCountsAt = Date.now(); }
  catch { if (!rooms.length) setRooms([{ room: 'general' }]); }
}
function setRooms(list) {
  if (!list) return;
  // poll responses without counts keep the last known counts
  for (const r of list) if (r.unread === undefined) { const old = rooms.find(x => x.room === r.room); if (old?.unread !== undefined) r.unread = old.unread; }
  if (JSON.stringify(list) === JSON.stringify(rooms)) return;
  rooms = list; renderRooms();
}

// Profile & settings live in the Settings tab
$('meBtn').onclick = () => setTab('settings');
async function editName() {
  const name = await popup({ icon: '🙂', title: 'Your name', text: 'This is the name people see on your messages.', ok: 'Save',
    input: { value: me.name, maxLength: 24, required: true, requiredMsg: 'Your name can’t be empty' },
    onConfirm: async v => { if (v === me.name) return null; try { const d = await api('auth/update', { name: v }); Object.assign(me, d.user); store.set('ic-user', JSON.stringify(d.user)); return null; } catch (e) { return e.message; } } });
  if (name === null) return;
  paintMe(); renderSettings();
  toast('Name saved');
}
async function changePassword() {
  let current = null;
  const ok1 = await popup({ icon: '🔑', title: 'Change password', text: 'First, enter your current password.', ok: 'Next',
    input: { type: 'password', placeholder: 'Current password', maxLength: 128, required: true, requiredMsg: 'Enter your current password' },
    onConfirm: async v => { current = v; return null; } });
  if (ok1 === null) return;
  const ok2 = await popup({ icon: '🔑', title: 'New password', text: 'At least 6 characters.', ok: 'Change password',
    input: { type: 'password', placeholder: 'New password', maxLength: 128, required: true, requiredMsg: 'Enter a new password' },
    onConfirm: async v => { if (v.length < 6) return 'Use at least 6 characters'; try { await api('auth/update', { password: current, newPassword: v }); return null; } catch (e) { return e.message; } } });
  if (ok2 !== null) toast('Password changed');
}
async function signOut() {
  const yes = await popup({ icon: '👋', title: 'Sign out?', text: 'You can sign in again on any device with your username and password.', ok: 'Sign out', danger: true });
  if (!yes) return;
  await disableNotifications(true);
  try { await api('auth/logout'); } catch {}
  me.token = ''; store.del('ic-token'); store.del('ic-user');
  history.replaceState(null, '', location.pathname);
  setTab('chats'); showLogin();
}

/* ---------------- Chat list ---------------- */
let roomFilter = 'all';
function renderRooms() {
  const q = $('roomSearch').value.trim().toLowerCase();
  const list = $('roomList'); list.innerHTML = '';
  const shown = rooms.filter(r => (!q || r.room.includes(q) || (r.title || '').toLowerCase().includes(q) || (r.peer?.username || '').includes(q))
    && (roomFilter === 'all' || (roomFilter === 'unread' && unreadCount(r)) || (roomFilter === 'dm' && r.dm) || (roomFilter === 'groups' && !r.dm)));
  for (const r of shown) {
    const n = unreadCount(r);
    const li = document.createElement('li');
    li.className = (r.room === current ? 'active ' : '') + (n ? 'unread' : '');
    const b = document.createElement('button');
    const av = document.createElement('div'); av.className = 'avatar'; paintAvatar(av, r.title || r.room, { ...r, photo: r.dm ? r.peer?.photo : r.photo });
    const meta = document.createElement('div'); meta.className = 'room-meta';
    const top = document.createElement('div'); top.className = 'room-top';
    const t = document.createElement('b'); t.textContent = r.title || '#' + r.room;
    top.append(t);
    if (r.last?.ts) { const tm = document.createElement('span'); tm.className = 'room-time'; tm.textContent = listTime(r.last.ts); top.append(tm); }
    const bottom = document.createElement('div'); bottom.className = 'room-bottom';
    const sub = document.createElement('small');
    if (r.last?.text) sub.textContent = (isMine(r.last) ? (r.dm ? '' : 'You: ') : r.dm ? '' : r.last.name + ': ') + r.last.text;
    else if (r.dm) sub.textContent = r.peer?.status ? `${r.peer.status.emoji} ${r.peer.status.text}`.trim() : `@${r.peer?.username || ''} · say hi 👋`;
    else if (r.locked && !r.access) sub.textContent = '🔒 Private group · tap to enter password';
    else if (r.geo) sub.textContent = `📍 Location group · ${fmtDist(r.radius)} range`;
    else sub.textContent = r.room === 'general' ? 'Everyone' : 'No messages yet';
    bottom.append(sub);
    if (isMuted(r.room)) { const mu = document.createElement('span'); mu.className = 'room-mute'; mu.textContent = '🔕'; mu.title = 'Muted'; bottom.append(mu); }
    if (n) { const dot = document.createElement('span'); dot.className = 'unread-dot'; dot.textContent = n === true ? '' : n > 99 ? '99+' : n; dot.setAttribute('aria-label', 'Unread'); bottom.append(dot); }
    meta.append(top, bottom); b.append(av, meta);
    b.onclick = () => openRoom(r.room);
    li.append(b); list.append(li);
  }
  if (!shown.length) {
    const li = document.createElement('li'); li.className = 'room-empty';
    li.textContent = q ? `No chats match “${q}”.` : roomFilter === 'unread' ? 'No unread chats 🎉' : roomFilter === 'dm' ? 'No friend chats yet — add a friend in the Friends tab.' : 'No chats yet — tap ＋ to start one.';
    list.append(li);
  }
  const unreadChats = rooms.filter(r => unreadCount(r)).length;
  document.title = unreadChats ? `(${unreadChats}) Intra Chat` : 'Intra Chat';
  $('navChatsBadge').textContent = unreadChats; $('navChatsBadge').classList.toggle('hidden', !unreadChats);
  try { if (navigator.setAppBadge) unreadChats ? navigator.setAppBadge(unreadChats) : navigator.clearAppBadge(); } catch {}
}
for (const c of document.querySelectorAll('#filterChips .chip-btn')) c.onclick = () => {
  roomFilter = c.dataset.filter;
  document.querySelectorAll('#filterChips .chip-btn').forEach(x => x.classList.toggle('on', x === c));
  renderRooms();
};
// Unread count for a chat: the server's count when we have it, else a dot (true) from the newest message
function unreadCount(r) {
  if (r.room === current || !r.last?.key || isMine(r.last)) return 0;
  if (r.locked && !r.access) return 0;
  if (!(r.last.key > (lastRead[r.room] || ''))) return 0;
  return typeof r.unread === 'number' && r.unread > 0 ? r.unread : true;
}
$('roomSearch').oninput = renderRooms;
const isUnread = r => !!unreadCount(r);

/* ---------------- Opening / leaving a room ---------------- */
async function openRoom(room, force) {
  if (!force && current === room && $('app').classList.contains('in-chat')) return;
  const info = roomInfo(room);
  // Private group we haven't joined yet: ask for its password first
  if (info.locked && info.access === false) { if (!(await askPassword(room))) { if (linkedRoom() === room) history.replaceState(null, '', location.pathname); return; } }
  leaveRoom();
  current = room; store.set('ic-room', room);
  if (!pendingIntent && location.hash !== `#/g/${room}`) history.replaceState(null, '', `#/g/${room}`);
  session++; since = ''; version = ''; seen = new Set(); pending = new Map(); receipts = [];
  acked = { delivered: '', read: '' }; openReceipts = new Set(); group = null; lastRendered = null; unseenBelow = 0; xsince = 0; edits = {};
  cancelReply(); closeGifs(); updateToBottom();
  $('messages').innerHTML = '';
  text.value = drafts[room] || ''; autosize(); syncButtons();   // restore any unsent draft for this group
  $('app').classList.add('in-chat', 'has-room');
  $('chatBar').classList.remove('hidden'); $('composerWrap').classList.remove('hidden');
  $('chatTitle').textContent = roomTitle(room); $('chatSub').textContent = info.dm ? lastSeenText(info.peer?.lastSeen) : 'tap here for info';
  $('messages').classList.toggle('dm', !!info.dm); applyWallpaper(room); closeEmoji();
  paintAvatar($('chatAvatar'), info.title || room, { ...info, photo: info.dm ? info.peer?.photo : info.photo });
  setPins([]); closeMention();
  renderRooms(); updateComposerLock(); renderAdminBanner();
  if (info.geo) startLocation();
  tellSW(); swPost({ type: 'read', room });
  poll(session);
  if (walkieListening()) startBackgroundAudio();         // walkie-talkie auto-play stays alive in the background
  if (finePointer) $('text').focus();
}
function leaveRoom() {
  session++; clearTimeout(pollTimer); ctrl?.abort(); polling = false;
  stopLocation(); stopAllAudio(); closeWalkie(); stopBackgroundAudio(); groupMap.destroy();
  if (current) markRead(current, since);
  current = null; group = null; tellSW();
}
$('backBtn').onclick = () => {
  leaveRoom(); history.replaceState(null, '', location.pathname);
  $('app').classList.remove('in-chat', 'info-open'); renderRooms(); refreshRooms();
};
window.addEventListener('hashchange', () => { if ($('app').classList.contains('hidden')) return; const it = linkIntent(); if (it && (it.act !== 'open' || it.room !== current)) runIntent(it); });

async function askPassword(room, again) {
  const title = roomTitle(room);
  const ok = await popup({
    icon: '🔒', title: again ? 'Password changed' : `Join “${title}”`,
    text: again ? `The password for “${title}” was changed. Enter the new one to keep chatting.` : 'This is a private group. Enter its password — ask the person who invited you.',
    input: { type: 'password', placeholder: 'Group password', maxLength: 64, required: true, requiredMsg: 'Enter the group password' },
    ok: 'Join',
    onConfirm: async pw => {
      try { await api('group/join', { room, password: pw }); const r = roomInfo(room); r.access = true; return null; }
      catch (e) { return e.message; }
    },
  });
  return ok !== null;
}

/* ---------------- Long-poll loop ---------------- */
async function poll(mySession) {
  if (polling || mySession !== session) return;
  polling = true;
  ctrl = new AbortController();
  const myCtrl = ctrl;
  const wait = version && !pollNow ? 7000 : 0;    // first request returns at once; after that, wait for changes
  pollNow = false;
  const pollStart = Date.now();
  const watchdog = setTimeout(() => myCtrl.abort(), wait + 15000);
  try {
    const ack = {};
    if (since && since > acked.delivered) ack.delivered = since;
    if (since && !document.hidden && since > acked.read) ack.read = since;
    const wantCounts = Date.now() - lastCountsAt > 20000;
    const d = await api('poll', { since, version, wait, ack, loc: geo.loc, xsince, walkie: walkieListening(), tsince: walkie.tsince ? walkie.tsince - 5000 : 0, ...(wantCounts ? { reads: readsPayload() } : {}) }, myCtrl.signal);
    if (wantCounts) lastCountsAt = Date.now();
    if (mySession !== session) return;
    if (ack.delivered) acked.delivered = ack.delivered;
    if (ack.read) { acked.read = ack.read; markRead(current, ack.read); }
    failures = 0; $('netBanner').classList.add('hidden');
    const first = !since, wasNear = nearBottom();
    version = d.version || '';
    const fresh = d.messages.filter(m => !seen.has(m.key));
    for (const m of fresh) { addMessage(m); if (!first) notify(m); }
    if (fresh.length) {
      if (first || wasNear) scrollDown(true);
      else { unseenBelow += fresh.filter(m => !isMine(m)).length; updateToBottom(); }
    }
    if (d.edits) { for (const [k, e] of Object.entries(d.edits)) { edits[k] = e; applyEdit(k); } }
    if (first && pendingIntent) setTimeout(applyIntent, 0);
    if (d.xt) xsince = d.xt;
    if (d.talk) onTalk(d.talk, d.xt);
    // (ignore a mute state from a request that started before we changed it ourselves)
    if (typeof d.muteUntil === 'number' && pollStart > muteChangedAt && (mutes[current] || 0) !== d.muteUntil) { if (d.muteUntil) mutes[current] = d.muteUntil; else delete mutes[current]; store.setJson('ic-mutes', mutes); }
    setRooms(d.rooms);
    if (d.pins) setPins(d.pins);
    receipts = d.receipts || [];
    setGroup(d.group);
    renderPresence(d.users || []);
    updateTicks();
  } catch (err) {
    if (mySession !== session || err.name === 'AbortError') return;
    if (err.code === 'locked') {
      // Password was changed (or we never had a valid key): ask again
      const room = current; roomInfo(room).access = false;
      leaveRoom();
      if (await askPassword(room, true)) openRoom(room, true); else $('backBtn').click();
      return;
    }
    failures++;
    if (failures > 1) { $('netBanner').classList.remove('hidden'); $('chatSub').textContent = 'reconnecting…'; }
  } finally {
    clearTimeout(watchdog);
    if (ctrl === myCtrl) polling = false;
    if (mySession === session) {
      clearTimeout(pollTimer);
      const delay = failures ? Math.min(1000 * 2 ** failures, 15000) : (document.hidden && !walkieListening() ? 3000 : 0);
      // Re-poll straight away without a timer: browsers slow timers down in background tabs
      if (delay === 0) Promise.resolve().then(() => poll(mySession));
      else pollTimer = setTimeout(() => poll(mySession), delay);
    }
  }
}
function repoll() { if (!current) return; if (polling) ctrl?.abort(); else poll(session); }
document.addEventListener('visibilitychange', () => { tellSW(); if (!document.hidden && current) { repoll(); swPost({ type: 'read', room: current }); } });
window.addEventListener('online', repoll);

function renderPresence(users) {
  const others = users.filter(u => u.uid !== me.uid);
  const typing = others.filter(u => u.typing).map(u => u.name);
  $('typing').textContent = typing.length ? `${typing.join(', ')} ${typing.length > 1 ? 'are' : 'is'} typing…` : '';
  let sub;
  if (group?.dm) {
    const peerOnline = others.some(u => u.uid === group.peer?.uid);
    sub = typing.length ? 'typing…' : peerOnline ? 'online' : lastSeenText(group.peer?.lastSeen);
    $('typing').textContent = '';
  } else {
    sub = typing.length ? `${typing.join(', ')} typing…` : users.length > 1 ? `${users.length} online` : 'tap here for group info';
    if (group?.geo) sub += ` · 📍 ${fmtDist(group.radius)}`;
    if (group?.locked) sub += ' · 🔒';
  }
  $('chatSub').textContent = sub;
  if ($('app').classList.contains('info-open') && users.some(u => !(membersCache.list || []).some(m => m.uid === u.uid))) loadMembers();   // someone new joined
  presenceCache = users;
  renderWalkie();
  if ($('app').classList.contains('info-open')) renderInfo();
}

/* ---------------- Messages ---------------- */
function addMessage(m) {
  seen.add(m.key);
  if (m.key > since) since = m.key;
  const el = m.cid && pending.get(m.cid);
  if (el) { pending.delete(m.cid); confirmPending(el, m); return; }
  render(m);
}
function confirmPending(el, m) {
  el.classList.remove('pending'); el._msg = m; el.dataset.key = m.key; applyEdit(m.key);
  seen.add(m.key); if (m.key > since) since = m.key;
  updateTicks();
}

function render(m, isPending) {
  const box = $('messages');
  const day = new Date(m.ts).toDateString();
  if (!lastRendered || lastRendered.day !== day) {
    const sep = document.createElement('div'); sep.className = 'day'; sep.textContent = dayLabel(m.ts); box.append(sep);
    lastRendered = null;
  }
  const mine = isMine(m), who = m.uid || m.name;
  const cont = lastRendered && lastRendered.who === who && m.ts - lastRendered.ts < 5 * 60_000;
  lastRendered = { who, ts: m.ts, day };

  const el = document.createElement('div');
  el.className = 'msg' + (mine ? ' mine' : '') + (cont ? ' cont' : '') + (isPending ? ' pending' : '');
  el._msg = m; if (m.key) el.dataset.key = m.key;
  if (!mine) {
    const av = document.createElement('div'); av.className = 'avatar m-avatar'; paintUser(av, m.uid, m.name); av.setAttribute('aria-hidden', 'true');
    const nm = document.createElement('span'); nm.className = 'who'; nm.textContent = m.name; nm.style.color = nameColor(m.name); el.append(av, nm);
    if (m.uid) { av.onclick = nm.onclick = e => { e.stopPropagation(); showProfile(m.uid); }; }
  }
  if (m.replyTo) {
    const q = quoteEl(m.replyTo); q.title = 'Go to message';
    q.onclick = e => { e.stopPropagation(); jumpTo(m.replyTo.key); };
    el.append(q);
  }
  if (m.gif) {
    const img = document.createElement('img');
    img.className = 'gif'; img.src = m.localUrl || m.gif.url; img.alt = m.gif.title || 'GIF'; img.loading = 'lazy';
    if (m.gif.w && m.gif.h) { img.width = m.gif.w; img.height = m.gif.h; }
    img.onclick = () => { $('viewer').querySelector('img').src = img.src; $('viewer').classList.remove('hidden'); };
    img.onload = () => { if (nearBottom(600)) scrollDown(true); };
    el.append(img);
  }
  if (m.audio) {
    el.append(voicePlayer(m.audio, m.localUrl));
    if (!mine && !isPending) {          // 🎙 hold here to answer with a voice message that quotes this one
      const q = document.createElement('button'); q.type = 'button'; q.className = 'quick-reply';
      q.innerHTML = '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg><span>Hold to reply</span>';
      q.setAttribute('aria-label', `Hold to reply to ${m.name} with a voice message`);
      bindHoldToRecord(q, () => startReply(el, { focus: false }));
      el.append(q);
    }
  }
  if (m.deleted) { el.classList.add('deleted'); const body = document.createElement('span'); body.className = 'body'; body.textContent = '🚫 This message was deleted'; el.append(body); }
  else if (m.text) { const body = document.createElement('span'); body.className = 'body'; body.append(fmtText(m.text)); el.append(body); }
  if (!mine && m.mentions?.includes(me.uid)) el.classList.add('mentions-me');
  if (!m.text && !m.deleted) el.classList.add('media-only');

  const foot = document.createElement('span'); foot.className = 'foot';
  if (m.scheduled) foot.append(Object.assign(document.createElement('span'), { className: 'f-tag', textContent: '⏰', title: 'Scheduled message' }));
  if (m.edited) foot.append(Object.assign(document.createElement('span'), { className: 'f-tag edited', textContent: 'edited' }));
  foot.append(timeLabel(m.ts));
  if (mine) {
    const t = document.createElement('span'); t.className = 'ticks clock'; t.textContent = '🕓'; t.title = 'Sending…';
    t.onclick = e => { e.stopPropagation(); const k = el.dataset.key; if (!k) return; openReceipts.has(k) ? openReceipts.delete(k) : openReceipts.add(k); updateTicks(); };
    foot.append(t);
  }
  el.append(foot);

  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'reply-btn'; btn.innerHTML = ICON.reply; btn.title = 'Reply'; btn.setAttribute('aria-label', 'Reply');
  btn.onclick = e => { e.stopPropagation(); startReply(el); };
  const icon = document.createElement('div'); icon.className = 'swipe-icon'; icon.innerHTML = ICON.reply;
  const more = document.createElement('button');
  more.type = 'button'; more.className = 'msg-btn'; more.textContent = '😊'; more.title = 'React and more'; more.setAttribute('aria-label', 'Message actions');
  more.onclick = e => { e.stopPropagation(); openMsgMenu(el); };
  el.append(btn, more, icon);
  el.addEventListener('dblclick', e => { if (!e.target.closest('img, .voice, .reacts') && !window.getSelection().toString()) startReply(el); });
  el.addEventListener('contextmenu', e => { if (e.target.closest('img')) return; e.preventDefault(); openMsgMenu(el); });
  addSwipe(el, icon); addLongPress(el);
  box.append(el);
  if (m.key) applyEdit(m.key);
  return el;
}
const nearBottom = (px = 160) => { const b = $('messages'); return b.scrollHeight - b.scrollTop - b.clientHeight < px; };
function scrollDown(force) { const b = $('messages'); if (force || nearBottom()) b.scrollTop = b.scrollHeight; unseenBelow = 0; updateToBottom(); }
function updateToBottom() {
  const show = current && !nearBottom(300);
  $('toBottom').classList.toggle('hidden', !show);
  $('toBottomCount').textContent = unseenBelow; $('toBottomCount').classList.toggle('hidden', !unseenBelow);
}
$('messages').addEventListener('scroll', () => { if (nearBottom()) unseenBelow = 0; updateToBottom(); }, { passive: true });
$('toBottom').onclick = () => { const b = $('messages'); b.scrollTo({ top: b.scrollHeight, behavior: 'smooth' }); unseenBelow = 0; updateToBottom(); };

function quoteEl(r) {
  const q = document.createElement('div'); q.className = 'quote';
  const n = document.createElement('b'); n.textContent = isMine(r) ? 'You' : r.name;
  q.append(n, r.text);
  return q;
}
function jumpTo(key) {
  const target = [...$('messages').children].find(x => x.dataset.key === key);
  if (!target) return toast('That message is too old to show');
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.remove('flash'); void target.offsetWidth; target.classList.add('flash');
}
const previewText = m => m.text || (m.audio ? `${m.audio.walkie ? '📻 Walkie-talkie' : '🎤 Voice message'} (${fmtDur(m.audio.dur)})` : m.gif ? '🎞️ GIF' : '');

function notify(m) {
  if (isMine(m) || !document.hidden || pushActive) return;   // push notifications take over when enabled
  const title = isMine(m.replyTo) ? `${m.name} replied to you` : `${m.name} · ${roomTitle(m.room)}`;
  if ('Notification' in window && Notification.permission === 'granted') {
    const n = new Notification(title, { body: previewText(m), tag: m.room });
    n.onclick = () => { window.focus(); n.close(); };
  }
}

/* ---------------- Seen ticks ---------------- */
function updateTicks() {
  const others = receipts.filter(r => r.uid !== me.uid);
  const mine = [...$('messages').children].filter(el => el.classList.contains('mine'));
  const lastKey = mine.filter(el => el.dataset.key).pop()?.dataset.key;
  for (const el of mine) {
    const t = el.querySelector('.ticks'), key = el.dataset.key;
    let line = el.querySelector('.seenby');
    if (!key || !t) continue;
    const readers = others.filter(r => r.read >= key).map(r => r.name);
    const delivered = others.filter(r => r.delivered >= key && !(r.read >= key)).map(r => r.name);
    t.classList.remove('clock');
    t.classList.toggle('seen', readers.length > 0);
    t.textContent = readers.length || delivered.length ? '✓✓' : '✓';
    t.title = [readers.length && 'Seen by ' + readers.join(', '), delivered.length && 'Delivered to ' + delivered.join(', ')].filter(Boolean).join('\n') || 'Sent';
    const open = openReceipts.has(key);
    if (!(open || (key === lastKey && readers.length))) { line?.remove(); continue; }
    if (!line) { line = document.createElement('div'); line.className = 'seenby'; el.insertBefore(line, el.querySelector('.reply-btn')); }
    line.classList.toggle('open', open);
    line.textContent = open ? t.title.replace('\n', ' · ') : 'Seen by ' + summarize(readers);
  }
}
const summarize = n => n.length <= 3 ? n.join(', ') : `${n.slice(0, 2).join(', ')} +${n.length - 2}`;

/* ---------------- Replies ---------------- */
function startReply(el, { focus = true } = {}) {
  const m = el._msg;
  if (!m?.key || el.classList.contains('deleted')) return;
  if (group?.me && !group.me.canChat) return toast('You can’t reply until you’re allowed to chat here');
  replyTo = { key: m.key, name: m.name, uid: m.uid, text: previewText(m).slice(0, 140) };
  showReplyBar();
  if (navigator.vibrate) navigator.vibrate(15);
  if (focus) $('text').focus();
}
function showReplyBar() {
  $('replyName').textContent = isMine(replyTo) ? 'You' : replyTo.name;
  $('replyText').textContent = replyTo.text;
  $('replyBar').classList.remove('hidden');
  if (walkie.on) renderWalkie();
}
function cancelReply() { replyTo = null; $('replyBar').classList.add('hidden'); if (typeof walkie !== 'undefined' && walkie.on) renderWalkie(); }
$('replyCancel').onclick = () => { cancelReply(); $('text').focus(); };

// Swipe a message sideways (touch) to reply
function addSwipe(el, icon) {
  const TRIGGER = 60, MAX = 90;
  let x0 = 0, y0 = 0, dx = 0, mode = null;
  el.addEventListener('touchstart', e => { const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; dx = 0; mode = null; }, { passive: true });
  el.addEventListener('touchmove', e => {
    const t = e.touches[0], mx = t.clientX - x0, my = t.clientY - y0;
    if (!mode) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      mode = Math.abs(mx) > Math.abs(my) * 1.3 && !e.target.closest('.wave') ? 'swipe' : 'scroll';
      if (mode === 'swipe') el.classList.add('dragging');
    }
    if (mode !== 'swipe') return;
    e.preventDefault();
    dx = Math.max(-MAX, Math.min(MAX, mx));
    el.style.transform = `translateX(${dx}px)`;
    const p = Math.min(Math.abs(dx) / TRIGGER, 1);
    icon.style.opacity = p;
    icon.style.left = dx > 0 ? `${-dx - 4}px` : '';
    icon.style.right = dx < 0 ? `${dx - 4}px` : '';
    icon.style.transform = `scale(${0.6 + 0.4 * p})`;
  }, { passive: false });
  const end = () => {
    if (mode === 'swipe' && Math.abs(dx) >= TRIGGER) startReply(el);
    el.classList.remove('dragging'); el.style.transform = ''; icon.style.opacity = 0; mode = null; dx = 0;
  };
  el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
}

/* ---------------- Sending ---------------- */
const text = $('text');
const drafts = {};
function autosize() { text.style.height = 'auto'; text.style.height = Math.min(text.scrollHeight, 140) + 'px'; }
function syncButtons() { const has = text.value.trim().length > 0; $('sendBtn').classList.toggle('hidden', !has); $('micBtn').classList.toggle('hidden', has); }
text.addEventListener('input', () => {
  autosize(); syncButtons(); if (current) drafts[current] = text.value;
  if (Date.now() - lastTyping < 2000 || !current || !text.value) return;
  lastTyping = Date.now(); api('typing').catch(() => {});
});
text.addEventListener('keydown', e => {
  if (e.key === 'Escape') { cancelReply(); closeGifs(); closeEmoji(); }
  // Enter sends on keyboards; on phones Enter adds a new line (like WhatsApp)
  if (e.key === 'Enter' && !e.shiftKey && finePointer && !e.isComposing) { e.preventDefault(); $('composer').requestSubmit(); }
});
$('composer').onsubmit = e => {
  e.preventDefault();
  const t = text.value.trim(); if (!t) return;
  text.value = ''; delete drafts[current]; autosize(); syncButtons(); closeEmoji();
  sendMessage({ text: t });
  if (!finePointer) text.focus();
};

async function sendMessage({ text: body = '', gif, audio, upload: file, localUrl }) {
  if (group?.me && !group.me.canChat) { toast('You can’t send messages here right now'); return; }
  const cid = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const reply = replyTo; cancelReply();
  const el = render({ uid: me.uid, name: me.name, text: body, gif, audio, localUrl, ts: Date.now(), replyTo: reply || undefined }, true);
  pending.set(cid, el); scrollDown(true);
  try {
    if (file) {
      const url = await upload(file);
      if (gif) gif = { ...gif, url }; if (audio) audio = { ...audio, url };
    }
    const { message } = await api('send', { text: body, gif, audio, cid, replyTo: reply, loc: geo.loc });
    if (pending.has(cid)) { pending.delete(cid); confirmPending(el, message); }
  } catch (err) {
    pending.delete(cid); el.remove();
    if (body && !gif && !audio) { text.value = body; autosize(); syncButtons(); }
    toast(err.code === 'out_of_range' ? err.message : 'Not sent — ' + err.message);
    if (err.code === 'out_of_range' || err.code === 'locked') repoll();
    if (reply) { replyTo = reply; showReplyBar(); }
  }
}

/* ---------------- Voice messages ---------------- */
// Hold the mic to record, slide left to cancel, release to send.
const rec = { state: 'idle', stream: null, recorder: null, chunks: [], start: 0, timer: null, peaks: [], analyser: null, ctx: null, x0: 0, cancel: false, pointer: null };
const MAX_REC_S = 120;
function pickMime() {
  for (const t of ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'])
    if (window.MediaRecorder && MediaRecorder.isTypeSupported?.(t)) return t;
  return '';
}
const mic = $('micBtn');
// Hold-to-record works on any button: the composer mic, and the 🎙 quick-reply button on voice messages.
// beforeStart() runs first (e.g. to set which message we're replying to).
function bindHoldToRecord(btn, beforeStart) {
btn.addEventListener('pointerdown', async e => {
  if (e.button !== 0 || rec.state !== 'idle') return;
  if (group?.me && !group.me.canChat) return toast('You can’t send messages here right now');
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast('Voice messages aren’t supported in this browser');
  e.preventDefault(); e.stopPropagation();
  beforeStart?.();
  btn.setPointerCapture(e.pointerId); rec.btn = btn;
  rec.state = 'starting'; rec.x0 = e.clientX; rec.cancel = false; rec.pointer = e.pointerId; rec.pressedAt = Date.now();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    if (rec.state !== 'starting') { stream.getTracks().forEach(t => t.stop()); return; }   // released while the permission prompt was up
    rec.stream = stream; rec.chunks = []; rec.peaks = [];
    const mime = pickMime();
    rec.recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
    rec.recorder.ondataavailable = ev => ev.data.size && rec.chunks.push(ev.data);
    rec.recorder.start(250);
    try {
      rec.ctx = new (window.AudioContext || window.webkitAudioContext)();
      rec.analyser = rec.ctx.createAnalyser(); rec.analyser.fftSize = 512;
      rec.ctx.createMediaStreamSource(stream).connect(rec.analyser);
    } catch { rec.analyser = null; }
    rec.state = 'recording'; rec.start = Date.now();
    btn.classList.add('recording'); $('recBar').classList.remove('hidden', 'cancel');
    if (navigator.vibrate) navigator.vibrate(20);
    const buf = new Uint8Array(512);
    rec.timer = setInterval(() => {
      const s = (Date.now() - rec.start) / 1000;
      $('recTime').textContent = fmtDur(s);
      if (rec.analyser) { rec.analyser.getByteTimeDomainData(buf); let sum = 0; for (const v of buf) sum += ((v - 128) / 128) ** 2; rec.peaks.push(Math.sqrt(sum / buf.length)); }
      if (s >= MAX_REC_S) finishRecording(true);
    }, 100);
  } catch (err) {
    rec.state = 'idle';
    toast(err.name === 'NotAllowedError' ? 'Microphone access is blocked — allow it in your browser settings' : 'Couldn’t start recording: ' + err.message);
  }
});
btn.addEventListener('pointermove', e => {
  if (rec.state !== 'recording' || e.pointerId !== rec.pointer) return;
  const dx = Math.min(0, e.clientX - rec.x0);
  $('recHint').style.transform = `translateX(${dx / 2}px)`;
  rec.cancel = dx < -90;
  $('recBar').classList.toggle('cancel', rec.cancel);
  $('recHint').textContent = rec.cancel ? 'Release to cancel' : '‹ Slide to cancel';
});
btn.addEventListener('pointerup', () => onMicRelease());
btn.addEventListener('pointercancel', () => { rec.cancel = true; onMicRelease(); });
btn.addEventListener('contextmenu', e => e.preventDefault());
}
bindHoldToRecord(mic);
function onMicRelease() {
  if (rec.state === 'starting') { rec.state = 'idle'; if (Date.now() - rec.pressedAt < 400) toast('Hold the mic to record'); return; }
  if (rec.state !== 'recording') return;
  finishRecording(!rec.cancel);
}
function finishRecording(send) {
  if (rec.state !== 'recording') return;
  rec.state = 'stopping';
  clearInterval(rec.timer);
  const dur = (Date.now() - rec.start) / 1000;
  const recorder = rec.recorder, stream = rec.stream;
  const peaks = downsample(rec.peaks, 40);
  recorder.onstop = () => {
    stream.getTracks().forEach(t => t.stop());
    rec.ctx?.close().catch(() => {});
    const blob = new Blob(rec.chunks, { type: (recorder.mimeType || 'audio/webm').split(';')[0] });
    resetRecUI();
    if (!send) { toast('Voice message cancelled'); if (rec.btn !== mic) cancelReply(); return; }
    if (dur < 0.8) { toast('Hold the mic to record'); return; }
    sendMessage({ audio: { dur: Math.round(dur * 10) / 10, peaks }, upload: blob, localUrl: URL.createObjectURL(blob) });
  };
  recorder.stop();
}
function resetRecUI() {
  rec.state = 'idle'; (rec.btn || mic).classList.remove('recording'); $('recBar').classList.add('hidden');
  $('recHint').style.transform = ''; $('recHint').textContent = '‹ Slide to cancel'; $('recTime').textContent = '0:00';
}
function downsample(arr, n) {
  if (!arr.length) return [];
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * arr.length / n), b = Math.max(a + 1, Math.floor((i + 1) * arr.length / n));
    out.push(Math.max(...arr.slice(a, b)));
  }
  const max = Math.max(...out, 0.01);
  return out.map(v => Math.round(Math.max(v / max, 0.08) * 100));
}

// Player: play/pause, tappable waveform, duration, playback speed
let playingAudio = null;
function stopAllAudio() { if (playingAudio) { playingAudio.pause(); playingAudio = null; } }
function voicePlayer(a, localUrl) {
  const wrap = document.createElement('div'); wrap.className = 'voice';
  if (a.walkie) { const tag = document.createElement('span'); tag.className = 'voice-tag'; tag.textContent = '📻 Walkie-talkie'; setTimeout(() => wrap.before(tag)); }
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'play'; btn.innerHTML = ICON.play; btn.setAttribute('aria-label', 'Play voice message');
  const wave = document.createElement('div'); wave.className = 'wave'; wave.setAttribute('role', 'slider'); wave.setAttribute('aria-label', 'Seek');
  let peaks = a.peaks?.length ? a.peaks : null;
  if (!peaks) { let h = hue(a.url || 'x'); peaks = Array.from({ length: 40 }, () => (h = (h * 9301 + 49297) % 233280, 20 + (h / 233280) * 80)); }
  const bars = peaks.map(p => { const i = document.createElement('i'); i.style.height = Math.max(12, p) + '%'; wave.append(i); return i; });
  const meta = document.createElement('div'); meta.className = 'meta';
  const time = document.createElement('span'); time.textContent = fmtDur(a.dur);
  const speed = document.createElement('button'); speed.type = 'button'; speed.className = 'speed'; speed.textContent = '1×'; speed.setAttribute('aria-label', 'Playback speed');
  meta.append(time, speed);
  wrap.append(btn, wave, meta);

  let audio = null;
  const dur = () => (audio && Number.isFinite(audio.duration) ? audio.duration : 0) || a.dur || 1;
  const paint = () => {
    const p = audio ? audio.currentTime / dur() : 0;
    bars.forEach((b, i) => b.classList.toggle('on', i / bars.length < p));
    time.textContent = audio && audio.currentTime > 0 ? fmtDur(audio.currentTime) : fmtDur(a.dur);
  };
  const ensure = () => {
    if (audio) return audio;
    audio = new Audio(localUrl || a.url); audio.preload = 'auto';
    audio.ontimeupdate = paint;
    audio.onplay = () => { btn.innerHTML = ICON.pause; btn.setAttribute('aria-label', 'Pause'); };
    audio.onpause = () => { btn.innerHTML = ICON.play; btn.setAttribute('aria-label', 'Play voice message'); };
    audio.onended = () => { audio.currentTime = 0; paint(); if (playingAudio === audio) playingAudio = null; };
    audio.onerror = () => toast('Couldn’t play this voice message');
    return audio;
  };
  btn.onclick = e => {
    e.stopPropagation();
    const au = ensure();
    if (au.paused) { if (playingAudio && playingAudio !== au) playingAudio.pause(); playingAudio = au; au.play().catch(() => toast('Tap again to play')); }
    else au.pause();
  };
  speed.onclick = e => {
    e.stopPropagation();
    const next = { '1×': '1.5×', '1.5×': '2×', '2×': '1×' }[speed.textContent];
    speed.textContent = next; ensure().playbackRate = parseFloat(next);
  };
  wave.addEventListener('pointerdown', e => {
    e.stopPropagation();
    const r = wave.getBoundingClientRect(), p = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
    const au = ensure();
    const go = () => { au.currentTime = p * dur(); paint(); };
    if (au.readyState >= 1) go(); else au.addEventListener('loadedmetadata', go, { once: true });
  });
  return wrap;
}

/* ---------------- GIF picker ---------------- */
let gifTimer = null, gifQuery = null, gifReq = 0;
$('gifBtn').onclick = () => {
  closeEmoji();
  const open = $('gifPanel').classList.toggle('hidden') === false;
  $('gifBtn').classList.toggle('active', open);
  if (open) { if (gifQuery === null) loadGifs(''); if (finePointer) $('gifSearch').focus(); }
};
function closeGifs() { $('gifPanel').classList.add('hidden'); $('gifBtn').classList.remove('active'); }
$('gifSearch').oninput = () => { clearTimeout(gifTimer); gifTimer = setTimeout(() => loadGifs($('gifSearch').value.trim()), 350); };
$('gifSearch').onkeydown = e => { if (e.key === 'Escape') closeGifs(); };
async function loadGifs(q) {
  gifQuery = q; const mine = ++gifReq;
  $('gifNote').textContent = 'Loading…';
  try {
    const { gifs } = await api('gifs', { q });
    if (mine !== gifReq) return;
    const grid = $('gifGrid'); grid.innerHTML = '';
    for (const g of gifs) {
      const img = document.createElement('img');
      img.src = g.preview.url; img.alt = g.title; img.title = g.title; img.loading = 'lazy'; img.width = g.preview.w; img.height = g.preview.h;
      img.onclick = () => { closeGifs(); sendMessage({ gif: { ...g.full, title: g.title } }); };
      grid.append(img);
    }
    $('gifNote').textContent = gifs.length ? 'Powered by GIPHY' : 'No GIFs found · Powered by GIPHY';
  } catch (err) {
    if (mine !== gifReq) return;
    $('gifGrid').innerHTML = '';
    $('gifNote').textContent = err.status === 501 ? 'GIF search isn’t set up yet. You can still upload your own GIF.' : 'Couldn’t load GIFs: ' + err.message;
  }
}
$('gifUpload').onclick = () => $('gifFile').click();
$('gifFile').onchange = async () => {
  const file = $('gifFile').files[0]; $('gifFile').value = '';
  if (!file) return;
  if (file.size > 4 * 1024 * 1024) return toast('That file is too large (max 4 MB)');
  const localUrl = URL.createObjectURL(file);
  const dims = await new Promise(res => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => res({}); i.src = localUrl; });
  if (!dims.w) return toast('That doesn’t look like an image');
  closeGifs();
  sendMessage({ gif: { ...dims, title: file.name.slice(0, 80) }, upload: file, localUrl });
};
$('viewer').onclick = () => $('viewer').classList.add('hidden');
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('viewer').classList.add('hidden'); });

/* ---------------- Location ---------------- */
const geo = { loc: null, watch: null, error: null };
function startLocation() {
  if (geo.watch != null) return;
  if (!navigator.geolocation) { geo.error = 'unsupported'; return; }
  geo.error = null;
  const got = p => {
    const first = !geo.loc;
    const loc = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) };
    if (geo.loc && loc.acc > geo.loc.acc * 2 && Date.now() - geo.at < 60_000) return;   // keep a recent, more precise fix
    geo.loc = loc; geo.at = Date.now(); geo.error = null;
    clearTimeout(geo.slow);
    if (first) { pollNow = true; repoll(); updateComposerLock(); }       // report position straight away (no long-poll wait)
  };
  const fail = err => {
    if (err.code === 1) geo.error = 'denied';
    else if (!geo.loc) geo.error = 'unavailable';
    updateComposerLock();
  };
  // A quick approximate fix first (network/Wi-Fi, accepts a recent cached one), then keep a precise GPS watch
  navigator.geolocation.getCurrentPosition(got, fail, { enableHighAccuracy: false, maximumAge: 120000, timeout: 10000 });
  geo.watch = navigator.geolocation.watchPosition(got, fail, { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 });
  clearTimeout(geo.slow);
  geo.slow = setTimeout(() => { if (!geo.loc && !geo.error) { geo.error = 'unavailable'; updateComposerLock(); } }, 15000);
}
function retryLocation() {
  stopLocation(); geo.error = null; $('lockedBar').dataset.key = ''; updateComposerLock();
  startLocation(); toast('Checking your location…');
}
function stopLocation() { if (geo.watch != null) navigator.geolocation.clearWatch(geo.watch); clearTimeout(geo.slow); geo.watch = null; geo.loc = null; }
function getLocationOnce() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('Location isn’t available in this browser'));
    navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
      err => rej(new Error(err.code === 1 ? 'Location access is blocked — allow it in your browser settings' : 'Couldn’t get your location — try again')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 });
  });
}

function setGroup(g) {
  const wasGeo = !!group?.geo;
  group = g || null;
  if (group?.geo && !wasGeo) startLocation();
  if (group) {
    const r = roomInfo(current);
    $('chatTitle').textContent = group.title; paintAvatar($('chatAvatar'), group.title, { geo: group.geo, locked: group.locked, photo: group.dm ? group.peer?.photo : group.photo });
    $('messages').classList.toggle('dm', !!group.dm);
    if (r.title !== group.title) { r.title = group.title; renderRooms(); }
  }
  updateComposerLock(); renderAdminBanner();
  if ($('app').classList.contains('info-open')) renderInfo();
}

// When a member can't chat, the composer is replaced by an explanation + action
function updateComposerLock() {
  const locked = $('lockedBar'), comp = $('composer');
  if (!group?.me || group.me.canChat) { locked.classList.add('hidden'); comp.classList.remove('hidden'); return; }
  comp.classList.add('hidden'); locked.classList.remove('hidden'); closeGifs(); cancelReply();
  const m = group.me, admin = group.adminName || 'the admin', range = fmtDist(group.radius);
  let icon = '📍', msg, action = null;
  if (geo.error === 'denied') { msg = `This group only works within ${range}. Allow location access in your browser to chat.`; action = ['Try again', () => { stopLocation(); startLocation(); }]; }
  else if (geo.error === 'unsupported') msg = 'Your browser can’t share location, so you can only read this group.';
  else if (geo.error === 'unavailable' && !geo.loc) { icon = '📡'; msg = `Couldn’t get your location. Turn on location (GPS) on your phone, or step near a window, then try again. This group only works within ${range}.`; action = ['Try again', retryLocation]; }
  else if (!m.hasLocation) { msg = `Checking your location… This group only works within ${range}.`; action = ['Try again', retryLocation]; }
  else if (m.req === 'pending') { icon = '⏳'; msg = `You’re ${fmtDist(m.dist)} away, outside the ${range} range. Your request was sent to ${admin} — you can chat once they approve.`; }
  else if (m.req === 'denied') { icon = '🚫'; msg = `${admin} declined your request to chat from outside the ${range} range. You can still read messages.`; action = ['Ask again', requestAccess]; }
  else { msg = `You’re ${fmtDist(m.dist)} away — outside this group’s ${range} range. You can still read messages.`; action = ['Ask to chat', requestAccess]; }
  const key = icon + msg + (action?.[0] || '');
  if (locked.dataset.key === key) return;             // avoid re-rendering (and losing focus) on every poll
  locked.dataset.key = key; locked.innerHTML = '';
  const row = document.createElement('div'); row.className = 'row';
  const ico = document.createElement('span'); ico.className = 'ico'; ico.textContent = icon;
  const p = document.createElement('span'); p.textContent = msg;
  row.append(ico, p); locked.append(row);
  if (action) { const b = document.createElement('button'); b.className = 'btn primary'; b.textContent = action[0]; b.onclick = action[1]; locked.append(b); }
}
async function requestAccess() {
  const admin = group?.adminName || 'the admin';
  const note = await popup({ icon: '📍', title: 'Ask to chat from here', text: `${admin} will be asked to let you chat while you’re outside the range. Add a short note if you like.`,
    input: { placeholder: 'e.g. Working from home today', maxLength: 140 }, ok: 'Send request' });
  if (note === null) return;
  try { await api('group/request', { note }); toast('Request sent'); repoll(); }
  catch (err) { toast(err.message); }
}
function renderAdminBanner() {
  const b = $('adminBanner');
  const n = group?.isAdmin ? (group.members || []).filter(m => m.req === 'pending').length : 0;
  if (!n) { b.classList.add('hidden'); return; }
  b.classList.remove('hidden'); b.innerHTML = '';
  const t = document.createElement('span'); t.className = 'grow';
  t.textContent = `🔔 ${n} ${n > 1 ? 'people want' : 'person wants'} to chat from outside the range`;
  const btn = document.createElement('button'); btn.className = 'btn small primary'; btn.textContent = 'Review';
  btn.onclick = openInfo;
  b.append(t, btn);
}

/* ---------------- Invite ---------------- */
async function shareInvite() {
  if (!current) return;
  const url = inviteLink(current), title = roomTitle(current);
  const text = group?.locked ? `Join “${title}” on Intra Chat (ask me for the password)` : `Join “${title}” on Intra Chat`;
  if (navigator.share && !finePointer) { try { await navigator.share({ title, text, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(url); toast('Invite link copied'); }
  catch { popup({ icon: '🔗', title: 'Invite link', text: url, ok: 'Done', cancel: '' }); }
}
$('shareBtn').onclick = shareInvite;

/* ---------------- Group info panel ---------------- */
let membersCache = { room: null, list: null };
async function loadMembers() {
  const room = current; if (!room) return;
  try { const d = await api('group/members', { room }); if (room === current) { membersCache = { room, list: d.members }; renderInfo(); } } catch {}
}
function openInfo() { if (!current) return; infoMode = 'info'; $('app').classList.add('info-open'); renderInfo(); loadMembers(); }
async function makeAdmin(mm) {
  const yes = await popup({ icon: '👑', title: `Make ${mm.name} the admin?`,
    text: `${mm.name} will be able to change the group’s name, password${group?.geo ? ', range' : ''} and members. You’ll stay in the group, but you won’t be the admin any more.`,
    ok: 'Make admin' });
  if (!yes) return;
  try { await api('group/transfer', { member: mm.uid }); toast(`👑 ${mm.name} is now the admin`); repoll(); loadMembers(); }
  catch (e) { toast(e.message); }
}
$('infoBtn').onclick = () => $('app').classList.contains('info-open') ? $('app').classList.remove('info-open') : openInfo();
$('chatMenuBtn').onclick = e => openChatMenu(e.currentTarget);
$('chatHead').onclick = openInfo;
$('infoClose').onclick = () => { $('app').classList.remove('info-open'); infoMode = 'info'; };

function el(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
function renderInfo() {
  if (infoMode === 'search') return;
  const body = $('infoBody');
  if (body.contains(document.activeElement) && document.activeElement.type === 'range') return;   // don't disturb a slider mid-drag
  const scroll = body.scrollTop;
  body.innerHTML = '';
  $('infoTitle').textContent = group?.dm ? 'Contact info' : 'Group info';
  if (group?.dm) { renderContactInfo(body); body.scrollTop = scroll; return; }
  const g = group, ri = roomInfo(current), title = g?.title || roomTitle(current);
  const isGeoRoom = g ? g.geo : ri.geo, isLocked = g ? g.locked : ri.locked;   // fall back to the chat list until group details load
  const hero = el('div', 'info-hero');
  const av = el('div', 'avatar'); paintAvatar(av, title, { geo: isGeoRoom, locked: isLocked, photo: g?.photo || ri.photo });
  if (g?.photo) { av.classList.add('click'); av.onclick = () => viewPhoto(g.photo); }
  if (g?.isAdmin) {
    const cam = el('button', 'cam-btn', '📷'); cam.type = 'button'; cam.title = 'Change group photo'; cam.setAttribute('aria-label', 'Change group photo');
    cam.onclick = e => { e.stopPropagation(); choosePhoto(current, !!g.photo); };
    av.append(cam);
  }
  const kind = isGeoRoom ? '📍 Location group' : isLocked ? '🔒 Private group' : current === 'general' ? '💬 Everyone' : '💬 Open group';
  const adminTxt = g?.isAdmin ? ' · you’re the admin' : g?.adminName ? ` · admin ${g.adminName}` : '';
  hero.append(av, el('h2', null, title), el('span', 'muted', kind + adminTxt));
  body.append(hero);

  // Invite
  const inv = el('div', 'card'); inv.append(el('h3', null, 'Invite people'));
  const row = el('div', 'invite-row'); row.append(el('code', null, inviteLink(current)));
  const copy = el('button', 'btn small primary', 'Share'); copy.onclick = shareInvite; row.append(copy);
  inv.append(row);
  if (g?.locked) inv.append(el('p', 'muted small', 'People who open the link will be asked for the group password.'));
  body.append(inv);

  // Notifications for this group on this device
  const nc = el('div', 'card'); nc.append(el('h3', null, 'Notifications'));
  const ns = el('div', 'setting'), nm = el('div', 's-meta');
  const muted = isMuted(current);
  nm.append(el('b', null, muted ? '🔕 Muted' : pushActive ? '🔔 On' : '🔔 Off on this device'),
    el('small', null, muted ? `Until ${fmtUntil(mutes[current])}` : pushActive ? 'You’ll be notified of new messages, even when the app is closed' : 'Turn on notifications to hear about new messages'));
  const nb = el('button', 'btn small ' + (!pushActive && !muted ? 'primary' : ''), muted ? 'Unmute' : pushActive ? 'Mute' : 'Turn on');
  nb.onclick = () => (pushActive || muted) ? muteGroup() : enableNotifications().then(renderInfo);
  ns.append(nm, nb); nc.append(ns); body.append(nc);

  // Admin: access settings
  if (g?.isAdmin) {
    const ac = el('div', 'card'); ac.append(el('h3', null, 'Admin settings'));
    ac.append(el('p', 'muted small', 'You’re the admin, so only you see these settings — on any device you sign in on. To hand the group over, use “Make admin” next to a member below.'));
    const setting = (titleTxt, sub, btnLabel, fn, cls = '') => {
      const s = el('div', 'setting'); const m = el('div', 's-meta'); m.append(el('b', null, titleTxt), el('small', null, sub));
      const b = el('button', 'btn small ' + cls, btnLabel); b.onclick = fn; s.append(m, b); ac.append(s);
    };
    setting('Group name', title, 'Rename', renameGroup);
    if (g.locked) {
      setting('Password', 'Members need it to join', 'Change', () => setGroupPassword(true));
      setting('Remove password', 'Anyone with the link can join', 'Remove', removeGroupPassword, 'ghost');
    } else setting('Password', 'No password — anyone with the link can join', 'Add', () => setGroupPassword(false));
    body.append(ac);
  }

  if (g?.geo) {
    const c = el('div', 'card'); c.append(el('h3', null, 'Range'));
    c.append(groupMap.element(g));
    const m = g.me || {};
    const kv = (k, v) => { const r = el('div', 'kv'); r.append(el('span', null, k), v instanceof Node ? v : el('span', null, v)); c.append(r); };
    kv('Range', fmtDist(g.radius));
    if (!g.isAdmin) {
      kv('Your distance', m.dist == null ? (geo.error === 'denied' ? 'Location blocked' : 'Checking…') : `${fmtDist(m.dist)}${m.acc ? ` (±${fmtDist(m.acc)})` : ''}`);
      kv('Status', el('span', 'chip ' + (m.inside ? 'ok' : m.approved ? 'brand' : 'warn'),
        m.inside ? 'Inside — can chat' : m.approved ? 'Approved — can chat' : m.req === 'pending' ? 'Request pending' : 'Outside — read only'));
    } else {
      kv('You', el('span', 'chip brand', 'Admin — can always chat'));
      const sr = el('div', 'slider-row');
      const slider = el('input'); slider.type = 'range'; slider.min = 0; slider.max = RANGES.length - 1; slider.step = 1; slider.value = radiusToSlider(g.radius); slider.setAttribute('aria-label', 'Group range');
      const out = el('output', null, fmtDist(g.radius));
      slider.oninput = () => { out.textContent = fmtDist(sliderToRadius(+slider.value)); groupMap.previewRadius(sliderToRadius(+slider.value)); };
      sr.append(slider, out);
      const save = el('button', 'btn small primary', 'Save range');
      save.onclick = async () => { try { await api('group/update', { radius: sliderToRadius(+slider.value) }); toast('Range updated'); slider.blur(); repoll(); } catch (e) { toast(e.message); } };
      const recBtn = el('button', 'btn small', 'Use my location as centre');
      recBtn.onclick = async () => {
        const yes = await popup({ icon: '📍', title: 'Move the centre here?', text: 'The group’s centre will be set to where you are now, and everyone’s range status will be checked again.', ok: 'Move centre' });
        if (!yes) return;
        try { const loc = await getLocationOnce(); await api('group/update', { recenter: true, loc }); toast('Centre moved'); repoll(); } catch (e) { toast(e.message); }
      };
      const btns = el('div', 'btn-row'); btns.append(save, recBtn);
      c.append(el('h3', null, 'Change range'), sr, btns, el('p', 'muted small', 'Tip: drag the 📍 pin on the map to move the centre.'));
    }
    body.append(c);

  }

  // Members: everyone who has opened the group, admin first, with online status.
  // The admin can hand the group over, and (location groups) review requests to chat from outside the range.
  const mc = el('div', 'card');
  const list = membersCache.room === current ? membersCache.list : null;
  const online = new Map(presenceCache.map(u => [u.uid, u]));
  const geoBy = new Map((g?.members || []).map(m => [m.uid, m]));
  mc.append(el('h3', null, list ? `Members (${list.length}) · ${presenceCache.length} online` : 'Members'));
  if (!list) mc.append(el('p', 'muted small', 'Loading…'));
  else if (list.length <= 1) mc.append(el('p', 'muted small', 'Nobody else has joined yet. Share the invite link above.'));
  for (const mm of list || []) {
    const r = el('div', 'member'), you = mm.uid === me.uid, on = online.get(mm.uid);
    const a = el('div', 'avatar click'); paintUser(a, mm.uid, mm.name); a.onclick = () => showProfile(mm.uid);
    const meta = el('div', 'm-meta'), nm = el('b', null, you ? `${mm.name} (you)` : mm.name);
    if (mm.admin) nm.append(el('span', 'chip brand admin-chip', 'Admin'));
    meta.append(nm);
    const geoRec = geoBy.get(mm.uid);
    const bits = [mm.username ? '@' + mm.username : null, on ? (on.typing && !you ? 'typing…' : 'online') : null];
    if (geoRec) bits.push(geoRec.inside == null ? 'location unknown' : `${geoRec.inside ? 'inside' : 'outside'} · ${fmtDist(geoRec.dist)}${geoRec.approved ? ' · approved' : ''}`);
    meta.append(el('small', null, bits.filter(Boolean).join(' · ')));
    if (geoRec?.req === 'pending' && geoRec.note) meta.append(el('small', 'note', `“${geoRec.note}”`));
    const acts = el('div', 'm-actions');
    if (g?.isAdmin && !you) {
      if (geoRec) {
        const act = (label, cls, action) => { const b = el('button', 'btn small ' + cls, label); b.onclick = async () => { b.disabled = true; try { await api('group/decide', { member: mm.uid, action }); toast(action === 'approve' ? `${mm.name} can chat now` : action === 'deny' ? 'Request declined' : 'Access revoked'); repoll(); } catch (e) { toast(e.message); b.disabled = false; } }; acts.append(b); };
        if (geoRec.req === 'pending') { act('Approve', 'ok', 'approve'); act('Deny', 'ghost', 'deny'); }
        else if (geoRec.approved) act('Revoke', 'ghost', 'revoke');
      }
      const mk = el('button', 'btn small ghost', 'Make admin'); mk.onclick = () => makeAdmin(mm); acts.append(mk);
    } else if (on) acts.append(el('span', 'dot', ''));
    r.append(a, meta, acts); mc.append(r);
  }
  body.append(mc);
  body.scrollTop = scroll;
}
async function renameGroup() {
  const title = await popup({ icon: '✏️', title: 'Rename group', input: { value: group.title, maxLength: 40, required: true, requiredMsg: 'Enter a name' }, ok: 'Save',
    onConfirm: async v => { try { await api('group/update', { title: v }); return null; } catch (e) { return e.message; } } });
  if (title) { toast('Group renamed'); repoll(); refreshRooms(); }
}
async function setGroupPassword(changing) {
  const pw = await popup({ icon: '🔒', title: changing ? 'Change password' : 'Add a password',
    text: changing ? 'Everyone except you will need the new password to keep chatting.' : 'New people will need this password to join. Share it only with people who should be here.',
    input: { type: 'password', placeholder: 'At least 4 characters', maxLength: 64, required: true, requiredMsg: 'Enter a password' }, ok: changing ? 'Change' : 'Add password',
    onConfirm: async v => { if (v.length < 4) return 'Use at least 4 characters'; try { await api('group/update', { password: v }); return null; } catch (e) { return e.message; } } });
  if (pw) { toast(changing ? 'Password changed' : 'Group is now private'); repoll(); refreshRooms(); }
}
async function removeGroupPassword() {
  const yes = await popup({ icon: '🔓', title: 'Remove the password?', text: 'Anyone with the invite link will be able to read and join this group.', ok: 'Remove', danger: true });
  if (!yes) return;
  try { await api('group/update', { password: null }); toast('Password removed'); repoll(); refreshRooms(); } catch (e) { toast(e.message); }
}

// A small radar: the dashed circle is the range; dots show distance from the centre (direction isn't shared, only distance)
function radar(g) {
  const NS = 'http://www.w3.org/2000/svg', S = 200, C = S / 2, R = 70;
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${S} ${S}`); svg.setAttribute('class', 'radar');
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `Range ${fmtDist(g.radius)} around the group centre`);
  const add = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); svg.append(e); return e; };
  add('circle', { cx: C, cy: C, r: 95, class: 'ring' });
  add('circle', { cx: C, cy: C, r: R, class: 'fence' });
  add('circle', { cx: C, cy: C, r: 4, class: 'centre' });
  const label = add('text', { x: C, y: C - R - 4, 'text-anchor': 'middle' }); label.textContent = fmtDist(g.radius);
  const scale = d => Math.min(d / g.radius * R, 92);
  const people = g.isAdmin ? (g.members || []).filter(m => m.dist != null) : (g.me?.dist != null ? [{ name: me.name, dist: g.me.dist, inside: g.me.inside }] : []);
  for (const p of people) {
    const ang = (hue(p.name) / 360) * Math.PI * 2, r = scale(p.dist);
    add('circle', { cx: C + Math.cos(ang) * r, cy: C + Math.sin(ang) * r, r: 6, class: 'dot', fill: p.inside ? 'var(--ok)' : 'var(--warn)' })
      .append(Object.assign(document.createElementNS(NS, 'title'), { textContent: `${p.name}: ${fmtDist(p.dist)}` }));
  }
  return svg;
}

/* ---------------- New group ---------------- */
let ngLoc = null;
const ngType = () => document.querySelector('input[name=ngType]:checked').value;
function syncNewGroup() {
  const t = ngType();
  $('ngGeo').classList.toggle('hidden', t !== 'geo');
  $('ngPwWrap').classList.toggle('hidden', !(t === 'private' || (t === 'geo' && $('ngGeoPw').checked)));
  $('ngHint').textContent = { open: 'Anyone with the invite link can read and chat.', private: 'Only people who know the password can join.', geo: 'People inside the range can chat. Anyone outside can read and ask you to chat.' }[t];
  $('ngCreate').textContent = { open: 'Create open group', private: 'Create private group', geo: 'Create location group' }[t];
}
function openNewGroup() {
  $('newGroupForm').reset(); $('ngErr').textContent = ''; ngLoc = null;
  $('ngRadiusOut').textContent = fmtDist(sliderToRadius(+$('ngRadius').value));
  syncNewGroup(); $('newGroup').showModal(); if (finePointer) $('ngName').focus();
}
$('ngClose').onclick = () => $('newGroup').close();
$('newGroup').onclick = e => { if (e.target === $('newGroup')) $('newGroup').close(); };
$('ngRadius').oninput = () => { $('ngRadiusOut').textContent = fmtDist(sliderToRadius(+$('ngRadius').value)); ngMapView?.setRadius(sliderToRadius(+$('ngRadius').value)); };
let ngMapView = null;
function closeNgMap() { try { ngMapView?.map.remove(); } catch {} ngMapView = null; $('ngMap').classList.add('hidden'); }
$('newGroup').addEventListener('close', closeNgMap);
$('ngGeoPw').onchange = syncNewGroup;
for (const r of document.querySelectorAll('input[name=ngType]')) r.onchange = async () => {
  syncNewGroup();
  if (ngType() === 'geo' && !ngLoc) {
    const s = $('ngLoc'); s.className = 'loc-status'; s.textContent = 'Getting your location…';
    try {
      ngLoc = await getLocationOnce(); s.className = 'loc-status ok'; s.textContent = `✓ Location found (±${fmtDist(ngLoc.acc)}). Drag the 📍 pin to adjust the centre.`;
      $('ngMap').classList.remove('hidden');
      rangeMap($('ngMap'), { center: ngLoc, radius: sliderToRadius(+$('ngRadius').value), draggable: true,
        onMove: ll => { ngLoc = { lat: ll.lat, lng: ll.lng, acc: 0 }; s.textContent = '✓ Centre set where you dropped the pin.'; return true; } })
        .then(v => { ngMapView = v; v.setYou(null); }).catch(() => $('ngMap').classList.add('hidden'));
    }
    catch (e) { s.className = 'loc-status bad'; s.textContent = e.message; }
  }
};
$('newGroupForm').onsubmit = async e => {
  e.preventDefault();
  const title = $('ngName').value.trim(), room = slug(title), type = ngType();
  const needsPw = type === 'private' || (type === 'geo' && $('ngGeoPw').checked);
  const password = needsPw ? $('ngPw').value : '';
  $('ngErr').textContent = '';
  if (!title) { $('ngErr').textContent = 'Give your group a name'; $('ngName').focus(); return; }
  if (!room) { $('ngErr').textContent = 'Use some letters or numbers in the name'; $('ngName').focus(); return; }
  if (needsPw && password.length < 4) { $('ngErr').textContent = 'Choose a password of at least 4 characters'; $('ngPw').focus(); return; }
  if (type === 'geo' && !ngLoc) { try { ngLoc = await getLocationOnce(); } catch (err) { $('ngErr').textContent = err.message; return; } }
  $('ngCreate').disabled = true;
  try {
    const d = await api('group/create', { room, title, type, password, radius: sliderToRadius(+$('ngRadius').value), loc: type === 'geo' ? ngLoc : undefined });
    rooms = [{ room, ...d.group, last: null }, ...rooms.filter(r => r.room !== room)];
    $('newGroup').close(); openRoom(room);
    toast(`“${title}” created — share the invite link to add people`);
  } catch (err) { $('ngErr').textContent = err.message; }
  finally { $('ngCreate').disabled = false; }
};


/* ---------------- Reactions, deletions & the message menu ---------------- */
function applyEdit(key) {
  const e = edits[key]; if (!e) return;
  const el = [...$('messages').children].find(x => x.dataset.key === key); if (!el) return;
  if (e.deleted && !el.classList.contains('deleted')) {
    el.classList.add('deleted'); el.classList.remove('media-only');
    el.querySelectorAll('.gif, .voice, .body, .quote').forEach(n => n.remove());
    const body = document.createElement('span'); body.className = 'body'; body.textContent = '🚫 This message was deleted';
    el.insertBefore(body, el.querySelector('.foot'));
    if (el._msg) el._msg = { ...el._msg, deleted: true, text: '', gif: null, audio: null };
  }
  if (!e.deleted && typeof e.text === 'string' && el._msg && (el._msg.text !== e.text || !el.querySelector('.edited'))) {
    el._msg = { ...el._msg, text: e.text, edited: e.edited, mentions: e.mentions };
    let body = el.querySelector('.body');
    if (e.text) { if (!body) { body = document.createElement('span'); body.className = 'body'; el.insertBefore(body, el.querySelector('.foot')); } body.replaceChildren(fmtText(e.text)); el.classList.remove('media-only'); }
    else body?.remove();
    const foot = el.querySelector('.foot');
    if (foot && !foot.querySelector('.edited')) foot.prepend(Object.assign(document.createElement('span'), { className: 'f-tag edited', textContent: 'edited' }));
    el.classList.toggle('mentions-me', !isMine(el._msg) && !!e.mentions?.includes(me.uid));
  }
  renderReactions(el, e.deleted ? {} : e.reactions || {});
}
function renderReactions(el, reactions) {
  el.querySelector('.reacts')?.remove();
  const entries = Object.entries(reactions).filter(([, n]) => n.length);
  if (!entries.length) return;
  const wrap = document.createElement('div'); wrap.className = 'reacts';
  for (const [emoji, names] of entries) {
    const chip = document.createElement('button'); chip.type = 'button';
    const people = names.map(p => typeof p === 'string' ? { name: p } : p);   // older reactions stored just names
    chip.className = 'react-chip' + (people.some(isMine) ? ' mine' : '');
    chip.title = people.map(p => isMine(p) ? 'You' : p.name).join(', ');
    chip.setAttribute('aria-label', `${emoji} by ${chip.title}`);
    chip.append(emoji); if (names.length > 1) { const b = document.createElement('b'); b.textContent = names.length; chip.append(b); }
    chip.onclick = e => { e.stopPropagation(); react(el, emoji); };
    wrap.append(chip);
  }
  el.insertBefore(wrap, el.querySelector('.reply-btn'));
}
async function react(el, emoji) {
  const key = el.dataset.key; if (!key) return;
  if (group?.me && !group.me.canChat) return toast('You can’t react until you’re allowed to chat here');
  try { const d = await api('react', { key, emoji }); edits[key] = d.edit; applyEdit(key); }
  catch (e) { toast(e.message); }
}

// Press and hold (touch) opens the menu; a swipe or scroll cancels it
function addLongPress(el) {
  let timer = null, x0 = 0, y0 = 0;
  const cancel = () => { clearTimeout(timer); timer = null; el.classList.remove('pressing'); };
  el.addEventListener('touchstart', e => {
    if (e.touches.length > 1 || e.target.closest('button, .wave, img')) return;
    const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY;
    el.classList.add('pressing');
    timer = setTimeout(() => { timer = null; el.classList.remove('pressing'); if (navigator.vibrate) navigator.vibrate(25); openMsgMenu(el); }, 450);
  }, { passive: true });
  el.addEventListener('touchmove', e => { const t = e.touches[0]; if (Math.abs(t.clientX - x0) > 10 || Math.abs(t.clientY - y0) > 10) cancel(); }, { passive: true });
  el.addEventListener('touchend', cancel); el.addEventListener('touchcancel', cancel);
}

let menuFor = null;
function openMsgMenu(el) {
  if (menuFor || !el.dataset.key) return;
  menuFor = el;
  const m = el._msg || {}, deleted = el.classList.contains('deleted');
  const canChat = !(group?.me && !group.me.canChat);
  const mine = isMine(m);
  const reacts = $('mmReacts'); reacts.innerHTML = ''; reacts.classList.toggle('hidden', deleted || !canChat);
  const myReact = Object.entries(edits[el.dataset.key]?.reactions || {}).find(([, n]) => n.some(p => isMine(typeof p === 'string' ? { name: p } : p)))?.[0];
  for (const e of REACTIONS) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = e; b.setAttribute('aria-label', 'React ' + e);
    if (e === myReact) b.className = 'on';
    b.onclick = () => { closeMsgMenu(); react(el, e); };
    reacts.append(b);
  }
  const acts = $('mmActions'); acts.innerHTML = '';
  const add = (label, icon, fn, cls = '') => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.innerHTML = icon; b.append(label); b.onclick = () => { closeMsgMenu(); fn(); }; acts.append(b); };
  if (!deleted && canChat) add('Reply', ICON.reply, () => startReply(el));
  if (!deleted && mine && canChat && (m.text || !m.audio)) add('Edit', '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="m14 6 4 4"/></svg>', () => editMsg(el));
  if (!deleted && canChat) { const pinned = pins.some(p => p.key === el.dataset.key); add(pinned ? 'Unpin' : 'Pin', '<svg viewBox="0 0 24 24"><path d="M9 4h6l-1 6 4 4H6l4-4-1-6zM12 14v7"/></svg>', () => pinMsg(el, !pinned)); }
  if (!deleted) add('Remind me', '<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M5 3 2 6M19 3l3 3"/></svg>', () => remindMsg(el));
  if (!deleted && m.text) add('Copy text', ICON.copy, async () => { try { await navigator.clipboard.writeText(m.text); toast('Copied'); } catch { toast('Couldn’t copy'); } });
  if (mine) add('Message info', ICON.info, () => messageInfo(el));
  if (!deleted && (mine || group?.isAdmin)) add(mine ? 'Delete for everyone' : 'Delete (admin)', ICON.trash, () => deleteMsg(el), 'danger');
  $('msgMenu').classList.remove('hidden');
  // Position the card next to the message, kept inside the screen
  const card = $('mmCard'), r = el.getBoundingClientRect(), cw = card.offsetWidth, ch = card.offsetHeight;
  const left = Math.min(Math.max(12, mine ? r.right - cw : r.left), innerWidth - cw - 12);
  let top = r.bottom + 8; if (top + ch > innerHeight - 12) top = Math.max(12, r.top - ch - 8);
  card.style.left = left + 'px'; card.style.top = top + 'px';
  (reacts.querySelector('button') || acts.querySelector('button'))?.focus();
}
function closeMsgMenu() { $('msgMenu').classList.add('hidden'); menuFor = null; }
$('msgMenu').addEventListener('click', e => { if (e.target === $('msgMenu')) closeMsgMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && menuFor) closeMsgMenu(); });
// a message's menu follows that message, so close it on scroll; the ⋮ menus stay open
$('messages').addEventListener('scroll', () => { if (menuFor && menuFor !== 'menu') closeMsgMenu(); }, { passive: true });

async function deleteMsg(el) {
  const yes = await popup({ icon: '🗑️', title: 'Delete for everyone?', text: 'The message will be replaced with “This message was deleted” for everyone in the group.', ok: 'Delete', danger: true });
  if (!yes) return;
  try { await api('delete', { key: el.dataset.key }); edits[el.dataset.key] = { ...(edits[el.dataset.key] || {}), deleted: true }; applyEdit(el.dataset.key); toast('Message deleted'); }
  catch (e) { toast(e.message); }
}
function messageInfo(el) {
  const key = el.dataset.key, others = receipts.filter(r => r.uid !== me.uid);
  const read = others.filter(r => r.read >= key).map(r => r.name), got = others.filter(r => r.delivered >= key && !(r.read >= key)).map(r => r.name);
  const lines = [read.length ? `✓✓ Seen by: ${read.join(', ')}` : 'Not seen yet', got.length ? `✓✓ Delivered to: ${got.join(', ')}` : ''].filter(Boolean);
  popup({ icon: 'ℹ️', title: 'Message info', text: `Sent ${new Date(el._msg.ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}\n${lines.join('\n')}`, ok: 'Done', cancel: '' });
}

/* ---------------- Notifications (Web Push) & installable app ---------------- */
let swReg = null, installPrompt = null;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
function swPost(msg) { try { navigator.serviceWorker?.controller?.postMessage(msg); } catch {} }
function tellSW() { swPost({ type: 'viewing', room: current, visible: !document.hidden }); }

async function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    swReg = await navigator.serviceWorker.register('/sw.js');
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.type === 'open' && e.data.room) runIntent({ room: e.data.room, act: e.data.act || 'open', key: e.data.key });
    });
    navigator.serviceWorker.addEventListener('controllerchange', tellSW);
    await navigator.serviceWorker.ready; tellSW();
    // Already allowed on this device? Make sure the server has a fresh subscription.
    if (pushSupported() && Notification.permission === 'granted') await subscribePush(false);
  } catch { /* service worker unsupported or blocked */ }
  updateNotifBanner();
}
function b64ToBytes(b64) { const s = atob((b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, c => c.charCodeAt(0)); }
async function subscribePush(loud) {
  try {
    const reg = swReg || await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { publicKey } = await api('push/key');
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    }
    await api('push/subscribe', { subscription: sub.toJSON() });
    pushActive = true;
    if (loud) toast('🔔 Notifications are on');
  } catch (e) {
    pushActive = false;
    if (loud) toast('Couldn’t turn on notifications: ' + e.message);
  }
  updateNotifBanner();
}
async function enableNotifications() {
  if (!pushSupported()) {
    if (isIOS && !isStandalone()) return iosHelp();
    return toast('This browser can’t show notifications');
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { updateNotifBanner(); return toast(perm === 'denied' ? 'Notifications are blocked — allow them in your browser’s site settings' : 'Notifications not turned on'); }
  await subscribePush(true);
}
async function disableNotifications(silent) {
  try { const sub = await (swReg || await navigator.serviceWorker?.ready)?.pushManager?.getSubscription(); await sub?.unsubscribe(); } catch {}
  try { await api('push/unsubscribe'); } catch {}
  pushActive = false; updateNotifBanner();
  if (silent !== true) toast('Notifications turned off on this device');
}
function iosHelp() {
  popup({ icon: '📲', title: 'Notifications on iPhone', text: 'On iPhone and iPad, notifications work once Intra Chat is on your Home Screen:\n1. Tap the Share button in Safari\n2. Choose “Add to Home Screen”\n3. Open Intra Chat from the new icon and turn notifications on', ok: 'Got it', cancel: '' });
}
function updateNotifBanner() {
  const b = $('notifBanner');
  const dismissed = (+store.get('ic-nb-dismissed') || 0) > Date.now();
  let show = false;
  if (!dismissed && !pushActive) {
    if (pushSupported() && Notification.permission === 'default') {
      show = true; $('nbTitle').textContent = 'Get notified about new messages'; $('nbText').textContent = 'Even when Intra Chat is closed — like WhatsApp.'; $('nbAction').textContent = 'Turn on'; $('nbAction').onclick = enableNotifications;
    } else if (isIOS && !isStandalone()) {
      show = true; $('nbTitle').textContent = 'Add Intra Chat to your Home Screen'; $('nbText').textContent = 'Needed on iPhone to get message notifications.'; $('nbAction').textContent = 'How'; $('nbAction').onclick = iosHelp;
    } else if (installPrompt) {
      show = true; $('nbTitle').textContent = 'Install the Intra Chat app'; $('nbText').textContent = 'Opens full-screen from your home screen.'; $('nbAction').textContent = 'Install'; $('nbAction').onclick = installApp;
    }
  }
  b.classList.toggle('hidden', !show);
}
$('nbClose').onclick = () => { store.set('ic-nb-dismissed', String(Date.now() + 3 * 864e5)); updateNotifBanner(); };
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; updateNotifBanner(); });
async function installApp() {
  if (!installPrompt) return;
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice.catch(() => ({}));
  installPrompt = null; updateNotifBanner();
  if (outcome === 'accepted') toast('Installed — find Intra Chat on your home screen');
}

/* Mute a group on this device */
async function muteGroup() {
  const room = current;                     // remember which group, in case you navigate away while saving
  const muted = isMuted(room);
  const choice = await popup({ icon: muted ? '🔔' : '🔕', title: muted ? 'Unmute this group?' : 'Mute notifications',
    text: muted ? `Muted until ${fmtUntil(mutes[room])}.` : 'You won’t get notifications from this group. You’ll still see new messages when you open it.',
    ok: '', cancel: 'Cancel',
    choices: muted ? [{ label: 'Unmute', value: 0, cls: 'primary' }] : [{ label: '8 hours', value: Date.now() + 8 * 36e5 }, { label: '1 week', value: Date.now() + 7 * 864e5 }, { label: 'Always', value: -1 }] });
  if (typeof choice !== 'number') return;
  try {
    muteChangedAt = Date.now();
    const d = await api('push/mute', { room, until: choice });
    if (d.muteUntil) mutes[room] = d.muteUntil; else delete mutes[room];
    store.setJson('ic-mutes', mutes); renderRooms(); if (current === room) renderInfo();
    toast(d.muteUntil ? '🔕 Group muted' : '🔔 Group unmuted');
  } catch (e) { toast(e.message); }
}
const fmtUntil = t => t > Date.now() + 365 * 864e5 ? 'you unmute it' : new Date(t).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });


/* ---------------- Walkie-talkie ---------------- */
// Hold to talk: your voice is recorded in ~1 s pieces that are sent as you speak; everyone with the walkie-talkie
// open hears them straight away, played back-to-back. One person talks at a time. The whole transmission can also
// be saved to the chat as a 📻 voice message for people who weren't listening.
const walkie = {
  on: false, ctx: null, nextTime: 0, played: new Set(), tsince: 0, queue: Promise.resolve(), floor: null, hearingUntil: 0, speaker: '',
  talking: false, talkId: null, seq: 0, stream: null, seg: null, segTimer: null, full: null, fullChunks: [], start: 0, timer: null, send: Promise.resolve(),
  analyser: null, peaks: [], listeners: 0,
};
const SEG_MS = 1000, MAX_TALK_S = 60;
$('wkSave').checked = store.get('ic-wk-save') !== '0';
$('wkSave').onchange = () => store.set('ic-wk-save', $('wkSave').checked ? '1' : '0');

function openWalkie() {
  if (!current) return;
  // Create/resume audio playback inside this tap so phones allow sound without further taps
  try {
    walkie.ctx = walkie.ctx || new (window.AudioContext || window.webkitAudioContext)();
    walkie.ctx.resume();
    const b = walkie.ctx.createBuffer(1, 1, 22050), src = walkie.ctx.createBufferSource(); src.buffer = b; src.connect(walkie.ctx.destination); src.start(0);
  } catch {}
  walkie.on = true; walkie.autoOff = false; walkie.nextTime = 0;
  startBackgroundAudio();
  $('walkiePanel').classList.remove('hidden'); $('walkieBtn').classList.add('on'); $('walkieBtn').setAttribute('aria-pressed', 'true');
  closeGifs(); renderWalkie(); repoll();
}
// Auto-play: once you've tapped anywhere in the app, walkie-talkie audio in the open chat plays straight away
// (no "Listen" tap), also with the screen locked or another app in front, like music.
const autoWalkie = () => store.get('ic-wk-auto') !== '0';
const walkieListening = () => walkie.on || (autoWalkie() && !walkie.autoOff && walkie.ctx?.state === 'running');
function unlockAudio() {
  if (!autoWalkie() && !walkie.on) return;
  try {
    if (!walkie.ctx) {
      walkie.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const b = walkie.ctx.createBuffer(1, 1, 22050), src = walkie.ctx.createBufferSource(); src.buffer = b; src.connect(walkie.ctx.destination); src.start(0);
    }
    if (walkie.ctx.state !== 'running') walkie.ctx.resume().then(() => { if (current) repoll(); }).catch(() => {});
  } catch { return; }
  if (current && !walkie.autoOff && !walkie.out?.ok) startBackgroundAudio();      // keeps it alive in the background
}
for (const ev of ['pointerdown', 'touchend', 'keydown']) document.addEventListener(ev, unlockAudio, { capture: true, passive: true });
function closeWalkie() {
  if (walkie.talking) stopTalking(false);
  walkie.on = false;
  if (!autoWalkie() || walkie.autoOff) stopBackgroundAudio(); else { walkie.mediaText = ''; updateMediaSession(); }
  $('walkiePanel').classList.add('hidden'); $('walkieBtn').classList.remove('on'); $('walkieBtn').setAttribute('aria-pressed', 'false');
  renderWalkie();
}
$('walkieBtn').onclick = () => walkie.on ? (closeWalkie(), repoll()) : openWalkie();
$('wkClose').onclick = () => { closeWalkie(); repoll(); };
$('wbListen').onclick = openWalkie;

function onTalk(talk, xt) {
  walkie.floor = talk.floor;
  if (!walkie.tsince) { walkie.tsince = xt; renderWalkie(); return; }     // first look: don't replay older audio
  walkie.tsince = xt;
  if (talk.chunks.length && walkie.ctx && walkie.ctx.state !== 'running' && autoWalkie()) walkie.ctx.resume().catch(() => {});
  if (walkieListening()) for (const c of talk.chunks.sort((a, b) => a.at - b.at || a.seq - b.seq)) enqueueChunk(c);
  renderWalkie();
}
function enqueueChunk(c) {
  const id = c.talkId + ':' + c.seq;
  if (walkie.played.has(id)) return;
  walkie.played.add(id);
  if (walkie.played.size > 500) walkie.played = new Set([...walkie.played].slice(-200));
  // download + decode right away, but play strictly in order
  const decoded = fetch(c.url).then(r => r.arrayBuffer()).then(b => walkie.ctx.decodeAudioData(b)).catch(() => null);
  walkie.queue = walkie.queue.then(async () => {
    const buf = await decoded;
    if (!buf || !walkieListening()) return;
    const ctx = walkie.ctx, src = ctx.createBufferSource(); src.buffer = buf; src.connect(walkieOutput());
    const at = Math.max(ctx.currentTime + 0.05, walkie.nextTime);
    src.start(at); walkie.nextTime = at + buf.duration;
    walkie.hearingUntil = performance.now() + (walkie.nextTime - ctx.currentTime) * 1000 + 300;
    walkie.speaker = c.name; renderWalkie();
    setTimeout(renderWalkie, (walkie.nextTime - ctx.currentTime) * 1000 + 350);
  });
}

// Keep-alive while the walkie-talkie is on: all walkie sound goes into ONE continuous media stream played by an
// <audio> element (plus an inaudible 30 Hz tone), so Chrome treats the page like a music player and keeps it running
// with the screen locked or another app open. A media notification shows who's talking and lets you switch it off.
function startBackgroundAudio() {
  const ctx = walkie.ctx; if (!ctx) return;
  try {
    if (!walkie.out && ctx.createMediaStreamDestination) {
      const dest = ctx.createMediaStreamDestination();
      const el = new Audio(); el.srcObject = dest.stream; el.setAttribute('playsinline', ''); el.autoplay = true;
      const osc = ctx.createOscillator(), quiet = ctx.createGain();
      osc.frequency.value = 30; quiet.gain.value = 0.0008;            // far below hearing on phone speakers
      osc.connect(quiet).connect(dest); osc.start();
      walkie.out = { dest, el, osc, ok: false };
    }
    walkie.out?.el.play().then(() => { if (walkie.out) walkie.out.ok = true; }).catch(() => {});
  } catch { walkie.out = null; }
  updateMediaSession();
}
function stopBackgroundAudio() {
  if (walkie.out) { try { walkie.out.osc.stop(); walkie.out.el.pause(); walkie.out.el.srcObject = null; } catch {} walkie.out = null; }
  if ('mediaSession' in navigator) { try { navigator.mediaSession.playbackState = 'none'; navigator.mediaSession.metadata = null; } catch {} }
  walkie.mediaText = '';
}
// Play through the continuous stream when it's running, otherwise straight to the speakers
const walkieOutput = () => (walkie.out?.ok ? walkie.out.dest : walkie.ctx.destination);
function updateMediaSession(text = '📻 Walkie-talkie · listening') {
  if (!('mediaSession' in navigator) || !walkieListening() || walkie.mediaText === text) return;
  walkie.mediaText = text;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: text, artist: roomTitle(current), album: 'Intra Chat',
      artwork: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }] });
    navigator.mediaSession.playbackState = 'playing';
    for (const a of ['pause', 'stop']) navigator.mediaSession.setActionHandler(a, () => { walkie.autoOff = true; closeWalkie(); stopBackgroundAudio(); repoll(); renderWalkie(); });
    navigator.mediaSession.setActionHandler('play', () => startBackgroundAudio());
  } catch {}
}

function renderWalkie() {
  const f = walkie.floor, othersTalking = f && f.uid !== me.uid, hearing = performance.now() < walkie.hearingUntil;
  const listeners = presenceCache.filter(u => u.walkie && u.uid !== me.uid).length;
  const canTalk = !(group?.me && !group.me.canChat);
  // Banner for people who don't have the walkie-talkie open
  const listening = walkieListening();
  const showBanner = !walkie.on && (othersTalking || (listening && hearing));
  $('walkieBanner').classList.toggle('hidden', !showBanner);
  if (showBanner) {
    const who = othersTalking ? f.name : walkie.speaker;
    $('wbText').textContent = listening ? `🔊 ${who} is talking…` : `${who} is talking on the walkie-talkie`;
    $('wbListen').textContent = listening ? 'Talk back' : 'Listen';
  }
  if (!walkie.on) { if (listening) updateMediaSession(othersTalking || hearing ? `🔊 ${othersTalking ? f.name : walkie.speaker} is talking` : '📻 Walkie-talkie · listening'); return; }
  $('wkListeners').textContent = listeners ? `${listeners} listening` : 'Nobody else listening yet';
  const st = $('wkStatus'), btn = $('pttBtn');
  st.className = 'wk-status';
  $('walkiePanel').classList.toggle('hearing', hearing && !walkie.talking);
  updateMediaSession(walkie.talking ? '🔴 You’re talking' : (othersTalking || hearing) ? `🔊 ${othersTalking ? f.name : walkie.speaker} is talking` : '📻 Walkie-talkie · listening');
  if (walkie.talking) { st.classList.add('live'); st.textContent = `🔴 You’re live · ${fmtDur((Date.now() - walkie.start) / 1000)}`; }
  else if (othersTalking || hearing) { st.classList.add('hearing'); st.textContent = `🔊 ${othersTalking ? f.name : walkie.speaker} is talking…`; }
  else st.textContent = canTalk ? 'Hold the button to talk' : 'You can listen here, but you’re outside the range to talk';
  btn.classList.toggle('talking', walkie.talking);
  btn.classList.toggle('busy', !!othersTalking && !walkie.talking);
  btn.disabled = !canTalk;
  $('pttLabel').textContent = walkie.talking ? 'Release to stop' : othersTalking ? `${f.name.split(' ')[0]} is talking` : replyTo ? `Hold to reply to ${replyTo.name.split(' ')[0]}` : 'Hold to talk';
  $('wkHint').textContent = finePointer ? 'Tip: hold the Space bar to talk. People with the walkie-talkie open hear you live; everyone else gets it as a 📻 message.'
    : 'Keeps playing with the screen locked or in another app (like music) while this stays on. Others get it as a 📻 message.';
}

async function startTalking() {
  if (walkie.talking || !current) return;
  if (walkie.floor && walkie.floor.uid !== me.uid) { if (navigator.vibrate) navigator.vibrate([40, 40, 40]); return toast(`${walkie.floor.name} is talking — wait for them to finish`); }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast('Your browser can’t record audio');
  const talkId = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => (b % 36).toString(36)).join('') + Date.now().toString(36).slice(-4);
  walkie.talking = true; walkie.talkId = talkId; walkie.seq = 0; walkie.start = Date.now(); walkie.fullChunks = []; walkie.peaks = [];
  renderWalkie();
  try {
    const [stream] = await Promise.all([
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
      api('talk/start', { talkId, loc: geo.loc }),
    ]);
    if (!walkie.talking || walkie.talkId !== talkId) { stream.getTracks().forEach(t => t.stop()); api('talk/end').catch(() => {}); return; }   // released already
    walkie.stream = stream;
    if (navigator.vibrate) navigator.vibrate(30);
    const mime = pickMime();
    // full recording (saved to chat afterwards)
    walkie.full = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
    walkie.full.ondataavailable = e => e.data.size && walkie.fullChunks.push(e.data);
    walkie.full.start(500);
    // level meter for the ring + waveform for the saved message
    try {
      const ctx = walkie.ctx || (walkie.ctx = new (window.AudioContext || window.webkitAudioContext)());
      walkie.analyser = ctx.createAnalyser(); walkie.analyser.fftSize = 512; ctx.createMediaStreamSource(stream).connect(walkie.analyser);
    } catch { walkie.analyser = null; }
    const buf = new Uint8Array(512);
    walkie.timer = setInterval(() => {
      if (walkie.analyser) {
        walkie.analyser.getByteTimeDomainData(buf); let sum = 0; for (const v of buf) sum += ((v - 128) / 128) ** 2;
        const lvl = Math.sqrt(sum / buf.length); walkie.peaks.push(lvl); $('pttBtn').style.setProperty('--lvl', 1 + Math.min(lvl * 3, 0.25));
      }
      renderWalkie();
      if ((Date.now() - walkie.start) / 1000 >= MAX_TALK_S) { toast('Walkie-talkie turns are limited to 1 minute'); stopTalking(true); }
    }, 100);
    recordSegment(mime);
  } catch (err) {
    walkie.talking = false; renderWalkie();
    toast(err.code === 'busy' ? err.message : err.name === 'NotAllowedError' ? 'Microphone access is blocked — allow it in your browser settings' : 'Couldn’t start: ' + err.message);
  }
}
// Each piece is a separate, complete recording so listeners can play it on its own
function recordSegment(mime) {
  if (!walkie.stream) return;
  const rec = new MediaRecorder(walkie.stream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : undefined);
  const parts = [], seq = walkie.seq++, talkId = walkie.talkId;
  rec.ondataavailable = e => e.data.size && parts.push(e.data);
  rec.onstop = () => {
    const final = !walkie.talking || walkie.talkId !== talkId;
    sendPiece(new Blob(parts, { type: (rec.mimeType || 'audio/webm').split(';')[0] }), talkId, seq, final);
  };
  rec.start();
  walkie.seg = rec;
  walkie.segTimer = setTimeout(() => { if (walkie.talking && walkie.talkId === talkId) { recordSegment(mime); rec.stop(); } }, SEG_MS);
}
function sendPiece(blob, talkId, seq, final) {
  const room = current;
  walkie.send = walkie.send.then(() => fetch('/api/talk/chunk', { method: 'POST', body: blob, headers: {
    'Content-Type': blob.type || 'application/octet-stream', Authorization: 'Bearer ' + me.token, 'X-Chat-Device': me.device,
    'X-Chat-Room': room, 'X-Talk-Id': talkId, 'X-Talk-Seq': String(seq), ...(final ? { 'X-Talk-Final': '1' } : {}) } }).catch(() => {}));
}
function stopTalking(save) {
  if (!walkie.talking) return;
  walkie.talking = false;
  clearTimeout(walkie.segTimer); clearInterval(walkie.timer);
  $('pttBtn').style.removeProperty('--lvl');
  const dur = (Date.now() - walkie.start) / 1000, stream = walkie.stream, full = walkie.full, peaks = downsample(walkie.peaks, 40);
  walkie.stream = null; walkie.full = null;
  if (walkie.seg && walkie.seg.state !== 'inactive') walkie.seg.stop();          // last piece goes out with the "final" flag
  else if (walkie.talkId) api('talk/end').catch(() => {});
  if (navigator.vibrate) navigator.vibrate(15);
  if (!full) { renderWalkie(); return; }
  full.onstop = () => {
    stream?.getTracks().forEach(t => t.stop());
    if (save && $('wkSave').checked && dur >= 0.8) {
      const blob = new Blob(walkie.fullChunks, { type: (full.mimeType || 'audio/webm').split(';')[0] });
      sendMessage({ audio: { dur: Math.round(dur * 10) / 10, peaks, walkie: true }, upload: blob, localUrl: URL.createObjectURL(blob) });
    }
  };
  full.stop();
  renderWalkie();
}
const ptt = $('pttBtn');
ptt.addEventListener('pointerdown', e => { if (e.button !== 0 || ptt.disabled) return; e.preventDefault(); ptt.setPointerCapture(e.pointerId); startTalking(); });
ptt.addEventListener('pointerup', () => stopTalking(true));
ptt.addEventListener('pointercancel', () => stopTalking(true));
ptt.addEventListener('contextmenu', e => e.preventDefault());
// Space bar = push-to-talk on keyboards (when you're not typing)
const typingInField = () => /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName);
document.addEventListener('keydown', e => { if (e.code === 'Space' && walkie.on && !e.repeat && !typingInField() && !ptt.disabled) { e.preventDefault(); startTalking(); } });
document.addEventListener('keyup', e => { if (e.code === 'Space' && walkie.talking) { e.preventDefault(); stopTalking(true); } });
window.addEventListener('blur', () => { if (walkie.talking) stopTalking(true); });


/* ---------------- Satellite map of a location group's range ---------------- */
// Leaflet is bundled with the app (/vendor/leaflet) and loaded only when a map is needed.
let leafletLoading = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  return leafletLoading ||= new Promise((resolve, reject) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/vendor/leaflet/leaflet.css'; document.head.append(css);
    const js = document.createElement('script'); js.src = '/vendor/leaflet/leaflet.js';
    js.onload = () => resolve(window.L); js.onerror = () => { leafletLoading = null; reject(new Error('Map couldn’t load')); };
    document.head.append(js);
  });
}
const pinIcon = L => L.divIcon({ className: 'map-pin', html: '<span>📍</span><b>Centre</b>', iconSize: [70, 40], iconAnchor: [35, 34] });
const youIcon = L => L.divIcon({ className: 'map-you', html: '<i></i><b>You</b>', iconSize: [60, 34], iconAnchor: [30, 8] });
function baseLayers(L) {
  const satellite = L.layerGroup([
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, opacity: .9 }),
  ]);
  const streets = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' });
  return { Satellite: satellite, Map: streets };
}
/**
 * A map showing a circle (the range), a centre pin and the viewer's own position.
 * opts.draggable: let the admin drag the pin; onMove(latlng) is called when they drop it.
 */
async function rangeMap(container, { center, radius, draggable = false, onMove = null }) {
  const L = await loadLeaflet();
  // no zoom/fade animations: closing a sheet mid-animation would otherwise throw inside Leaflet
  const map = L.map(container, { zoomControl: true, attributionControl: true, scrollWheelZoom: false, tap: true, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false }).setView([center.lat, center.lng], 16);
  const layers = baseLayers(L);
  layers.Satellite.addTo(map);
  L.control.layers(layers, null, { position: 'topright' }).addTo(map);
  const circle = L.circle([center.lat, center.lng], { radius, color: '#2dd4bf', weight: 2, dashArray: '6 6', fillColor: '#2dd4bf', fillOpacity: .14 }).addTo(map);
  const pin = L.marker([center.lat, center.lng], { icon: pinIcon(L), draggable, keyboard: draggable, title: draggable ? 'Drag to move the centre' : 'Group centre', zIndexOffset: 500 }).addTo(map);
  let you = null;
  if (draggable) {
    pin.on('drag', e => circle.setLatLng(e.target.getLatLng()));
    pin.on('dragend', async e => {
      const ll = e.target.getLatLng();
      const keep = await onMove?.(ll);
      if (keep === false) { pin.setLatLng(circle._origin || [center.lat, center.lng]); circle.setLatLng(pin.getLatLng()); }
    });
  }
  circle._origin = [center.lat, center.lng];
  const fit = () => {
    const b = circle.getBounds();
    if (you) b.extend(you.getLatLng());
    map.fitBounds(b, { padding: [24, 24], maxZoom: 18 });
  };
  fit();
  return {
    map,
    setCenter(c) { circle._origin = [c.lat, c.lng]; circle.setLatLng(circle._origin); pin.setLatLng(circle._origin); },
    setRadius(r) { circle.setRadius(r); },
    setYou(loc) {
      if (!loc) { if (you) { you.remove(); you = null; } return; }
      if (!you) { you = L.marker([loc.lat, loc.lng], { icon: youIcon(L), interactive: false }).addTo(map); fit(); }
      else you.setLatLng([loc.lat, loc.lng]);
    },
    fit,
    resize() { map.invalidateSize(); },
  };
}

// The Group info panel re-renders often, so the map is created once per group and re-attached
const groupMap = {
  room: null, wrap: null, view: null, key: '',
  element(g) {
    if (this.room !== current || !this.wrap) this.create(g);
    const key = `${g.center?.lat},${g.center?.lng},${g.radius}`;
    if (this.view && key !== this.key) { this.view.setCenter(g.center); this.view.setRadius(g.radius); this.view.fit(); }
    this.key = key;
    this.view?.setYou(geo.loc);
    setTimeout(() => this.view?.resize(), 0);
    return this.wrap;
  },
  create(g) {
    this.destroy();
    this.room = current; this.key = `${g.center?.lat},${g.center?.lng},${g.radius}`;
    const wrap = this.wrap = el('div', 'range-map-wrap');
    const box = el('div', 'range-map'); box.setAttribute('role', 'img'); box.setAttribute('aria-label', `Map of the group’s ${fmtDist(g.radius)} range`);
    wrap.append(box, el('div', 'map-legend', '📍 group centre · dashed circle = range · 🔵 you'));
    if (!g.center) { wrap.replaceChildren(radar(g)); return; }
    rangeMap(box, { center: g.center, radius: g.radius, draggable: !!g.isAdmin, onMove: ll => this.confirmMove(ll) })
      .then(v => { if (this.wrap === wrap) { this.view = v; v.setYou(geo.loc); } else v.map.remove(); })
      .catch(() => { if (this.wrap === wrap) wrap.replaceChildren(radar(g)); });   // offline or blocked: fall back to the radar
  },
  async confirmMove(ll) {
    const yes = await popup({ icon: '📍', title: 'Move the centre here?', text: 'The range will be centred on the point where you dropped the pin, and everyone’s status will be checked again.', ok: 'Move centre' });
    if (!yes) return false;
    try { await api('group/update', { recenter: true, loc: { lat: ll.lat, lng: ll.lng, acc: 0 } }); toast('Centre moved'); repoll(); return true; }
    catch (e) { toast(e.message); return false; }
  },
  previewRadius(r) { this.view?.setRadius(r); },
  destroy() { try { this.view?.map.remove(); } catch {} this.view = null; this.wrap = null; this.room = null; },
};


/* ---------------- Tabs: Chats / Friends / Settings ---------------- */
let currentTab = 'chats';
function setTab(tab) {
  currentTab = tab;
  for (const b of document.querySelectorAll('.nav-btn')) b.classList.toggle('on', b.dataset.tab === tab);
  $('viewChats').classList.toggle('hidden', tab !== 'chats');
  $('viewFriends').classList.toggle('hidden', tab !== 'friends');
  $('viewSettings').classList.toggle('hidden', tab !== 'settings');
  if (!wide() && $('app').classList.contains('in-chat')) $('backBtn').click();
  if (tab === 'friends') { loadFriends(); if (finePointer) $('friendSearch').focus(); }
  if (tab === 'settings') renderSettings();
}
for (const b of document.querySelectorAll('.nav-btn')) b.onclick = () => setTab(b.dataset.tab);
function lastSeenText(ts) {
  if (!ts) return 'tap here for contact info';
  const d = new Date(ts), now = new Date(), y = new Date(); y.setDate(now.getDate() - 1);
  if (Date.now() - ts < 90_000) return 'online';
  const t = timeLabel(ts);
  if (d.toDateString() === now.toDateString()) return `last seen today at ${t}`;
  if (d.toDateString() === y.toDateString()) return `last seen yesterday at ${t}`;
  return `last seen ${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} at ${t}`;
}
function simpleMenu(anchor, items) {
  if (menuFor) return;
  menuFor = 'menu';
  $('mmReacts').classList.add('hidden');
  const acts = $('mmActions'); acts.innerHTML = '';
  for (const it of items) {
    const b = document.createElement('button'); b.type = 'button'; b.className = it.danger ? 'danger' : '';
    const ic = document.createElement('span'); ic.className = 'mm-emoji'; ic.textContent = it.icon || '';
    b.append(ic, it.label); b.onclick = () => { closeMsgMenu(); it.onClick(); }; acts.append(b);
  }
  $('msgMenu').classList.remove('hidden');
  const card = $('mmCard'), r = anchor.getBoundingClientRect(), cw = card.offsetWidth, ch = card.offsetHeight;
  card.style.left = Math.max(12, Math.min(r.right - cw, innerWidth - cw - 12)) + 'px';
  card.style.top = Math.max(12, Math.min(r.bottom + 4, innerHeight - ch - 12)) + 'px';
  acts.querySelector('button')?.focus();
}
$('listMenuBtn').onclick = e => simpleMenu(e.currentTarget, [
  { icon: '👥', label: 'New group', onClick: openNewGroup },
  { icon: '➕', label: 'Add a friend', onClick: () => setTab('friends') },
  { icon: '✨', label: 'App style', onClick: openStylePicker },
  { icon: '🎨', label: 'Chat wallpaper', onClick: () => openWallpaper(null) },
  { icon: '⚙️', label: 'Settings', onClick: () => setTab('settings') },
]);
function openChatMenu(anchor) {
  if (!current) return;
  const items = [{ icon: 'ℹ️', label: group?.dm ? 'Contact info' : 'Group info', onClick: openInfo }];
  if (!group?.dm) items.push({ icon: '🔗', label: 'Invite people', onClick: shareInvite });
  items.push({ icon: '🔍', label: 'Search messages', onClick: openSearch });
  items.push({ icon: '⏰', label: 'Scheduled messages', onClick: showScheduled });
  items.push({ icon: '🎨', label: 'Wallpaper', onClick: () => openWallpaper(current) });
  items.push({ icon: isMuted(current) ? '🔔' : '🔕', label: isMuted(current) ? 'Unmute notifications' : 'Mute notifications', onClick: () => pushActive || isMuted(current) ? muteGroup() : enableNotifications() });
  items.push({ icon: '📻', label: walkie.on ? 'Close walkie-talkie' : 'Walkie-talkie', onClick: () => $('walkieBtn').click() });
  simpleMenu(anchor, items);
}

/* ---------------- Friends & 1:1 chats ---------------- */
let friends = { friends: [], incoming: [], outgoing: [] }, friendResults = null, friendTimer = null;
async function loadFriends() {
  try { friends = await api('friends/list'); } catch { return; }
  const n = friends.incoming.length;
  $('navFriendsBadge').textContent = n; $('navFriendsBadge').classList.toggle('hidden', !n);
  if (currentTab === 'friends') renderFriends();
  if ($('newChat').open) renderNewChat();
}
$('friendSearch').oninput = () => {
  clearTimeout(friendTimer);
  const q = $('friendSearch').value.trim().replace(/^@/, '').toLowerCase();
  if (q.length < 2) { friendResults = null; renderFriends(); return; }
  friendTimer = setTimeout(async () => { try { friendResults = (await api('friends/search', { q })).users; } catch { friendResults = []; } renderFriends(); }, 300);
};
function personRow(p, actions = [], onClick = null) {
  const row = el(onClick ? 'button' : 'div', 'person' + (onClick ? ' click' : ''));
  if (onClick) { row.type = 'button'; row.onclick = onClick; }
  const a = el('div', 'avatar'); if (p.photo !== undefined) profiles[p.uid] = { ...(profiles[p.uid] || {}), ...p }; paintUser(a, p.uid, p.name);
  if (p.uid) { a.classList.add('click'); a.onclick = e => { e.stopPropagation(); showProfile(p.uid); }; }
  const meta = el('div', 'p-meta'); meta.append(el('b', null, p.name), el('small', null, p.status ? `${p.status.emoji} ${p.status.text}`.trim() : `@${p.username}` + (p.lastSeen ? ` · ${lastSeenText(p.lastSeen).replace('tap here for contact info', '')}` : '')));
  const acts = el('div', 'p-acts');
  for (const [label, cls, fn] of actions) { const b = el('button', 'btn small ' + cls, label); b.type = 'button'; b.onclick = e => { e.stopPropagation(); fn(b); }; acts.append(b); }
  row.append(a, meta, acts);
  return row;
}
async function friendAction(route, uid, okMsg, btn) {
  if (btn) btn.disabled = true;
  try { const d = await api('friends/' + route, { uid }); if (okMsg) toast(okMsg); await loadFriends(); if (friendResults) $('friendSearch').dispatchEvent(new Event('input')); return d; }
  catch (e) { toast(e.message); if (btn) btn.disabled = false; }
}
function renderFriends() {
  const body = $('friendsBody'); body.innerHTML = '';
  if (friendResults) {
    body.append(el('h3', 'sec-title', 'Search results'));
    if (!friendResults.length) body.append(el('p', 'empty-note', 'No one with that username. Check the spelling — usernames look like @priya.'));
    for (const u of friendResults) {
      const acts = u.state === 'friends' ? [['Message', 'primary', () => openDm(u.uid)]]
        : u.state === 'out' ? [['Requested', 'ghost', b => friendAction('remove', u.uid, 'Request cancelled', b)]]
        : u.state === 'in' ? [['Accept', 'primary', b => friendAction('respond', u.uid, `You and ${u.name} are now friends`, b).then(() => {})]]
        : [['Add friend', 'primary', b => friendAction('request', u.uid, `Friend request sent to ${u.name}`, b)]];
      if (u.state === 'in') acts[0][2] = b => respond(u, true, b);
      body.append(personRow(u, acts));
    }
    return;
  }
  if (friends.incoming.length) {
    body.append(el('h3', 'sec-title', `Friend requests (${friends.incoming.length})`));
    for (const u of friends.incoming) body.append(personRow(u, [['Accept', 'primary', b => respond(u, true, b)], ['Decline', 'ghost', b => respond(u, false, b)]]));
  }
  body.append(el('h3', 'sec-title', `Friends (${friends.friends.length})`));
  if (!friends.friends.length) {
    const e = el('div', 'empty-note'); e.append(el('span', 'big', '🤝'), 'No friends yet. Search for someone’s @username above and tap “Add friend”. Once they accept, you can chat 1:1.');
    body.append(e);
  }
  for (const u of friends.friends) body.append(personRow(u, [['Message', 'primary', () => openDm(u.uid)]], () => openDm(u.uid)));
  if (friends.outgoing.length) {
    body.append(el('h3', 'sec-title', 'Sent requests'));
    for (const u of friends.outgoing) body.append(personRow(u, [['Cancel', 'ghost', b => friendAction('remove', u.uid, 'Request cancelled', b)]]));
  }
}
async function respond(u, accept, btn) {
  if (btn) btn.disabled = true;
  try { await api('friends/respond', { uid: u.uid, accept }); toast(accept ? `🤝 You and ${u.name} are now friends` : 'Request declined'); await loadFriends(); if (friendResults) $('friendSearch').dispatchEvent(new Event('input')); }
  catch (e) { toast(e.message); if (btn) btn.disabled = false; }
}
async function openDm(uid) {
  try {
    const { room } = await api('friends/dm', { uid });
    $('newChat').open && $('newChat').close();
    if (!rooms.some(r => r.room === room)) await refreshRooms();
    setTab('chats');
    openRoom(room);
  } catch (e) { toast(e.message); }
}
async function removeFriend(peer) {
  const yes = await popup({ icon: '👋', title: `Remove ${peer.name}?`, text: 'You’ll stop being friends. Your chat history stays, but neither of you can start new 1:1 chats until you’re friends again.', ok: 'Remove', danger: true });
  if (!yes) return;
  await friendAction('remove', peer.uid, `${peer.name} removed from friends`);
}

/* ---------------- New chat sheet ---------------- */
$('newChatBtn').onclick = () => { renderNewChat(); $('newChat').showModal(); loadFriends(); };
$('ncClose').onclick = () => $('newChat').close();
$('newChat').onclick = e => { if (e.target === $('newChat')) $('newChat').close(); };
$('ncGroup').onclick = () => { $('newChat').close(); openNewGroup(); };
$('ncFriend').onclick = () => { $('newChat').close(); setTab('friends'); setTimeout(() => $('friendSearch').focus(), 50); };
function renderNewChat() {
  const box = $('ncFriends'); box.innerHTML = '';
  if (!friends.friends.length) { box.append(el('p', 'empty-note', 'Add friends to chat with them 1:1.')); return; }
  for (const u of friends.friends) box.append(personRow(u, [], () => openDm(u.uid)));
}

/* ---------------- Contact info (1:1 chats) ---------------- */
function renderContactInfo(body) {
  const peer = group.peer || {};
  const hero = el('div', 'info-hero');
  const av = el('div', 'avatar'); paintAvatar(av, peer.name || '?', { photo: peer.photo });
  if (peer.photo) { av.classList.add('click'); av.onclick = () => viewPhoto(peer.photo); }
  const online = presenceCache.some(u => u.uid === peer.uid && u.uid !== me.uid);
  hero.append(av, el('h2', null, peer.name), el('span', 'muted', `@${peer.username || ''}`), el('span', 'muted small', online ? 'online' : lastSeenText(peer.lastSeen)));
  body.append(hero);
  const pf = profiles[peer.uid];
  if (pf === undefined) needProfiles([peer.uid], true);
  if (peer.status || pf?.about) {
    const ab = el('div', 'card about-card');
    if (peer.status) ab.append(el('div', 'status-pill', `${peer.status.emoji} ${peer.status.text}`.trim() + (peer.status.until ? ` · until ${fmtUntil(peer.status.until)}` : '')));
    if (pf?.about) { ab.append(el('h3', null, 'About'), el('p', null, pf.about)); }
    body.append(ab);
  }
  const c = el('div', 'card');
  const row = (icon, title, sub, fn, cls = '') => { const b = el('button', 'set-row ' + cls); b.type = 'button'; b.onclick = fn; const i = el('span', 's-ico', icon); const m = el('div', 's-meta'); m.append(el('b', null, title)); if (sub) m.append(el('small', null, sub)); b.append(i, m); c.append(b); };
  row('📻', 'Walkie-talkie', 'Push to talk with ' + (peer.name || '').split(' ')[0], () => { $('app').classList.remove('info-open'); if (!walkie.on) $('walkieBtn').click(); });
  row(isMuted(current) ? '🔔' : '🔕', isMuted(current) ? 'Unmute notifications' : 'Mute notifications', isMuted(current) ? `Muted until ${fmtUntil(mutes[current])}` : null, () => pushActive || isMuted(current) ? muteGroup() : enableNotifications());
  row('🎨', 'Wallpaper', 'Choose a wallpaper just for this chat', () => openWallpaper(current));
  row('🔍', 'Search messages', null, openSearch);
  row('⏰', 'Scheduled messages', null, showScheduled);
  row('🔒', 'Private chat', 'Only you and ' + (peer.name || '').split(' ')[0] + ' can see these messages', () => {});
  const isFriend = friends.friends.some(f => f.uid === peer.uid);
  if (isFriend) row('👋', `Remove ${peer.name} from friends`, null, () => removeFriend(peer), 'danger');
  else row('➕', `Add ${peer.name} as a friend`, null, () => friendAction('request', peer.uid, 'Friend request sent'));
  body.append(c);
}

/* ---------------- Settings ---------------- */
function renderSettings() {
  const body = $('settingsBody'); if (!body) return;
  body.innerHTML = '';
  const prof = el('div', 'profile-hero');
  const av = el('div', 'avatar'); paintAvatar(av, me.name || '?', { photo: me.photo });
  if (me.photo) { av.classList.add('click'); av.onclick = () => viewPhoto(me.photo); }
  const cam = el('button', 'cam-btn', '📷'); cam.type = 'button'; cam.setAttribute('aria-label', 'Change profile photo'); cam.onclick = e => { e.stopPropagation(); choosePhoto(null, !!me.photo); };
  av.append(cam);
  prof.append(av, el('h2', null, me.name), el('span', 'muted', '@' + me.username));
  body.append(prof);
  const row = (icon, title, sub, fn, cls = '') => { const b = el('button', 'set-row ' + cls); b.type = 'button'; b.onclick = fn; const m = el('div', 's-meta'); m.append(el('b', null, title)); if (sub) m.append(el('small', null, sub)); b.append(el('span', 's-ico', icon), m); body.append(b); };
  body.append(el('h3', 'sec-title', 'Profile'));
  row('🙂', 'Name', me.name, editName);
  row('ℹ️', 'About', me.about || 'Add a few words about yourself', editAbout);
  const st = me.status && (!me.status.until || me.status.until > Date.now()) ? me.status : null;
  row(st?.emoji || '💬', 'Status', st ? `${st.text || ''}${st.until ? ' · until ' + fmtUntil(st.until) : ''}`.trim() : 'Let people know what you’re up to', editStatus);
  row('👁️', 'View my profile', 'See what others see', () => showProfile(me.uid));
  const themeName = { system: 'System default', light: 'Light', dark: 'Dark' }[store.get('ic-theme') || 'system'];
  body.append(el('h3', 'sec-title', 'Chats'));
  row('🌓', 'Theme', themeName, chooseTheme);
  row('✨', 'App style', (STYLES.find(x => x.id === appStyle()).icon + ' ' + STYLES.find(x => x.id === appStyle()).name), openStylePicker);
  row('🎨', 'Chat wallpaper', wallpaperName(wallFor(null)), () => openWallpaper(null));
  row('📻', 'Walkie-talkie auto-play', autoWalkie() ? 'On — you hear people live in the open chat, even in the background' : 'Off — tap “Listen” to hear people', () => {
    store.set('ic-wk-auto', autoWalkie() ? '0' : '1'); walkie.autoOff = false;
    if (autoWalkie()) { unlockAudio(); toast('📻 Walkie-talkie will play automatically'); } else { if (!walkie.on) stopBackgroundAudio(); toast('Walkie-talkie auto-play off'); }
    renderSettings(); repoll();
  });
  body.append(el('h3', 'sec-title', 'Notifications'));
  if (pushSupported() && Notification.permission !== 'denied') row(pushActive ? '🔔' : '🔕', 'Message notifications', pushActive ? 'On for this device' : 'Off — tap to turn on', () => (pushActive ? disableNotifications() : enableNotifications()).then(renderSettings));
  else row('🔕', 'Message notifications', isIOS && !isStandalone() ? 'Add Intra Chat to your Home Screen first' : 'Blocked in your browser’s site settings', () => (isIOS && !isStandalone() ? iosHelp() : toast('Allow notifications for this site in your browser settings')));
  if (installPrompt) row('📲', 'Install the app', 'Full screen, from your home screen', installApp);
  body.append(el('h3', 'sec-title', 'Account'));
  row('🔑', 'Change password', null, changePassword);
  row('🚪', 'Sign out', null, signOut, 'danger');
  body.append(el('p', 'muted small empty-note', 'Intra Chat · chats with friends are private to the two of you'));
}
async function chooseTheme() {
  const cur = store.get('ic-theme') || 'system';
  const v = await popup({ icon: '🌓', title: 'Choose theme', ok: '', cancel: 'Cancel',
    choices: [['system', 'System default'], ['light', 'Light'], ['dark', 'Dark']].map(([value, label]) => ({ value, label: (value === cur ? '✓ ' : '') + label, cls: value === cur ? 'primary' : '' })) });
  if (typeof v !== 'string') return;
  store.set('ic-theme', v); applyTheme(); renderSettings();
}
// App styles: the look of the whole app (independent of light / dark)
const STYLES = [
  { id: 'classic', name: 'Classic', icon: '💬', desc: 'Familiar green chat look', bar: ['#008069', '#202c33'], meta: ['#008069', '#202c33'],
    pv: { light: { bg: '#efeae2', bar: '#008069', ink: '#fff', inB: '#fff', outB: '#d9fdd3' }, dark: { bg: '#0b141a', bar: '#202c33', ink: '#e9edef', inB: '#202c33', outB: '#005c4b' } } },
  { id: 'glass', name: 'Glass', icon: '🫧', desc: 'Frosted Apple-style glass', meta: ['#eef2ff', '#05070f'],
    pv: { light: { bg: 'radial-gradient(at 15% 10%,rgba(120,170,255,.6),transparent 60%),radial-gradient(at 90% 25%,rgba(190,160,255,.5),transparent 60%),radial-gradient(at 70% 95%,rgba(255,190,150,.55),transparent 60%),#f3f1ff', bar: 'rgba(255,255,255,.62)', ink: '#1c1c1e', inB: 'rgba(255,255,255,.8)', outB: 'rgba(0,122,255,.88)', glass: true },
          dark: { bg: 'radial-gradient(at 15% 10%,rgba(40,90,230,.6),transparent 60%),radial-gradient(at 90% 25%,rgba(120,60,210,.5),transparent 60%),radial-gradient(at 70% 95%,rgba(200,80,120,.35),transparent 60%),#06070f', bar: 'rgba(28,28,30,.55)', ink: '#f5f5f7', inB: 'rgba(58,58,62,.7)', outB: 'rgba(10,132,255,.85)', glass: true } } },
  { id: 'ios', name: 'iOS', icon: '🍎', desc: 'iMessage look, blue bubbles', meta: ['#f9f9f9', '#161618'],
    pv: { light: { bg: '#fff', bar: '#f9f9f9', ink: '#000', inB: '#e9e9eb', outB: '#007aff', line: '#e5e5ea', round: 1 }, dark: { bg: '#000', bar: '#161618', ink: '#fff', inB: '#26252a', outB: '#0a84ff', line: '#2c2c2e', round: 1 } } },
  { id: 'material', name: 'Material', icon: '🎨', desc: 'Android Material You', meta: ['#f3edf7', '#211f26'],
    pv: { light: { bg: '#fef7ff', bar: '#f3edf7', ink: '#1d1b20', inB: '#ece6f0', outB: '#eaddff', round: 1 }, dark: { bg: '#141218', bar: '#211f26', ink: '#e6e0e9', inB: '#2b2930', outB: '#4f378b', round: 1 } } },
  { id: 'brutal', name: 'Brutal', icon: '🧱', desc: 'Bold borders, hard shadows', meta: ['#ffd23f', '#ffd23f'],
    pv: { light: { bg: '#fff6dc', bar: '#ffd23f', ink: '#111', inB: '#fff', outB: '#ffd23f', brutal: '#111' }, dark: { bg: '#161616', bar: '#ffd23f', ink: '#111', inB: '#262626', outB: '#ffd23f', brutal: '#f2f2f2' } } },
  { id: 'neon', name: 'Neon', icon: '🌃', desc: 'Glowing pink & cyan, always dark', meta: ['#0e0a1c', '#0e0a1c'],
    pv: { light: { bg: '#07040f', bar: '#0e0a1c', ink: '#00f0ff', inB: '#150f2b', outB: 'linear-gradient(135deg,#ff2fd6,#a63cff)', neon: 1 }, dark: { bg: '#07040f', bar: '#0e0a1c', ink: '#00f0ff', inB: '#150f2b', outB: 'linear-gradient(135deg,#ff2fd6,#a63cff)', neon: 1 } } },
  { id: 'clay', name: 'Clay', icon: '🧸', desc: 'Soft, squishy pastel 3D', meta: ['#f4f0ff', '#262140'],
    pv: { light: { bg: '#efeaff', bar: '#f4f0ff', ink: '#6243e8', inB: '#fff', outB: '#ffd9c7', clay: 1 }, dark: { bg: '#1d1933', bar: '#262140', ink: '#b9a6ff', inB: '#2e2950', outB: '#6d4c9f', clay: 1 } } },
  { id: 'minimal', name: 'Minimal', icon: '◻️', desc: 'Clean, quiet, black & white', meta: ['#ffffff', '#0a0a0a'],
    pv: { light: { bg: '#fff', bar: '#fff', ink: '#111', inB: '#f2f2f2', outB: '#111', line: '#eee' }, dark: { bg: '#0a0a0a', bar: '#0a0a0a', ink: '#f5f5f5', inB: '#1a1a1a', outB: '#f5f5f5', line: '#1d1d1d' } } },
];
const appStyle = () => STYLES.some(x => x.id === store.get('ic-style')) ? store.get('ic-style') : 'classic';
function applyTheme() {
  const t = store.get('ic-theme') || 'system', st = appStyle();
  if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  if (st === 'classic') delete document.documentElement.dataset.style; else document.documentElement.dataset.style = st;
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('metaTheme').setAttribute('content', STYLES.find(x => x.id === st).meta[dark ? 1 : 0]);
  if (current) applyWallpaper(current);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

/* ---------------- Wallpapers ---------------- */
// Our own doodle pattern (chat bubbles, hearts, stars) drawn as a tiny SVG tile
const doodle = color => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140' viewBox='0 0 140 140'><g fill='none' stroke='${color}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M14 18h22a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H24l-7 6v-6h-3a5 5 0 0 1-5-5V23a5 5 0 0 1 5-5z'/><path d='M96 22c3-6 12-6 12 1 0 6-12 13-12 13s-12-7-12-13c0-7 9-7 12-1z'/><path d='M62 70l3 7 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z'/><circle cx='112' cy='86' r='8'/><path d='M20 96c6 0 6 8 12 8s6-8 12-8'/><path d='M84 116h16M92 108v16'/><rect x='50' y='112' width='14' height='18' rx='3'/><path d='M120 120l8-8M70 26l6 6'/></g></svg>`)}")`;
const WALLPAPERS = [
  { id: 'doodle', name: 'Doodles', light: ['#efeae2', doodle('rgba(0,0,0,.07)')], dark: ['#0b141a', doodle('rgba(255,255,255,.05)')] },
  { id: 'plain', name: 'Plain', light: ['#efeae2'], dark: ['#0b141a'] },
  { id: 'mint', name: 'Mint', light: ['#d1f2e3', doodle('rgba(0,80,50,.07)')], dark: ['#0f2a22', doodle('rgba(255,255,255,.05)')] },
  { id: 'sky', name: 'Sky', light: ['#d6ebf7', doodle('rgba(0,50,90,.07)')], dark: ['#0e2230', doodle('rgba(255,255,255,.05)')] },
  { id: 'lavender', name: 'Lavender', light: ['#e6e0f5', doodle('rgba(60,30,110,.07)')], dark: ['#1e1a2e', doodle('rgba(255,255,255,.05)')] },
  { id: 'peach', name: 'Peach', light: ['#fbe3d3', doodle('rgba(110,50,0,.07)')], dark: ['#2c1d15', doodle('rgba(255,255,255,.05)')] },
  { id: 'rose', name: 'Rose', light: ['#f8dde4'], dark: ['#2a161c'] },
  { id: 'slate', name: 'Slate', light: ['#dfe4ea'], dark: ['#161b22'] },
  { id: 'sunset', name: 'Sunset', light: ['#ffd8b8', 'linear-gradient(160deg,#ffe0c2,#f8c3d4 55%,#d7c6f5)'], dark: ['#2a1f2b', 'linear-gradient(160deg,#3a2430,#2a2240 60%,#16203a)'] },
  { id: 'ocean', name: 'Ocean', light: ['#cfeef0', 'linear-gradient(160deg,#d9f6f0,#c6e3f7 60%,#d8d6f6)'], dark: ['#0f2430', 'linear-gradient(160deg,#0e2e33,#10243a 60%,#161a36)'] },
  { id: 'forest', name: 'Forest', light: ['#dcefd6', 'linear-gradient(160deg,#e6f4d8,#cfe8d8 60%,#c9e1e6)'], dark: ['#12261b', 'linear-gradient(160deg,#16301f,#11281f 60%,#0f2028)'] },
  { id: 'aurora', name: 'Aurora', light: ['transparent'], dark: ['transparent'], swatch: ['radial-gradient(at 10% 10%,#a7f3d0,transparent 55%),radial-gradient(at 90% 10%,#c4b5fd,transparent 55%),radial-gradient(at 80% 90%,#93c5fd,transparent 60%),#f2f0ff', 'radial-gradient(at 10% 10%,#0f766e,transparent 55%),radial-gradient(at 90% 10%,#5b21b6,transparent 55%),#080b18'] },
  { id: 'grid', name: 'Grid', light: ['#fff6dc', 'linear-gradient(rgba(0,0,0,.07) 1.5px,transparent 1.5px),linear-gradient(90deg,rgba(0,0,0,.07) 1.5px,transparent 1.5px)', '28px 28px'], dark: ['#161616', 'linear-gradient(rgba(255,255,255,.06) 1.5px,transparent 1.5px),linear-gradient(90deg,rgba(255,255,255,.06) 1.5px,transparent 1.5px)', '28px 28px'] },
  { id: 'paper', name: 'Paper', light: ['#ffffff'], dark: ['#000000'] },
  { id: 'm3', name: 'Lilac', light: ['#fef7ff'], dark: ['#141218'] },
  { id: 'clay', name: 'Clay', light: ['#efeaff'], dark: ['#1d1933'] },
  { id: 'neon', name: 'Neon', light: ['#07040f', 'radial-gradient(ellipse at 20% 0%,rgba(255,47,214,.18),transparent 55%),radial-gradient(ellipse at 90% 100%,rgba(0,240,255,.14),transparent 55%)', 'cover'], dark: ['#07040f', 'radial-gradient(ellipse at 20% 0%,rgba(255,47,214,.18),transparent 55%),radial-gradient(ellipse at 90% 100%,rgba(0,240,255,.14),transparent 55%)', 'cover'] },
  { id: 'night', name: 'Night', light: ['#2b3a55', 'linear-gradient(160deg,#283a5e,#1d2a44)'], dark: ['#0a1020', 'linear-gradient(160deg,#121a33,#070b16)'] },
];
const isDark = () => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
const wallpaperName = id => id === 'custom' ? 'Your photo' : (WALLPAPERS.find(w => w.id === id) || WALLPAPERS[0]).name;
const STYLE_WALL = { classic: 'doodle', glass: 'aurora', ios: 'paper', material: 'm3', brutal: 'grid', neon: 'neon', clay: 'clay', minimal: 'paper' };
const wallFor = room => (room && store.get('ic-wall:' + room)) || store.get('ic-wall') || STYLE_WALL[appStyle()];
// Your own photo: kept on this device only (like WhatsApp). Per-chat photos override the all-chats photo.
const photoFor = room => (room && store.get('ic-wall:' + room) === 'custom' && store.get('ic-wall-img:' + room)) || store.get('ic-wall-img');
function wallStyle(id, room) {
  if (id === 'custom') {
    const img = photoFor(room);
    if (img) {
      const dim = Math.min(Math.max(+(store.get('ic-wall-dim') ?? 20), 0), 80) / 100 + (isDark() ? .15 : 0);
      return { bg: '#222', img: `linear-gradient(rgba(0,0,0,${dim}),rgba(0,0,0,${dim})), url("${img}")`, size: 'cover' };
    }
    id = 'doodle';
  }
  const w = WALLPAPERS.find(x => x.id === id) || WALLPAPERS[0];
  const [bg, img, size] = isDark() ? w.dark : w.light;
  return { bg, img: img || 'none', size: size || (img?.startsWith('linear') ? 'cover' : '190px') };
}
function applyWallpaper(room) {
  const st = wallStyle(wallFor(room), room), pane = $('chatPane');
  pane.style.setProperty('--wall', st.bg); pane.style.setProperty('--wall-img', st.img); pane.style.setProperty('--wall-size', st.size);
}
let wallTarget = null;
function openWallpaper(room) {
  wallTarget = room;
  $('wallTitle').textContent = room ? 'Wallpaper for this chat' : 'Chat wallpaper';
  $('wallNote').textContent = room ? 'Only changes this chat, on this device. Pick “Default” to use your main wallpaper.' : 'Used for all chats on this device (unless a chat has its own).';
  renderWallGrid(); $('wallSheet').showModal();
}
function renderWallGrid() {
  const grid = $('wallGrid'); grid.innerHTML = '';
  const scopeKey = wallTarget ? 'ic-wall:' + wallTarget : 'ic-wall';
  const chosen = wallTarget ? store.get(scopeKey) || 'default' : store.get('ic-wall') || STYLE_WALL[appStyle()];
  const myPhoto = wallTarget ? store.get('ic-wall-img:' + wallTarget) || store.get('ic-wall-img') : store.get('ic-wall-img');
  const select = id => {
    if (wallTarget) { if (id === 'default') store.del(scopeKey); else store.set(scopeKey, id); }
    else store.set('ic-wall', id);
    if (current) applyWallpaper(current);
    renderWallGrid(); renderSettings();
  };
  // 📷 pick a photo from this device
  const up = el('button', 'wall-opt photo'); up.type = 'button'; up.setAttribute('aria-label', 'Choose a photo from your device');
  up.append('📷', el('span', null, myPhoto ? 'New photo' : 'Your photo'));
  up.onclick = () => $('wallFile').click();
  grid.append(up);
  const opts = (wallTarget ? [{ id: 'default', name: 'Default' }] : []).concat(myPhoto ? [{ id: 'custom', name: 'Your photo' }] : [], WALLPAPERS);
  for (const w of opts) {
    const st = w.id === 'custom' ? { bg: '#222', img: `url("${myPhoto}")`, size: 'cover' } : wallStyle(w.id === 'default' ? (store.get('ic-wall') || STYLE_WALL[appStyle()]) : w.id, null);
    const b = el('button', 'wall-opt' + (w.id === chosen ? ' on' : '')); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(w.id === chosen)); b.setAttribute('aria-label', w.name);
    b.style.backgroundColor = st.bg; b.style.backgroundImage = st.img; b.style.backgroundSize = st.size === 'cover' ? 'cover' : st.size === '28px 28px' ? '14px 14px' : '';
    const sw = (WALLPAPERS.find(x => x.id === (w.id === 'default' ? wallFor(null) : w.id)) || {}).swatch;
    if (sw) b.style.background = sw[isDark() ? 1 : 0];
    b.style.backgroundPosition = 'center';
    b.append(el('span', null, w.name));
    b.onclick = () => {
      if (w.id === 'custom' && wallTarget && !store.get('ic-wall-img:' + wallTarget)) store.set('ic-wall-img:' + wallTarget, myPhoto);
      select(w.id);
    };
    grid.append(b);
  }
  const effective = chosen === 'default' ? (store.get('ic-wall') || STYLE_WALL[appStyle()]) : chosen;
  $('wallDimRow').classList.toggle('hidden', effective !== 'custom');
  $('wallDim').value = store.get('ic-wall-dim') ?? 20;
  const pv = $('wallPreview'), st = wallStyle(effective, wallTarget);
  pv.style.setProperty('--pv-bg', st.bg); pv.style.setProperty('--pv-img', st.img); pv.style.setProperty('--pv-size', st.size);
}
$('wallDim').oninput = () => { store.set('ic-wall-dim', $('wallDim').value); renderWallGrid(); if (current) applyWallpaper(current); };
// Shrink the photo (longest side ≤ 1440 px, JPEG) so it fits in this device's storage
function shrinkImage(file, max, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file isn’t a picture we can use')); };
    img.src = url;
  });
}
$('wallFile').onchange = async () => {
  const file = $('wallFile').files[0]; $('wallFile').value = '';
  if (!file) return;
  const key = wallTarget ? 'ic-wall-img:' + wallTarget : 'ic-wall-img';
  try {
    let saved = false;
    for (const [max, q] of [[1440, .82], [1080, .7], [800, .6]]) {          // smaller until it fits
      const data = await shrinkImage(file, max, q);
      try { localStorage.setItem(key, data); saved = true; break; } catch {}
    }
    if (!saved) {
      // make room: drop other chats' photos, then try once more
      for (const k of Object.keys(localStorage)) if (k.startsWith('ic-wall-img:') && k !== key) localStorage.removeItem(k);
      localStorage.setItem(key, await shrinkImage(file, 800, .55));
    }
    if (wallTarget) store.set('ic-wall:' + wallTarget, 'custom'); else store.set('ic-wall', 'custom');
    if (current) applyWallpaper(current);
    renderWallGrid(); renderSettings(); toast('🖼️ Wallpaper set');
  } catch (e) { toast(e.message?.includes('quota') ? 'Not enough space on this device for that photo' : (e.message || 'Couldn’t use that photo')); }
};
$('wallClose').onclick = () => $('wallSheet').close();
$('wallSheet').onclick = e => { if (e.target === $('wallSheet')) $('wallSheet').close(); };

/* ---------------- Emoji picker ---------------- */
const EMOJI = {
  'Smileys': '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 🤗 🤭 🤫 🤔 😐 😏 😒 🙄 😬 😌 😔 😴 🤒 🤯 🥳 😎 🤓 😕 😟 😮 😲 🥺 😢 😭 😱 😤 😡 🤬 😈 💀 💩 🤡 👻',
  'Gestures': '👍 👎 👌 ✌️ 🤞 🤟 🤘 👋 🤙 💪 🙏 👏 🙌 🤝 ✋ 👀 🫶',
  'Hearts & symbols': '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💯 ✨ 🔥 🎉 🎊 ⭐ 🌟 ⚡ 💥 ✅ ❌ ❓ ❗ 💤 🎂 🍕 ☕ 🍺 🚀 🏆 📍 📞 ⏰',
};
let emojiBuilt = false;
function buildEmoji() {
  if (emojiBuilt) return; emojiBuilt = true;
  const p = $('emojiPanel');
  for (const [title, list] of Object.entries(EMOJI)) {
    p.append(el('h4', null, title));
    for (const e of list.split(' ')) { const b = el('button', null, e); b.type = 'button'; b.setAttribute('aria-label', e); b.onclick = () => insertText(e); p.append(b); }
  }
}
function insertText(t) {
  const ta = $('text'), a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? ta.value.length;
  ta.value = ta.value.slice(0, a) + t + ta.value.slice(b);
  const pos = a + t.length; ta.setSelectionRange?.(pos, pos);
  ta.dispatchEvent(new Event('input'));
  if (finePointer) ta.focus();
}
function closeEmoji() { $('emojiPanel').classList.add('hidden'); $('emojiBtn').classList.remove('active'); }
$('emojiBtn').onclick = () => {
  buildEmoji();
  const open = $('emojiPanel').classList.toggle('hidden') === false;
  $('emojiBtn').classList.toggle('active', open);
  if (open) { closeGifs(); $('text').blur(); }
};

/* ---------------- Profiles: photos, about, status ---------------- */
let profiles = {}, profWant = new Set(), profTimer = null;
setInterval(() => { profiles = {}; }, 10 * 60_000);          // pick up new photos now and then
function paintMe() {
  paintAvatar($('meAvatar'), me.name, { photo: me.photo });
  $('meName').textContent = `${me.name} · @${me.username}`;
}
function paintUser(el, uid, name) {
  el.dataset.uid = uid || ''; el.dataset.label = name || '?';
  const p = uid === me.uid ? me : profiles[uid];
  paintAvatar(el, name, { photo: p?.photo });
  if (uid && uid !== me.uid && !(uid in profiles)) needProfiles([uid]);
}
function repaintUsers() {
  for (const a of document.querySelectorAll('.avatar[data-uid]')) {
    const uid = a.dataset.uid; if (!uid) continue;
    paintAvatar(a, a.dataset.label, { photo: (uid === me.uid ? me : profiles[uid])?.photo });
  }
}
function needProfiles(uids, refreshInfo) {
  for (const u of uids) if (/^[a-f0-9]{24}$/.test(u || '')) profWant.add(u);
  clearTimeout(profTimer);
  profTimer = setTimeout(async () => {
    const ids = [...profWant].slice(0, 60); profWant.clear();
    if (!ids.length) return;
    for (const id of ids) if (!profiles[id]) profiles[id] = null;          // asked for (avoids asking twice)
    try { Object.assign(profiles, (await api('profile/batch', { uids: ids })).profiles); }
    catch { for (const id of ids) if (profiles[id] === null) delete profiles[id]; return; }
    repaintUsers();
    if (refreshInfo && $('app').classList.contains('info-open')) renderInfo();
  }, 80);
}
function viewPhoto(url) { $('viewer').querySelector('img').src = url; $('viewer').classList.remove('hidden'); }
const statusText = st => st ? `${st.emoji || ''} ${st.text || ''}`.trim() : '';

// Profile card: tap someone's photo or name
async function showProfile(uid) {
  let p;
  if (uid === me.uid) p = { ...me, friend: 'self' };
  else { try { p = (await api('profile/get', { uid })).profile; } catch (e) { return toast(e.message); } }
  if (!p) return toast('This account no longer exists');
  if (uid !== me.uid) profiles[uid] = { ...(profiles[uid] || {}), ...p };
  let dlg = $('profileView');
  if (!dlg) {
    dlg = document.createElement('dialog'); dlg.id = 'profileView'; dlg.className = 'sheet profile-sheet';
    dlg.onclick = e => { if (e.target === dlg) dlg.close(); };
    document.body.append(dlg);
  }
  dlg.innerHTML = '';
  const inner = el('div', 'sheet-inner');
  const close = el('button', 'icon-btn ps-close'); close.type = 'button'; close.setAttribute('aria-label', 'Close');
  close.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>'; close.onclick = () => dlg.close();
  const av = el('div', 'avatar'); paintAvatar(av, p.name, { photo: p.photo });
  if (p.photo) { av.classList.add('click'); av.onclick = () => viewPhoto(p.photo); }
  inner.append(close, av, el('h2', null, p.name), el('span', 'muted', '@' + p.username));
  const online = presenceCache.some(u => u.uid === uid) || uid === me.uid;
  inner.append(el('span', 'muted small', online ? 'online' : lastSeenText(p.lastSeen).replace('tap here for contact info', 'not seen recently')));
  const st = p.status && (!p.status.until || p.status.until > Date.now()) ? p.status : null;
  if (st) inner.append(el('div', 'status-pill', statusText(st) + (st.until ? ` · until ${fmtUntil(st.until)}` : '')));
  if (p.about) { const ab = el('div', 'ps-about'); ab.append(el('small', 'muted', 'About'), el('p', null, p.about)); inner.append(ab); }
  const acts = el('div', 'ps-actions');
  const btn = (label, cls, fn) => { const b = el('button', 'btn ' + cls, label); b.type = 'button'; b.onclick = () => fn(b); acts.append(b); };
  if (p.friend === 'self') btn('✏️ Edit profile', 'primary', () => { dlg.close(); setTab('settings'); });
  else if (p.friend === 'friends') btn('💬 Message', 'primary', () => { dlg.close(); openDm(uid); });
  else if (p.friend === 'out') btn('Request sent', 'ghost', () => {});
  else if (p.friend === 'in') btn('Accept friend request', 'primary', async b => { await respond(p, true, b); dlg.close(); });
  else btn('➕ Add friend', 'primary', async b => { await friendAction('request', uid, `Friend request sent to ${p.name}`, b); dlg.close(); });
  inner.append(acts);
  dlg.append(inner);
  if (!dlg.open) dlg.showModal();
}

async function saveMe(patch, okMsg) {
  try { const d = await api('auth/update', patch); Object.assign(me, d.user); store.set('ic-user', JSON.stringify(d.user)); paintMe(); renderSettings(); repaintUsers(); if (okMsg) toast(okMsg); return null; }
  catch (e) { return e.message; }
}
async function editAbout() {
  await popup({ icon: 'ℹ️', title: 'About', text: 'A few words people see on your profile.', ok: 'Save',
    input: { value: me.about || '', maxLength: 140, placeholder: 'e.g. Design team · Floor 3' },
    onConfirm: v => v === (me.about || '') ? null : saveMe({ about: v }, 'About saved') });
}
const STATUSES = [['📅', 'In a meeting'], ['🍽️', 'At lunch'], ['🎧', 'Focusing'], ['🚗', 'Commuting'], ['🏠', 'Working from home'], ['🤒', 'Out sick'], ['🏖️', 'On leave']];
async function editStatus() {
  const cur = me.status && (!me.status.until || me.status.until > Date.now()) ? me.status : null;
  const pick = await popup({ icon: '💬', title: 'Set a status', text: cur ? `Now: ${statusText(cur)}` : 'Shown next to your name. It clears itself when you want.', ok: '', cancel: 'Cancel',
    choices: [...STATUSES.map(([e, t]) => ({ value: e + '|' + t, label: `${e}  ${t}` })), { value: 'custom', label: '✏️  Write my own…' }, ...(cur ? [{ value: 'clear', label: '✖  Clear status', cls: 'danger' }] : [])] });
  if (typeof pick !== 'string') return;
  if (pick === 'clear') return saveMe({ status: null }, 'Status cleared');
  let emoji = '💬', txt = '';
  if (pick === 'custom') {
    const v = await popup({ icon: '✏️', title: 'Your status', text: 'Start with an emoji if you like, e.g. “🏃 Back in 5”.', ok: 'Next', input: { value: '', maxLength: 60, required: true, requiredMsg: 'Write something' } });
    if (v === null) return;
    const m = v.match(/^(\p{Extended_Pictographic}[\u{FE0F}\u{200D}\p{Extended_Pictographic}]*)\s*(.*)$/u);
    if (m) { emoji = m[1]; txt = m[2]; } else txt = v;
  } else [emoji, txt] = pick.split('|');
  const endOfDay = new Date(); endOfDay.setHours(23, 59, 0, 0);
  const until = await popup({ icon: emoji, title: 'Clear after', ok: '', cancel: 'Cancel',
    choices: [{ value: 3600e3, label: '1 hour' }, { value: 4 * 3600e3, label: '4 hours' }, { value: endOfDay - Date.now(), label: 'Today' }, { value: 7 * 864e5, label: 'This week' }, { value: 0, label: 'Don’t clear' }] });
  if (typeof until !== 'number') return;
  await saveMe({ status: { emoji, text: txt, until: until ? Date.now() + until : 0 } }, `Status set: ${emoji} ${txt}`);
}
// Change / remove a profile photo (yours, or a group's when room is given)
async function choosePhoto(room, has) {
  if (has) {
    const v = await popup({ icon: '📷', title: room ? 'Group photo' : 'Profile photo', ok: '', cancel: 'Cancel', choices: [{ value: 'new', label: '🖼️  Choose a new photo' }, { value: 'remove', label: '🗑️  Remove photo', cls: 'danger' }] });
    if (v === 'remove') {
      if (room) { try { await api('group/update', { room, photo: null }); toast('Group photo removed'); repoll(); refreshRooms(); } catch (e) { toast(e.message); } }
      else await saveMe({ photo: null }, 'Photo removed');
      return;
    }
    if (v !== 'new') return;
  }
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = async () => {
    const file = inp.files[0]; if (!file) return;
    try {
      const data = await shrinkImage(file, 512, .85);
      const blob = await (await fetch(data)).blob();
      const r = await fetch('/api/avatar', { method: 'POST', body: blob, headers: { 'Content-Type': 'image/jpeg', 'X-Chat-Device': me.device, Authorization: 'Bearer ' + me.token, ...(room ? { 'X-Chat-Room': room } : {}) } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Upload failed');
      if (room) { toast('📷 Group photo updated'); repoll(); refreshRooms(); }
      else { Object.assign(me, d.user); store.set('ic-user', JSON.stringify(d.user)); paintMe(); renderSettings(); repaintUsers(); toast('📷 Profile photo updated'); }
    } catch (e) { toast(e.message); }
  };
  inp.click();
}

/* ---------------- Message formatting: *bold* _italic_ ~strike~ `code`, links, @mentions ---------------- */
function fmtText(str, depth = 0) {
  const frag = document.createDocumentFragment();
  const re = /(https?:\/\/[^\s<>"]*[^\s<>".,:;!?)\]'"])|@([a-z0-9_.]{3,20})|`([^`\n]+)`|([*_~])(\S(?:[^\n]*?\S)?)\4/gi;
  let last = 0, m;
  while ((m = re.exec(str))) {
    const i = m.index, before = str[i - 1] || ' ', after = str[re.lastIndex] || ' ';
    if (/\w/.test(before) || (m[4] && /\w/.test(after))) { re.lastIndex = i + 1; continue; }
    if (i > last) frag.append(str.slice(last, i));
    if (m[1]) { const a = document.createElement('a'); a.href = m[1]; a.textContent = m[1]; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.onclick = e => e.stopPropagation(); frag.append(a); }
    else if (m[2]) {
      const u = m[2].toLowerCase(), s = document.createElement('span');
      s.className = 'mention' + (u === me.username ? ' me' : ''); s.textContent = '@' + m[2];
      s.onclick = e => { e.stopPropagation(); openProfileByUsername(u); };
      frag.append(s);
    }
    else if (m[3]) { const c = document.createElement('code'); c.textContent = m[3]; frag.append(c); }
    else { const t = document.createElement({ '*': 'b', _: 'i', '~': 's' }[m[4]]); t.append(depth < 2 ? fmtText(m[5], depth + 1) : m[5]); frag.append(t); }
    last = re.lastIndex;
  }
  if (last < str.length) frag.append(str.slice(last));
  return frag;
}
async function openProfileByUsername(u) {
  if (u === me.username) return showProfile(me.uid);
  const known = (membersCache.list || []).find(x => x.username === u) || Object.values(profiles).find(p => p?.username === u);
  if (known) return showProfile(known.uid);
  try { const hit = (await api('friends/search', { q: u })).users.find(x => x.username === u); hit ? showProfile(hit.uid) : toast(`No one called @${u}`); } catch (e) { toast(e.message); }
}

/* ---------------- @mention suggestions ---------------- */
let mentionBox = null;
function closeMention() { mentionBox?.classList.add('hidden'); }
async function updateMention() {
  if (!current || group?.dm) return closeMention();
  const upto = text.value.slice(0, text.selectionStart), m = upto.match(/(^|\s)@([a-z0-9_.]{0,20})$/i);
  if (!m) return closeMention();
  if (membersCache.room !== current) { await loadMembers(); if (!text.value.slice(0, text.selectionStart).endsWith(m[0].trimStart())) return; }
  const q = m[2].toLowerCase();
  const hits = (membersCache.list || []).filter(x => x.uid !== me.uid && x.username && (x.username.startsWith(q) || x.name.toLowerCase().split(/\s+/).some(w => w.startsWith(q)))).slice(0, 6);
  if (!hits.length) return closeMention();
  if (!mentionBox) { mentionBox = el('div', 'mention-box'); mentionBox.setAttribute('role', 'listbox'); $('composer').before(mentionBox); }
  mentionBox.innerHTML = ''; mentionBox.classList.remove('hidden');
  for (const h of hits) {
    const b = el('button', 'mention-opt'); b.type = 'button'; b.setAttribute('role', 'option');
    const a = el('div', 'avatar'); paintUser(a, h.uid, h.name);
    const t = el('span'); t.append(el('b', null, h.name), el('small', 'muted', ' @' + h.username));
    b.append(a, t);
    b.onmousedown = e => e.preventDefault();          // keep the keyboard open
    b.onclick = () => pickMention(h.username);
    mentionBox.append(b);
  }
}
function pickMention(username) {
  const pos = text.selectionStart, upto = text.value.slice(0, pos).replace(/@([a-z0-9_.]{0,20})$/i, '@' + username + ' ');
  text.value = upto + text.value.slice(pos); text.setSelectionRange(upto.length, upto.length);
  closeMention(); autosize(); syncButtons(); if (current) drafts[current] = text.value; text.focus();
}
text.addEventListener('input', updateMention);
text.addEventListener('keydown', e => {
  if (!mentionBox || mentionBox.classList.contains('hidden')) return;
  if (e.key === 'Escape') { e.stopImmediatePropagation(); closeMention(); }
  if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) { e.preventDefault(); e.stopImmediatePropagation(); mentionBox.querySelector('button')?.click(); }
}, true);
text.addEventListener('blur', () => setTimeout(closeMention, 150));

/* ---------------- Edit, pin, remind ---------------- */
async function editMsg(el) {
  const m = el._msg;
  await popup({ icon: '✏️', title: 'Edit message', ok: 'Save', input: { value: m.text || '', maxLength: 2000, required: !m.gif, requiredMsg: 'A message can’t be empty — delete it instead' },
    onConfirm: async v => {
      if (v === (m.text || '')) return null;
      try { const d = await api('edit', { key: el.dataset.key, text: v }); edits[el.dataset.key] = { ...(edits[el.dataset.key] || {}), ...d.edit }; applyEdit(el.dataset.key); return null; }
      catch (e) { return e.message; }
    } });
}
let pins = [], pinIdx = 0, pinBar = null;
function setPins(list) {
  if (JSON.stringify(list) === JSON.stringify(pins)) return;
  pins = list || []; if (pinIdx >= pins.length) pinIdx = Math.max(0, pins.length - 1);
  if (!pinBar) {
    pinBar = el('div', 'pin-bar hidden'); pinBar.setAttribute('role', 'button'); pinBar.tabIndex = 0;
    $('walkieBanner').after(pinBar);
    pinBar.onclick = e => {
      const p = pins[pinIdx]; if (!p) return;
      if (e.target.closest('.pin-x')) return pinKey(p.key, false);
      jumpTo(p.key);
      if (pins.length > 1) { pinIdx = (pinIdx - 1 + pins.length) % pins.length; renderPinBar(); }   // next tap shows the older pin
    };
  }
  pinIdx = pins.length - 1;
  renderPinBar();
}
function renderPinBar() {
  if (!pinBar) return;
  const p = pins[pinIdx];
  pinBar.classList.toggle('hidden', !p);
  if (!p) return;
  pinBar.innerHTML = '';
  const dots = el('div', 'pin-dots'); for (let i = 0; i < pins.length; i++) dots.append(el('i', i === pinIdx ? 'on' : ''));
  const t = el('div', 'pin-text'); t.append(el('b', null, pins.length > 1 ? `📌 Pinned message ${pinIdx + 1} of ${pins.length}` : '📌 Pinned message'), el('span', null, `${p.name}: ${p.text}`));
  const x = el('button', 'icon-btn pin-x', '✕'); x.type = 'button'; x.title = 'Unpin'; x.setAttribute('aria-label', 'Unpin');
  pinBar.append(dots, t, x);
}
async function pinKey(key, on) {
  try { await api('pin', { key, on }); toast(on ? '📌 Pinned for everyone' : 'Unpinned'); repoll(); } catch (e) { toast(e.message); }
}
const pinMsg = (el, on) => pinKey(el.dataset.key, on);

// Choose a time: quick options or any date & time
async function pickTime(title, icon, quick) {
  const at = (d, h) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(h, 0, 0, 0); return x.getTime(); };
  const opts = [...quick.map(([ms, label]) => ({ value: Date.now() + ms, label }))];
  if (new Date().getHours() < 19) opts.push({ value: at(0, 20), label: 'Tonight at 8 PM' });
  opts.push({ value: at(1, 9), label: 'Tomorrow at 9 AM' });
  const mon = new Date(); mon.setDate(mon.getDate() + ((8 - mon.getDay()) % 7 || 7)); mon.setHours(9, 0, 0, 0);
  opts.push({ value: mon.getTime(), label: 'Monday at 9 AM' }, { value: 'custom', label: '📅 Pick date & time…' });
  const v = await popup({ icon, title, ok: '', cancel: 'Cancel', choices: opts });
  if (v === 'custom') {
    const d = new Date(Date.now() + 3600e3 - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
    const s = await popup({ icon, title, ok: 'Set', input: { type: 'datetime-local', value: d, required: true },
      onConfirm: async x => new Date(x).getTime() > Date.now() + 30_000 ? null : 'Pick a time in the future' });
    return s ? new Date(s).getTime() : null;
  }
  return typeof v === 'number' ? v : null;
}
const whenText = t => new Date(t).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
async function remindMsg(el) {
  const t = await pickTime('Remind me about this message', '🔔', [[20 * 60e3, 'In 20 minutes'], [3600e3, 'In 1 hour'], [3 * 3600e3, 'In 3 hours']]);
  if (!t) return;
  try { await api('remind', { key: el.dataset.key, at: t }); toast(`🔔 I’ll remind you ${whenText(t)}`); if (!pushActive) setTimeout(() => toast('Turn on notifications so reminders can reach you'), 3400); }
  catch (e) { toast(e.message); }
}

/* ---------------- Scheduled messages ---------------- */
async function scheduleCurrent() {
  const body = text.value.trim();
  if (!body) return toast('Type a message first, then hold ➤ to schedule it');
  if (group?.me && !group.me.canChat) return toast('You can’t send messages here right now');
  const t = await pickTime('Schedule message', '⏰', [[3600e3, 'In 1 hour'], [3 * 3600e3, 'In 3 hours']]);
  if (!t) return;
  try {
    await api('schedule', { text: body, at: t, replyTo: replyTo || undefined, loc: geo.loc });
    text.value = ''; delete drafts[current]; autosize(); syncButtons(); cancelReply();
    toast(`⏰ Scheduled for ${whenText(t)}`);
  } catch (e) { toast(e.message); }
}
async function showScheduled() {
  let list;
  try { list = (await api('schedule/list')).scheduled; } catch (e) { return toast(e.message); }
  const v = await popup({ icon: '⏰', title: 'Scheduled messages', text: list.length ? 'Tap one to cancel it.' : 'Nothing scheduled in this chat. Type a message, then press and hold ➤ (or right-click it) to send it later.', ok: '', cancel: 'Close',
    choices: list.map(j => ({ value: j.id, label: `${whenText(j.at)} — ${j.text.length > 50 ? j.text.slice(0, 50) + '…' : j.text}` })) });
  if (typeof v !== 'string') return;
  const j = list.find(x => x.id === v);
  const yes = await popup({ icon: '🗑️', title: 'Cancel this message?', text: `“${j.text}”\nwas going to be sent ${whenText(j.at)}.`, ok: 'Cancel message', cancel: 'Keep', danger: true });
  if (!yes) return;
  try { await api('schedule/cancel', { id: v }); toast('Scheduled message cancelled'); } catch (e) { toast(e.message); }
}
{
  // Press and hold (or right-click) ➤ to schedule
  const send = $('sendBtn'); let t = null, fired = false;
  send.addEventListener('pointerdown', () => { fired = false; clearTimeout(t); t = setTimeout(() => { fired = true; if (navigator.vibrate) navigator.vibrate(20); scheduleCurrent(); }, 550); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) send.addEventListener(ev, () => clearTimeout(t));
  send.addEventListener('click', e => { if (fired) { e.preventDefault(); fired = false; } });
  send.addEventListener('contextmenu', e => { e.preventDefault(); clearTimeout(t); if (!fired) scheduleCurrent(); fired = false; });
  send.title = 'Send (hold to schedule)';
}

/* ---------------- Search a chat ---------------- */
let infoMode = 'info', searchTimer = null;
function openSearch() {
  if (!current) return;
  infoMode = 'search';
  $('app').classList.add('info-open');
  $('infoTitle').textContent = 'Search messages';
  const body = $('infoBody'); body.innerHTML = '';
  const box = el('div', 'search-box'); const inp = el('input'); inp.type = 'search'; inp.placeholder = 'Search this chat…'; inp.id = 'msgSearch'; inp.setAttribute('aria-label', 'Search messages');
  box.append(inp); const res = el('div', 'search-results'); res.append(el('p', 'muted small empty-note', 'Find messages by words or by who sent them.'));
  body.append(box, res);
  inp.oninput = () => {
    clearTimeout(searchTimer);
    const q = inp.value.trim();
    if (q.length < 2) { res.replaceChildren(el('p', 'muted small empty-note', 'Type at least 2 letters.')); return; }
    searchTimer = setTimeout(async () => {
      let r; try { r = (await api('search', { q })).results; } catch (e) { res.replaceChildren(el('p', 'muted small empty-note', e.message)); return; }
      if (inp.value.trim() !== q) return;
      res.innerHTML = '';
      if (!r.length) res.append(el('p', 'muted small empty-note', `No messages with “${q}”.`));
      for (const m of r) {
        const row = el('button', 'search-hit'); row.type = 'button';
        const top = el('div', 'sh-top'); top.append(el('b', null, isMine(m) ? 'You' : m.name), el('small', 'muted', `${dayLabel(m.ts)} ${timeLabel(m.ts)}`));
        const snip = el('div', 'sh-text'), i = m.text.toLowerCase().indexOf(q.toLowerCase());
        if (i >= 0) { snip.append(m.text.slice(Math.max(0, i - 30), i)); snip.append(el('mark', null, m.text.slice(i, i + q.length))); snip.append(m.text.slice(i + q.length)); } else snip.textContent = m.text;
        row.append(top, snip);
        row.onclick = () => { if (!wide() || innerWidth < 1200) { $('app').classList.remove('info-open'); infoMode = 'info'; } jumpTo(m.key); };
        res.append(row);
      }
    }, 250);
  };
  setTimeout(() => inp.focus(), 60);
}

/* ---------------- App style picker ---------------- */
function stylePreview(st) {
  const v = st.pv[isDark() ? 'dark' : 'light'];
  const ph = el('div', 'sp-phone'); ph.style.background = v.bg;
  if (v.brutal) ph.style.border = `2px solid ${v.brutal}`; else if (v.line) ph.style.border = `1px solid ${v.line}`;
  const bar = el('div', 'sp-bar'); bar.style.background = v.bar; bar.style.color = v.ink;
  if (v.glass) { bar.style.backdropFilter = 'blur(8px)'; bar.style.borderBottom = '1px solid rgba(255,255,255,.4)'; }
  if (v.brutal) bar.style.borderBottom = '2px solid #111';
  if (v.line) bar.style.borderBottom = `1px solid ${v.line}`;
  const dot = el('i'); dot.style.background = v.ink; dot.style.opacity = .55; const ln = el('s'); ln.style.background = v.ink; ln.style.opacity = .55;
  bar.append(dot, ln);
  const body = el('div', 'sp-body');
  for (const [cls, bg] of [['in', v.inB], ['out', v.outB], ['in', v.inB]]) {
    const b = el('i', 'sp-b ' + cls); b.style.background = bg;
    if (v.brutal) { b.style.border = `2px solid ${v.brutal}`; b.style.boxShadow = `2px 2px 0 ${v.brutal}`; b.style.borderRadius = '4px'; }
    if (v.glass) b.style.border = '1px solid rgba(255,255,255,.45)';
    if (st.id === 'classic') b.style.borderRadius = '5px';
    if (v.neon) { b.style.border = '1px solid rgba(0,240,255,.5)'; b.style.boxShadow = cls === 'out' ? '0 0 10px rgba(255,47,214,.6)' : '0 0 8px rgba(0,240,255,.3)'; }
    if (v.clay) { b.style.boxShadow = '3px 4px 8px rgba(120,100,200,.25), inset 1px 1px 2px rgba(255,255,255,.7)'; b.style.borderRadius = '12px'; }
    body.append(b);
  }
  ph.append(bar, body);
  return ph;
}
function openStylePicker() {
  let dlg = $('styleSheet');
  if (!dlg) {
    dlg = document.createElement('dialog'); dlg.id = 'styleSheet'; dlg.className = 'sheet style-sheet';
    dlg.onclick = e => { if (e.target === dlg) dlg.close(); };
    document.body.append(dlg);
  }
  const render = () => {
    dlg.innerHTML = '';
    const inner = el('div', 'sheet-inner');
    const head = el('header', 'sheet-head'); head.append(el('h2', null, 'App style'));
    const x = el('button', 'icon-btn'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>'; x.onclick = () => dlg.close();
    head.append(x); inner.append(head);
    inner.append(el('p', 'muted small', 'Pick the look you like. Works with light and dark mode — change that under Theme.'));
    const grid = el('div', 'style-grid');
    for (const st of STYLES) {
      const b = el('button', 'style-opt' + (st.id === appStyle() ? ' on' : '')); b.type = 'button'; b.setAttribute('aria-pressed', st.id === appStyle());
      const t = el('b', null, `${st.icon} ${st.name}`); if (st.id === appStyle()) t.append(el('span', null, '✓'));
      b.append(stylePreview(st), t, el('small', null, st.desc));
      b.onclick = () => { store.set('ic-style', st.id); applyTheme(); renderSettings(); render(); if (current) applyWallpaper(current); };
      grid.append(b);
    }
    inner.append(grid);
    const th = el('button', 'btn block'); th.type = 'button'; th.textContent = '🌓 Theme: ' + ({ system: 'System default', light: 'Light', dark: 'Dark' }[store.get('ic-theme') || 'system']);
    th.onclick = async () => { dlg.close(); await chooseTheme(); openStylePicker(); };
    inner.append(th);
    dlg.append(inner);
  };
  render();
  if (!dlg.open) dlg.showModal();
}

/* ---------------- Start ---------------- */
applyTheme();
// Resume a saved session, otherwise show sign in (or create account when arriving from an invite)
(async () => {
  setAuthMode(linkedRoom() ? 'signup' : 'login');
  try { Object.assign(me, JSON.parse(store.get('ic-user') || '{}')); } catch {}
  if (!me.token) { $('login').classList.remove('hidden'); setTimeout(() => $('username').focus(), 50); return; }
  enterApp();                                   // optimistic: show the app straight away
  try { const d = await api('auth/me'); Object.assign(me, d.user); store.set('ic-user', JSON.stringify(d.user)); paintMe(); renderSettings(); }
  catch (e) { if (e.code !== 'auth') { /* offline: keep going */ } }
})();
