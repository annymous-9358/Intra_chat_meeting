'use strict';
/* Intra Chat client — long-polling chat with replies, seen ticks, GIFs, voice notes and location groups. */

const $ = id => document.getElementById(id);
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: k => { try { localStorage.removeItem(k); } catch {} },
};
const ICON = {
  reply: '<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v3"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>',
};
const finePointer = matchMedia('(pointer: fine)').matches;

// A random per-device secret: proves "this is the same phone" for location-group admin rights and requests
function deviceSecret() {
  let s = store.get('ic-device');
  if (!s || !/^[a-f0-9]{32}$/.test(s)) {
    s = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
    store.set('ic-device', s);
  }
  return s;
}

const me = { name: store.get('ic-name') || '', pw: store.get('ic-pw') || '', device: deviceSecret() };
let rooms = [], current = null;          // current = room slug
let since = '', version = '', seen = new Set(), pending = new Map(), replyTo = null;
let receipts = [], acked = { delivered: '', read: '' }, openReceipts = new Set();
let ctrl = null, pollTimer = null, polling = false, session = 0, failures = 0, lastTyping = 0;
let group = null;                        // location-group info for the current room (null for open rooms)
let lastRendered = null;                 // { name, ts, day } of the last message element, for grouping
let roomsTimer = null;

/* ---------------- API ---------------- */
async function api(route, body = {}, signal) {
  const r = await fetch('/api/' + route, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'X-Chat-Password': me.pw, 'X-Chat-Device': me.device },
    body: JSON.stringify({ name: me.name, room: current || 'general', ...body }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || 'HTTP ' + r.status); e.status = r.status; e.code = data.code; throw e; }
  return data;
}
async function upload(file) {
  const r = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Chat-Password': me.pw }, body: file });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'upload failed');
  return d.url;
}

let toastTimer;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

/* ---------------- Helpers ---------------- */
const slug = s => s.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').slice(0, 30);
function hue(str) { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function initials(s) { const p = s.replace(/[-_]/g, ' ').trim().split(/\s+/); return ((p[0]?.[0] || '?') + (p[1]?.[0] || '')).toUpperCase(); }
function paintAvatar(el, label, geo) {
  el.textContent = initials(label);
  el.style.background = `hsl(${hue(label)} 55% 48%)`;
  el.classList.toggle('geo', !!geo);
}
const nameColor = n => `hsl(${hue(n)} 60% var(--name-l, 42%))`;
function fmtDist(m) { if (m == null) return '?'; return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`; }
function fmtDur(s) { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function dayLabel(ts) {
  const d = new Date(ts), today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}
const timeLabel = ts => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const roomInfo = r => rooms.find(x => x.room === r) || { room: r };
const roomTitle = r => roomInfo(r).title || '#' + r;
// Range slider snaps to round distances between 50 m and 50 km
const RANGES = [50, 100, 150, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000, 15000, 20000, 30000, 50000];
const sliderToRadius = v => RANGES[Math.min(Math.max(Math.round(v), 0), RANGES.length - 1)];
const radiusToSlider = r => RANGES.reduce((best, x, i) => Math.abs(x - r) < Math.abs(RANGES[best] - r) ? i : best, 0);

/* ---------------- Login ---------------- */
$('name').value = me.name; $('pw').value = me.pw;
$('loginForm').onsubmit = async e => {
  e.preventDefault();
  me.name = $('name').value.trim().slice(0, 24); me.pw = $('pw').value;
  if (!me.name) return;
  $('err').textContent = ''; $('loginBtn').disabled = true;
  try {
    const d = await api('rooms', { room: 'general' });
    store.set('ic-name', me.name); store.set('ic-pw', me.pw);
    rooms = d.rooms; enterApp();
  } catch (err) { $('err').textContent = err.status === 401 ? 'Wrong password' : err.message; }
  finally { $('loginBtn').disabled = false; }
};
$('logoutBtn').onclick = () => {
  if (!confirm('Sign out on this device?')) return;
  store.del('ic-pw'); leaveRoom(); clearInterval(roomsTimer);
  $('app').classList.add('hidden'); $('login').classList.remove('hidden'); $('pw').value = '';
};
function enterApp() {
  $('login').classList.add('hidden'); $('app').classList.remove('hidden');
  paintAvatar($('meAvatar'), me.name); $('meName').textContent = me.name;
  renderRooms();
  clearInterval(roomsTimer);
  roomsTimer = setInterval(() => { if (!current && !document.hidden) refreshRooms(); }, 15000);
  const last = store.get('ic-room');
  // On tablets/desktops open the last chat straight away; phones start on the chat list
  if (matchMedia('(min-width: 768px)').matches) openRoom(last && rooms.some(r => r.room === last) ? last : 'general');
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}
async function refreshRooms() { try { const r = (await api('rooms')).rooms; if (JSON.stringify(r) !== JSON.stringify(rooms)) { rooms = r; renderRooms(); } } catch {} }

/* ---------------- Chat list ---------------- */
function renderRooms() {
  const q = $('roomSearch').value.trim().toLowerCase();
  const list = $('roomList'); list.innerHTML = '';
  const shown = rooms.filter(r => !q || r.room.includes(q) || (r.title || '').toLowerCase().includes(q));
  for (const r of shown) {
    const li = document.createElement('li'); if (r.room === current) li.className = 'active';
    const b = document.createElement('button');
    const av = document.createElement('div'); av.className = 'avatar'; paintAvatar(av, r.title || r.room, r.geo);
    const meta = document.createElement('div'); meta.className = 'room-meta';
    const t = document.createElement('b'); t.textContent = r.title || '#' + r.room;
    const sub = document.createElement('small');
    if (r.geo) { sub.className = 'geo'; sub.textContent = `📍 Location group · ${fmtDist(r.radius)} range`; } else sub.textContent = 'Open group';
    meta.append(t, sub); b.append(av, meta);
    b.onclick = () => openRoom(r.room);
    li.append(b); list.append(li);
  }
  if (!shown.length) list.innerHTML = '<li class="room-empty">No groups match.</li>';
}
$('roomSearch').oninput = renderRooms;

/* ---------------- Opening / leaving a room ---------------- */
function openRoom(room) {
  if (current === room && $('app').classList.contains('in-chat')) return;
  leaveRoom();
  current = room; store.set('ic-room', room);
  session++; since = ''; version = ''; seen = new Set(); pending = new Map(); receipts = [];
  acked = { delivered: '', read: '' }; openReceipts = new Set(); group = null; lastRendered = null;
  cancelReply(); closeGifs();
  $('messages').innerHTML = '';
  $('app').classList.add('in-chat', 'has-room');
  $('chatBar').classList.remove('hidden'); $('composerWrap').classList.remove('hidden');
  $('chatTitle').textContent = roomTitle(room); $('chatSub').textContent = 'connecting…';
  paintAvatar($('chatAvatar'), roomInfo(room).title || room, roomInfo(room).geo);
  renderRooms(); updateComposerLock(); renderAdminBanner();
  if (roomInfo(room).geo) startLocation();
  poll(session);
  if (finePointer) $('text').focus();
}
function leaveRoom() {
  session++; clearTimeout(pollTimer); ctrl?.abort(); polling = false;
  stopLocation(); stopAllAudio();
  current = null; group = null;
}
$('backBtn').onclick = () => {
  leaveRoom(); $('app').classList.remove('in-chat', 'info-open'); renderRooms(); refreshRooms();
};

/* ---------------- Long-poll loop ---------------- */
async function poll(mySession) {
  if (polling) return;
  polling = true;
  ctrl = new AbortController();
  const myCtrl = ctrl;
  const wait = version ? 7000 : 0;    // first request returns at once; after that, wait for changes
  const watchdog = setTimeout(() => myCtrl.abort(), wait + 15000);
  try {
    const ack = {};
    if (since && since > acked.delivered) ack.delivered = since;
    if (since && !document.hidden && since > acked.read) ack.read = since;
    const d = await api('poll', { since, version, wait, ack, loc: geo.loc }, myCtrl.signal);
    if (mySession !== session) return;
    if (ack.delivered) acked.delivered = ack.delivered;
    if (ack.read) acked.read = ack.read;
    failures = 0; $('status').classList.remove('bad'); $('status').title = 'Connected';
    const first = !since;
    version = d.version || '';
    const fresh = d.messages.filter(m => !seen.has(m.key));
    for (const m of fresh) { addMessage(m); if (!first) notify(m); }
    if (fresh.length) scrollDown(first);
    if (d.rooms && JSON.stringify(d.rooms) !== JSON.stringify(rooms)) { rooms = d.rooms; renderRooms(); }
    receipts = d.receipts || [];
    setGroup(d.group);
    renderPresence(d.users || []);
    updateTicks();
  } catch (err) {
    if (mySession !== session || err.name === 'AbortError') return;
    if (err.status === 401) { toast('Password changed — please sign in again.'); $('logoutBtn').click(); return; }
    failures++; $('status').classList.add('bad'); $('status').title = 'Reconnecting…'; $('chatSub').textContent = 'reconnecting…';
  } finally {
    clearTimeout(watchdog);
    if (ctrl === myCtrl) polling = false;
    if (mySession === session) {
      clearTimeout(pollTimer);
      const delay = failures ? Math.min(1000 * 2 ** failures, 15000) : (document.hidden ? 3000 : 0);
      pollTimer = setTimeout(() => poll(mySession), delay);
    }
  }
}
function repoll() { if (!current) return; if (polling) ctrl?.abort(); else poll(session); }
document.addEventListener('visibilitychange', () => { if (!document.hidden && current) repoll(); });

function renderPresence(users) {
  const others = users.filter(u => u.name !== me.name);
  const typing = others.filter(u => u.typing).map(u => u.name);
  $('typing').textContent = typing.length ? `${typing.join(', ')} ${typing.length > 1 ? 'are' : 'is'} typing…` : '';
  let sub = typing.length ? 'typing…' : `${users.length} online`;
  if (group) sub += ` · 📍 ${fmtDist(group.radius)} range`;
  $('chatSub').textContent = sub;
  presenceCache = users;
  if ($('app').classList.contains('info-open')) renderInfo();
}
let presenceCache = [];

/* ---------------- Messages ---------------- */
function addMessage(m) {
  seen.add(m.key);
  if (m.key > since) since = m.key;
  const el = m.cid && pending.get(m.cid);
  if (el) { pending.delete(m.cid); confirmPending(el, m); return; }
  render(m);
}
function confirmPending(el, m) {
  el.classList.remove('pending'); el._msg = m; el.dataset.key = m.key;
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
  const mine = m.name === me.name;
  const cont = lastRendered && lastRendered.name === m.name && m.ts - lastRendered.ts < 5 * 60_000;
  lastRendered = { name: m.name, ts: m.ts, day };

  const el = document.createElement('div');
  el.className = 'msg' + (mine ? ' mine' : '') + (cont ? ' cont' : '') + (isPending ? ' pending' : '');
  el._msg = m; if (m.key) el.dataset.key = m.key;
  if (!mine) { const who = document.createElement('span'); who.className = 'who'; who.textContent = m.name; who.style.color = nameColor(m.name); el.append(who); }
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
    img.onload = () => { if (nearBottom()) scrollDown(); };
    el.append(img);
  }
  if (m.audio) el.append(voicePlayer(m.audio, m.localUrl));
  if (m.text) { const body = document.createElement('span'); body.className = 'body'; body.textContent = m.text; el.append(body); }
  if (!m.text) el.classList.add('media-only');

  const foot = document.createElement('span'); foot.className = 'foot';
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
  el.append(btn, icon);
  el.addEventListener('dblclick', e => { if (!e.target.closest('img, .voice') && !window.getSelection().toString()) startReply(el); });
  addSwipe(el, icon);
  box.append(el);
  return el;
}
const nearBottom = () => { const b = $('messages'); return b.scrollHeight - b.scrollTop - b.clientHeight < 400; };
function scrollDown(force) { const b = $('messages'); if (force || nearBottom()) b.scrollTop = b.scrollHeight; }

function quoteEl(r) {
  const q = document.createElement('div'); q.className = 'quote';
  const n = document.createElement('b'); n.textContent = r.name === me.name ? 'You' : r.name;
  q.append(n, r.text);
  return q;
}
function jumpTo(key) {
  const target = [...$('messages').children].find(x => x.dataset.key === key);
  if (!target) return toast('That message is no longer loaded');
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.remove('flash'); void target.offsetWidth; target.classList.add('flash');
}
const previewText = m => m.text || (m.audio ? `🎤 Voice message (${fmtDur(m.audio.dur)})` : m.gif ? '🎞️ GIF' : '');

function notify(m) {
  if (m.name === me.name || !document.hidden) return;
  const title = m.replyTo?.name === me.name ? `${m.name} replied to you` : `${m.name} · ${roomTitle(m.room)}`;
  if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body: previewText(m) });
}

/* ---------------- Seen ticks ---------------- */
function updateTicks() {
  const others = receipts.filter(r => r.name !== me.name);
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
function startReply(el) {
  const m = el._msg;
  if (!m?.key) return;
  if (group && !group.me.canChat) return toast('You can’t reply until you’re allowed to chat here');
  replyTo = { key: m.key, name: m.name, text: previewText(m).slice(0, 140) };
  $('replyName').textContent = m.name === me.name ? 'You' : m.name;
  $('replyText').textContent = replyTo.text;
  $('replyBar').classList.remove('hidden');
  if (navigator.vibrate) navigator.vibrate(15);
  $('text').focus();
}
function cancelReply() { replyTo = null; $('replyBar').classList.add('hidden'); }
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
function autosize() { text.style.height = 'auto'; text.style.height = Math.min(text.scrollHeight, 140) + 'px'; }
function syncButtons() { const has = text.value.trim().length > 0; $('sendBtn').classList.toggle('hidden', !has); $('micBtn').classList.toggle('hidden', has); }
text.addEventListener('input', () => {
  autosize(); syncButtons();
  if (Date.now() - lastTyping < 2000 || !current) return;
  lastTyping = Date.now(); api('typing').catch(() => {});
});
text.addEventListener('keydown', e => {
  if (e.key === 'Escape') { cancelReply(); closeGifs(); }
  // Enter sends on keyboards; on phones Enter adds a new line (like WhatsApp)
  if (e.key === 'Enter' && !e.shiftKey && finePointer && !e.isComposing) { e.preventDefault(); $('composer').requestSubmit(); }
});
$('composer').onsubmit = e => {
  e.preventDefault();
  const t = text.value.trim(); if (!t) return;
  text.value = ''; autosize(); syncButtons();
  sendMessage({ text: t });
};

async function sendMessage({ text: body = '', gif, audio, upload: file, localUrl }) {
  if (group && !group.me.canChat) { toast('You can’t send messages here right now'); return; }
  const cid = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const reply = replyTo; cancelReply();
  const el = render({ name: me.name, text: body, gif, audio, localUrl, ts: Date.now(), replyTo: reply || undefined }, true);
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
    toast(err.code === 'out_of_range' ? err.message : 'Not sent: ' + err.message);
    if (err.code === 'out_of_range') repoll();
    if (reply) { replyTo = reply; $('replyName').textContent = reply.name === me.name ? 'You' : reply.name; $('replyText').textContent = reply.text; $('replyBar').classList.remove('hidden'); }
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
mic.addEventListener('pointerdown', async e => {
  if (e.button !== 0 || rec.state !== 'idle') return;
  if (group && !group.me.canChat) return toast('You can’t send messages here right now');
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast('Voice messages aren’t supported in this browser');
  e.preventDefault();
  mic.setPointerCapture(e.pointerId);
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
    mic.classList.add('recording'); $('recBar').classList.remove('hidden'); $('recBar').classList.remove('cancel');
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
    toast(err.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in your browser settings.' : 'Couldn’t start recording: ' + err.message);
  }
});
mic.addEventListener('pointermove', e => {
  if (rec.state !== 'recording' || e.pointerId !== rec.pointer) return;
  const dx = Math.min(0, e.clientX - rec.x0);
  $('recHint').style.transform = `translateX(${dx / 2}px)`;
  rec.cancel = dx < -90;
  $('recBar').classList.toggle('cancel', rec.cancel);
  $('recHint').textContent = rec.cancel ? 'Release to cancel' : '‹ Slide to cancel';
});
mic.addEventListener('pointerup', () => onMicRelease());
mic.addEventListener('pointercancel', () => { rec.cancel = true; onMicRelease(); });
mic.addEventListener('contextmenu', e => e.preventDefault());
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
    if (!send) { toast('Voice message cancelled'); return; }
    if (dur < 0.8) { toast('Hold the mic to record'); return; }
    sendMessage({ audio: { dur: Math.round(dur * 10) / 10, peaks }, upload: blob, localUrl: URL.createObjectURL(blob) });
  };
  recorder.stop();
}
function resetRecUI() {
  rec.state = 'idle'; mic.classList.remove('recording'); $('recBar').classList.add('hidden');
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
    time.textContent = audio && (audio.currentTime > 0) ? fmtDur(audio.currentTime) : fmtDur(a.dur);
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
  const seek = e => {
    const r = wave.getBoundingClientRect(), p = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
    const au = ensure();
    const go = () => { au.currentTime = p * dur(); paint(); };
    if (au.readyState >= 1) go(); else au.addEventListener('loadedmetadata', go, { once: true });
  };
  wave.addEventListener('pointerdown', e => { e.stopPropagation(); seek(e); });
  return wrap;
}

/* ---------------- GIF picker ---------------- */
let gifTimer = null, gifQuery = null, gifReq = 0;
$('gifBtn').onclick = () => {
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
  geo.watch = navigator.geolocation.watchPosition(p => {
    const first = !geo.loc;
    geo.loc = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) };
    geo.error = null;
    if (first) repoll();       // report position straight away
  }, err => {
    geo.error = err.code === 1 ? 'denied' : 'unavailable';
    updateComposerLock();
  }, { enableHighAccuracy: true, maximumAge: 20000, timeout: 30000 });
}
function stopLocation() { if (geo.watch != null) navigator.geolocation.clearWatch(geo.watch); geo.watch = null; geo.loc = null; }
function getLocationOnce() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('Location isn’t available in this browser'));
    navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
      err => rej(new Error(err.code === 1 ? 'Location access was blocked. Allow it in your browser settings.' : 'Couldn’t get your location')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 });
  });
}

function setGroup(g) {
  const wasGeo = !!group;
  group = g || null;
  if (group && !wasGeo) startLocation();
  if (group) {
    const r = roomInfo(current); r.geo = true; r.radius = group.radius; r.title = group.title;
    $('chatTitle').textContent = group.title; paintAvatar($('chatAvatar'), group.title, true);
  }
  updateComposerLock(); renderAdminBanner();
  if ($('app').classList.contains('info-open')) renderInfo();
}

// When a member can't chat, the composer is replaced by an explanation + action (like WhatsApp's "only admins can send")
function updateComposerLock() {
  const locked = $('lockedBar'), comp = $('composer');
  if (!group || group.me.canChat) {
    locked.classList.add('hidden'); comp.classList.remove('hidden');
    return;
  }
  comp.classList.add('hidden'); locked.classList.remove('hidden'); closeGifs(); cancelReply();
  const m = group.me, admin = group.adminName || 'the admin', range = fmtDist(group.radius);
  let icon = '📍', msg, action = null;
  if (geo.error === 'denied') { msg = `This group only works within ${range}. Allow location access in your browser to chat.`; action = ['Try again', () => { stopLocation(); startLocation(); }]; }
  else if (geo.error === 'unsupported') msg = 'Your browser can’t share location, so you can only read this group.';
  else if (!m.hasLocation && !geo.loc) msg = `Checking your location… This group only works within ${range}.`;
  else if (m.req === 'pending') { icon = '⏳'; msg = `You’re ${fmtDist(m.dist)} away, outside the ${range} range. Your request was sent to ${admin} — you can chat once they approve.`; }
  else if (m.req === 'denied') { icon = '🚫'; msg = `${admin} declined your request to chat from outside the ${range} range. You can still read messages.`; action = ['Ask again', requestAccess]; }
  else { msg = `You’re ${fmtDist(m.dist)} away — outside this group’s ${range} range. You can still read messages.`; action = ['Ask to chat', requestAccess]; }
  locked.innerHTML = '';
  const row = document.createElement('div'); row.className = 'row';
  const ico = document.createElement('span'); ico.className = 'ico'; ico.textContent = icon;
  const p = document.createElement('span'); p.textContent = msg;
  row.append(ico, p); locked.append(row);
  if (action) { const b = document.createElement('button'); b.className = 'btn primary'; b.textContent = action[0]; b.onclick = action[1]; locked.append(b); }
}
async function requestAccess() {
  const note = prompt(`Add a note for ${group?.adminName || 'the admin'} (optional):`, '') ;
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

/* ---------------- Group info panel ---------------- */
function openInfo() { if (!current) return; $('app').classList.add('info-open'); renderInfo(); }
$('infoBtn').onclick = () => $('app').classList.contains('info-open') ? $('app').classList.remove('info-open') : openInfo();
$('chatHead').onclick = openInfo;
$('infoClose').onclick = () => $('app').classList.remove('info-open');

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function renderInfo() {
  const body = $('infoBody'); const scroll = body.scrollTop;
  if (body.contains(document.activeElement) && document.activeElement.type === 'range') return;   // don't disturb a slider mid-drag
  body.innerHTML = '';
  const info = roomInfo(current);
  const hero = el('div', 'info-hero');
  const av = el('div', 'avatar'); paintAvatar(av, group?.title || info.title || current, !!group);
  hero.append(av, el('h2', null, group?.title || roomTitle(current)),
    el('span', 'muted', group ? `📍 Location group · admin ${group.adminName || '?'}` : 'Open group · anyone with the password'));
  body.append(hero);

  if (group) {
    const c = el('div', 'card'); c.append(el('h3', null, 'Range'));
    c.append(radar(group));
    const m = group.me;
    const kv = (k, v) => { const r = el('div', 'kv'); r.append(el('span', null, k), v instanceof Node ? v : el('span', null, v)); c.append(r); };
    kv('Range', fmtDist(group.radius));
    if (!group.isAdmin) {
      kv('Your distance', m.dist == null ? (geo.error === 'denied' ? 'Location blocked' : 'Checking…') : `${fmtDist(m.dist)}${m.acc ? ` (±${fmtDist(m.acc)})` : ''}`);
      const chip = el('span', 'chip ' + (m.inside ? 'ok' : m.approved ? 'brand' : 'warn'),
        m.inside ? 'Inside — can chat' : m.approved ? 'Approved — can chat' : m.req === 'pending' ? 'Request pending' : 'Outside — read only');
      kv('Status', chip);
    } else {
      kv('You', el('span', 'chip brand', 'Admin — can always chat'));
      // Admin controls
      const row = el('div', 'slider-row');
      const slider = el('input'); slider.type = 'range'; slider.min = 0; slider.max = RANGES.length - 1; slider.step = 1; slider.value = radiusToSlider(group.radius); slider.setAttribute('aria-label', 'Group range');
      const out = el('output', null, fmtDist(group.radius));
      slider.oninput = () => out.textContent = fmtDist(sliderToRadius(+slider.value));
      row.append(slider, out);
      const save = el('button', 'btn small primary', 'Save range');
      save.onclick = async () => { try { await api('group/update', { radius: sliderToRadius(+slider.value) }); toast('Range updated'); slider.blur(); repoll(); } catch (e) { toast(e.message); } };
      const recBtn = el('button', 'btn small', 'Move centre to my location');
      recBtn.onclick = async () => {
        if (!confirm('Set the group centre to where you are now? Everyone’s range status will be re-checked.')) return;
        try { const loc = await getLocationOnce(); await api('group/update', { recenter: true, loc }); toast('Centre moved'); repoll(); } catch (e) { toast(e.message); }
      };
      const btns = el('div', 'btn-row'); btns.append(save, recBtn);
      c.append(el('h3', null, 'Change range'), row, btns);
    }
    body.append(c);

    if (group.isAdmin) {
      const mc = el('div', 'card'); mc.append(el('h3', null, `Members (${(group.members || []).length})`));
      if (!(group.members || []).length) mc.append(el('p', 'muted small', 'Nobody else has opened this group yet.'));
      for (const mm of group.members || []) {
        const row = el('div', 'member');
        const a = el('div', 'avatar'); paintAvatar(a, mm.name);
        const meta = el('div', 'm-meta'); meta.append(el('b', null, mm.name));
        const where = mm.inside == null ? 'Location unknown' : `${mm.inside ? 'Inside' : 'Outside'} · ${fmtDist(mm.dist)} away`;
        meta.append(el('small', null, where + (mm.approved ? ' · approved' : '')));
        if (mm.req === 'pending' && mm.note) meta.append(el('small', 'note', `“${mm.note}”`));
        const acts = el('div', 'm-actions');
        const act = (label, cls, action) => { const b = el('button', 'btn small ' + cls, label); b.onclick = async () => { b.disabled = true; try { await api('group/decide', { member: mm.id, action }); repoll(); } catch (e) { toast(e.message); b.disabled = false; } }; acts.append(b); };
        if (mm.req === 'pending') { act('Approve', 'ok', 'approve'); act('Deny', 'ghost', 'deny'); }
        else if (mm.approved) act('Revoke', 'ghost', 'revoke');
        else if (mm.req === 'denied') acts.append(el('span', 'chip warn', 'Denied'));
        else acts.append(el('span', 'chip ' + (mm.inside ? 'ok' : mm.inside === false ? 'warn' : ''), mm.inside ? 'Can chat' : mm.inside === false ? 'Read only' : '—'));
        row.append(a, meta, acts); mc.append(row);
      }
      body.append(mc);
    }
  }

  const oc = el('div', 'card'); oc.append(el('h3', null, `Online now (${presenceCache.length})`));
  for (const u of presenceCache) { const row = el('div', 'member'); const a = el('div', 'avatar'); paintAvatar(a, u.name); const meta = el('div', 'm-meta'); meta.append(el('b', null, u.name === me.name ? `${u.name} (you)` : u.name)); row.append(a, meta); oc.append(row); }
  body.append(oc);
  body.scrollTop = scroll;
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
  const people = g.isAdmin ? (g.members || []).filter(m => m.dist != null) : (g.me.dist != null ? [{ name: me.name, dist: g.me.dist, inside: g.me.inside }] : []);
  for (const p of people) {
    const ang = (hue(p.name) / 360) * Math.PI * 2, r = scale(p.dist);
    add('circle', { cx: C + Math.cos(ang) * r, cy: C + Math.sin(ang) * r, r: 6, class: 'dot', fill: p.inside ? 'var(--ok)' : 'var(--warn)' })
      .append(Object.assign(document.createElementNS(NS, 'title'), { textContent: `${p.name}: ${fmtDist(p.dist)}` }));
  }
  return svg;
}

/* ---------------- New group ---------------- */
let ngLoc = null;
$('newGroupBtn').onclick = () => {
  $('newGroupForm').reset(); $('ngErr').textContent = ''; $('ngGeo').classList.add('hidden'); ngLoc = null;
  $('ngRadiusOut').textContent = fmtDist(sliderToRadius(+$('ngRadius').value));
  $('newGroup').showModal(); $('ngName').focus();
};
$('ngClose').onclick = () => $('newGroup').close();
$('ngRadius').oninput = () => $('ngRadiusOut').textContent = fmtDist(sliderToRadius(+$('ngRadius').value));
for (const r of document.querySelectorAll('input[name=ngType]')) r.onchange = async () => {
  const isGeo = r.value === 'geo' && r.checked;
  $('ngGeo').classList.toggle('hidden', !isGeo);
  if (isGeo && !ngLoc) {
    const s = $('ngLoc'); s.className = 'loc-status'; s.textContent = 'Getting your location…';
    try { ngLoc = await getLocationOnce(); s.className = 'loc-status ok'; s.textContent = `✓ Location found (accuracy ±${fmtDist(ngLoc.acc)}). This will be the centre.`; }
    catch (e) { s.className = 'loc-status bad'; s.textContent = e.message; }
  }
};
$('newGroupForm').onsubmit = async e => {
  e.preventDefault();
  const title = $('ngName').value.trim(), room = slug(title);
  if (!room) { $('ngErr').textContent = 'Use letters or numbers in the name'; return; }
  const isGeo = document.querySelector('input[name=ngType]:checked').value === 'geo';
  $('ngErr').textContent = '';
  if (!isGeo) {
    if (!rooms.some(r => r.room === room)) rooms.push({ room, title: null, geo: false });
    $('newGroup').close(); openRoom(room); return;
  }
  if (!ngLoc) { try { ngLoc = await getLocationOnce(); } catch (err) { $('ngErr').textContent = err.message; return; } }
  $('ngCreate').disabled = true;
  try {
    const radius = sliderToRadius(+$('ngRadius').value);
    await api('group/create', { room, title, radius, loc: ngLoc });
    rooms.push({ room, title, geo: true, radius });
    $('newGroup').close(); openRoom(room);
    toast(`📍 “${title}” created — you’re the admin`);
  } catch (err) { $('ngErr').textContent = err.message; }
  finally { $('ngCreate').disabled = false; }
};

/* ---------------- Start ---------------- */
// Auto sign-in if we already have a name + password on this device
if (me.name && me.pw) $('loginForm').requestSubmit();
