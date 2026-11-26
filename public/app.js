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
/* ---------------- Icons (one line-icon set used everywhere; no emoji in the interface) ---------------- */
const IC = {
  "user": "<circle cx=\"12\" cy=\"8\" r=\"4\"/><path d=\"M4 21c1-4 4.5-6 8-6s7 2 8 6\"/>",
  "userPlus": "<circle cx=\"9\" cy=\"8\" r=\"4\"/><path d=\"M2 21c1-4 4-6 7-6s6 2 7 6M19 8v6M16 11h6\"/>",
  "userMinus": "<circle cx=\"9\" cy=\"8\" r=\"4\"/><path d=\"M2 21c1-4 4-6 7-6s6 2 7 6M16 11h6\"/>",
  "userCheck": "<circle cx=\"9\" cy=\"8\" r=\"4\"/><path d=\"M2 21c1-4 4-6 7-6s6 2 7 6M16 11l2 2 4-4\"/>",
  "users": "<circle cx=\"9\" cy=\"8\" r=\"3.5\"/><path d=\"M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5\"/><circle cx=\"17\" cy=\"9\" r=\"2.6\"/><path d=\"M16.5 14.6c2.6.1 4.5 1.8 5 4.4\"/>",
  "info": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 11v6M12 7.5v.01\"/>",
  "message": "<path d=\"M21 12a8.5 8.5 0 0 1-12.6 7.4L3 21l1.7-5A8.5 8.5 0 1 1 21 12z\"/>",
  "eyeOff": "<path d=\"M9.9 4.2A10.6 10.6 0 0 1 12 4c6.5 0 10 8 10 8a17.8 17.8 0 0 1-3.2 4.3M6.6 6.6C3.7 8.4 2 12 2 12s3.5 8 10 8c1.8 0 3.4-.5 4.8-1.3M9.9 9.9a3 3 0 0 0 4.2 4.2M2 2l20 20\"/>",
  "arrowLeft": "<path d=\"M19 12H5M11 18l-6-6 6-6\"/>",
  "eye": "<path d=\"M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/>",
  "contrast": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 3a9 9 0 0 1 0 18z\" fill=\"currentColor\"/>",
  "sparkles": "<path d=\"M11 3l1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9z\"/><path d=\"M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z\"/>",
  "image": "<rect x=\"3\" y=\"4\" width=\"18\" height=\"16\" rx=\"2.5\"/><circle cx=\"9\" cy=\"10\" r=\"2\"/><path d=\"M21 16l-5-5-9 9\"/>",
  "radio": "<rect x=\"6\" y=\"7\" width=\"12\" height=\"15\" rx=\"2\"/><path d=\"M9 7V2M10 11h4M10 14h4\"/><circle cx=\"12\" cy=\"18\" r=\"1.5\"/>",
  "bell": "<path d=\"M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8\"/><path d=\"M10.3 21a1.9 1.9 0 0 0 3.4 0\"/>",
  "bellOff": "<path d=\"M8.7 3.6A6 6 0 0 1 18 8c0 3 .5 5 1.2 6.3M17 17H3s3-1 3-8c0-.6.1-1.2.3-1.8\"/><path d=\"M10.3 21a1.9 1.9 0 0 0 3.4 0M3 3l18 18\"/>",
  "download": "<path d=\"M12 3v12M7 10l5 5 5-5M5 21h14\"/>",
  "key": "<circle cx=\"7.5\" cy=\"15.5\" r=\"4.5\"/><path d=\"M10.7 12.3 21 2M16 7l3 3M18.5 4.5l2 2\"/>",
  "logout": "<path d=\"M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3\"/>",
  "settings": "<circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z\"/>",
  "link": "<path d=\"M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1\"/><path d=\"M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1\"/>",
  "search": "<circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"M20 20l-4-4\"/>",
  "clock": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7v5l3 2\"/>",
  "lock": "<rect x=\"5\" y=\"11\" width=\"14\" height=\"10\" rx=\"2\"/><path d=\"M8 11V7a4 4 0 0 1 8 0v4\"/>",
  "unlock": "<rect x=\"5\" y=\"11\" width=\"14\" height=\"10\" rx=\"2\"/><path d=\"M8 11V7a4 4 0 0 1 7.6-1.7\"/>",
  "pin": "<path d=\"M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z\"/><circle cx=\"12\" cy=\"9\" r=\"2.5\"/>",
  "trash": "<path d=\"M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6\"/>",
  "pencil": "<path d=\"M4 20h4L19 9l-4-4L4 16v4z\"/><path d=\"m14 6 4 4\"/>",
  "crown": "<path d=\"M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z\"/>",
  "camera": "<path d=\"M3 8.5A2.5 2.5 0 0 1 5.5 6H7l2-2h6l2 2h1.5A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z\"/><circle cx=\"12\" cy=\"13\" r=\"3.5\"/>",
  "pinned": "<path d=\"M9 4h6l-1 6 4 4H6l4-4-1-6zM12 14v7\"/>",
  "calendar": "<rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M3 10h18M8 3v4M16 3v4\"/>",
  "check": "<path d=\"M5 12.5l4.5 4.5L19 7.5\"/>",
  "checks": "<path d=\"M2 12.5l4.5 4.5L16 7.5M10.5 16.5l.5.5L20.5 7.5\"/>",
  "x": "<path d=\"M6 6l12 12M18 6 6 18\"/>",
  "smile": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M8.5 14.5s1.3 2 3.5 2 3.5-2 3.5-2M9 9.5h.01M15 9.5h.01\"/>",
  "ban": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M5.6 5.6l12.8 12.8\"/>",
  "mic": "<rect x=\"9\" y=\"3\" width=\"6\" height=\"11\" rx=\"3\"/><path d=\"M5 11a7 7 0 0 0 14 0M12 18v3\"/>",
  "fingerprint": "<path d=\"M12 11v3a8 8 0 0 1-1.5 4.7M8.5 13.5V11a3.5 3.5 0 0 1 7 0v1M18.8 15.5A13 13 0 0 0 19 13v-2a7 7 0 0 0-11.5-5.4M5 15v-4a7 7 0 0 1 .9-3.4M15.4 15.6a12 12 0 0 1-1.5 4.6M5.7 18.6A10.6 10.6 0 0 0 8.5 13.5\"/>",
  "volumeOff": "<path d=\"M4 9h4l5-4v14l-5-4H4z\"/><path d=\"M16 9l6 6M22 9l-6 6\"/>",
  "volume": "<path d=\"M4 9h4l5-4v14l-5-4H4z\"/><path d=\"M16.5 9a4 4 0 0 1 0 6M19.5 6a8 8 0 0 1 0 12\"/>",
  "signal": "<path d=\"M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01M3 3l18 18\"/>",
  "hourglass": "<path d=\"M7 3h10M7 21h10M8 3c0 4 8 5 8 9s-8 5-8 9M16 3c0 4-8 5-8 9s8 5 8 9\"/>",
  "globe": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18\"/>",
  "coffee": "<path d=\"M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 11h1.5a2.5 2.5 0 0 1 0 5H17M8 2.5v3M12 2.5v3\"/>",
  "headphones": "<path d=\"M4 16v-4a8 8 0 0 1 16 0v4\"/><rect x=\"3\" y=\"14\" width=\"4\" height=\"7\" rx=\"1.5\"/><rect x=\"17\" y=\"14\" width=\"4\" height=\"7\" rx=\"1.5\"/>",
  "car": "<path d=\"M5 15l1.6-5.2A2 2 0 0 1 8.5 8.5h7a2 2 0 0 1 1.9 1.3L19 15M3 15h18v4H3zM6.5 19v2M17.5 19v2\"/>",
  "home": "<path d=\"M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z\"/>",
  "thermometer": "<path d=\"M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z\"/>",
  "sun": "<circle cx=\"12\" cy=\"12\" r=\"4\"/><path d=\"M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4\"/>",
  "play": "<path d=\"M7 4v16l13-8z\" fill=\"currentColor\" stroke=\"none\"/>",
  "send": "<path d=\"M22 2 11 13M22 2l-7 20-4-9-9-4z\"/>",
  "footprints": "<path d=\"M4 16v-2.4C4 11.5 3 10.5 3 8c0-2.7 1.5-6 4.5-6C9.4 2 10 3.8 10 5.5c0 3.1-2 5.7-2 8.7V16a2 2 0 1 1-4 0z\"/><path d=\"M20 20v-2.4c0-2.1 1-3.1 1-5.6 0-2.7-1.5-6-4.5-6C14.6 6 14 7.8 14 9.5c0 3.1 2 5.7 2 8.7V20a2 2 0 1 0 4 0z\"/><path d=\"M16 17h4M4 13h4\"/>",
  "flame": "<path d=\"M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3.3.3 1.3 1.2 2.4 2.5 2.8z\"/>",
  "trophy": "<path d=\"M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.7V17c0 .6-.5 1-1 1.2-1.2.5-2 2-2 3.8M14 14.7V17c0 .6.5 1 1 1.2 1.2.5 2 2 2 3.8M18 2H6v7a6 6 0 0 0 12 0V2z\"/>",
  "flag": "<path d=\"M4 22V4a1 1 0 0 1 1-1h12l-2 4 2 4H5\"/>",
  "plus": "<path d=\"M12 5v14M5 12h14\"/>",
  "stop": "<rect x=\"6\" y=\"6\" width=\"12\" height=\"12\" rx=\"2\"/>",
  "pause": "<path d=\"M9 5v14M15 5v14\"/>",
  "gif": "<rect x=\"3\" y=\"5\" width=\"18\" height=\"14\" rx=\"2.5\"/><path d=\"M10 10H8.5a1.5 1.5 0 0 0-1.5 1.5v1A1.5 1.5 0 0 0 8.5 14H10v-2M13 10v4M16 14v-4h2M16 12h1.5\"/>"
  };
const EMOJI_IC = {"🙂": "user", "🔑": "key", "👋": "logout", "🔒": "lock", "🔓": "unlock", "📍": "pin", "🔗": "link", "👑": "crown", "✏️": "pencil", "🗑️": "trash", "📲": "download", "🔔": "bell", "🔕": "bellOff", "👥": "users", "➕": "userPlus", "✨": "sparkles", "🎨": "image", "⚙️": "settings", "🔍": "search", "⏰": "clock", "📻": "radio", "👁️": "eye", "🌓": "contrast", "🚪": "logout", "💬": "message", "📷": "camera", "📅": "calendar", "🍽️": "coffee", "🎧": "headphones", "🚗": "car", "🏠": "home", "🤒": "thermometer", "🏖️": "sun", "🤝": "userCheck", "📡": "signal", "⏳": "hourglass", "🚫": "ban", "🖼️": "image", "🎙": "mic", "🔊": "volume", "📌": "pinned", "ℹ️": "info"};
// svg markup for an icon name (or one of the old emoji names / a status 'ic:name'); '' when it isn't an icon
function svgFor(x) {
  const name = typeof x === 'string' ? (x.startsWith('ic:') ? x.slice(3) : EMOJI_IC[x] || EMOJI_IC[x.replace(/\uFE0F/g, '')] || x) : '';
  return IC[name] ? `<svg viewBox="0 0 24 24" aria-hidden="true">${IC[name]}</svg>` : '';
}
function icoEl(x, cls = 'ic') { const s = document.createElement('span'); s.className = cls; s.innerHTML = svgFor(x); return s; }
// a line of UI text with a leading icon
function icoText(x, text, cls = 'ic-line') { const s = document.createElement('span'); s.className = cls; s.append(icoEl(x), text); return s; }
const stripEmoji = t => String(t).replace(/(\p{Extended_Pictographic}|[\u2600-\u27BF])\uFE0F?\s?/gu, '').replace(/\s{2,}/g, ' ').trim();
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
let ctrl = null, pollTimer = null, polling = false, session = 0, failures = 0, lastTyping = 0, primed = 0;   // primed: the session whose first poll has come back
let group = null;                                    // info about the current group (null for #general)
let lastRendered = null, unseenBelow = 0, presenceCache = [], roomsTimer = null;
let readMark = '', unreadDiv = null;          // what was read when the chat opened; the "N unread messages" divider
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
  const t = $('toast'); t.textContent = stripEmoji(msg); t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}
/**
 * Custom popup. Resolves with true (confirm), the entered text (input), or null when cancelled.
 * onConfirm(value) may return an error string to keep the popup open and show it inline.
 */
function popup({ icon = '', title, text = '', input = null, ok = 'OK', cancel = 'Cancel', danger = false, onConfirm = null, choices = null, extra = null }) {
  return new Promise(resolve => {
    const dlg = $('modal'), field = $('modalField'), inp = $('modalInput'), eye = $('modalEye');
    $('modalIcon').innerHTML = svgFor(icon); $('modalIcon').classList.toggle('danger', danger);
    $('modalTitle').textContent = title; $('modalText').textContent = text; $('modalText').classList.toggle('hidden', !text);
    $('modalErr').textContent = '';
    $('modalOk').textContent = ok; $('modalOk').className = 'btn ' + (danger ? 'danger' : 'primary'); $('modalOk').disabled = false;
    $('modalCancel').textContent = cancel; $('modalCancel').classList.toggle('hidden', !cancel);
    dlg.querySelector('.modal-actions').classList.toggle('single', !cancel);
    field.classList.toggle('hidden', !input);
    if (input) {
      inp.type = input.type || 'text'; inp.value = input.value || ''; inp.placeholder = input.placeholder || '';
      inp.maxLength = input.maxLength || 140; inp.inputMode = input.inputmode || ''; inp.autocomplete = input.type === 'password' ? 'current-password' : 'off';
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
    for (const c of choices || []) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ' + (c.cls || '') + (c.icon ? ' with-ic' : ''); if (c.icon) b.append(icoEl(c.icon)); b.append(c.label); b.onclick = () => finish(c.value); box.append(b); }
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

/* ---------------- Back button / swipe-back ----------------
   Every screen or pop-up that opens on top (chat on phones, group info, a tab, sheets, popups, menus, photo viewer,
   emoji/GIF panels) adds a browser history entry. Back (Android back, iOS swipe, browser back) closes the top one
   instead of leaving the app. When something is closed by its own button, its entry is marked used and skipped later. */
const layers = []; let layerSeq = 0;
function pushLayer(close, url) {
  const id = ++layerSeq, top = layers[layers.length - 1];
  if (top?.dead) { layers.pop(); layers.push({ id, close }); history.replaceState({ ic: id }, '', url || location.href); }
  else { layers.push({ id, close }); history.pushState({ ic: id }, '', url || location.href); }
  return id;
}
function dropLayer(id) { const l = id && layers.find(x => x.id === id); if (l) l.dead = true; }
const layerLive = id => !!id && layers.some(l => l.id === id && !l.dead);
// Close a layer from the UI: go back through history when it's the top one, so the history stays tidy
function closeLayer(id, close) {
  const top = layers[layers.length - 1];
  if (top && top.id === id && !top.dead) history.back(); else { dropLayer(id); close(); }
}
let autoBack = false;            // true while we step back over used-up entries ourselves
window.addEventListener('popstate', e => {
  const auto = autoBack; autoBack = false;
  const idx = layers.findIndex(l => l.id === e.state?.ic);
  const closing = layers.splice(idx + 1);
  let closed = 0;
  for (const l of closing.reverse()) if (!l.dead) { closed++; try { l.close(); } catch {} }
  // one Back = one visible step: skip entries whose pop-up was already closed by its own button
  // (but never close something more on a step we took ourselves)
  if (idx >= 0 && (layers[idx].dead || (!closed && !auto))) { autoBack = true; history.back(); }
});
// All <dialog>s (sheets, popups, profile card, style picker…)
{
  const show = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function () {
    show.call(this);
    const dlg = this;
    const id = pushLayer(() => { const ev = new Event('cancel', { cancelable: true }); dlg.dispatchEvent(ev); if (dlg.open) dlg.close(); });
    dlg.addEventListener('close', () => dropLayer(id), { once: true });
  };
}

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
const inviteLink = room => `${location.origin}${location.pathname}#/g/${encodeURIComponent(room)}` + (room === current && group?.invite && group.inviteCode ? `?i=${encodeURIComponent(group.inviteCode)}` : '');
const linkedRoom = () => { const m = location.hash.match(/^#\/g\/([a-z0-9_-]{1,30})(\?.*)?$/i); return m ? m[1].toLowerCase() : null; };
// What a link / notification button asks for: open a group and then talk, reply or play a message
function linkIntent() {
  const h = location.hash;
  if (h === '#/walkie') return { room: store.get('ic-room') || 'general', act: 'walkie' };
  if (h === '#/new') return { act: 'new' };
  if (h === '#/friends') return { act: 'friends' };
  if (h === '#/stories') return { act: 'stories' };
  if (h === '#/hidden') return { act: 'hidden' };
  { const m = h.match(/^#\/challenge\/([a-z0-9]{10})$/); if (m) return { act: 'challenge', id: m[1] }; }
  let mm;
  if ((mm = h.match(/^#\/u\/([a-f0-9]{24})$/))) return { act: 'profile', uid: mm[1] };          // a person's profile (friend request)
  if ((mm = h.match(/^#\/dm\/([a-f0-9]{24})$/))) return { act: 'dm', uid: mm[1] };              // 1:1 chat with them
  if ((mm = h.match(/^#\/story\/([a-f0-9]{24})\/(\d{13}-[a-f0-9]{6})(\?viewers=1)?$/))) return { act: 'story', uid: mm[1], id: mm[2], viewers: !!mm[3] };
  if (h.startsWith('#/steps')) { const q = new URLSearchParams(h.split('?')[1] || ''); return { act: 'health', ok: q.get('health') === 'ok', msg: q.get('msg'), today: q.get('today') }; }
  const room = linkedRoom(); if (!room) return null;
  const q = new URLSearchParams(h.split('?')[1] || '');
  return { room, act: q.get('a') || 'open', key: q.get('k') || null, code: q.get('i') || null };
}
let pendingIntent = null; const inviteCodes = {};
// Follow an in-app link like "/#/u/<id>" from a notification tap
function navTo(url) {
  const h = '#' + String(url || '').split('#')[1];
  if (!h || h === '#undefined') return;
  if (location.hash === h) { const it = linkIntent(); if (it) runIntent(it); }
  else location.hash = h;
}
function runIntent(intent) {
  if (!intent) return;
  if (intent.act === 'new') { history.replaceState(history.state, '', location.pathname); return openNewGroup(); }
  if (intent.act === 'profile') { history.replaceState(history.state, '', location.pathname); setTab('friends'); return showProfile(intent.uid); }
  if (intent.act === 'dm') { history.replaceState(history.state, '', location.pathname); return openDm(intent.uid); }
  if (intent.act === 'story') {
    history.replaceState(history.state, '', location.pathname); setTab('chats');
    return loadStories().then(() => {
      const p = storyFeed.people.find(x => x.uid === intent.uid), st = p?.stories.find(x => x.id === intent.id);
      if (!st) return toast('That story has expired');
      openStories(intent.uid, intent.id);
      if (intent.viewers && p.mine) setTimeout(() => showStoryViewers(st), 400);     // who viewed / reacted
    });
  }
  if (intent.act === 'health') {
    history.replaceState(history.state, '', location.pathname);
    setTimeout(() => { openMyStepsSheet(); toast(intent.ok ? `Google Health connected${intent.today ? ` · today ${fmtN(+intent.today)} steps` : ''}` : (intent.msg || 'Couldn’t connect Google Health')); }, 300);
    return;
  }
  if (intent.act === 'challenge') { history.replaceState(history.state, '', location.pathname); return openChallenge(intent.id); }
  if (intent.act === 'hidden') { history.replaceState(history.state, '', location.pathname); setTab('chats'); return openHidden(); }
  if (intent.act === 'stories') { history.replaceState(history.state, '', location.pathname); setTab('chats'); return loadStories().then(() => { const p = storyFeed.people.find(x => !x.mine && !x.allSeen && !x.muted); if (p) openStories(p.uid); }); }
  if (intent.act === 'friends') { history.replaceState(history.state, '', location.pathname); return setTab('friends'); }
  if (intent.code && intent.room) inviteCodes[intent.room] = intent.code;    // private invite link: join on open
  pendingIntent = intent.act === 'open' ? null : intent;
  if (intent.room !== current) openRoom(intent.room); else applyIntent();
}
// Runs once the group's messages are on screen
function applyIntent() {
  const it = pendingIntent; if (!it || it.room !== current) return;
  pendingIntent = null;
  history.replaceState(history.state, '', `#/g/${current}`);
  const el = it.key && [...$('messages').children].find(x => x.dataset.key === it.key);
  if (it.act === 'walkie' || it.act === 'talk') {
    if (!walkie.on) openWalkie();
    if (el && it.act === 'talk') startReply(el, { focus: false });
    toast(el && it.act === 'talk' ? `Hold the button to reply to ${el._msg?.name}` : 'Walkie-talkie on — hold the button to talk');
  } else if (el && it.act === 'reply') startReply(el);
  else if (el && (it.act === 'play' || it.act === 'show')) {
    el.scrollIntoView({ block: 'center' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    if (it.act === 'play') el.querySelector('.voice .play')?.click();
  } else if (it.act === 'show') toast('That message is too old to show');
  if (it.act === 'steps') openSteps();
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
    if (authMode === 'signup') toast(`Welcome, ${d.user.name}!`);
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
  if (appLockOn() && !appLockShown) showAppLock();          // app lock: ask on every start
  paintMe();
  refreshRooms().then(() => {
    const intent = linkIntent();
    // start from the chat list so Back from a linked chat lands there instead of leaving the app
    if (intent) { history.replaceState(null, '', location.pathname); return runIntent(intent); }
    const target = wide() ? (rooms.some(r => r.room === store.get('ic-room')) ? store.get('ic-room') : 'general') : null;
    if (target) openRoom(target);
  });
  clearInterval(roomsTimer);
  roomsTimer = setInterval(() => { if (document.hidden) return; if (!current) refreshRooms(); loadFriends(); if (Date.now() - storiesAt > 60000) loadStories(); }, 15000);
  loadStories();
  setupServiceWorker(); updateNotifBanner(); loadFriends(); renderSettings(); loadPrivacy();
  if (nativeApp()) { setupNativePush(); configureStepSync(); configureNativeWalkie(); }
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
// Nearby location groups only show up for people in range: send a rough position with the chat list,
// but only if location is already allowed (we never ask just for the list)
let listLoc = null, listLocAt = 0;
async function refreshListLoc() {
  if (Date.now() - listLocAt < 3 * 60_000 || !navigator.geolocation) return;
  listLocAt = Date.now();
  try {
    const st = await navigator.permissions?.query({ name: 'geolocation' });
    if (st?.state !== 'granted') return;
    navigator.geolocation.getCurrentPosition(p => { const had = !!listLoc; listLoc = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }; if (!had) refreshRooms(); }, () => {}, { enableHighAccuracy: false, maximumAge: 5 * 60_000, timeout: 15000 });
  } catch {}
}
async function refreshRooms() {
  refreshListLoc();
  try { setRooms((await api('rooms', { room: current || 'general', reads: readsPayload(), loc: geo.loc || undefined, listLoc: listLoc || undefined })).rooms); lastCountsAt = Date.now(); }
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
async function signOut(force = false) {
  const yes = force || await popup({ icon: '👋', title: 'Sign out?', text: 'You can sign in again on any device with your username and password.', ok: 'Sign out', danger: true });
  if (!yes) return;
  await disableNotifications(true);
  if (nativeApp()) { await api('push/native/remove').catch(() => {}); stepSyncCall('stop').catch(() => {}); window.Capacitor.nativePromise('Walkie', 'clear').catch(() => {}); store.del('ic-wk-closed'); }
  try { await api('auth/logout'); } catch {}
  me.token = ''; store.del('ic-token'); store.del('ic-user');
  history.replaceState(history.state, '', location.pathname);
  setTab('chats'); showLogin();
}

/* ---------------- Chat list ---------------- */
let roomFilter = 'all';
function renderRooms() {
  const q = $('roomSearch').value.trim().toLowerCase();
  const list = $('roomList'); list.innerHTML = '';
  const inHidden = roomFilter === 'hidden' && hiddenOpen;
  document.querySelectorAll('#filterChips .chip-btn').forEach(x => x.classList.toggle('on', x.dataset.filter === roomFilter));
  const shown = rooms.filter(r => (inHidden ? r.hidden : !r.hidden) && (!q || r.room.includes(q) || (r.title || '').toLowerCase().includes(q) || (r.peer?.username || '').includes(q))
    && (inHidden || roomFilter === 'all' || (roomFilter === 'unread' && unreadCount(r)) || (roomFilter === 'dm' && r.dm) || (roomFilter === 'groups' && !r.dm)));
  if (inHidden) {
    const li = document.createElement('li'); li.className = 'hidden-head';
    const t = el('div', 'hh-text'); t.append(icoText('lock', 'Hidden chats'), el('small', null, 'Only you can see this folder. It locks again when you leave the app.'));
    const b = el('button', 'btn small', 'Lock'); b.type = 'button'; b.onclick = lockHidden;
    li.append(t, b); list.append(li);
  }
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
    if (r.last?.text) { const kind = mediaKind(r.last.text); sub.replaceChildren((isMine(r.last) ? (r.dm ? '' : 'You: ') : r.dm ? '' : r.last.name + ': ')); if (kind) sub.append(icoText(kind[0], kind[1], 'ic-inline')); else sub.append(r.last.text); }
    else if (r.dm) sub.textContent = r.peer?.status ? statusText(r.peer.status) : `@${r.peer?.username || ''} · say hi`;
    else if (r.invite) sub.replaceChildren(icoText('userPlus', 'Invite-only group'));
    else if (r.locked && !r.access) sub.replaceChildren(icoText('lock', 'Private group · tap to enter password'));
    else if (r.geo) sub.replaceChildren(icoText('pin', `Location group · ${fmtDist(r.radius)} range`));
    else sub.textContent = r.room === 'general' ? 'Everyone' : 'No messages yet';
    bottom.append(sub);
    if (isMuted(r.room)) { const mu = document.createElement('span'); mu.className = 'room-mute'; mu.innerHTML = svgFor('bellOff'); mu.title = 'Muted'; bottom.append(mu); }
    if (n) { const dot = document.createElement('span'); dot.className = 'unread-dot'; dot.textContent = n === true ? '' : n > 99 ? '99+' : n; dot.setAttribute('aria-label', 'Unread'); bottom.append(dot); }
    meta.append(top, bottom); b.append(av, meta);
    b.onclick = () => openRoom(r.room);
    li.append(b); list.append(li);
  }
  if (!shown.length) {
    const li = document.createElement('li'); li.className = 'room-empty';
    li.textContent = inHidden ? 'No hidden chats. Open a chat → ⋮ → Hide chat.' : q ? `No chats match “${q}”.` : roomFilter === 'unread' ? 'No unread chats' : roomFilter === 'dm' ? 'No friend chats yet — add a friend in the Friends tab.' : 'No chats yet — tap ＋ to start one.';
    list.append(li);
  }
  const unreadChats = rooms.filter(r => !r.hidden && unreadCount(r)).length;     // hidden chats never show in counts
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
// "📻 Walkie-talkie" / "Voice message" etc. → [icon, text] (old previews were stored with an emoji in front)
function mediaKind(t) {
  const m = String(t).match(/^(?:(?:🚫|📻|🎤|🎞️|🎞)\s*)?(Message deleted|Walkie-talkie(?: message)?|Voice message|GIF)$/u);
  if (!m) return null;
  return [{ 'Message deleted': 'ban', 'GIF': 'gif', 'Voice message': 'mic' }[m[1]] || 'radio', m[1]];
}
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
  if (info.hidden && !hiddenOpen && !(await unlockHidden())) { if (linkedRoom() === room) history.replaceState(history.state, '', location.pathname); return; }
  // Private group we haven't joined yet: ask for its password first
  if (info.locked && info.access === false) { if (!(await askPassword(room))) { if (linkedRoom() === room) history.replaceState(history.state, '', location.pathname); return; } }
  leaveRoom();
  current = room; store.set('ic-room', room);
  if (!wide() && !layerLive(chatLayer)) chatLayer = pushLayer(closeChatUI, `#/g/${room}`);
  else if (!pendingIntent && location.hash !== `#/g/${room}`) history.replaceState(history.state, '', `#/g/${room}`);
  session++; since = ''; version = ''; seen = new Set(); pending = new Map(); receipts = [];
  acked = { delivered: '', read: '' }; openReceipts = new Set(); group = null; lastRendered = null; unseenBelow = 0; xsince = 0; edits = {};
  readMark = lastRead[room] || ''; unreadDiv = null;
  cancelReply(); closeGifs(); updateToBottom();
  $('messages').innerHTML = '';
  text.value = drafts[room] || ''; autosize(); syncButtons();   // restore any unsent draft for this group
  $('app').classList.add('in-chat', 'has-room');
  $('chatBar').classList.remove('hidden'); $('composerWrap').classList.remove('hidden');
  $('chatTitle').textContent = roomTitle(room); $('chatSub').textContent = info.dm ? lastSeenText(info.peer?.lastSeen) : 'tap here for info';
  $('messages').classList.toggle('dm', !!info.dm); applyWallpaper(room); closeEmoji();
  paintAvatar($('chatAvatar'), info.title || room, { ...info, photo: info.dm ? info.peer?.photo : info.photo });
  setPins([]); closeMention(); setGame(null); gameDraft = {};
  renderRooms(); updateComposerLock(); renderAdminBanner();
  if (info.geo) startLocation();
  tellSW(); swPost({ type: 'read', room });
  poll(session);
  if (walkieListening()) startBackgroundAudio();         // walkie-talkie auto-play stays alive in the background
  if (finePointer) $('text').focus();
}
function leaveRoom() {
  session++; clearTimeout(pollTimer); ctrl?.abort(); polling = false;
  stopLocation(); stopAllAudio(); closeWalkie(); stopBackgroundAudio(); lkLeave(); groupMap.destroy();
  if (current) markRead(current, since);
  current = null; group = null; tellSW();
}
let chatLayer = null;
function closeChatUI() {
  leaveRoom(); history.replaceState(history.state, '', location.pathname);
  $('app').classList.remove('in-chat', 'info-open'); renderRooms(); refreshRooms();
}
$('backBtn').onclick = () => closeLayer(chatLayer, closeChatUI);
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
  // the first request of a room returns at once; after that, wait for changes — also in a room with no messages yet
  // (no version), which used to re-ask nonstop. The server caps the wait: 7 s on Netlify.
  const wait = primed === mySession && !pollNow ? 25000 : 0;
  pollNow = false;
  const pollStart = Date.now();
  const watchdog = setTimeout(() => myCtrl.abort(), wait + 15000);
  try {
    const ack = {};
    if (since && since > acked.delivered) ack.delivered = since;
    if (since && !document.hidden && since > acked.read) ack.read = since;
    const wantCounts = Date.now() - lastCountsAt > 20000;
    const d = await api('poll', { since, version, wait, ack, fsid: funView.sid || undefined, fseq: funView.sid ? funView.seq : undefined, loc: geo.loc, listLoc: listLoc || undefined, xsince, walkie: walkieListening(), tsince: walkie.tsince ? walkie.tsince - 5000 : 0, ...(wantCounts ? { reads: readsPayload() } : {}) }, myCtrl.signal);
    if (wantCounts) lastCountsAt = Date.now();
    if (mySession !== session) return;
    if (ack.delivered) acked.delivered = ack.delivered;
    if (ack.read) { acked.read = ack.read; markRead(current, ack.read); }
    failures = 0; $('netBanner').classList.add('hidden');
    const first = !since, wasNear = nearBottom();
    version = d.version || ''; primed = mySession;
    const fresh = d.messages.filter(m => !seen.has(m.key));
    for (const m of fresh) { addMessage(m); if (!first) notify(m); }
    if (fresh.length) {
      const theirs = fresh.filter(m => !isMine(m) && !m.sys);
      if (first) {
        // opening a chat with unread messages: mark the first one and start there (like WhatsApp)
        const firstUnread = readMark && theirs.find(m => m.key > readMark);
        if (firstUnread) { markUnread(firstUnread.key, theirs.filter(m => m.key >= firstUnread.key).length); scrollToUnread(); }
        else scrollDown(true);
      } else {
        // new messages while you're scrolled up or away from the app: mark where they start
        if (theirs.length && (!wasNear || document.hidden)) markUnread(theirs[0].key, theirs.length);
        if (wasNear) scrollDown(true);
        else { unseenBelow += theirs.length; updateToBottom(); }
      }
    }
    if (d.edits) { for (const [k, e] of Object.entries(d.edits)) { edits[k] = e; applyEdit(k); } }
    if (first && pendingIntent) setTimeout(applyIntent, 0);
    if (d.xt) xsince = d.xt;
    if (d.fun) funLive(d.fun);
    if (d.talk) onTalk(d.talk, d.xt);
    // (ignore a mute state from a request that started before we changed it ourselves)
    if (typeof d.muteUntil === 'number' && pollStart > muteChangedAt && (mutes[current] || 0) !== d.muteUntil) { if (d.muteUntil) mutes[current] = d.muteUntil; else delete mutes[current]; store.setJson('ic-mutes', mutes); }
    setRooms(d.rooms);
    if (d.pins) setPins(d.pins);
    if ('game' in d) setGame(d.game);
    receipts = d.receipts || [];
    setGroup(d.group);
    renderPresence(d.users || []);
    updateTicks();
  } catch (err) {
    if (mySession !== session || err.name === 'AbortError') return;
    if (err.code === 'deleted') { groupGone(current, err.message); return; }
    if (err.code === 'invite_only') {
      const room = current, code = inviteCodes[room];
      if (code) {
        delete inviteCodes[room];
        try { await api('group/join', { room, code }); toast('You joined the group'); await refreshRooms(); openRoom(room, true); return; }
        catch (e) { toast(e.message); }
      } else popup({ icon: 'lock', title: 'Invite-only group', text: err.message, ok: 'OK', cancel: '' });
      leaveRoom(); history.replaceState(history.state, '', location.pathname); $('app').classList.remove('in-chat', 'info-open', 'has-room'); renderRooms();
      return;
    }
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
    if (group?.geo) sub += ` · ${fmtDist(group.radius)} range`;
    if (group?.locked) sub += ' · private';
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
  if (m.sys) {          // celebration / challenge notes: a centred pill, tap to open the step challenge
    const s = document.createElement('button'); s.className = 'sys-msg'; s.type = 'button'; s.dataset.key = m.key; s._msg = m;
    const tx = document.createElement('span'), tm = document.createElement('small'); tx.textContent = m.text; tm.textContent = timeLabel(m.ts);
    s.append(icoEl(m.sys === 'steps' ? 'footprints' : m.sys === 'game' ? 'sparkles' : m.sys === 'fun' ? 'pencil' : 'info'), tx, tm);
    s.onclick = () => m.sys === 'game' ? openGame() : m.sys === 'fun' ? (m.ref ? funReplay(m.ref) : openFun()) : openSteps();
    box.append(s); lastRendered = { who: null, ts: m.ts, day };
    return s;
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
    q.onclick = e => { e.stopPropagation(); m.replyTo.story ? openStoryById(m.replyTo.uid, String(m.replyTo.key).slice(6)) : jumpTo(m.replyTo.key); };
    el.append(q);
  }
  if (m.gif) {
    const img = document.createElement('img');
    img.className = 'gif'; img.src = m.localUrl || m.gif.url; img.alt = m.gif.title || 'GIF'; img.loading = 'lazy';
    if (m.gif.w && m.gif.h) { img.width = m.gif.w; img.height = m.gif.h; }
    img.onclick = () => viewPhoto(img.src);
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
  if (m.deleted) { el.classList.add('deleted'); const body = document.createElement('span'); body.className = 'body'; body.append(icoEl('ban'), 'This message was deleted'); el.append(body); }
  else if (m.text) { const body = document.createElement('span'); body.className = 'body'; body.append(fmtText(m.text)); el.append(body); }
  if (!mine && m.mentions?.includes(me.uid)) el.classList.add('mentions-me');
  if (!m.text && !m.deleted) el.classList.add('media-only');

  const foot = document.createElement('span'); foot.className = 'foot';
  if (m.scheduled) foot.append(Object.assign(document.createElement('span'), { className: 'f-tag', innerHTML: svgFor('clock'), title: 'Scheduled message' }));
  if (m.edited) foot.append(Object.assign(document.createElement('span'), { className: 'f-tag edited', textContent: 'edited' }));
  foot.append(timeLabel(m.ts));
  if (mine) {
    const t = document.createElement('span'); t.className = 'ticks clock'; t.innerHTML = svgFor('clock'); t.title = 'Sending…';
    t.onclick = e => { e.stopPropagation(); const k = el.dataset.key; if (!k) return; openReceipts.has(k) ? openReceipts.delete(k) : openReceipts.add(k); updateTicks(); };
    foot.append(t);
  }
  el.append(foot);

  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'reply-btn'; btn.innerHTML = ICON.reply; btn.title = 'Reply'; btn.setAttribute('aria-label', 'Reply');
  btn.onclick = e => { e.stopPropagation(); startReply(el); };
  const icon = document.createElement('div'); icon.className = 'swipe-icon'; icon.innerHTML = ICON.reply;
  const more = document.createElement('button');
  more.type = 'button'; more.className = 'msg-btn'; more.innerHTML = svgFor('smile'); more.title = 'React and more'; more.setAttribute('aria-label', 'Message actions');
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
$('toBottom').onclick = () => {
  const b = $('messages');
  // new messages below: go to the first one; otherwise (or on a second tap) to the very bottom
  if (unreadDiv?.isConnected && unreadTop() > b.scrollTop + 40) { scrollToUnread(true); return; }
  b.scrollTo({ top: b.scrollHeight, behavior: 'smooth' }); unseenBelow = 0; updateToBottom();
};
// "N unread messages" divider above the first unread message; more arriving adds to the count
function markUnread(key, n) {
  if (unreadDiv?.isConnected) { unreadDiv._n += n; unreadDiv.firstChild.textContent = unreadText(unreadDiv._n); return; }
  const at = $('messages').querySelector(`[data-key="${CSS.escape(key)}"]`); if (!at) return;
  unreadDiv = el('div', 'unread-divider'); unreadDiv._n = n; unreadDiv.setAttribute('role', 'separator');
  unreadDiv.append(el('span', null, unreadText(n)));
  at.before(unreadDiv);
  at.classList.remove('cont');                      // show the sender's name again on the first unread message
}
// the divider's position inside the scrolling message list
const unreadTop = () => unreadDiv.getBoundingClientRect().top - $('messages').getBoundingClientRect().top + $('messages').scrollTop;
const unreadText = n => `${n} unread message${n === 1 ? '' : 's'}`;
function scrollToUnread(smooth) {
  const b = $('messages'); if (!unreadDiv?.isConnected) return;
  const top = Math.max(0, unreadTop() - 12);
  if (smooth) b.scrollTo({ top, behavior: 'smooth' }); else b.scrollTop = top;
  unseenBelow = 0; updateToBottom();
}
const dropUnread = () => { unreadDiv?.remove(); unreadDiv = null; };

function quoteEl(r) {
  const q = document.createElement('div'); q.className = 'quote' + (r.story ? ' story-quote' : '');
  const n = document.createElement('b'); n.textContent = r.story ? (isMine(r) ? 'Your story' : `${r.name} · Story`) : isMine(r) ? 'You' : r.name;
  if (r.story) {
    const th = el('div', 'sq-thumb');
    if (okPhoto(r.thumb)) th.style.backgroundImage = `url("${r.thumb}")`; else th.style.background = storyBg(r.bg);
    const t = el('div', 'sq-text'); t.append(n, r.text);
    q.append(t, th);
    return q;
  }
  q.append(n, r.text);
  return q;
}
function jumpTo(key) {
  const target = [...$('messages').children].find(x => x.dataset.key === key);
  if (!target) return toast('That message is too old to show');
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.remove('flash'); void target.offsetWidth; target.classList.add('flash');
}
const previewText = m => m.text || (m.audio ? `${m.audio.walkie ? 'Walkie-talkie' : 'Voice message'} (${fmtDur(m.audio.dur)})` : m.gif ? 'GIF' : '');

function notify(m) {
  if (isMine(m) || !document.hidden || pushActive || roomInfo(m.room)?.hidden) return;   // push notifications take over when enabled
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
    t.innerHTML = svgFor(readers.length || delivered.length ? 'checks' : 'check');
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
  dropUnread();                                     // replying means you've seen them (like WhatsApp)
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
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 48000 } });
    if (rec.state !== 'starting') { stream.getTracks().forEach(t => t.stop()); return; }   // released while the permission prompt was up
    rec.stream = stream; rec.chunks = []; rec.peaks = [];
    const mime = pickMime();
    rec.recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 48000 } : undefined);
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
  if (a.walkie) { const tag = document.createElement('span'); tag.className = 'voice-tag'; tag.append(icoEl('radio'), 'Walkie-talkie'); setTimeout(() => wrap.before(tag)); }
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
  if (open) gifLayer = pushLayer(() => { $('gifPanel').classList.add('hidden'); $('gifBtn').classList.remove('active'); }); else dropLayer(gifLayer);
  if (open) { if (gifQuery === null) loadGifs(''); if (finePointer) $('gifSearch').focus(); }
};
let gifLayer = null;
function closeGifs() { $('gifPanel').classList.add('hidden'); $('gifBtn').classList.remove('active'); dropLayer(gifLayer); }
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
  let up = file;
  if (file.type !== 'image/gif' && file.size > 1.5 * 1024 * 1024) {        // big phone photos: high-quality resize, not a refusal
    try { for (const [mx, q] of [[2560, .9], [2048, .86], [1600, .82]]) { up = await (await fetch(await shrinkImage(file, mx, q))).blob(); if (up.size <= 3.8 * 1024 * 1024) break; } }
    catch { return toast('That doesn’t look like an image'); }
  }
  if (up.size > 4 * 1024 * 1024) return toast('That file is too large (max 4 MB)');
  const localUrl = URL.createObjectURL(up);
  const dims = await new Promise(res => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => res({}); i.src = localUrl; });
  if (!dims.w) return toast('That doesn’t look like an image');
  closeGifs();
  sendMessage({ gif: { ...dims, title: file.name.slice(0, 80) }, upload: up, localUrl });
};
const hideViewer = () => { if (!$('viewer').classList.contains('hidden')) closeLayer(viewerLayer, () => $('viewer').classList.add('hidden')); };
$('viewer').onclick = hideViewer;
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideViewer(); });

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
  updateComposerLock(); renderAdminBanner(); renderStepsBanner();
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
  const ico = document.createElement('span'); ico.className = 'ico'; ico.innerHTML = svgFor(icon);
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
  t.textContent = `${n} ${n > 1 ? 'people want' : 'person wants'} to chat from outside the range`;
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
let infoLayer = null;
function closeInfoUI() { $('app').classList.remove('info-open'); infoMode = 'info'; }
function showInfoPane() { if (!$('app').classList.contains('info-open') || !layerLive(infoLayer)) infoLayer = pushLayer(closeInfoUI); $('app').classList.add('info-open'); }
function openInfo() { if (!current) return; infoMode = 'info'; infoSig = ''; showInfoPane(); renderInfo(); loadMembers(); }
async function makeAdmin(mm) {
  const yes = await popup({ icon: 'crown', title: `Make ${mm.name} an admin?`,
    text: `${mm.name} will be able to change the group’s name, photo, password${group?.geo ? ', range' : ''} and make other people admins. ${group?.adminName || 'The owner'} stays the owner.`,
    ok: 'Make admin' });
  if (!yes) return;
  try { await api('group/admin/add', { member: mm.uid }); toast(`${mm.name} is now an admin`); repoll(); loadMembers(); }
  catch (e) { toast(e.message); }
}
async function removeAdmin(mm, self) {
  const yes = await popup({ icon: 'userMinus', title: self ? 'Stop being an admin?' : `Remove ${mm.name} as admin?`,
    text: self ? 'You’ll stay in the group as a normal member. An admin or the owner can make you admin again.' : `${mm.name} stays in the group as a normal member.`,
    ok: self ? 'Step down' : 'Remove admin', danger: true });
  if (!yes) return;
  try { await api('group/admin/remove', { member: mm.uid }); toast(self ? 'You’re no longer an admin' : `${mm.name} is no longer an admin`); repoll(); loadMembers(); }
  catch (e) { toast(e.message); }
}
async function deleteGroup() {
  const name = group?.title || current;
  const yes = await popup({ icon: 'trash', title: `Delete “${name}”?`, danger: true, ok: 'Delete group',
    text: 'This deletes the group for everyone — all messages, voice notes, photos and members. It can’t be undone.\n\nType the group name to confirm.',
    input: { placeholder: name, maxLength: 40, required: true, requiredMsg: 'Type the group name' },
    onConfirm: async v => {
      if (v.trim().toLowerCase() !== name.toLowerCase()) return `Type “${name}” exactly to confirm`;
      try { await api('group/delete', { confirm: v.trim() }); return null; } catch (e) { return e.message; }
    } });
  if (yes === null) return;
  groupGone(current, `“${name}” was deleted`);
}
// The group was deleted (by you or by its owner): close it and drop it from the list
function groupGone(room, msg) {
  if (current === room) { leaveRoom(); history.replaceState(history.state, '', location.pathname); $('app').classList.remove('in-chat', 'info-open', 'has-room'); }
  rooms = rooms.filter(r => r.room !== room); renderRooms(); refreshRooms();
  toast(msg);
}
$('infoBtn').onclick = () => $('app').classList.contains('info-open') ? closeLayer(infoLayer, closeInfoUI) : openInfo();
$('chatMenuBtn').onclick = e => openChatMenu(e.currentTarget);
$('chatHead').onclick = openInfo;
$('infoClose').onclick = () => closeLayer(infoLayer, closeInfoUI);

function el(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
// Only redraw the info panel when something it shows changed (redrawing on every poll swallowed taps on its buttons)
let infoSig = '';
function renderInfo() {
  if (infoMode === 'search' || infoMode === 'steps') return;
  const body = $('infoBody');
  if (body.contains(document.activeElement) && document.activeElement.type === 'range') return;   // don't disturb a slider mid-drag
  const sig = JSON.stringify([current, group, membersCache.room === current ? membersCache.list : null, presenceCache.map(u => [u.uid, !!u.typing, !!u.walkie]),
    mutes[current] || 0, pushActive, friends.friends.map(f => f.uid), group?.peer && profiles[group.peer.uid]?.about, roomInfo(current)?.photo]);
  if (sig === infoSig && body.childElementCount) return;
  infoSig = sig;
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
    const cam = el('button', 'cam-btn'); cam.innerHTML = svgFor('camera'); cam.type = 'button'; cam.title = 'Change group photo'; cam.setAttribute('aria-label', 'Change group photo');
    cam.onclick = e => { e.stopPropagation(); choosePhoto(current, !!g.photo); };
    av.append(cam);
  }
  const kind = (g?.invite || ri.invite) ? (isGeoRoom ? 'Invite-only location group' : 'Invite-only group') : isGeoRoom ? 'Location group' : isLocked ? 'Private group' : current === 'general' ? 'Everyone' : 'Open group';
  const adminTxt = g?.isOwner ? ' · you’re the owner' : g?.isAdmin ? ' · you’re an admin' : g?.adminName ? ` · owner ${g.adminName}` : '';
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
  nm.append(el('b', null, muted ? 'Muted' : pushActive ? 'On' : 'Off on this device'),
    el('small', null, muted ? `Until ${fmtUntil(mutes[current])}` : pushActive ? 'You’ll be notified of new messages, even when the app is closed' : 'Turn on notifications to hear about new messages'));
  const nb = el('button', 'btn small ' + (!pushActive && !muted ? 'primary' : ''), muted ? 'Unmute' : pushActive ? 'Mute' : 'Turn on');
  nb.onclick = () => (pushActive || muted) ? muteGroup() : enableNotifications().then(renderInfo);
  ns.append(nm, nb); nc.append(ns); body.append(nc);

  // Admin: access settings
  if (g?.isAdmin) {
    const ac = el('div', 'card'); ac.append(el('h3', null, 'Admin settings'));
    ac.append(el('p', 'muted small', g.isOwner ? 'You’re the owner, so you and the admins you choose see these settings. Use “Make admin” next to a member below to add admins.' : 'You’re an admin, so you see these settings. Use “Make admin” to add more admins.'));
    const setting = (titleTxt, sub, btnLabel, fn, cls = '') => {
      const s = el('div', 'setting'); const m = el('div', 's-meta'); m.append(el('b', null, titleTxt), el('small', null, sub));
      const b = el('button', 'btn small ' + cls, btnLabel); b.onclick = fn; s.append(m, b); ac.append(s);
    };
    setting('Group name', title, 'Rename', renameGroup);
    const who = g.invite ? 'Invite only — hidden from everyone else' : g.locked ? 'Password — members need it to join' : 'Anyone with the link';
    setting('Who can join', who, 'Change', chooseAccess);
    if (g.locked) setting('Password', 'Change the group password', 'Change', () => setGroupPassword(true), 'ghost');
    setting('Location limit', g.geo ? `On — only within ${fmtDist(g.radius)} of the group’s centre` : 'Off — chat from anywhere', g.geo ? 'Turn off' : 'Turn on', toggleLocationLimit, 'ghost');
    setting('Add people', 'Add friends straight into the group', 'Add', addPeople, 'primary');
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
      c.append(el('h3', null, 'Change range'), sr, btns, el('p', 'muted small', 'Tip: drag the pin on the map to move the centre.'));
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
    if (mm.owner) nm.append(el('span', 'chip brand admin-chip', 'Owner'));
    else if (mm.admin) nm.append(el('span', 'chip brand admin-chip', 'Admin'));
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
      if (!mm.admin) { const mk = el('button', 'btn small ghost', 'Make admin'); mk.onclick = () => makeAdmin(mm); acts.append(mk); }
      else if (g.isOwner && !mm.owner) { const rm = el('button', 'btn small ghost', 'Remove admin'); rm.onclick = () => removeAdmin(mm); acts.append(rm); }
      else if (on) acts.append(el('span', 'dot', ''));
    } else if (you && mm.admin && !mm.owner) { const sd = el('button', 'btn small ghost', 'Step down'); sd.onclick = () => removeAdmin(mm, true); acts.append(sd); }
    else if (on) acts.append(el('span', 'dot', ''));
    r.append(a, meta, acts); mc.append(r);
  }
  body.append(mc);
  // Danger zone: only the owner can delete the group
  if (g?.isOwner && current !== 'general') {
    const dz = el('div', 'card danger-zone');
    const del = el('button', 'set-row danger'); del.type = 'button'; del.onclick = deleteGroup;
    const dm = el('div', 's-meta'); dm.append(el('b', null, 'Delete group'), el('small', null, 'Deletes all messages and members for everyone'));
    del.append(icoEl('trash', 's-ico'), dm); dz.append(del); body.append(dz);
  }
  body.scrollTop = scroll;
}
// Who can join: anyone with the link / password / invite only
async function chooseAccess() {
  const cur = group.invite ? 'invite' : group.locked ? 'password' : 'open';
  const v = await popup({ icon: 'users', title: 'Who can join?', ok: '', cancel: 'Cancel', choices: [
    { value: 'open', label: 'Anyone with the link', icon: cur === 'open' ? 'check' : 'link' },
    { value: 'password', label: 'People who know the password', icon: cur === 'password' ? 'check' : 'lock' },
    { value: 'invite', label: 'Invite only (hidden, you add people)', icon: cur === 'invite' ? 'check' : 'userPlus' }] });
  if (typeof v !== 'string' || v === cur) return;
  let password;
  if (v === 'password') {
    password = await popup({ icon: 'lock', title: 'Group password', text: 'Members will need it to join. People already in the group are asked once.', ok: 'Save', input: { type: 'password', placeholder: 'At least 4 characters', maxLength: 64, required: true },
      onConfirm: async x => x.length >= 4 ? null : 'Use at least 4 characters' });
    if (password === null) return;
  }
  try { await api('group/update', { access: v, password }); toast({ open: 'Anyone with the link can join now', password: 'Password set', invite: 'Group is invite-only now — current members stay in' }[v]); repoll(); refreshRooms(); }
  catch (e) { toast(e.message); }
}
async function toggleLocationLimit() {
  if (group.geo) {
    const yes = await popup({ icon: 'pin', title: 'Turn off the location limit?', text: 'Members can chat from anywhere.', ok: 'Turn off' });
    if (!yes) return;
    try { await api('group/update', { location: false }); toast('Location limit off'); repoll(); refreshRooms(); } catch (e) { toast(e.message); }
    return;
  }
  const r = await popup({ icon: 'pin', title: 'Limit to a place', text: 'The centre is where you are now. Pick the range:', ok: '', cancel: 'Cancel',
    choices: [100, 200, 500, 1000, 5000].map(m => ({ value: m, label: fmtDist(m) })) });
  if (typeof r !== 'number') return;
  try { const loc = await getLocationOnce(); await api('group/update', { location: true, radius: r, loc }); toast(`Only within ${fmtDist(r)} now`); repoll(); refreshRooms(); }
  catch (e) { toast(e.message); }
}
// Add friends to the group (owner / admins)
async function addPeople() {
  await loadFriends();
  const inGroup = new Set((membersCache.room === current ? membersCache.list : []).map(x => x.uid));
  const list = friends.friends.filter(f => !inGroup.has(f.uid));
  const chosen = new Set();
  const { d, inner } = sheet('addPeople', 'Add people');
  inner.append(el('p', 'muted small', group?.invite ? 'Only people you add (or who get the invite link) can see and join this group.' : 'They’ll be added straight in and get a notification.'));
  if (!list.length) inner.append(el('p', 'empty-note', friends.friends.length ? 'All your friends are already here.' : 'Add friends first (Friends tab), then add them here.'));
  const box = el('div', 'pick-list');
  for (const f of list) {
    const lab = el('label', 'person pick-row'); const cb = el('input'); cb.type = 'checkbox'; cb.onchange = () => cb.checked ? chosen.add(f.uid) : chosen.delete(f.uid);
    const a = el('div', 'avatar'); paintAvatar(a, f.name, { photo: f.photo });
    const m = el('div', 'p-meta'); m.append(el('b', null, f.name), el('small', null, '@' + f.username));
    lab.append(a, m, cb); box.append(lab);
  }
  inner.append(box);
  const go = el('button', 'btn primary block', 'Add'); go.type = 'button';
  go.onclick = async () => {
    if (!chosen.size) return toast('Pick at least one friend');
    go.disabled = true;
    try { const r = await api('group/invite', { uids: [...chosen] }); toast(`Added ${r.added.map(x => x.name).join(', ') || 'nobody'}`); d.close(); loadMembers(); repoll(); }
    catch (e) { toast(e.message); go.disabled = false; }
  };
  inner.append(go);
  if (group?.invite && group.inviteCode) {
    const ln = el('div', 'invite-row'); ln.append(el('code', null, inviteLink(current)));
    const sh = el('button', 'btn small', 'Share link'); sh.onclick = shareInvite; ln.append(sh);
    inner.append(el('h3', 'sec-title', 'Or share the private invite link'), ln);
    const rs = el('button', 'link-btn', 'Reset link (old link stops working)'); rs.type = 'button';
    rs.onclick = async () => { try { await api('group/update', { resetLink: true }); toast('New invite link made'); d.close(); repoll(); } catch (e) { toast(e.message); } };
    inner.append(rs);
  }
  d.showModal();
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
  $('ngHint').textContent = { open: 'Anyone with the invite link can read and chat.', private: 'Only people who know the password can join.', geo: 'People inside the range can chat. It only shows up for people nearby or who have chatted there.', invite: 'Hidden from everyone else. You add friends, or share the group’s private invite link.' }[t];
  $('ngCreate').textContent = { open: 'Create open group', private: 'Create private group', geo: 'Create location group', invite: 'Create invite-only group' }[t];
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
      ngLoc = await getLocationOnce(); s.className = 'loc-status ok'; s.textContent = `Location found (±${fmtDist(ngLoc.acc)}). Drag the pin to adjust the centre.`;
      $('ngMap').classList.remove('hidden');
      rangeMap($('ngMap'), { center: ngLoc, radius: sliderToRadius(+$('ngRadius').value), draggable: true,
        onMove: ll => { ngLoc = { lat: ll.lat, lng: ll.lng, acc: 0 }; s.textContent = 'Centre set where you dropped the pin.'; return true; } })
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
    if (type === 'invite') setTimeout(() => addPeople(), 600); else toast(`“${title}” created — share the invite link to add people`);
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
    const body = document.createElement('span'); body.className = 'body'; body.append(icoEl('ban'), 'This message was deleted');
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
  $('msgMenu').classList.remove('hidden'); menuLayer = pushLayer(() => { $('msgMenu').classList.add('hidden'); menuFor = null; });
  // Position the card next to the message, kept inside the screen
  const card = $('mmCard'), r = el.getBoundingClientRect(), cw = card.offsetWidth, ch = card.offsetHeight;
  const left = Math.min(Math.max(12, mine ? r.right - cw : r.left), innerWidth - cw - 12);
  let top = r.bottom + 8; if (top + ch > innerHeight - 12) top = Math.max(12, r.top - ch - 8);
  card.style.left = left + 'px'; card.style.top = top + 'px';
  (reacts.querySelector('button') || acts.querySelector('button'))?.focus();
}
let menuLayer = null;
function closeMsgMenu() { $('msgMenu').classList.add('hidden'); menuFor = null; dropLayer(menuLayer); }
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
  const lines = [read.length ? `Seen by: ${read.join(', ')}` : 'Not seen yet', got.length ? `Delivered to: ${got.join(', ')}` : ''].filter(Boolean);
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
      if (e.data?.type === 'nav' && e.data.url) navTo(e.data.url);
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
  if (!dismissed && !pushActive && !(window.Capacitor?.isNativePlatform?.())) {   // the native app has its own notifications
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
const SEG_MS = 700, MAX_TALK_S = 60;              // shorter pieces = lower delay
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
// auto-play only while the app is on screen; in the background the open walkie-talkie (or the native player) takes over
const walkieListening = () => walkie.on || (autoWalkie() && !walkie.autoOff && walkie.ctx?.state === 'running' && !document.hidden);
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
  if (!autoWalkie() || walkie.autoOff) stopBackgroundAudio(); else { nativeWalkie(false); walkie.mediaText = ''; updateMediaSession(); }
  $('walkiePanel').classList.add('hidden'); $('walkieBtn').classList.remove('on'); $('walkieBtn').setAttribute('aria-pressed', 'false');
  renderWalkie();
}
$('walkieBtn').onclick = () => { gameWalkie = false; walkie.on ? (closeWalkie(), repoll()) : openWalkie(); };
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
  if (lk.room && lk.speakers.has(c.uid)) { walkie.played.add(id); walkie.speaker = c.name; walkie.hearingUntil = performance.now() + 1500; return; }   // already heard live
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
// In the Android app, a native foreground service keeps the walkie-talkie alive in the background
const isNativeApp = () => !!window.Capacitor?.isNativePlatform?.() && window.Capacitor.getPlatform?.() === 'android';
let nativeWalkieOn = false, nativeWalkieText = '';
function nativeWalkie(on, text) {
  if (!isNativeApp()) return;
  if (!nativeWalkie.listening) {
    nativeWalkie.listening = true;
    window.Capacitor.addListener('Walkie', 'stop', () => { walkie.autoOff = true; closeWalkie(); stopBackgroundAudio(); repoll(); toast('Walkie-talkie off'); });
  }
  if (on) {
    const t = text || 'Listening — you’ll hear people live';
    if (nativeWalkieOn && t === nativeWalkieText) return;
    nativeWalkieOn = true; nativeWalkieText = t;
    window.Capacitor.nativePromise('Walkie', 'start', { title: `Walkie-talkie · ${roomTitle(current)}`, text: t }).catch(() => { nativeWalkieOn = false; });
  } else if (nativeWalkieOn) {
    nativeWalkieOn = false; nativeWalkieText = '';
    window.Capacitor.nativePromise('Walkie', 'stop').catch(() => {});
  }
}
function startBackgroundAudio() {
  if (walkie.on) nativeWalkie(true);
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
  nativeWalkie(false);
  if (walkie.out) { try { walkie.out.osc.stop(); walkie.out.el.pause(); walkie.out.el.srcObject = null; } catch {} walkie.out = null; }
  if ('mediaSession' in navigator) { try { navigator.mediaSession.playbackState = 'none'; navigator.mediaSession.metadata = null; } catch {} }
  walkie.mediaText = '';
}
// Play through the continuous stream when it's running, otherwise straight to the speakers
const walkieOutput = () => (walkie.out?.ok ? walkie.out.dest : walkie.ctx.destination);
function updateMediaSession(text = 'Walkie-talkie · listening') {
  if (walkie.on) nativeWalkie(true, /talking/.test(text) ? text : 'Listening — you’ll hear people live');
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

/* Real-time walkie-talkie voice over LiveKit (WebRTC, ~0.2 s delay). One speaker at a time is still enforced by
   talk/start; the audio pieces keep flowing too (saved message, closed-app listeners) and are skipped for anyone we
   already hear live. If LiveKit isn't set up or can't connect, the audio pieces are used as before. */
const lk = { room: null, name: null, connecting: null, enabled: null, checkedAt: 0, speakers: new Set(), track: null, loading: null };
function loadLiveKit() {
  if (window.LivekitClient) return Promise.resolve(window.LivekitClient);
  return lk.loading ||= new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = '/vendor/livekit/livekit-client.umd.js'; sc.onload = () => res(window.LivekitClient); sc.onerror = () => { lk.loading = null; rej(new Error('LiveKit failed to load')); }; document.head.append(sc); });
}
async function lkLeave() {
  const r = lk.room; lk.room = null; lk.name = null; lk.speakers.clear(); lk.track = null;
  document.querySelectorAll('audio[data-lk]').forEach(a => a.remove());
  if (r) try { await r.disconnect(); } catch {}
}
function lkEnsure() {
  const want = current && walkieListening();
  if (!want) { if (lk.room) lkLeave(); return; }
  if ((lk.room && lk.name === current) || lk.connecting) return;
  if (lk.enabled === false && Date.now() - lk.checkedAt < 5 * 60_000) return;
  const target = current;
  lk.connecting = (async () => {
    try {
      const t = await api('talk/lk', { room: target });
      lk.enabled = !!t.enabled; lk.checkedAt = Date.now();
      if (!t.enabled) return;
      const L = await loadLiveKit();
      if (target !== current || !walkieListening()) return;
      await lkLeave();
      const r = new L.Room({ adaptiveStream: false, dynacast: false });
      r.on(L.RoomEvent.TrackSubscribed, (track, pub, part) => {
        if (track.kind !== 'audio') return;
        const a = track.attach(); a.dataset.lk = part.identity; a.style.display = 'none'; document.body.append(a);
        a.play?.().catch(() => {});
        lk.speakers.add(part.identity);
      });
      r.on(L.RoomEvent.TrackUnsubscribed, (track, pub, part) => { track.detach().forEach(e => e.remove()); lk.speakers.delete(part.identity); });
      r.on(L.RoomEvent.Disconnected, () => { if (lk.room === r) { lk.room = null; lk.name = null; lk.speakers.clear(); } });
      await r.connect(t.url, t.token, { autoSubscribe: true });
      if (target !== current || !walkieListening()) { r.disconnect(); return; }
      lk.room = r; lk.name = target;
    } catch (e) { console.warn('LiveKit unavailable — using audio pieces', e); lk.checkedAt = Date.now(); }
    finally { lk.connecting = null; }
  })();
}
async function lkPublish(stream) {
  if (!lk.room || !window.LivekitClient) return;
  try {
    const mt = stream.getAudioTracks()[0]; if (!mt) return;
    const t = new window.LivekitClient.LocalAudioTrack(mt, undefined, true);   // our own mic track (we stop it ourselves)
    await lk.room.localParticipant.publishTrack(t, { source: window.LivekitClient.Track.Source.Microphone, dtx: false, red: true });
    lk.track = t;
  } catch (e) { console.warn('LiveKit publish failed — audio pieces still go out', e); }
}
function lkUnpublish() {
  const t = lk.track; lk.track = null;
  if (t && lk.room) try { lk.room.localParticipant.unpublishTrack(t, false); } catch {}
}

// Tell the Android app which chat the web app is playing live, so its closed-app player handles all the others
let nativeListenRoom;
function syncNativeListen() {
  if (!isNativeApp()) return;
  const r = current && walkieListening() ? current : '';
  if (r === nativeListenRoom) return;
  nativeListenRoom = r;
  window.Capacitor.nativePromise('Walkie', 'setListening', { room: r }).catch(() => {});
}
document.addEventListener('visibilitychange', () => { if (typeof walkie !== 'undefined') { syncNativeListen(); lkEnsure(); } });
function renderWalkie() {
  lkEnsure(); syncNativeListen();
  const f = walkie.floor, othersTalking = f && f.uid !== me.uid, hearing = performance.now() < walkie.hearingUntil;
  const listeners = presenceCache.filter(u => u.walkie && u.uid !== me.uid).length;
  const canTalk = !(group?.me && !group.me.canChat);
  // Banner for people who don't have the walkie-talkie open
  const listening = walkieListening();
  const showBanner = !walkie.on && (othersTalking || (listening && hearing));
  $('walkieBanner').classList.toggle('hidden', !showBanner);
  if (showBanner) {
    const who = othersTalking ? f.name : walkie.speaker;
    $('wbText').textContent = listening ? `${who} is talking…` : `${who} is talking on the walkie-talkie`;
    $('wbListen').textContent = listening ? 'Talk back' : 'Listen';
  }
  if (!walkie.on) { if (listening) updateMediaSession(othersTalking || hearing ? `${othersTalking ? f.name : walkie.speaker} is talking` : 'Walkie-talkie · listening'); return; }
  $('wkListeners').textContent = listeners ? `${listeners} listening` : 'Nobody else listening yet';
  const st = $('wkStatus'), btn = $('pttBtn');
  st.className = 'wk-status';
  $('walkiePanel').classList.toggle('hearing', hearing && !walkie.talking);
  updateMediaSession(walkie.talking ? 'You’re talking' : (othersTalking || hearing) ? `${othersTalking ? f.name : walkie.speaker} is talking` : 'Walkie-talkie · listening');
  if (walkie.talking) { st.classList.add('live'); st.textContent = `Live · ${fmtDur((Date.now() - walkie.start) / 1000)}`; }
  else if (othersTalking || hearing) { st.classList.add('hearing'); st.textContent = `${othersTalking ? f.name : walkie.speaker} is talking…`; }
  else st.textContent = canTalk ? 'Hold the button to talk' : 'You can listen here, but you’re outside the range to talk';
  btn.classList.toggle('talking', walkie.talking);
  btn.classList.toggle('busy', !!othersTalking && !walkie.talking);
  btn.disabled = !canTalk;
  $('pttLabel').textContent = walkie.talking ? 'Release to stop' : othersTalking ? `${f.name.split(' ')[0]} is talking` : replyTo ? `Hold to reply to ${replyTo.name.split(' ')[0]}` : 'Hold to talk';
  $('wkHint').textContent = finePointer ? 'Tip: hold the Space bar to talk. People with the walkie-talkie open hear you live; everyone else gets it as a walkie-talkie message.'
    : 'Keeps playing with the screen locked or in another app (like music) while this stays on. Others get it as a walkie-talkie message.';
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
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 48000 } }),
      api('talk/start', { talkId, loc: geo.loc }),
    ]);
    if (!walkie.talking || walkie.talkId !== talkId) { stream.getTracks().forEach(t => t.stop()); api('talk/end').catch(() => {}); return; }   // released already
    walkie.stream = stream;
    lkPublish(stream);                       // live voice for people in the LiveKit room
    if (navigator.vibrate) navigator.vibrate(30);
    const mime = pickMime();
    // full recording (saved to chat afterwards)
    walkie.full = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 48000 } : undefined);
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
  const rec = new MediaRecorder(walkie.stream, mime ? { mimeType: mime, audioBitsPerSecond: 48000 } : undefined);   // clear Opus voice
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
  lkUnpublish();
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
const pinIcon = L => L.divIcon({ className: 'map-pin', html: `<span class="pin-ic">${svgFor('pin')}</span><b>Centre</b>`, iconSize: [70, 40], iconAnchor: [35, 34] });
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
    wrap.append(box, el('div', 'map-legend', 'Pin = group centre · dashed circle = range · blue dot = you'));
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
let currentTab = 'chats', tabLayer = null;
function setTab(tab) {
  currentTab = tab;
  for (const b of document.querySelectorAll('.nav-btn')) b.classList.toggle('on', b.dataset.tab === tab);
  $('viewChats').classList.toggle('hidden', tab !== 'chats');
  $('viewFriends').classList.toggle('hidden', tab !== 'friends');
  $('viewSettings').classList.toggle('hidden', tab !== 'settings');
  $('viewChallenges').classList.toggle('hidden', tab !== 'challenges');
  if (!wide() && $('app').classList.contains('in-chat')) { dropLayer(chatLayer); closeChatUI(); }
  // Friends / Settings sit on top of Chats: back returns to Chats
  if (tab !== 'chats' && !layerLive(tabLayer)) tabLayer = pushLayer(() => setTab('chats'));
  if (tab === 'chats') dropLayer(tabLayer);
  if (tab === 'friends') { loadFriends(); if (finePointer) $('friendSearch').focus(); }
  if (tab === 'settings') renderSettings();
  if (tab === 'challenges') { if (chView.id && !layerLive(chView.layer)) chView.id = null; chView.id ? openChallenge(chView.id) : loadChallenges(); }
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
    const ic = document.createElement('span'); ic.className = 'mm-emoji'; ic.innerHTML = svgFor(it.icon);
    b.append(ic, it.label); b.onclick = () => { closeMsgMenu(); it.onClick(); }; acts.append(b);
  }
  $('msgMenu').classList.remove('hidden'); menuLayer = pushLayer(() => { $('msgMenu').classList.add('hidden'); menuFor = null; });
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
  { icon: 'lock', label: 'Hidden chats', onClick: openHidden },
  { icon: privacyOn() ? 'eye' : 'eyeOff', label: privacyOn() ? 'Turn off privacy mode' : 'Privacy mode', onClick: togglePrivacy },
  { icon: '⚙️', label: 'Settings', onClick: () => setTab('settings') },
]);
function openChatMenu(anchor) {
  if (!current) return;
  const items = [{ icon: 'ℹ️', label: group?.dm ? 'Contact info' : 'Group info', onClick: openInfo }];
  if (!group?.dm) items.push({ icon: '🔗', label: 'Invite people', onClick: shareInvite });
  items.push({ icon: '🔍', label: 'Search messages', onClick: openSearch });
  items.push({ icon: '⏰', label: 'Scheduled messages', onClick: showScheduled });
  items.push({ icon: 'sparkles', label: game && game.phase !== 'over' ? `Game: ${game.name}` : 'Games', onClick: () => game && game.phase !== 'over' ? openGame() : openGamePicker() });
  items.push({ icon: 'footprints', label: group?.dm ? 'Step duel' : 'Step challenge', onClick: openSteps });
  items.push({ icon: 'pencil', label: 'Fun mode', onClick: openFun });
  items.push({ icon: '🎨', label: 'Wallpaper', onClick: () => openWallpaper(current) });
  items.push({ icon: isMuted(current) ? '🔔' : '🔕', label: isMuted(current) ? 'Unmute notifications' : 'Mute notifications', onClick: () => pushActive || isMuted(current) ? muteGroup() : enableNotifications() });
  items.push({ icon: '📻', label: walkie.on ? 'Close walkie-talkie' : 'Walkie-talkie', onClick: () => $('walkieBtn').click() });
  items.push(roomInfo(current)?.hidden ? { icon: 'unlock', label: 'Unhide chat', onClick: () => hideChat(current, false) } : { icon: 'lock', label: 'Hide chat', onClick: () => hideChat(current, true) });
  if (group?.isOwner && !group.dm && current !== 'general') items.push({ icon: 'trash', label: 'Delete group', danger: true, onClick: deleteGroup });
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
  const meta = el('div', 'p-meta'); meta.append(el('b', null, p.name), el('small', null, p.status ? statusText(p.status) : `@${p.username}` + (p.lastSeen ? ` · ${lastSeenText(p.lastSeen).replace('tap here for contact info', '')}` : '')));
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
    const e = el('div', 'empty-note'); e.append(icoEl('users', 'big'), 'No friends yet. Search for someone’s @username above and tap “Add friend”. Once they accept, you can chat 1:1.');
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
  const yes = await popup({ icon: 'userMinus', title: `Remove ${peer.name}?`, text: 'You’ll stop being friends. Your chat history stays, but neither of you can start new 1:1 chats until you’re friends again.', ok: 'Remove', danger: true });
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
    if (peer.status) ab.append(statusPill(peer.status, peer.status.until ? ` · until ${fmtUntil(peer.status.until)}` : ''));
    if (pf?.about) { ab.append(el('h3', null, 'About'), el('p', null, pf.about)); }
    body.append(ab);
  }
  const c = el('div', 'card');
  const row = (icon, title, sub, fn, cls = '') => { const b = el('button', 'set-row ' + cls); b.type = 'button'; b.onclick = fn; const i = icoEl(icon, 's-ico'); const m = el('div', 's-meta'); m.append(el('b', null, title)); if (sub) m.append(el('small', null, sub)); b.append(i, m); c.append(b); };
  row('📻', 'Walkie-talkie', 'Push to talk with ' + (peer.name || '').split(' ')[0], () => { $('app').classList.remove('info-open'); if (!walkie.on) $('walkieBtn').click(); });
  row(isMuted(current) ? '🔔' : '🔕', isMuted(current) ? 'Unmute notifications' : 'Mute notifications', isMuted(current) ? `Muted until ${fmtUntil(mutes[current])}` : null, () => pushActive || isMuted(current) ? muteGroup() : enableNotifications());
  row('🎨', 'Wallpaper', 'Choose a wallpaper just for this chat', () => openWallpaper(current));
  row('🔍', 'Search messages', null, openSearch);
  row('⏰', 'Scheduled messages', null, showScheduled);
  row('🔒', 'Private chat', 'Only you and ' + (peer.name || '').split(' ')[0] + ' can see these messages', () => {});
  const isFriend = friends.friends.some(f => f.uid === peer.uid);
  if (isFriend) row('userMinus', `Remove ${peer.name} from friends`, null, () => removeFriend(peer), 'danger');
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
  const cam = el('button', 'cam-btn'); cam.innerHTML = svgFor('camera'); cam.type = 'button'; cam.setAttribute('aria-label', 'Change profile photo'); cam.onclick = e => { e.stopPropagation(); choosePhoto(null, !!me.photo); };
  av.append(cam);
  prof.append(av, el('h2', null, me.name), el('span', 'muted', '@' + me.username));
  body.append(prof);
  const row = (icon, title, sub, fn, cls = '') => { const b = el('button', 'set-row ' + cls); b.type = 'button'; b.onclick = fn; const m = el('div', 's-meta'); m.append(el('b', null, title)); if (sub) m.append(el('small', null, sub)); b.append(icoEl(icon, 's-ico'), m); body.append(b); };
  body.append(el('h3', 'sec-title', 'Profile'));
  row('🙂', 'Name', me.name, editName);
  row('ℹ️', 'About', me.about || 'Add a few words about yourself', editAbout);
  const st = me.status && (!me.status.until || me.status.until > Date.now()) ? me.status : null;
  row(svgFor(st?.emoji) ? st.emoji : 'message', 'Status', st ? `${st.text || ''}${st.until ? ' · until ' + fmtUntil(st.until) : ''}`.trim() : 'Let people know what you’re up to', editStatus);
  row('👁️', 'View my profile', 'See what others see', () => showProfile(me.uid));
  const themeName = { system: 'System default', light: 'Light', dark: 'Dark' }[store.get('ic-theme') || 'system'];
  body.append(el('h3', 'sec-title', 'Privacy'));
  row(privacyOn() ? 'eye' : 'eyeOff', 'Privacy mode', privacyOn() ? 'On — messages are blurred; tap one to read it' : 'Blur messages in public so nobody can read over your shoulder', togglePrivacy);
  row('lock', 'Hidden chats', privacyState.hasPin ? `${rooms.filter(r => r.hidden).length} hidden · PIN protected` : 'Hide chats behind a PIN', openHidden);
  if (privacyState.hasPin) row('fingerprint', 'Open hidden chats with fingerprint / face', hiddenBioOn() ? 'On for this device' : 'Off — you type your PIN', toggleHiddenBio);
  if (privacyState.hasPin) row('key', 'Change hidden-chats PIN', null, changeHiddenPin);
  row('lock', 'App lock', appLockOn() ? `On · ${APP_LOCK_AFTER[appLock().after] || 'immediately'}${appLock().bio ? ' · fingerprint / face' : ''}` : 'Lock Intra Chat with a code or fingerprint / face', openAppLockSettings);
  body.append(el('h3', 'sec-title', 'Chats'));
  row('🌓', 'Theme', themeName, chooseTheme);
  row('sparkles', 'App style', STYLES.find(x => x.id === appStyle()).name, openStylePicker);
  row('🎨', 'Chat wallpaper', wallpaperName(wallFor(null)), () => openWallpaper(null));
  row('📻', 'Walkie-talkie auto-play', autoWalkie() ? 'On — you hear people live in the open chat, even in the background' : 'Off — tap “Listen” to hear people', () => {
    store.set('ic-wk-auto', autoWalkie() ? '0' : '1'); walkie.autoOff = false;
    if (autoWalkie()) { unlockAudio(); toast('📻 Walkie-talkie will play automatically'); } else { if (!walkie.on) stopBackgroundAudio(); toast('Walkie-talkie auto-play off'); }
    renderSettings(); repoll();
  });
  if (isNativeApp()) row('radio', 'Walkie-talkie with app closed', closedWalkieOn() ? 'On — plays live even when Intra Chat is closed' : 'Off — tap to hear it live with the app closed', async () => { await setClosedWalkie(!closedWalkieOn()); renderSettings(); });
  body.append(el('h3', 'sec-title', 'Health'));
  row('footprints', 'My steps', 'Walk mode, daily goal, streaks and badges', openMyStepsSheet);
  body.append(el('h3', 'sec-title', 'Stories'));
  row('users', 'Close friends', storyFeed.closeFriends.length ? `${storyFeed.closeFriends.length} people · see your close-friends stories` : 'Choose who sees your close-friends stories', editCloseFriends);
  row('bellOff', 'Muted stories', storyFeed.muted.length ? `${storyFeed.muted.length} muted` : 'Nobody muted', manageMutedStories);
  body.append(el('h3', 'sec-title', 'Notifications'));
  if (nativeApp()) row(nativePush.granted ? 'bell' : 'bellOff', 'Message notifications', nativePush.granted ? 'On for this phone' : 'Off — tap to turn on', async () => { const okp = await setupNativePush(true); toast(okp ? 'Notifications are on' : 'Allow notifications for Intra Chat in your phone’s settings'); renderSettings(); });
  else if (pushSupported() && Notification.permission !== 'denied') row(pushActive ? '🔔' : '🔕', 'Message notifications', pushActive ? 'On for this device' : 'Off — tap to turn on', () => (pushActive ? disableNotifications() : enableNotifications()).then(renderSettings));
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
    choices: [['system', 'System default'], ['light', 'Light'], ['dark', 'Dark']].map(([value, label]) => ({ value, label, icon: value === cur ? 'check' : null, cls: value === cur ? 'primary' : '' })) });
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
  up.append(icoEl('camera'), el('span', null, myPhoto ? 'New photo' : 'Your photo'));
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
      // High-quality resize: halve step by step (avoids the blur/jaggies of one big downscale), best smoothing
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const W = Math.round(img.naturalWidth * k), H = Math.round(img.naturalHeight * k);
      let src = img, sw = img.naturalWidth, sh = img.naturalHeight;
      while (sw / 2 >= W * 1.05 && sh / 2 >= H * 1.05) {
        const t = document.createElement('canvas'); t.width = Math.round(sw / 2); t.height = Math.round(sh / 2);
        const tc = t.getContext('2d'); tc.imageSmoothingEnabled = true; tc.imageSmoothingQuality = 'high'; tc.drawImage(src, 0, 0, t.width, t.height);
        src = t; sw = t.width; sh = t.height;
      }
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const cx = c.getContext('2d'); cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
      cx.fillStyle = '#fff'; cx.fillRect(0, 0, W, H);            // transparent PNGs get a white background, not black
      cx.drawImage(src, 0, 0, W, H);
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
let emojiLayer = null;
function closeEmoji() { $('emojiPanel').classList.add('hidden'); $('emojiBtn').classList.remove('active'); dropLayer(emojiLayer); }
$('emojiBtn').onclick = () => {
  buildEmoji();
  const open = $('emojiPanel').classList.toggle('hidden') === false;
  $('emojiBtn').classList.toggle('active', open);
  if (open) emojiLayer = pushLayer(() => { $('emojiPanel').classList.add('hidden'); $('emojiBtn').classList.remove('active'); }); else dropLayer(emojiLayer);
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
let viewerLayer = null;
function viewPhoto(url) { $('viewer').querySelector('img').src = url; $('viewer').classList.remove('hidden'); viewerLayer = pushLayer(() => $('viewer').classList.add('hidden')); }
const statusText = st => st ? `${st.emoji && !st.emoji.startsWith('ic:') ? st.emoji + ' ' : ''}${st.text || ''}`.trim() : '';
function statusPill(st, extra = '') { const p = el('div', 'status-pill'); if (svgFor(st.emoji)) p.append(icoEl(st.emoji)); p.append(statusText(st) + extra); return p; }

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
  if (st) inner.append(statusPill(st, st.until ? ` · until ${fmtUntil(st.until)}` : ''));
  if (p.about) { const ab = el('div', 'ps-about'); ab.append(el('small', 'muted', 'About'), el('p', null, p.about)); inner.append(ab); }
  const acts = el('div', 'ps-actions');
  const btn = (label, cls, fn) => { const b = el('button', 'btn ' + cls, label); b.type = 'button'; b.onclick = () => fn(b); acts.append(b); };
  if (p.friend === 'self') btn('Edit profile', 'primary', () => { dlg.close(); setTab('settings'); });
  else if (p.friend === 'friends') btn('Message', 'primary', () => { dlg.close(); openDm(uid); });
  else if (p.friend === 'out') btn('Request sent', 'ghost', () => {});
  else if (p.friend === 'in') btn('Accept friend request', 'primary', async b => { await respond(p, true, b); dlg.close(); });
  else btn('Add friend', 'primary', async b => { await friendAction('request', uid, `Friend request sent to ${p.name}`, b); dlg.close(); });
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
const STATUSES = [['ic:calendar', 'In a meeting'], ['ic:coffee', 'At lunch'], ['ic:headphones', 'Focusing'], ['ic:car', 'Commuting'], ['ic:home', 'Working from home'], ['ic:thermometer', 'Out sick'], ['ic:sun', 'On leave']];
async function editStatus() {
  const cur = me.status && (!me.status.until || me.status.until > Date.now()) ? me.status : null;
  const pick = await popup({ icon: '💬', title: 'Set a status', text: cur ? `Now: ${statusText(cur)}` : 'Shown next to your name. It clears itself when you want.', ok: '', cancel: 'Cancel',
    choices: [...STATUSES.map(([e, t]) => ({ value: e + '|' + t, label: t, icon: e })), { value: 'custom', label: 'Write my own…', icon: 'pencil' }, ...(cur ? [{ value: 'clear', label: 'Clear status', icon: 'x', cls: 'danger' }] : [])] });
  if (typeof pick !== 'string') return;
  if (pick === 'clear') return saveMe({ status: null }, 'Status cleared');
  let emoji = 'ic:message', txt = '';
  if (pick === 'custom') {
    const v = await popup({ icon: '✏️', title: 'Your status', text: 'e.g. “Back in 5 minutes”.', ok: 'Next', input: { value: '', maxLength: 60, required: true, requiredMsg: 'Write something' } });
    if (v === null) return;
    const m = v.match(/^(\p{Extended_Pictographic}[\u{FE0F}\u{200D}\p{Extended_Pictographic}]*)\s*(.*)$/u);
    if (m) { emoji = m[1]; txt = m[2]; } else txt = v;
  } else [emoji, txt] = pick.split('|');
  const endOfDay = new Date(); endOfDay.setHours(23, 59, 0, 0);
  const until = await popup({ icon: svgFor(emoji) ? emoji : 'clock', title: 'Clear after', ok: '', cancel: 'Cancel',
    choices: [{ value: 3600e3, label: '1 hour' }, { value: 4 * 3600e3, label: '4 hours' }, { value: endOfDay - Date.now(), label: 'Today' }, { value: 7 * 864e5, label: 'This week' }, { value: 0, label: 'Don’t clear' }] });
  if (typeof until !== 'number') return;
  await saveMe({ status: { emoji, text: txt, until: until ? Date.now() + until : 0 } }, `Status set: ${txt}`);
}
// Change / remove a profile photo (yours, or a group's when room is given)
async function choosePhoto(room, has) {
  if (has) {
    const v = await popup({ icon: '📷', title: room ? 'Group photo' : 'Profile photo', ok: '', cancel: 'Cancel', choices: [{ value: 'new', label: 'Choose a new photo', icon: 'image' }, { value: 'remove', label: 'Remove photo', icon: 'trash', cls: 'danger' }] });
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
      const data = await shrinkImage(file, 1080, .9);          // sharp on high-density phone screens
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
  const t = el('div', 'pin-text'); t.append(icoText('pinned', pins.length > 1 ? `Pinned message ${pinIdx + 1} of ${pins.length}` : 'Pinned message', 'pin-title'), el('span', null, `${p.name}: ${p.text}`));
  const x = el('button', 'icon-btn pin-x'); x.innerHTML = svgFor('x'); x.type = 'button'; x.title = 'Unpin'; x.setAttribute('aria-label', 'Unpin');
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
  opts.push({ value: mon.getTime(), label: 'Monday at 9 AM' }, { value: 'custom', label: 'Pick date & time…', icon: 'calendar' });
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
  if (!body) return toast('Type a message first, then press and hold Send to schedule it');
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
  const v = await popup({ icon: '⏰', title: 'Scheduled messages', text: list.length ? 'Tap one to cancel it.' : 'Nothing scheduled in this chat. Type a message, then press and hold Send (or right-click it) to send it later.', ok: '', cancel: 'Close',
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
  showInfoPane();
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

/* ---------------- Stories ---------------- */
let storyFeed = { people: [], closeFriends: [], muted: [] }, storiesAt = 0;
const STORY_BGS = ['#00a884', '#7c3aed', '#e11d48', '#ea580c', '#0284c7', '#0f172a', '#16a34a', '#db2777', '#ca8a04', 'grad1', 'grad2', 'grad3'];
const STORY_GRADS = { grad1: 'linear-gradient(135deg,#f97316,#db2777)', grad2: 'linear-gradient(135deg,#06b6d4,#7c3aed)', grad3: 'linear-gradient(135deg,#22c55e,#0ea5e9)' };
const STORY_FONTS = ['sans', 'serif', 'mono', 'hand', 'bold'];
const STORY_REACTS = ['❤️', '😂', '😮', '😢', '👏', '🔥'];
const storyBg = b => STORY_GRADS[b] || (STORY_BGS.includes(b) ? b : '#00a884');
const agoText = ts => { const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`; };

async function loadStories() {
  try { storyFeed = await api('story/feed', { room: 'general' }); storiesAt = Date.now(); } catch { return; }
  renderStoryBar();
  if (currentTab === 'settings') renderSettings();
}
function storyAvatar(p, size) {
  const ring = el('div', 'story-ring' + (!p.stories.length ? ' none' : p.allSeen ? ' seen' : ''));
  if (size) ring.style.setProperty('--s', size + 'px');
  const a = el('div', 'avatar'); paintAvatar(a, p.name, { photo: p.photo }); ring.append(a);
  return ring;
}
function renderStoryBar() {
  const bar = $('storyBar'); if (!bar) return;
  bar.innerHTML = '';
  const mine = storyFeed.people.find(p => p.mine) || { uid: me.uid, name: me.name, photo: me.photo, stories: [], allSeen: true, mine: true };
  const item = (p, label, onClick, extra) => {
    const b = el('button', 'story-item' + (p.muted ? ' muted' : '')); b.type = 'button'; b.onclick = onClick;
    const r = storyAvatar(p); if (extra) r.append(extra);
    b.append(r, el('span', null, label)); b.title = label; bar.append(b); return b;
  };
  const plus = el('span', 'story-plus');
  plus.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>';
  plus.onclick = e => { e.stopPropagation(); openStoryComposer(); };
  item(mine, mine.stories.length ? 'Your story' : 'Add story', () => mine.stories.length ? openStories(me.uid) : openStoryComposer(), plus);
  for (const p of storyFeed.people) if (!p.mine) item(p, p.name.split(' ')[0], () => openStories(p.uid));
}

/* --- viewer --- */
const sv = { list: [], pi: 0, si: 0, raf: 0, start: 0, elapsed: 0, paused: false, dur: 5000, layer: null, loading: false };
function svEl() {
  let v = $('storyViewer'); if (v) return v;
  v = el('div', 'story-viewer hidden'); v.id = 'storyViewer'; v.setAttribute('role', 'dialog'); v.setAttribute('aria-label', 'Story');
  v.innerHTML = `<div class="sv-card"><div class="sv-bars"></div>
    <header class="sv-head"><div class="sv-av"></div><div class="sv-who"><b></b><small></small></div>
      <button class="icon-btn sv-more" aria-label="Story options"><svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="19" r="1.6" fill="currentColor"/></svg></button>
      <button class="icon-btn sv-close" aria-label="Close">${svgFor('x')}</button></header>
    <div class="sv-stage"><div class="sv-content"></div><div class="sv-poll"></div><button class="sv-nav prev" aria-label="Previous"></button><button class="sv-nav next" aria-label="Next"></button></div>
    <footer class="sv-foot"></footer></div>`;
  document.body.append(v);
  v.querySelector('.sv-close').onclick = () => closeLayer(sv.layer, closeStoriesUI);
  v.querySelector('.sv-more').onclick = e => storyMenu(e.currentTarget);
  const stage = v.querySelector('.sv-stage');
  let downAt = 0, held = false, y0 = 0, holdTimer;
  stage.addEventListener('pointerdown', e => { if (e.target.closest('.sv-poll button')) return; downAt = Date.now(); y0 = e.clientY; held = false; holdTimer = setTimeout(() => { held = true; svPause(true); }, 220); });
  stage.addEventListener('pointerup', e => {
    clearTimeout(holdTimer); if (!downAt) return;
    const dy = e.clientY - y0; downAt = 0;
    if (dy > 90) return closeLayer(sv.layer, closeStoriesUI);          // swipe down closes
    if (held) { svPause(false); return; }
    if (e.target.closest('.sv-poll button')) return;
    const r = stage.getBoundingClientRect();
    (e.clientX - r.left < r.width * .3 ? svPrev : svNext)();
  });
  stage.addEventListener('pointercancel', () => { clearTimeout(holdTimer); if (held) svPause(false); downAt = 0; });
  document.addEventListener('keydown', e => {
    if (v.classList.contains('hidden') || /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)) return;
    if (e.key === 'ArrowRight') svNext(); else if (e.key === 'ArrowLeft') svPrev(); else if (e.key === 'Escape') closeLayer(sv.layer, closeStoriesUI); else if (e.key === ' ') { e.preventDefault(); svPause(!sv.paused); }
  });
  return v;
}
function openStories(uid, storyId) {
  const people = storyFeed.people.filter(p => p.stories.length);
  const start = people.find(p => p.uid === uid); if (!start) return toast('No stories to show');
  // your own stories on their own; a friend's, then the other friends after them (muted ones only if you tap them)
  sv.list = start.mine ? [start] : [start, ...people.filter(p => !p.mine && !p.muted && p.uid !== uid)];
  sv.pi = 0;
  sv.si = storyId ? Math.max(0, start.stories.findIndex(s => s.id === storyId)) : start.mine ? 0 : Math.max(0, start.stories.findIndex(s => !s.seen));
  const v = svEl(); v.classList.remove('hidden');
  if (!layerLive(sv.layer)) sv.layer = pushLayer(closeStoriesUI);
  svShow();
}
async function openStoryById(uid, id) {
  if (Date.now() - storiesAt > 10000) await loadStories();
  const p = storyFeed.people.find(x => x.uid === uid);
  if (!p?.stories.some(s => s.id === id)) return toast('This story has expired');
  openStories(uid, id);
}
function closeStoriesUI() {
  cancelAnimationFrame(sv.raf); $('storyViewer')?.classList.add('hidden'); dropLayer(sv.layer);
  renderStoryBar();
}
function svCur() { const p = sv.list[sv.pi]; return p && { p, s: p.stories[sv.si] }; }
function svShow() {
  const c = svCur(); if (!c) return closeLayer(sv.layer, closeStoriesUI);
  const { p, s } = c, v = svEl();
  // bars
  const bars = v.querySelector('.sv-bars'); bars.innerHTML = '';
  p.stories.forEach((_, i) => { const b = el('i'); const f = el('b'); f.style.width = i < sv.si ? '100%' : '0%'; b.append(f); bars.append(b); });
  // header
  const av = v.querySelector('.sv-av'); av.innerHTML = ''; const a = el('div', 'avatar'); paintAvatar(a, p.name, { photo: p.photo }); av.append(a);
  av.onclick = () => { if (!p.mine) { closeLayer(sv.layer, closeStoriesUI); showProfile(p.uid); } };
  v.querySelector('.sv-who b').textContent = p.mine ? 'Your story' : p.name;
  v.querySelector('.sv-who small').textContent = agoText(s.at) + (s.audience === 'close' ? ' · Close friends' : '');
  // content
  const box = v.querySelector('.sv-content'); box.innerHTML = ''; box.className = 'sv-content';
  sv.elapsed = 0; sv.paused = false; sv.loading = false;
  if (s.type === 'photo') {
    box.classList.add('photo');
    const img = el('img'); img.alt = s.caption || 'Story photo'; sv.loading = true;
    img.onload = () => { sv.loading = false; sv.start = performance.now(); };
    img.onerror = () => { sv.loading = false; };
    img.src = s.url; box.append(img);
    if (s.caption) box.append(el('div', 'sv-caption', s.caption));
    sv.dur = 6000;
  } else {
    box.classList.add('text', 'font-' + (s.font || 'sans')); box.style.background = storyBg(s.bg);
    const t = el('div', 'sv-text'); t.append(fmtText(s.text)); box.append(t);
    sv.dur = Math.min(10000, 4500 + s.text.length * 40);
  }
  if (!box.classList.contains('text')) box.style.background = '#000';
  renderPoll(s, p);
  renderStoryFoot(s, p);
  // mark seen
  if (!p.mine && !s.seen) { s.seen = true; p.allSeen = p.stories.every(x => x.seen); api('story/view', { uid: p.uid, id: s.id, room: 'general' }).catch(() => {}); }
  sv.start = performance.now();
  cancelAnimationFrame(sv.raf); sv.raf = requestAnimationFrame(svTick);
  // preload the next photo
  const nx = p.stories[sv.si + 1] || sv.list[sv.pi + 1]?.stories[0]; if (nx?.url) { const i = new Image(); i.src = nx.url; }
}
function svTick(now) {
  const v = $('storyViewer'); if (!v || v.classList.contains('hidden')) return;
  if (sv.paused || sv.loading) { sv.start = now - sv.elapsed; }
  else {
    sv.elapsed = now - sv.start;
    const fill = v.querySelectorAll('.sv-bars b')[sv.si]; if (fill) fill.style.width = Math.min(100, sv.elapsed / sv.dur * 100) + '%';
    if (sv.elapsed >= sv.dur) return svNext();
  }
  sv.raf = requestAnimationFrame(svTick);
}
function svPause(on) { sv.paused = on; $('storyViewer')?.classList.toggle('paused', on); }
function svNext() {
  const p = sv.list[sv.pi]; if (!p) return;
  if (sv.si < p.stories.length - 1) sv.si++;
  else if (sv.pi < sv.list.length - 1) { sv.pi++; const q = sv.list[sv.pi]; sv.si = Math.max(0, q.stories.findIndex(s => !s.seen)); }
  else return closeLayer(sv.layer, closeStoriesUI);
  svShow();
}
function svPrev() {
  if (sv.si > 0) sv.si--;
  else if (sv.pi > 0) { sv.pi--; sv.si = sv.list[sv.pi].stories.length - 1; }
  svShow();
}
function renderPoll(s, p) {
  const box = $('storyViewer').querySelector('.sv-poll'); box.innerHTML = '';
  if (!s.poll) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  box.append(el('b', 'sp-q', s.poll.q));
  const total = s.poll.counts ? s.poll.counts.reduce((a, b) => a + b, 0) : 0;
  s.poll.opts.forEach((o, i) => {
    const b = el('button', 'sp-opt' + (s.poll.myVote === i ? ' mine' : '')); b.type = 'button';
    const pct = s.poll.counts && total ? Math.round(s.poll.counts[i] / total * 100) : null;
    if (pct !== null) { b.style.setProperty('--pct', pct + '%'); b.classList.add('done'); }
    b.append(el('span', null, o)); if (pct !== null) b.append(el('em', null, pct + '%'));
    b.onclick = async e => {
      e.stopPropagation();
      if (p.mine) return toast('Others vote on your poll — see results under Viewers');
      try { const d = await api('story/vote', { uid: p.uid, id: s.id, opt: i, room: 'general' }); s.poll = d.story.poll; renderPoll(s, p); } catch (er) { toast(er.message); }
    };
    box.append(b);
  });
  if (s.poll.counts) box.append(el('small', 'sp-total', `${total} vote${total === 1 ? '' : 's'}`));
}
function renderStoryFoot(s, p) {
  const f = $('storyViewer').querySelector('.sv-foot'); f.innerHTML = '';
  if (p.mine) {
    const b = el('button', 'sv-views'); b.type = 'button'; b.append(icoEl('eye'), `${s.views || 0} view${s.views === 1 ? '' : 's'}`);
    if (s.reacts) b.append(el('span', 'sv-rc', ` · ${s.reacts} reaction${s.reacts === 1 ? '' : 's'}`));
    b.onclick = () => showStoryViewers(s);
    f.append(b);
    return;
  }
  const reacts = el('div', 'sv-reacts');
  for (const e of STORY_REACTS) {
    const b = el('button', s.myReact === e ? 'on' : '', e); b.type = 'button'; b.setAttribute('aria-label', 'React ' + e);
    b.onclick = async () => {
      try { const d = await api('story/react', { uid: p.uid, id: s.id, emoji: e, room: 'general' }); s.myReact = d.myReact; renderStoryFoot(s, p); if (d.myReact) { toast(`Reacted ${d.myReact}`); burst(d.myReact); } } catch (er) { toast(er.message); }
    };
    reacts.append(b);
  }
  const form = el('form', 'sv-reply'); const inp = el('input'); inp.placeholder = `Reply to ${p.name.split(' ')[0]}…`; inp.maxLength = 500; inp.setAttribute('aria-label', 'Reply');
  const send = el('button', 'round-btn'); send.type = 'submit'; send.innerHTML = svgFor('send'); send.setAttribute('aria-label', 'Send reply');
  inp.onfocus = () => svPause(true); inp.onblur = () => { if (!inp.value) svPause(false); };
  form.onsubmit = async e => {
    e.preventDefault(); const t = inp.value.trim(); if (!t) return;
    send.disabled = true;
    try { await api('story/reply', { uid: p.uid, id: s.id, text: t, room: 'general' }); inp.value = ''; inp.blur(); svPause(false); toast(`Reply sent to ${p.name.split(' ')[0]}`); refreshRooms(); }
    catch (er) { toast(er.message); } finally { send.disabled = false; }
  };
  form.append(inp, send);
  f.append(reacts, form);
}
function burst(emoji) {
  const v = $('storyViewer'); if (!v) return;
  for (let i = 0; i < 8; i++) { const s = el('span', 'sv-burst', emoji); s.style.left = (30 + Math.random() * 40) + '%'; s.style.animationDelay = i * 60 + 'ms'; v.append(s); setTimeout(() => s.remove(), 1600); }
}
function storyMenu(anchor) {
  const c = svCur(); if (!c) return;
  const { p, s } = c; svPause(true);
  const items = p.mine ? [
    { icon: 'eye', label: 'Viewers', onClick: () => showStoryViewers(s) },
    { icon: 'trash', label: 'Delete story', danger: true, onClick: () => deleteStory(s) },
  ] : [
    { icon: 'message', label: `Message ${p.name.split(' ')[0]}`, onClick: () => { closeLayer(sv.layer, closeStoriesUI); openDm(p.uid); } },
    { icon: 'user', label: 'View profile', onClick: () => { closeLayer(sv.layer, closeStoriesUI); showProfile(p.uid); } },
    { icon: p.muted ? 'bell' : 'bellOff', label: p.muted ? `Unmute ${p.name.split(' ')[0]}’s stories` : `Mute ${p.name.split(' ')[0]}’s stories`, onClick: () => muteStories(p, !p.muted) },
  ];
  simpleMenu(anchor, items);
  const resume = () => { if (!menuFor) { svPause(false); clearInterval(t); } }; const t = setInterval(resume, 300);
}
async function deleteStory(s) {
  const yes = await popup({ icon: 'trash', title: 'Delete this story?', text: 'It disappears for everyone straight away.', ok: 'Delete', danger: true });
  if (!yes) { svPause(false); return; }
  try {
    await api('story/delete', { id: s.id, room: 'general' }); toast('Story deleted');
    const p = sv.list[sv.pi]; p.stories = p.stories.filter(x => x.id !== s.id);
    if (!p.stories.length) { closeLayer(sv.layer, closeStoriesUI); } else { sv.si = Math.min(sv.si, p.stories.length - 1); svShow(); }
    loadStories();
  } catch (e) { toast(e.message); }
}
async function muteStories(p, on) {
  try { const d = await api('story/mute', { uid: p.uid, on, room: 'general' }); storyFeed.muted = d.muted; p.muted = on; toast(on ? `${p.name}’s stories muted` : `${p.name}’s stories unmuted`); loadStories(); } catch (e) { toast(e.message); }
  svPause(false);
}
function sheet(id, title) {
  let d = $(id);
  if (!d) { d = document.createElement('dialog'); d.id = id; d.className = 'sheet'; d.onclick = e => { if (e.target === d) d.close(); }; document.body.append(d); }
  d.innerHTML = '';
  const inner = el('div', 'sheet-inner'), head = el('header', 'sheet-head'); head.append(el('h2', null, title));
  const x = el('button', 'icon-btn'); x.type = 'button'; x.innerHTML = svgFor('x'); x.setAttribute('aria-label', 'Close'); x.onclick = () => d.close(); head.append(x);
  inner.append(head); d.append(inner);
  return { d, inner };
}
async function showStoryViewers(s) {
  svPause(true);
  let data; try { data = await api('story/viewers', { id: s.id, room: 'general' }); } catch (e) { svPause(false); return toast(e.message); }
  const { d, inner } = sheet('storyViewers', `Viewed by ${data.viewers.length}`);
  if (data.poll) {
    const counts = data.poll.opts.map((_, i) => data.viewers.filter(v => v.vote === i).length), total = counts.reduce((a, b) => a + b, 0);
    const pc = el('div', 'sv-pollres'); pc.append(el('b', null, data.poll.q));
    data.poll.opts.forEach((o, i) => { const r = el('div', 'spr-row'); r.style.setProperty('--pct', (total ? counts[i] / total * 100 : 0) + '%'); r.append(el('span', null, o), el('em', null, `${counts[i]}`)); pc.append(r); });
    inner.append(pc);
  }
  if (!data.viewers.length) inner.append(el('p', 'empty-note', 'No views yet.'));
  for (const v of data.viewers) {
    const row = personRow({ ...v, lastSeen: 0 }, [], null);
    row.querySelector('small').textContent = [v.at ? agoText(v.at) : '', v.vote !== null && data.poll ? `voted “${data.poll.opts[v.vote]}”` : ''].filter(Boolean).join(' · ');
    if (v.react) row.querySelector('.p-acts').append(el('span', 'sv-vreact', v.react));
    inner.append(row);
  }
  d.addEventListener('close', () => svPause(false), { once: true });
  d.showModal();
}

/* --- close friends & muted --- */
async function editCloseFriends() {
  await loadFriends();
  const chosen = new Set(storyFeed.closeFriends);
  const { d, inner } = sheet('closeFriends', 'Close friends');
  inner.append(el('p', 'muted small', 'Only these friends see stories you share with “Close friends”. They aren’t told they’re on the list.'));
  if (!friends.friends.length) inner.append(el('p', 'empty-note', 'Add friends first.'));
  const list = el('div', 'cf-list');
  for (const f of friends.friends) {
    const lab = el('label', 'person cf-row'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = chosen.has(f.uid);
    cb.onchange = () => cb.checked ? chosen.add(f.uid) : chosen.delete(f.uid);
    const a = el('div', 'avatar'); paintAvatar(a, f.name, { photo: f.photo });
    const m = el('div', 'p-meta'); m.append(el('b', null, f.name), el('small', null, '@' + f.username));
    lab.append(a, m, cb); list.append(lab);
  }
  inner.append(list);
  const save = el('button', 'btn primary block', 'Save'); save.type = 'button';
  save.onclick = async () => { save.disabled = true; try { const r = await api('story/close-friends', { uids: [...chosen], room: 'general' }); storyFeed.closeFriends = r.closeFriends; toast(`${r.closeFriends.length} close friend${r.closeFriends.length === 1 ? '' : 's'}`); d.close(); renderSettings(); } catch (e) { toast(e.message); save.disabled = false; } };
  inner.append(save);
  d.showModal();
  return new Promise(res => d.addEventListener('close', res, { once: true }));
}
function manageMutedStories() {
  const { d, inner } = sheet('mutedStories', 'Muted stories');
  const muted = storyFeed.people.filter(p => p.muted);
  if (!storyFeed.muted.length) inner.append(el('p', 'empty-note', 'You haven’t muted anyone’s stories. Use the menu while watching a story to mute someone.'));
  for (const uid of storyFeed.muted) {
    const f = friends.friends.find(x => x.uid === uid) || muted.find(x => x.uid === uid) || { uid, name: 'Friend', username: '' };
    inner.append(personRow(f, [['Unmute', 'primary', async b => { b.disabled = true; await muteStories(f, false); d.close(); renderSettings(); }]]));
  }
  d.showModal();
}

/* --- composer --- */
const sc = { mode: 'text', bg: '#00a884', font: 'sans', file: null, audience: 'friends', hours: 24, poll: false };
function openStoryComposer() {
  Object.assign(sc, { mode: 'text', bg: STORY_BGS[Math.floor(Math.random() * STORY_BGS.length)], font: 'sans', file: null, audience: 'friends', hours: 24, poll: false });
  const { d, inner } = sheet('storySheet', 'New story');
  d.classList.add('story-sheet');
  const tabs = el('div', 'seg'); const tText = el('button', 'on', 'Text'), tPhoto = el('button', null, 'Photo'); tText.type = tPhoto.type = 'button'; tabs.append(tText, tPhoto);
  const prev = el('div', 'sc-preview');
  const ta = el('textarea', 'sc-text'); ta.placeholder = 'Type a status'; ta.maxLength = 300; ta.rows = 4;
  const img = el('img', 'sc-img hidden'); img.alt = 'Story photo preview';
  const pick = el('button', 'sc-pick hidden'); pick.type = 'button'; pick.append(icoEl('image'), 'Choose a photo');
  const file = el('input'); file.type = 'file'; file.accept = 'image/*'; file.hidden = true;
  const tools = el('div', 'sc-tools');
  const fontBtn = el('button', 'sc-tool', 'Aa'); fontBtn.type = 'button'; fontBtn.title = 'Change font';
  const colorBtn = el('button', 'sc-tool sc-color'); colorBtn.type = 'button'; colorBtn.title = 'Change colour';
  tools.append(fontBtn, colorBtn);
  prev.append(ta, img, pick, tools, file);
  const cap = el('input', 'sc-caption hidden'); cap.placeholder = 'Add a caption…'; cap.maxLength = 200;
  const paint = () => {
    prev.style.background = sc.mode === 'text' ? storyBg(sc.bg) : '#111';
    prev.className = 'sc-preview font-' + sc.font + (sc.mode === 'photo' ? ' photo' : '');
    colorBtn.style.background = storyBg(sc.bg);
    ta.classList.toggle('hidden', sc.mode !== 'text'); tools.classList.toggle('hidden', sc.mode !== 'text');
    img.classList.toggle('hidden', sc.mode !== 'photo' || !sc.file); pick.classList.toggle('hidden', sc.mode !== 'photo' || !!sc.file);
    cap.classList.toggle('hidden', sc.mode !== 'photo');
    tText.classList.toggle('on', sc.mode === 'text'); tPhoto.classList.toggle('on', sc.mode === 'photo');
  };
  tText.onclick = () => { sc.mode = 'text'; paint(); ta.focus(); };
  tPhoto.onclick = () => { sc.mode = 'photo'; paint(); if (!sc.file) file.click(); };
  pick.onclick = () => file.click(); img.onclick = () => file.click();
  file.onchange = () => { const f = file.files[0]; if (!f) return; sc.file = f; img.src = URL.createObjectURL(f); paint(); };
  fontBtn.onclick = () => { sc.font = STORY_FONTS[(STORY_FONTS.indexOf(sc.font) + 1) % STORY_FONTS.length]; paint(); };
  colorBtn.onclick = () => { sc.bg = STORY_BGS[(STORY_BGS.indexOf(sc.bg) + 1) % STORY_BGS.length]; paint(); };
  // poll
  const pollT = el('label', 'check sc-check'); const pcb = el('input'); pcb.type = 'checkbox'; pollT.append(pcb, 'Add a poll');
  const pollBox = el('div', 'sc-poll hidden');
  const pq = el('input'); pq.placeholder = 'Ask a question…'; pq.maxLength = 80;
  const opts = el('div', 'sc-opts');
  const addOpt = v => { const o = el('input'); o.placeholder = `Option ${opts.children.length + 1}`; o.maxLength = 30; o.value = v || ''; opts.append(o); };
  addOpt('Yes'); addOpt('No');
  const more = el('button', 'link-btn', '+ Add option'); more.type = 'button'; more.onclick = () => { if (opts.children.length < 4) addOpt(); if (opts.children.length >= 4) more.remove(); };
  pollBox.append(pq, opts, more);
  pcb.onchange = () => { sc.poll = pcb.checked; pollBox.classList.toggle('hidden', !pcb.checked); if (pcb.checked) pq.focus(); };
  // audience + duration
  const segRow = (label, choices, key) => {
    const row = el('div', 'sc-row'); row.append(el('span', 'sc-label', label));
    const seg = el('div', 'seg small');
    for (const [v, t] of choices) { const b = el('button', sc[key] === v ? 'on' : '', t); b.type = 'button'; b.onclick = () => { sc[key] = v; [...seg.children].forEach(x => x.classList.toggle('on', x === b)); }; seg.append(b); }
    row.append(seg); return row;
  };
  const aud = segRow('Share with', [['friends', 'All friends'], ['close', 'Close friends']], 'audience');
  const cfEdit = el('button', 'link-btn', `Edit close friends (${storyFeed.closeFriends.length})`); cfEdit.type = 'button';
  cfEdit.onclick = async () => { d.close(); await editCloseFriends(); d.showModal(); cfEdit.textContent = `Edit close friends (${storyFeed.closeFriends.length})`; };
  const dur = segRow('Disappears after', [[6, '6 hours'], [24, '24 hours'], [48, '48 hours']], 'hours');
  const post = el('button', 'btn primary block', 'Share story'); post.type = 'button';
  post.onclick = async () => {
    const body = { type: sc.mode, bg: sc.bg, font: sc.font, audience: sc.audience, hours: sc.hours, room: 'general' };
    if (sc.mode === 'text') { body.text = ta.value.trim(); if (!body.text) return toast('Write something first'); }
    else { if (!sc.file) return toast('Choose a photo first'); body.caption = cap.value.trim(); }
    if (sc.poll) body.poll = { q: pq.value.trim(), opts: [...opts.children].map(o => o.value.trim()).filter(Boolean) };
    if (sc.audience === 'close' && !storyFeed.closeFriends.length) return toast('Choose your close friends first');
    post.disabled = true; post.textContent = 'Sharing…';
    try {
      if (sc.mode === 'photo') {
        const blob = await (await fetch(await shrinkImage(sc.file, 1920, .9))).blob();
        const r = await fetch('/api/story/photo', { method: 'POST', body: blob, headers: { 'Content-Type': 'image/jpeg', 'X-Chat-Device': me.device, Authorization: 'Bearer ' + me.token } });
        const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Upload failed');
        body.url = j.url;
      }
      await api('story/post', body);
      d.close(); toast(sc.audience === 'close' ? 'Shared with close friends' : 'Story shared'); await loadStories();
    } catch (e) { toast(e.message); post.disabled = false; post.textContent = 'Share story'; }
  };
  inner.append(tabs, prev, cap, pollT, pollBox, aud, cfEdit, dur, post);
  paint();
  d.showModal();
  setTimeout(() => ta.focus(), 80);
}

/* ---------------- Step challenge ---------------- */
// Steps come from "Walk mode" (the phone's motion sensor while the app is open) or are typed in from the phone's
// Health / Fit app. Groups can run a challenge: daily goal, leaderboard, streaks, badges, a team journey and cheers.
const localDay = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const fmtN = n => Math.round(n || 0).toLocaleString();
const kmOf = n => (n * 0.75 / 1000);
let myStepsData = null, stepsBoard = null, stepsRange = 'today';
async function loadMySteps() {
  const [me1, hs] = await Promise.all([api('steps/me', { room: current || 'general', today: localDay() }).catch(() => null), api('health/status', { room: current || 'general' }).catch(() => null)]);
  if (me1) myStepsData = me1; if (hs) healthStatus = hs;
  // keep Google Health fresh while you look at your steps (the server also syncs every 30 minutes on its own)
  if (healthStatus?.connected && !healthStatus.error && Date.now() - healthStatus.lastSync > 10 * 60_000 && !healthSyncing) syncHealthNow(true);
  return myStepsData;
}
/* Inside the native Android / iOS app: read daily steps straight from Health Connect / Apple Health */
const nativeApp = () => !!window.Capacitor?.isNativePlatform?.();
const nativeOS = () => window.Capacitor?.getPlatform?.() || 'web';
const hcCall = (method, opts = {}) => window.Capacitor.nativePromise('Health', method, opts);
const phoneHealthName = () => nativeOS() === 'ios' ? 'Apple Health' : 'Health Connect';
let phoneHealth = { checked: false, available: false, reason: '', granted: store.get('ic-hc-on') === '1', lastSync: Number(store.get('ic-hc-at')) || 0, syncing: false };
async function checkPhoneHealth() {
  if (!nativeApp()) return phoneHealth;
  try { const a = await hcCall('isAvailable'); phoneHealth.available = !!a.available; phoneHealth.reason = a.reason || ''; } catch (e) { phoneHealth.available = false; phoneHealth.reason = e.message; }
  phoneHealth.checked = true;
  return phoneHealth;
}
async function connectPhoneHealth(onChange) {
  if (!phoneHealth.checked) await checkPhoneHealth();
  if (!phoneHealth.available) {
    const yes = await popup({ icon: 'footprints', title: `${phoneHealthName()} isn’t ready`, text: nativeOS() === 'android' ? 'Install or update “Health Connect by Android” from the Play Store (built in on Android 14+), then try again.' : (phoneHealth.reason || 'Apple Health isn’t available on this device.'), ok: nativeOS() === 'android' ? 'Open Health Connect' : 'OK', cancel: 'Close' });
    if (yes && nativeOS() === 'android') hcCall('openHealthConnectSettings').catch(() => {});
    return;
  }
  try {
    const st = await hcCall('requestAuthorization', { read: ['steps'], write: [] });
    // Apple never says whether read access was given, so on iPhone we just try reading
    const ok = nativeOS() === 'ios' || (st?.readAuthorized || []).includes('steps');
    if (!ok) { toast(`Allow ${phoneHealthName()} to share Steps to sync automatically`); return; }
    phoneHealth.granted = true; store.set('ic-hc-on', '1');
    await syncPhoneHealth(false); onChange?.();
    await configureStepSync(); await askBackgroundSteps();
  } catch (e) { toast(e.message || `Couldn’t connect ${phoneHealthName()}`); }
}
function disconnectPhoneHealth(onChange) {
  phoneHealth.granted = false; store.del('ic-hc-on'); stepSyncCall('stop').catch(() => {});
  toast(`${phoneHealthName()} sync off. To remove access fully, open ${phoneHealthName()} settings.`);
  onChange?.();
}
// Read the last 7 days of daily step totals on the phone and send them to the server (it never lowers a day)
async function syncPhoneHealth(quiet = true) {
  if (!nativeApp() || !phoneHealth.granted || phoneHealth.syncing || !me.token) return;
  phoneHealth.syncing = true;
  try {
    const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - 6);
    const { samples = [] } = await hcCall('queryAggregated', { dataType: 'steps', startDate: start.toISOString(), endDate: new Date().toISOString(), bucket: 'day', aggregation: 'sum' });
    const days = {};
    for (const x of samples) { const d = new Date(x.startDate); const key = new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); days[key] = Math.round(x.value || 0); }
    const r = await api('steps/import', { room: current || 'general', days, src: nativeOS() === 'ios' ? 'apple-health' : 'health-connect', today: localDay() });
    phoneHealth.lastSync = Date.now(); store.set('ic-hc-at', String(phoneHealth.lastSync));
    if (!quiet) toast(`Synced from ${phoneHealthName()} · today ${fmtN(days[localDay()] || 0)} steps`);
    if (r.updated) { await loadMySteps(); if (infoMode === 'steps') { await loadBoard(); renderSteps(); } refreshMyStepsSheet?.(); renderStepsBanner(); }
  } catch (e) {
    if (/permission|authoriz|SecurityException/i.test(e.message || '')) { phoneHealth.granted = false; store.del('ic-hc-on'); }
    if (!quiet) toast(e.message || 'Sync failed');
  } finally { phoneHealth.syncing = false; }
}
function phoneHealthBox(onChange) {
  if (!nativeApp()) return null;
  const on = phoneHealth.granted;
  const box = el('div', 'health-box' + (on ? ' on' : ''));
  const mid = el('div', 'hb-mid'), acts = el('div', 'hb-acts');
  const btn = (label, cls, fn) => { const b = el('button', 'btn small ' + cls, label); b.type = 'button'; b.onclick = fn; acts.append(b); return b; };
  if (!on) {
    mid.append(el('b', null, `Sync steps from ${phoneHealthName()}`), el('small', null, nativeOS() === 'android' ? 'Reads your phone’s step count (and Google Fit, Samsung Health or your watch, if they share to Health Connect). Keeps syncing in the background.' : 'Reads your iPhone and Apple Watch steps. Updates when you open the app.'));
    btn('Connect', 'primary', () => connectPhoneHealth(onChange));
  } else {
    mid.append(el('b', null, `${phoneHealthName()} connected`), el('small', null, (phoneHealth.lastSync ? `Synced ${agoText(phoneHealth.lastSync)}` : 'Syncing…') + (nativeOS() === 'android' ? ' · also every 30 min in the background' : ' · updates when you open the app')));
    const sb = btn('Sync now', '', async () => { sb.disabled = true; await syncPhoneHealth(false); sb.disabled = false; onChange?.(); });
    btn('Turn off', 'ghost', () => disconnectPhoneHealth(onChange));
  }
  box.append(icoEl('footprints', 'hb-ic'), mid, acts);
  return box;
}
/* Native app notifications (Firebase Cloud Messaging) */
let nativePush = { listeners: false, granted: false };
const pushCall = (m, o = {}) => window.Capacitor.nativePromise('PushNotifications', m, o);
async function setupNativePush(ask = true) {
  if (!nativeApp() || !me.token) return false;
  try {
    if (!nativePush.listeners) {
      nativePush.listeners = true;
      window.Capacitor.addListener('PushNotifications', 'registration', t => { if (t?.value) api('push/native', { room: 'general', token: t.value, platform: nativeOS(), notify: nativePush.granted }).catch(() => {}); });
      window.Capacitor.addListener('PushNotifications', 'registrationError', e => console.warn('push registration failed', e));
      // Tapping a notification opens the right chat (also when the app was closed)
      window.Capacitor.addListener('PushNotifications', 'pushNotificationActionPerformed', a => {
        const d = a?.notification?.data || {};
        if (d.type === 'message' && d.room) runIntent({ room: d.room, act: 'open', key: d.key || null });
        else if (d.url && d.url.startsWith('/#/')) navTo(d.url);
      });
    }
    let perm = await pushCall('checkPermissions');
    if (perm.receive !== 'granted' && ask) perm = await pushCall('requestPermissions');
    nativePush.granted = perm.receive === 'granted';
    // without notification permission the phone still registers for wake-ups (fun mode, walkie-talkie) — no notifications
    if (!nativePush.granted) { await pushCall('register').catch(() => {}); return false; }
    await pushCall('createChannel', { id: 'messages', name: 'Messages', description: 'New messages, mentions and replies', importance: 4, visibility: 1, vibration: true, lights: true }).catch(() => {});
    await pushCall('register');
    return true;
  } catch (e) { console.warn('push setup failed', e); return false; }
}
/* Walkie-talkie with the app closed (Android): Firebase wakes the phone when someone starts talking and the app
   plays it live natively. Per-phone setting, asked once the first time you open the walkie-talkie. */
const closedWalkieOn = () => store.get('ic-wk-closed') !== '0';     // on unless turned off
async function configureNativeWalkie() {
  if (!isNativeApp() || !me.token) return;
  try {
    await window.Capacitor.nativePromise('Walkie', 'configure', { baseUrl: location.origin, token: me.token, device: me.device });
    const { room } = await window.Capacitor.nativePromise('Walkie', 'takePending');
    if (room) setTimeout(() => runIntent({ room, act: 'walkie' }), 600);
  } catch {}
}
async function setClosedWalkie(on, quiet) {
  if (on && !(await setupNativePush(true))) { toast('Allow notifications for Intra Chat first'); return false; }
  try { await api('push/native/walkie', { room: 'general', on }); } catch (e) { if (!quiet) toast(e.message); return false; }
  store.set('ic-wk-closed', on ? '1' : '0');
  if (!quiet) toast(on ? 'You’ll hear the walkie-talkie even with the app closed' : 'Walkie-talkie only plays while the app is open');
  return true;
}
async function askClosedWalkie() {
  if (!isNativeApp() || store.get('ic-wk-closed') !== null) return;
  const yes = await popup({ icon: 'radio', title: 'Hear it with the app closed?', text: 'When someone talks on the walkie-talkie in your chats, play it live even if Intra Chat is closed — like Zello. Muted chats stay quiet. You can change this in Settings.', ok: 'Yes, play live', cancel: 'No thanks' });
  if (yes) await setClosedWalkie(true); else store.set('ic-wk-closed', '0');
}

/* Background step sync (native StepSync plugin, Android): uploads Health Connect steps ~every 30 min, app closed or not */
const stepSyncCall = (m, o = {}) => window.Capacitor.nativePromise('StepSync', m, o);
async function configureStepSync() {
  if (!nativeApp() || nativeOS() !== 'android' || !phoneHealth.granted || !me.token) return;
  try { await stepSyncCall('configure', { baseUrl: location.origin, token: me.token, device: me.device }); } catch (e) { console.warn('step sync setup failed', e); }
}
async function askBackgroundSteps() {
  if (nativeOS() !== 'android') return;
  try {
    const st = await stepSyncCall('status');
    if (!st.backgroundSupported || st.backgroundGranted) return;
    const yes = await popup({ icon: 'footprints', title: 'Keep syncing in the background?', text: 'Let Intra Chat read your steps while the app is closed, so challenges stay up to date without opening it. Health Connect will ask you to confirm.', ok: 'Allow', cancel: 'Not now' });
    if (!yes) return;
    const r = await stepSyncCall('requestBackground');
    toast(r.granted ? 'Steps will sync in the background' : 'Steps will sync when you open the app');
  } catch {}
}

if (nativeApp()) {
  checkPhoneHealth();
  const tick = () => { if (!document.hidden) syncPhoneHealth(true); };
  setTimeout(tick, 4000);
  document.addEventListener('visibilitychange', tick);
  setInterval(tick, 15 * 60_000);
}

/* Google Health (Health Connect / Fitbit / Pixel Watch) automatic step sync */
let healthStatus = null, healthSyncing = false;
async function connectHealth() {
  try { const { url } = await api('health/start', { room: current || 'general', tz: new Date().getTimezoneOffset() }); location.href = url; }
  catch (e) { toast(e.message); }
}
async function syncHealthNow(quiet) {
  healthSyncing = true;
  try {
    const r = await api('health/sync', { room: current || 'general', tz: new Date().getTimezoneOffset() });
    if (!quiet) toast(`Synced from Google Health · today ${fmtN(r.today)} steps`);
    healthStatus = { ...healthStatus, lastSync: Date.now(), error: null, today: r.today };
    if (r.updated) { await loadMySteps(); if (infoMode === 'steps') { await loadBoard(); renderSteps(); } refreshMyStepsSheet?.(); renderStepsBanner(); }
  } catch (e) { if (!quiet) toast(e.message); healthStatus = { ...healthStatus, error: e.code || 'sync_failed' }; }
  finally { healthSyncing = false; }
}
async function disconnectHealth(onChange) {
  const yes = await popup({ icon: 'link', title: 'Disconnect Google Health?', text: 'Steps already synced stay. Automatic syncing stops until you connect again.', ok: 'Disconnect', danger: true });
  if (!yes) return;
  try { await api('health/disconnect', { room: current || 'general' }); healthStatus = { ...healthStatus, connected: false, error: null }; toast('Google Health disconnected'); onChange?.(); } catch (e) { toast(e.message); }
}
function healthBox(onChange) {
  const hs = healthStatus; if (!hs?.configured) return null;
  const box = el('div', 'health-box' + (hs.connected && !hs.error ? ' on' : ''));
  const ic = icoEl('sparkles', 'hb-ic'); const mid = el('div', 'hb-mid'); const acts = el('div', 'hb-acts');
  const btn = (label, cls, fn) => { const b = el('button', 'btn small ' + cls, label); b.type = 'button'; b.onclick = fn; acts.append(b); return b; };
  if (!hs.connected) {
    mid.append(el('b', null, 'Auto-sync from Google Health'), el('small', null, 'Phone steps (Health Connect), Fitbit and Pixel Watch — synced every 30 minutes, no need to open the app.'));
    btn('Connect', 'primary', connectHealth);
  } else if (hs.error === 'expired') {
    mid.append(el('b', null, 'Google Health sign-in expired'), el('small', null, 'Reconnect to keep your steps syncing automatically.'));
    btn('Reconnect', 'primary', connectHealth);
  } else if (hs.error === 'not_linked') {
    mid.append(el('b', null, 'Almost there'), el('small', null, 'Install the Google Health app, sign in with the same Google account, then tap Sync now.'));
    btn('Sync now', 'primary', () => syncHealthNow().then(onChange));
    btn('Disconnect', 'ghost', () => disconnectHealth(onChange));
  } else {
    mid.append(el('b', null, 'Google Health connected'), el('small', null, hs.lastSync ? `Synced ${agoText(hs.lastSync)} · updates every 30 min` : 'Syncing…'));
    const sb = btn('Sync now', '', async () => { sb.disabled = true; await syncHealthNow(); sb.disabled = false; onChange?.(); });
    btn('Disconnect', 'ghost', () => disconnectHealth(onChange));
  }
  box.append(ic, mid, acts);
  return box;
}
async function loadBoard() { if (!current) return null; try { stepsBoard = await api('steps/board', { range: stepsRange, today: localDay() }); } catch (e) { stepsBoard = { error: e.message }; } return stepsBoard; }

function ringSvg(pct, size = 148) {
  const r = size / 2 - 10, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, pct));
  return `<svg class="ring-svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-bg"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fg${p >= 1 ? ' done' : ''}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`;
}
function personalCard(d, onChange) {
  const card = el('div', 'card steps-me');
  const top = el('div', 'sm-top');
  const ring = el('div', 'sm-ring'); ring.innerHTML = ringSvg(d.steps / d.goal);
  const mid = el('div', 'sm-mid'); mid.append(el('b', null, fmtN(d.steps)), el('small', null, `of ${fmtN(d.goal)} steps`));
  ring.append(mid);
  const stats = el('div', 'sm-stats');
  const stat = (ic, v, l) => { const s = el('div', 'sm-stat'); s.append(icoEl(ic), el('b', null, v), el('small', null, l)); stats.append(s); };
  stat('flame', d.streak, d.streak === 1 ? 'day streak' : 'day streak');
  stat('pin', kmOf(d.steps).toFixed(1), 'km today');
  stat('sun', fmtN(d.steps * 0.04), 'kcal');
  top.append(ring, stats);
  card.append(top);
  if (d.steps >= d.goal) card.append(el('p', 'sm-cheer', 'Goal reached today — great job!'));
  else card.append(el('p', 'sm-cheer muted', `${fmtN(d.goal - d.steps)} steps to go · about ${Math.ceil((d.goal - d.steps) / 110)} min of walking`));
  // week chart: value on every bar, tap a bar for that day's details
  const kfmt = n => n >= 10000 ? Math.round(n / 1000) + 'k' : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(n));
  const dayName = (ds, long) => new Date(ds + 'T12:00').toLocaleDateString([], long ? { weekday: 'long', day: 'numeric', month: 'short' } : { weekday: 'short' });
  const total = d.week.reduce((a, x) => a + x.steps, 0), hits = d.week.filter(x => x.steps >= d.goal).length;
  const sum = el('div', 'sm-sum');
  sum.append(el('span', null, `This week: ${fmtN(total)} steps`), el('span', null, `avg ${fmtN(total / 7)}/day · goal hit ${hits} of 7`));
  card.append(sum);
  const detail = el('div', 'sm-detail'); card.append(detail);
  const wk = el('div', 'sm-week'); const max = Math.max(d.goal, ...d.week.map(x => x.steps)) * 1.16;
  const bars = el('div', 'sm-bars');
  const goalLine = el('div', 'sm-goal-line'); goalLine.style.bottom = `calc((100% - 18px) * ${(d.goal / max).toFixed(4)})`;   // bars sit below an 18px label row
  goalLine.append(el('span', null, `goal ${kfmt(d.goal)}`));
  bars.append(goalLine);
  const cols = [];
  const show = (x, col) => {
    cols.forEach(c => c.classList.toggle('sel', c === col));
    const pct = Math.round(x.steps / d.goal * 100);
    detail.replaceChildren(el('b', null, x.date === d.today ? 'Today' : dayName(x.date, true)),
      el('span', null, `${fmtN(x.steps)} steps · ${kmOf(x.steps).toFixed(1)} km · ${pct}% of goal${x.steps >= d.goal ? ' ✓' : ''}`));
  };
  for (const x of d.week) {
    const col = el('button', 'sm-day' + (x.steps >= d.goal ? ' hit' : '') + (x.date === d.today ? ' today' : '')); col.type = 'button';
    col.setAttribute('aria-label', `${dayName(x.date, true)}: ${fmtN(x.steps)} steps`);
    const val = el('em', null, x.steps ? kfmt(x.steps) : '–');
    const bar = el('i'); bar.style.height = Math.max(3, x.steps / max * 100) + '%';
    const stack = el('div', 'sm-stack'); stack.append(val, bar);
    col.append(stack);
    col.onclick = () => show(x, col);
    cols.push(col); bars.append(col);
  }
  const labels = el('div', 'sm-labels');
  for (const x of d.week) labels.append(el('small', x.date === d.today ? 'today' : '', x.date === d.today ? 'Today' : dayName(x.date)));
  wk.append(bars, labels);
  card.append(wk);
  const todayIdx = d.week.findIndex(x => x.date === d.today);
  show(d.week[todayIdx >= 0 ? todayIdx : 6], cols[todayIdx >= 0 ? todayIdx : 6]);
  const btns = el('div', 'btn-row sm-btns');
  const walkB = el('button', 'btn primary with-ic'); walkB.type = 'button'; walkB.append(icoEl('footprints'), 'Start walk'); walkB.onclick = () => startWalk(onChange);
  const addB = el('button', 'btn with-ic'); addB.type = 'button'; addB.append(icoEl('plus'), 'Add steps'); addB.onclick = () => addStepsManually(d, onChange);
  const goalB = el('button', 'btn ghost with-ic'); goalB.type = 'button'; goalB.append(icoEl('flag'), 'Goal'); goalB.onclick = () => editStepGoal(d, onChange);
  btns.append(walkB, addB, goalB); card.append(btns);
  const pb = phoneHealthBox(onChange); if (pb) card.append(pb);
  const hb = !nativeApp() || !phoneHealth.granted ? healthBox(onChange) : null; if (hb) card.append(hb);
  // badges
  const bw = el('div', 'sm-badges'); bw.append(el('h3', null, `Badges · ${d.badges.filter(b => b.got).length} of ${d.badges.length}`));
  const grid = el('div', 'badge-grid');
  const bIcon = { first: 'footprints', goal: 'flag', '10k': 'trophy', '20k': 'trophy', streak3: 'flame', streak7: 'flame', km42: 'pin', km100: 'globe' };
  for (const b of d.badges) { const x = el('div', 'sbadge' + (b.got ? ' got' : '')); x.title = b.desc; x.append(icoEl(bIcon[b.id] || 'trophy', 'b-ic'), el('b', null, b.name), el('small', null, b.desc)); grid.append(x); }
  bw.append(grid); card.append(bw);
  return card;
}
async function addStepsManually(d, onChange) {
  const v = await popup({ icon: 'footprints', title: 'Today’s steps', text: 'Type today’s total from your phone’s Health or Google Fit app (or your watch).', ok: 'Save',
    input: { type: 'number', value: d?.steps || '', placeholder: 'e.g. 6500', required: true, requiredMsg: 'Enter a number' },
    onConfirm: async x => { const n = Number(x); if (!(n >= 0 && n <= 100000)) return 'Enter a number between 0 and 100,000'; try { const r = await api('steps/log', { room: current || 'general', steps: n, today: localDay() }); if (r.celebrated) setTimeout(() => celebrate(), 300); return null; } catch (e) { return e.message; } } });
  if (v !== null) { toast('Steps saved'); onChange?.(); }
}
async function editStepGoal(d, onChange) {
  const v = await popup({ icon: 'flag', title: 'Daily step goal', ok: '', cancel: 'Cancel',
    choices: [5000, 6000, 8000, 10000, 12000, 15000].map(g => ({ value: g, label: `${fmtN(g)} steps`, icon: g === d.goal ? 'check' : null, cls: g === d.goal ? 'primary' : '' })) });
  if (typeof v !== 'number') return;
  try { await api('steps/goal', { room: current || 'general', goal: v }); toast(`Goal set to ${fmtN(v)} steps`); onChange?.(); } catch (e) { toast(e.message); }
}
function celebrate() {
  const c = el('div', 'confetti'); document.body.append(c);
  const colors = ['#00a884', '#25d366', '#ffd23f', '#ff5c8a', '#7c3aed', '#0ea5e9'];
  for (let i = 0; i < 70; i++) { const p = el('i'); p.style.left = Math.random() * 100 + '%'; p.style.background = colors[i % colors.length]; p.style.animationDelay = Math.random() * .6 + 's'; p.style.transform = `rotate(${Math.random() * 360}deg)`; c.append(p); }
  setTimeout(() => c.remove(), 3200);
  toast('Daily goal reached!');
}

let refreshMyStepsSheet = null;
async function openMyStepsSheet() {
  await loadMySteps(); if (!myStepsData) return toast('Couldn’t load your steps');
  const { d, inner } = sheet('myStepsSheet', 'My steps');
  const draw = async () => { await loadMySteps(); inner.querySelector('.steps-me')?.replaceWith(personalCard(myStepsData, draw)); };
  refreshMyStepsSheet = () => { if (d.open) inner.querySelector('.steps-me')?.replaceWith(personalCard(myStepsData, draw)); };
  inner.append(personalCard(myStepsData, draw));
  inner.append(el('p', 'muted small', 'Tip: open any group’s menu → Step challenge to compete with friends.'));
  d.showModal();
}
/* --- the group panel (in the info column) --- */
async function openSteps() {
  if (!current) return;
  infoMode = 'steps'; showInfoPane();
  $('infoTitle').textContent = group?.dm ? 'Step duel' : 'Step challenge';
  const body = $('infoBody'); body.innerHTML = ''; body.append(el('p', 'muted small empty-note', 'Loading…'));
  await Promise.all([loadMySteps(), loadBoard()]);
  renderSteps();
}
function renderSteps() {
  if (infoMode !== 'steps') return;
  const body = $('infoBody'), scroll = body.scrollTop; body.innerHTML = '';
  const refresh = async () => { await Promise.all([loadMySteps(), loadBoard()]); renderSteps(); renderStepsBanner(); };
  const chGoal = stepsBoard?.challenge && !stepsBoard.challenge.ended ? stepsBoard.challenge.goal : null;
  if (myStepsData) body.append(personalCard(chGoal ? { ...myStepsData, goal: chGoal, streak: stepsBoard.rows?.find(r => r.uid === me.uid)?.streak ?? myStepsData.streak } : myStepsData, refresh));
  if (stepsBoard && !stepsBoard.error) {
    const ch = stepsBoard.challenge, duel = stepsBoard.dm, peerFirst = (group?.peer?.name || 'them').split(' ')[0];
    if (duel) body.prepend(duelCard(stepsBoard, peerFirst));
    // challenge header + team journey
    const cc = el('div', 'card steps-ch');
    if (ch && !ch.ended) {
      const h = el('div', 'ch-head'); h.append(icoEl('trophy', 'ch-ic'));
      const t = el('div'); t.append(el('b', null, ch.title), el('small', 'muted', `Day ${ch.dayNo} of ${ch.days} · ${fmtN(ch.goal)} steps a day · started by ${ch.by}`)); h.append(t); cc.append(h);
      if (ch.teamKm) {
        const j = el('div', 'journey');
        j.append(el('div', 'j-label', `Team journey · ${ch.km} of ${ch.teamKm} km`));
        const track = el('div', 'j-track'); const fill = el('i', 'j-fill'); fill.style.width = ch.pct * 100 + '%'; track.append(fill);
        for (const st of ch.stops) { const m = el('span', 'j-stop' + (st.reached ? ' on' : '')); m.style.left = st.p * 100 + '%'; m.title = st.name; track.append(m); }
        const walker = el('span', 'j-walker'); walker.innerHTML = svgFor('footprints'); walker.style.left = ch.pct * 100 + '%'; track.append(walker);
        j.append(track);
        const next = ch.stops.find(x => !x.reached);
        j.append(el('small', 'muted', next ? `Next stop: ${next.name} at ${Math.round(next.p * ch.teamKm)} km` : 'You made it to the finish line together!'));
        cc.append(j);
      }
    } else {
      cc.append(el('b', null, ch?.ended ? `“${ch.title}” has finished` : duel ? 'No duel running' : 'No challenge running'),
        el('p', 'muted small', duel ? `Challenge ${peerFirst} to a step duel: pick a daily goal and a length, and see who walks more.` : stepsBoard.canManage ? 'Start a challenge to get everyone walking: a daily goal, a leaderboard, streaks and a team journey.' : 'Ask a group admin to start a step challenge. The leaderboard below already works with everyone’s own goals.'));
    }
    if (stepsBoard.canManage) {
      const b = el('button', 'btn small ' + (ch && !ch.ended ? 'ghost' : 'primary'), ch && !ch.ended ? (duel ? 'End duel' : 'End challenge') : (duel ? `Challenge ${peerFirst}` : 'Start a challenge')); b.type = 'button';
      b.onclick = () => ch && !ch.ended ? endChallenge() : startChallenge();
      cc.append(b);
    }
    body.append(cc);
    // leaderboard
    const lb = el('div', 'card steps-lb');
    const seg = el('div', 'seg small');
    for (const [v, t] of [['today', 'Today'], ['week', 'This week'], ...(ch ? [['challenge', 'Challenge']] : [])]) {
      const b = el('button', stepsRange === v ? 'on' : '', t); b.type = 'button'; b.onclick = async () => { stepsRange = v; await loadBoard(); renderSteps(); }; seg.append(b);
    }
    lb.append(seg);
    const rows = stepsBoard.rows || [];
    if (!rows.some(r => r.steps)) lb.append(el('p', 'muted small empty-note', 'Nobody has logged steps yet. Be the first!'));
    const top = Math.max(1, ...rows.map(r => r.steps));
    for (const r of rows) {
      const row = el('div', 'lb-row' + (r.uid === me.uid ? ' me' : ''));
      const rank = el('span', 'lb-rank' + (r.rank && r.rank <= 3 ? ' r' + r.rank : ''), r.rank ? String(r.rank) : '–');
      const a = el('div', 'avatar'); paintAvatar(a, r.name, { photo: r.photo });
      const mid = el('div', 'lb-mid');
      const nm = el('div', 'lb-name'); nm.append(el('b', null, r.uid === me.uid ? 'You' : r.name));
      if (r.rank === 1 && r.steps) nm.append(icoEl('crown', 'lb-crown'));
      if (r.streak > 1) { const f = el('span', 'lb-streak'); f.append(icoEl('flame'), String(r.streak)); f.title = `${r.streak}-day streak`; nm.append(f); }
      if (r.hit) { const h = el('span', 'lb-hit'); h.append(icoEl('check')); h.title = 'Goal reached today'; nm.append(h); }
      const bar = el('div', 'lb-bar'); const fill = el('i'); fill.style.width = (r.steps / top * 100) + '%'; bar.append(fill);
      mid.append(nm, bar);
      const right = el('div', 'lb-right'); right.append(el('b', null, fmtN(r.steps)), el('small', null, stepsRange === 'today' ? `${Math.min(100, Math.round(r.today / r.goal * 100))}% of goal` : `${kmOf(r.steps).toFixed(1)} km`));
      row.append(rank, a, mid, right);
      if (r.uid !== me.uid) {
        const cheer = el('button', 'icon-btn lb-cheer' + (r.cheered ? ' done' : '')); cheer.type = 'button'; cheer.innerHTML = svgFor('sparkles');
        cheer.title = r.cheered ? 'You cheered today' : `Cheer ${r.name.split(' ')[0]} on`; cheer.setAttribute('aria-label', cheer.title);
        cheer.onclick = async () => { if (r.cheered) return toast('You already cheered them today'); try { await api('steps/cheer', { uid: r.uid, today: localDay() }); r.cheered = true; cheer.classList.add('done', 'pop'); toast(`Cheered ${r.name.split(' ')[0]} on`); } catch (e) { toast(e.message); } };
        row.append(cheer);
      } else row.append(el('span', 'lb-cheer-sp'));
      lb.append(row);
    }
    body.append(lb);
  }
  body.scrollTop = scroll;
}
// Head-to-head card for a 1:1 step duel
function duelCard(b, peerFirst) {
  const mine = b.rows.find(r => r.uid === me.uid) || { steps: 0, today: 0, streak: 0 }, them = b.rows.find(r => r.uid !== me.uid) || { name: peerFirst, steps: 0, today: 0, streak: 0 };
  const card = el('div', 'card duel');
  const side = (r, label) => {
    const s = el('div', 'duel-side'); const a = el('div', 'avatar'); paintAvatar(a, r.name || label, { photo: r.photo });
    s.append(a, el('b', 'duel-n', fmtN(r.steps)), el('small', null, label));
    if (r.streak > 1) { const f = el('span', 'lb-streak'); f.append(icoEl('flame'), `${r.streak}`); s.append(f); }
    return s;
  };
  const vs = el('div', 'duel-vs', 'VS');
  card.append(el('div', 'duel-range muted small', b.range === 'today' ? 'Today' : b.range === 'week' ? 'This week' : 'Whole duel'));
  const row = el('div', 'duel-row'); row.append(side(mine, 'You'), vs, side(them, peerFirst)); card.append(row);
  const total = mine.steps + them.steps;
  const bar = el('div', 'duel-bar'); const l = el('i', 'me'); l.style.width = (total ? mine.steps / total * 100 : 50) + '%'; bar.append(l); card.append(bar);
  const diff = mine.steps - them.steps;
  card.append(el('p', 'duel-msg', !total ? 'Nobody has walked yet — first steps win bragging rights.' : diff > 0 ? `You’re ahead by ${fmtN(diff)} steps — keep it up!` : diff < 0 ? `${peerFirst} is ahead by ${fmtN(-diff)} steps — time for a walk?` : 'Neck and neck!'));
  return card;
}
async function startChallenge() {
  const duel = !!group?.dm, peerFirst = (group?.peer?.name || 'your friend').split(' ')[0];
  const title = await popup({ icon: 'trophy', title: duel ? `Step duel with ${peerFirst}` : 'New step challenge', text: 'Give it a fun name.', ok: 'Next', input: { value: duel ? 'Step duel' : 'Step it up', maxLength: 40, required: true } });
  if (title === null) return;
  const goal = await popup({ icon: 'flag', title: 'Daily goal for everyone', ok: '', cancel: 'Cancel', choices: [5000, 7500, 10000, 12500].map(g => ({ value: g, label: `${fmtN(g)} steps a day` })) });
  if (typeof goal !== 'number') return;
  const days = await popup({ icon: 'calendar', title: 'How long?', ok: '', cancel: 'Cancel', choices: [[3, '3 days'], [7, '1 week'], [14, '2 weeks'], [30, '30 days']].map(([v, l]) => ({ value: v, label: l })) });
  if (typeof days !== 'number') return;
  const n = duel ? 2 : Math.max(1, (membersCache.room === current ? membersCache.list?.length : 0) || 3);
  const suggest = Math.max(10, Math.round(n * goal * days * 0.75 / 1000 * 0.7 / 10) * 10);
  const teamKm = await popup({ icon: 'pin', title: 'Team journey', text: duel ? `Compete, but also walk a distance together with ${peerFirst} — both your steps add up.` : 'Walk a distance together — everyone’s steps add up.', ok: '', cancel: 'Cancel',
    choices: [{ value: suggest, label: `${suggest} km (suggested for ${n} people)` }, { value: Math.round(suggest * 1.5), label: `${Math.round(suggest * 1.5)} km (harder)` }, { value: 0, label: 'No team journey' }] });
  if (typeof teamKm !== 'number') return;
  try { await api('steps/challenge', { title, goal, days, teamKm, today: localDay() }); toast(duel ? `Duel on — ${peerFirst} has been challenged!` : 'Challenge started — let’s go!'); stepsRange = 'challenge'; repoll(); await loadBoard(); renderSteps(); }
  catch (e) { toast(e.message); }
}
async function endChallenge() {
  const yes = await popup({ icon: 'flag', title: group?.dm ? 'End the duel?' : 'End the challenge?', text: 'The leaderboard stays; the challenge and team journey stop for everyone.', ok: 'End challenge', danger: true });
  if (!yes) return;
  try { await api('steps/challenge', { end: true }); stepsRange = 'today'; toast('Challenge ended'); repoll(); await loadBoard(); renderSteps(); } catch (e) { toast(e.message); }
}

/* --- banner in the chat while a challenge runs --- */
let stepsBannerEl = null, bannerStepsAt = 0;
async function renderStepsBanner() {
  const ch = group?.steps, today = localDay(), on = !!ch && today >= ch.start && today <= ch.end;
  if (!stepsBannerEl) { stepsBannerEl = el('button', 'steps-banner hidden'); stepsBannerEl.type = 'button'; stepsBannerEl.onclick = openSteps; ($('pinBar') || $('walkieBanner')).after(stepsBannerEl); }
  stepsBannerEl.classList.toggle('hidden', !on);
  if (!on) return;
  if (!myStepsData || Date.now() - bannerStepsAt > 60000) { bannerStepsAt = Date.now(); await loadMySteps(); }
  const mine = myStepsData?.steps || 0, pct = Math.min(1, mine / ch.goal);
  stepsBannerEl.innerHTML = '';
  const dayNo = Math.min(ch.days, Math.round((new Date(today) - new Date(ch.start)) / 864e5) + 1);
  const t = el('div', 'sb-text'); t.append(el('b', null, ch.title), el('small', null, `Day ${dayNo} of ${ch.days} · you ${fmtN(mine)} / ${fmtN(ch.goal)}`));
  const bar = el('div', 'sb-bar'); const f = el('i'); f.style.width = pct * 100 + '%'; bar.append(f); t.append(bar);
  stepsBannerEl.append(icoEl('footprints', 'sb-ic'), t, el('span', 'sb-go', 'Open'));
}

/* --- Walk mode: count steps with the motion sensor while the app is open --- */
const walk = { on: false, steps: 0, saved: 0, base: 9.8, above: false, lastPeak: 0, start: 0, wake: null, timer: null, layer: null, gotMotion: false, onDone: null };
function walkOverlay() {
  let o = $('walkOverlay'); if (o) return o;
  o = el('div', 'walk-overlay hidden'); o.id = 'walkOverlay';
  o.innerHTML = `<div class="wo-card"><div class="wo-ring"></div><div class="wo-sub"></div><div class="wo-note muted small"></div>
    <div class="wo-btns"><button type="button" class="btn wo-pause"></button><button type="button" class="btn primary wo-stop"></button></div></div>`;
  document.body.append(o);
  o.querySelector('.wo-stop').onclick = () => closeLayer(walk.layer, () => stopWalk(true));
  o.querySelector('.wo-pause').onclick = () => { walk.paused = !walk.paused; renderWalkOverlay(); };
  return o;
}
function renderWalkOverlay() {
  const o = walkOverlay(), goal = myStepsData?.goal || 8000, todaySteps = (myStepsData?.steps || 0) + walk.steps - walk.saved + walk.saved;
  o.querySelector('.wo-ring').innerHTML = ringSvg(((myStepsData?.steps || 0) + (walk.steps - walk.saved)) / goal, 220) + `<div class="wo-mid"><b>${fmtN(walk.steps)}</b><small>steps this walk</small></div>`;
  const mins = Math.floor((Date.now() - walk.start) / 60000);
  o.querySelector('.wo-sub').textContent = `${kmOf(walk.steps).toFixed(2)} km · ${mins} min · today ${fmtN((myStepsData?.steps || 0) + walk.steps - walk.saved)} / ${fmtN(goal)}`;
  o.querySelector('.wo-note').textContent = walk.paused ? 'Paused' : walk.gotMotion ? 'Keep the phone in your hand or pocket. The screen stays on while you walk.' : 'Waiting for the motion sensor…';
  o.querySelector('.wo-pause').replaceChildren(icoEl(walk.paused ? 'play' : 'pause'), walk.paused ? 'Resume' : 'Pause');
  o.querySelector('.wo-stop').replaceChildren(icoEl('stop'), 'Stop & save');
  o.querySelector('.wo-pause').classList.add('with-ic'); o.querySelector('.wo-stop').classList.add('with-ic');
  void todaySteps;
}
function onMotion(e) {
  const a = e.accelerationIncludingGravity; if (!a || a.x == null) return;
  walk.gotMotion = true;
  if (walk.paused) return;
  const mag = Math.hypot(a.x, a.y, a.z), now = performance.now();
  walk.base = walk.base * 0.92 + mag * 0.08;                  // slow-moving average (gravity + posture)
  const d = mag - walk.base;
  if (!walk.above && d > 1.3 && now - walk.lastPeak > 300) { walk.above = true; walk.lastPeak = now; walk.steps++; if (walk.steps % 5 === 0) renderWalkOverlay(); }
  else if (walk.above && d < 0.2) walk.above = false;
}
async function saveWalk() {
  const n = walk.steps - walk.saved; if (n <= 0) return;
  walk.saved = walk.steps;
  try { const r = await api('steps/log', { room: current || 'general', steps: n, mode: 'add', today: localDay() }); if (myStepsData) myStepsData.steps = r.steps; if (r.celebrated) celebrate(); }
  catch { walk.saved -= n; }
}
async function startWalk(onDone) {
  if (!('DeviceMotionEvent' in window)) return noSensor(onDone);
  // iPhone asks for motion access; elsewhere sensors just work (the 4-second check below catches devices without one)
  if (typeof DeviceMotionEvent.requestPermission === 'function') {
    let res = 'denied'; try { res = await DeviceMotionEvent.requestPermission(); } catch {}
    if (res !== 'granted' && isIOS) return toast('Allow “Motion & Orientation” access to count steps');
  }
  Object.assign(walk, { on: true, steps: 0, saved: 0, above: false, lastPeak: 0, start: Date.now(), gotMotion: false, paused: false, onDone });
  if (!myStepsData) await loadMySteps();
  window.addEventListener('devicemotion', onMotion);
  try { navigator.wakeLock?.request('screen').then(w => { if (walk.on) walk.wake = w; else w.release(); }).catch(() => {}); } catch {}   // keep the screen on (don't wait for it)
  walkOverlay().classList.remove('hidden'); walk.layer = pushLayer(() => stopWalk(true));
  renderWalkOverlay();
  walk.timer = setInterval(() => { renderWalkOverlay(); if (walk.steps - walk.saved >= 50) saveWalk(); }, 1000);
  setTimeout(() => { if (walk.on && !walk.gotMotion) { stopWalk(false); dropLayer(walk.layer); noSensor(onDone); } }, 4000);
}
async function stopWalk(save) {
  if (!walk.on) return;
  walk.on = false; clearInterval(walk.timer); window.removeEventListener('devicemotion', onMotion);
  try { await walk.wake?.release(); } catch {} walk.wake = null;
  $('walkOverlay')?.classList.add('hidden');
  if (save) { await saveWalk(); toast(walk.steps ? `${fmtN(walk.steps)} steps saved` : 'No steps counted this time'); }
  walk.onDone?.();
}
async function noSensor(onDone) {
  const yes = await popup({ icon: 'footprints', title: 'No motion sensor here', text: 'Walk mode needs a phone. On this device, add today’s steps from your phone’s Health or Google Fit app instead.', ok: 'Add steps', cancel: 'Close' });
  if (yes) addStepsManually(myStepsData, onDone);
}
document.addEventListener('visibilitychange', () => { if (walk.on && document.hidden) saveWalk(); });

/* ---------------- Mini-games ---------------- */
// One game per chat. The server sends each player only what they may see; this renders it and sends moves.
let game = null, gameSig = '', gameClockOff = 0, gameTick = null, gameBanner = null, gameDraft = {};
const GAME_ICON = { imposter: 'eye', mafia: 'ban', episode: 'play', emoji: 'smile', wyr: 'users', ttt: 'checks', rps: 'sparkles' };
const pname = uid => uid === me.uid ? 'You' : (game?.players.find(p => p.uid === uid)?.name || 'Someone');
function setGame(g) {
  const sig = JSON.stringify(g && { ...g, now: 0 });
  if (g) gameClockOff = g.now - Date.now();
  if (sig === gameSig) return;
  gameSig = sig; game = g;
  try { gameSfx(g); } catch {}
  renderGameBanner();
  if ($('gameSheet')?.open) renderGame();
}
function renderGameBanner() {
  if (!gameBanner) { gameBanner = el('button', 'game-banner hidden'); gameBanner.type = 'button'; gameBanner.onclick = openGame; ($('pinBar') || $('walkieBanner')).after(gameBanner); }
  const live = game && game.phase !== 'over';
  gameBanner.classList.toggle('hidden', !live);
  if (!live) return;
  gameBanner.replaceChildren(icoEl(GAME_ICON[game.kind] || 'sparkles', 'gb-ic'),
    Object.assign(el('div', 'gb-text'), {}), el('span', 'gb-go', game.phase === 'lobby' && !game.joined ? 'Join' : 'Open'));
  const t = gameBanner.querySelector('.gb-text');
  t.append(el('b', null, game.name), el('small', null, game.phase === 'lobby' ? `${game.players.length} joined · ${game.hostName} is hosting` : `Round ${game.round}${game.rounds ? ' of ' + game.rounds : ''} · ${game.joined ? 'tap to play' : 'tap to watch'}`));
}
// The player's country, as a hint for servers that can't see it (Netlify tells the server directly)
const regionHint = (() => {
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } })();
  const byTz = { 'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', 'Asia/Karachi': 'PK', 'Asia/Dhaka': 'BD', 'Asia/Dubai': 'AE', 'Asia/Singapore': 'SG', 'Europe/London': 'GB', 'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US', 'America/Los_Angeles': 'US', 'America/Toronto': 'CA', 'Australia/Sydney': 'AU' };
  return byTz[tz] || (navigator.language || '').split('-')[1]?.toUpperCase() || '';
})();
const reportedClips = new Set();
window.addEventListener('message', e => {
  if (!/^https:\/\/www\.youtube(-nocookie)?\.com$/.test(e.origin)) return;
  let d; try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
  if (d?.event !== 'onError') return;
  const f = document.querySelector('iframe.g-yt'), clip = f?.dataset.clip;
  if (!clip || reportedClips.has(clip)) return;
  reportedClips.add(clip);
  toast('This clip won’t play here — finding another…');
  gameApi('move', { clipFailed: true, clipId: clip }).catch(() => {});
});
async function gameApi(action, body = {}) {
  try { const r = await api('game/' + action, { region: regionHint, ...body }); if (r.game !== undefined) setGame(r.game); return r; }
  catch (e) { toast(e.message); throw e; }
}
// Narrator: the app reads the game's lines aloud (Android app: native text-to-speech; browsers: Web Speech)
let lastSaid = '';
function narrate(text) {
  if (!text || text === lastSaid) return;
  lastSaid = text;
  try {
    if (window.Capacitor?.isNativePlatform?.()) { window.Capacitor.nativePromise('TextToSpeech', 'speak', { text, lang: 'en-IN', rate: 0.95, pitch: 1, volume: 1, category: 'playback' }).catch(() => {}); return; }
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'en-IN'; u.rate = 0.95; speechSynthesis.speak(u);
  } catch {}
}
// Say a player's name instead of tapping it (Android app: native speech recognition; Chrome: Web Speech)
async function listenForName(names) {
  let heard = [];
  if (window.Capacitor?.isNativePlatform?.()) {
    const sr = (m, o = {}) => window.Capacitor.nativePromise('SpeechRecognition', m, o);
    const perm = await sr('requestPermissions').catch(() => ({}));
    if (perm.speechRecognition && perm.speechRecognition !== 'granted') throw new Error('Allow the microphone for voice picks');
    heard = (await sr('start', { language: 'en-IN', maxResults: 5, prompt: 'Say a player’s name', partialResults: false, popup: true })).matches || [];
  } else {
    const R = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!R) throw new Error('Voice picking isn’t supported in this browser — tap a name');
    heard = await new Promise((res, rej) => { const r = new R(); r.lang = 'en-IN'; r.maxAlternatives = 5; r.onresult = e => res([...e.results[0]].map(a => a.transcript)); r.onerror = e => rej(new Error(e.error === 'not-allowed' ? 'Allow the microphone for voice picks' : 'Didn’t catch that — try again')); r.onend = () => res([]); r.start(); });
  }
  const n = x => String(x).toLowerCase().replace(/[^a-z0-9 ]/g, '');
  for (const h of heard) { const w = n(h); const hit = names.find(p => w.includes(n(p.name).split(' ')[0]) || n(p.name).includes(w)); if (hit) return hit; }
  throw new Error(heard.length ? `Heard “${heard[0]}” — no player with that name` : 'Didn’t catch that — try again');
}
// Hold-to-talk inside a game: uses the chat's walkie-talkie so everyone hears you live
function gameTalkButton(label = 'Hold to talk') {
  const b = el('button', 'btn g-ptt'); b.type = 'button'; b.append(icoEl('mic'), el('span', null, label));
  const down = e => { e.preventDefault(); if (!walkie.on) openWalkie(); b.classList.add('on'); b.setPointerCapture?.(e.pointerId); startTalking(); };
  const up = () => { if (!b.classList.contains('on')) return; b.classList.remove('on'); stopTalking(false); };
  b.addEventListener('pointerdown', down); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
  b.addEventListener('contextmenu', e => e.preventDefault());
  return b;
}
async function openGamePicker() {
  let list; try { list = (await api('game/list')).games; } catch (e) { return toast(e.message); }
  const { d, inner } = sheet('gamePicker', group?.dm ? 'Play together' : 'Group games');
  inner.append(el('p', 'muted small', 'Pick a game. Everyone in the chat gets a note to join.'));
  const grid = el('div', 'game-grid');
  for (const x of list) {
    const b = el('button', 'game-card'); b.type = 'button';
    b.append(icoEl(GAME_ICON[x.kind] || 'sparkles', 'gc-ic'), el('b', null, x.name), el('small', null, x.desc), el('em', null, x.min === x.max ? `${x.min} players` : `${x.min}+ players`));
    b.onclick = async () => {
      return gameSetup(x, d, inner);
    };
    grid.append(b);
  }
  inner.append(grid);
  d.showModal();
}
// Before starting: the starter picks rounds (or wins needed) and the time for each turn
function gameSetup(x, d, inner) {
  const st = x.set || {}, val = { rounds: st.defRounds, wins: st.defWins, secs: st.defSecs }, sounds = { wrong: 'fahh', right: 'crore' };
  [...inner.children].slice(1).forEach(n => n.remove());
  inner.querySelector('.sheet-head h2').textContent = x.name;
  const back = el('button', 'link-btn gs-back', 'All games'); back.type = 'button'; back.prepend(icoEl('arrowLeft')); back.onclick = () => openGamePicker();
  inner.append(back, el('p', 'muted small', x.desc));
  let series = null, epCount = null;
  if (x.kind === 'episode') {
    const f = el('label', 'field'); series = el('input'); series.maxLength = 60; series.value = 'Taarak Mehta Ka Ooltah Chashmah';
    f.append(el('span', null, 'Which show?'), series); inner.append(f);
    const f2 = el('label', 'field'); epCount = el('input'); epCount.type = 'number'; epCount.min = 1; epCount.max = 20000; epCount.inputMode = 'numeric'; epCount.value = 4000;
    f2.append(el('span', null, 'Episodes in this show'), epCount, el('small', 'muted', 'Random only picks from 1 to this number, and players can’t pick higher.')); inner.append(f2);
    let touched = false; epCount.oninput = () => { touched = true; };
    series.oninput = () => { if (!touched) epCount.value = /taarak|tarak|tmkoc/i.test(series.value) ? 4000 : ''; if (!touched) epCount.placeholder = 'e.g. 120'; };
  }
  const stepper = (label, key, [lo, hi], unit) => {
    const row = el('div', 'gs-row'), num = el('b', 'gs-num'), minus = el('button', 'gs-step', '−'), plus = el('button', 'gs-step', '+');
    minus.type = plus.type = 'button'; minus.setAttribute('aria-label', 'Fewer'); plus.setAttribute('aria-label', 'More');
    const paint = () => { num.textContent = `${val[key]} ${unit(val[key])}`; minus.disabled = val[key] <= lo; plus.disabled = val[key] >= hi; };
    minus.onclick = () => { val[key] = Math.max(lo, val[key] - 1); paint(); }; plus.onclick = () => { val[key] = Math.min(hi, val[key] + 1); paint(); };
    const ctl = el('div', 'gs-ctl'); ctl.append(minus, num, plus); row.append(el('span', null, label), ctl); paint(); return row;
  };
  if (st.rounds) inner.append(stepper('Rounds', 'rounds', st.rounds, n => n === 1 ? 'round' : 'rounds'));
  if (st.wins) inner.append(stepper('First to win', 'wins', st.wins, n => n === 1 ? 'throw' : 'throws'));
  if (st.secs) {
    const fmt = n => n >= 60 && n % 60 === 0 ? `${n / 60} min` : n > 60 ? `${Math.floor(n / 60)}m ${n % 60}s` : `${n} s`;
    const opts = [...new Set([10, 15, 20, 25, 30, 40, 45, 60, 75, 90, 120, 150, 180, 240, 300, st.defSecs])].filter(n => n >= st.secs[0] && n <= st.secs[1]).sort((a, b) => a - b);
    const box = el('div', 'gs-time'); box.append(el('span', null, st.timeLabel || 'Time per turn'));
    const chips = el('div', 'gs-chips');
    for (const n of opts) { const c = el('button', 'chip-btn' + (n === val.secs ? ' on' : ''), fmt(n)); c.type = 'button'; c.onclick = () => { val.secs = n; chips.querySelectorAll('.chip-btn').forEach(z => z.classList.toggle('on', z === c)); }; chips.append(c); }
    box.append(chips); inner.append(box);
  }
  const sb = el('div', 'gs-time'); sb.append(el('span', null, 'Sounds'), soundPicker(sounds)); inner.append(sb);
  const go = el('button', 'btn primary block', 'Start game'); go.type = 'button';
  go.onclick = async () => {
    const extra = { ...val, sounds }; if (series) { if (!series.value.trim()) return toast('Type the show’s name'); extra.series = series.value.trim(); const n = Math.round(Number(epCount.value)); if (!(n >= 1 && n <= 20000)) { epCount.focus(); return toast('How many episodes does the show have? (1–20000)'); } extra.maxEp = n; }
    go.disabled = true;
    try { await gameApi('start', { kind: x.kind, ...extra }); if (d.open) d.close(); openGame(); } catch { go.disabled = false; }
  };
  inner.append(go);
}
/* ---------------- Game sounds (made with Web Audio, or a clip the game starter uploaded) ---------------- */
const SFX_NAMES = {
  wrong: { fahh: 'Fahh (meme style)', buzzer: 'Game-show buzzer', trombone: 'Sad trombone', bruh: 'Bruh', off: 'No sound' },
  right: { crore: 'Crorepati jackpot', ding: 'Ding ding', coin: 'Arcade coin', tada: 'Ta-da!', off: 'No sound' },
};
let sfxCtx = null; const sfxClips = {};
const sfxMuted = () => { try { return localStorage.getItem('ic-sfx-off') === '1'; } catch { return false; } };
function sfxSetMuted(off) { try { localStorage.setItem('ic-sfx-off', off ? '1' : '0'); } catch {} }
function sfxAc() { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; sfxCtx ||= new C(); if (sfxCtx.state === 'suspended') sfxCtx.resume().catch(() => {}); return sfxCtx; }
document.addEventListener('pointerdown', () => { if (sfxCtx?.state === 'suspended') sfxCtx.resume().catch(() => {}); }, { passive: true });
function sfxNoise(c, secs) { const b = c.createBuffer(1, Math.ceil(c.sampleRate * secs), c.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; const n = c.createBufferSource(); n.buffer = b; return n; }
function sfxEnv(c, t, a, hold, rel, peak, dest) { const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setValueAtTime(peak, t + a + hold); g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + rel); g.connect(dest); return g; }
function sfxTone(c, out, type, f, t, dur, peak = .3, f2) { const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur); o.connect(sfxEnv(c, t, .01, dur * .3, dur * .7, peak, out)); o.start(t); o.stop(t + dur + .05); return o; }
function sfxVoice(c, out, t, f1, f2, dur, formants, peak) {     // a sung "aah"/"uh": sawtooth through vowel formants, with wobble
  const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const vib = c.createOscillator(), vg = c.createGain(); vib.frequency.value = 5.5; vg.gain.value = f1 * .025; vib.connect(vg).connect(o.frequency);
  const env = sfxEnv(c, t, .06, dur * .55, dur * .45, peak, out);
  formants.forEach(([fq, gn]) => { const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fq; bp.Q.value = 7; const g = c.createGain(); g.gain.value = gn; o.connect(bp).connect(g).connect(env); });
  o.start(t); vib.start(t); o.stop(t + dur + .1); vib.stop(t + dur + .1);
}
const SFX_SYNTH = {
  fahh(c, out, t) {        // breathy "ff…" then a long falling "AAAHH"
    const n = sfxNoise(c, .25), hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2200; n.connect(hp).connect(sfxEnv(c, t, .05, .08, .12, .55, out)); n.start(t);
    sfxVoice(c, out, t + .14, 290, 105, 1.25, [[800, 2.2], [1200, 1.2], [2600, .5]], .9);
    const n2 = sfxNoise(c, 1.3), bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 1; n2.connect(bp).connect(sfxEnv(c, t + .14, .1, .6, .6, .12, out)); n2.start(t + .14);
  },
  buzzer(c, out, t) { const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1600; lp.connect(out); for (const f of [110, 116.5]) sfxTone(c, lp, 'square', f, t, .7, .22); },
  trombone(c, out, t) { const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1300; lp.connect(out); [[392, .32], [370, .32], [349, .32]].forEach(([f, d], i) => sfxVoice(c, lp, t + i * .36, f, f * .98, d, [[700, 1.5], [1100, .8]], .7)); sfxVoice(c, lp, t + 1.08, 330, 300, 1.1, [[700, 1.5], [1100, .8]], .7); },
  bruh(c, out, t) { const n = sfxNoise(c, .1), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; n.connect(lp).connect(sfxEnv(c, t, .01, .03, .05, .4, out)); n.start(t); sfxVoice(c, out, t + .06, 125, 92, .45, [[600, 2], [1000, 1]], .9); },
  crore(c, out, t) {       // KBC-style jackpot: boom, a rising brass swell, then sparkling chimes
    sfxTone(c, out, 'sine', 70, t, 1.1, .5, 38);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(250, t); lp.frequency.exponentialRampToValueAtTime(3800, t + .9);
    const sw = sfxEnv(c, t, .5, .7, .8, .22, out); lp.connect(sw);
    for (const f of [130.8, 164.8, 196, 261.6]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = (Math.random() - .5) * 14; o.connect(lp); o.start(t); o.stop(t + 2.1); }
    [1046.5, 1318.5, 1568, 2093, 2637].forEach((f, i) => { sfxTone(c, out, 'sine', f, t + .55 + i * .11, .7, .18); sfxTone(c, out, 'triangle', f * 2, t + .55 + i * .11, .35, .05); });
  },
  ding(c, out, t) { for (const [f, d] of [[880, 0], [1318.5, .16]]) { sfxTone(c, out, 'sine', f, t + d, 1, .3); sfxTone(c, out, 'sine', f * 2.76, t + d, .4, .07); } },
  coin(c, out, t) { sfxTone(c, out, 'square', 988, t, .08, .26); sfxTone(c, out, 'square', 1319, t + .08, .45, .26); },
  tada(c, out, t) { const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400; lp.connect(out); sfxTone(c, lp, 'sawtooth', 392, t, .12, .16); sfxTone(c, lp, 'sawtooth', 523, t + .14, .12, .16); for (const f of [659, 784, 1046.5]) sfxTone(c, lp, 'sawtooth', f, t + .3, 1, .13); },
};
// kind: 'wrong' | 'right'; choice: a built-in name or an uploaded clip's URL
function playSfx(kind, choice, force = false) {
  if (!force && sfxMuted()) return;
  choice ||= kind === 'wrong' ? 'fahh' : 'crore';
  if (choice === 'off') return;
  if (choice.startsWith('/api/file/')) { const a = sfxClips[choice] ||= new Audio(choice); try { a.currentTime = 0; a.volume = .9; a.play().catch(() => {}); } catch {} return; }
  const c = sfxAc(), fn = SFX_SYNTH[choice]; if (!c || !fn) return;
  const out = c.createGain(); out.gain.value = .9; out.connect(c.destination); fn(c, out, c.currentTime + .02);
}
// Picker used when starting a chat game or setting up a challenge game. val: { wrong, right }
function soundPicker(val) {
  const box = el('div', 'sfx-pick');
  for (const kind of ['wrong', 'right']) {
    const row = el('div', 'sfx-row'), sel = el('select'); sel.setAttribute('aria-label', kind === 'wrong' ? 'Wrong answer sound' : 'Right answer sound');
    const fill = () => {
      sel.innerHTML = '';
      for (const [k, name] of Object.entries(SFX_NAMES[kind])) sel.append(Object.assign(document.createElement('option'), { value: k, textContent: name }));
      if (val[kind]?.startsWith('/api/file/')) sel.append(Object.assign(document.createElement('option'), { value: val[kind], textContent: 'Your uploaded sound' }));
      sel.append(Object.assign(document.createElement('option'), { value: '__up', textContent: 'Upload your own…' }));
      sel.value = val[kind];
    };
    const file = el('input'); file.type = 'file'; file.accept = 'audio/*'; file.hidden = true;
    file.onchange = async () => {
      const f = file.files[0]; file.value = ''; if (!f) return fill();
      if (f.size > 600 * 1024) { toast('Pick a short clip (under 600 KB)'); return fill(); }
      try { toast('Uploading sound…'); val[kind] = await upload(f); fill(); playSfx(kind, val[kind], true); } catch (e) { toast(e.message); fill(); }
    };
    sel.onchange = () => { if (sel.value === '__up') return file.click(); val[kind] = sel.value; playSfx(kind, val[kind], true); };
    const test = el('button', 'icon-btn sfx-test'); test.type = 'button'; test.innerHTML = svgFor('volume'); test.setAttribute('aria-label', 'Play this sound'); test.onclick = () => playSfx(kind, val[kind], true);
    const lab = el('span', null, kind === 'wrong' ? 'Wrong answer' : 'Right answer');
    const ctl = el('div', 'sfx-ctl'); ctl.append(sel, test); row.append(lab, ctl, file); box.append(row); fill();
  }
  return box;
}
function sfxMuteBtn() {
  const b = el('button', 'icon-btn sfx-mute'); b.type = 'button';
  const paint = () => { b.innerHTML = svgFor(sfxMuted() ? 'volumeOff' : 'volume'); b.setAttribute('aria-label', sfxMuted() ? 'Turn game sounds on' : 'Mute game sounds'); b.title = b.getAttribute('aria-label'); };
  b.onclick = e => { e.stopPropagation(); sfxSetMuted(!sfxMuted()); paint(); if (!sfxMuted()) playSfx('right', 'ding'); }; paint(); return b;
}
// Chat games: right sound when your score goes up; wrong when a round/throw ends and someone else scored instead of you
let sfxBase = null;
function gameSfx(g) {
  if (!g || !g.joined) { sfxBase = null; return; }
  const key = `${g.id}-${g.round}-${g.data?.throwNo || 0}`, val = u => (g.scores?.[u] || 0) + (g.data?.wins?.[u] || 0);
  const snap = () => Object.fromEntries(g.players.map(p => [p.uid, val(p.uid)]));
  if (!sfxBase || sfxBase.key !== key) {
    const fresh = !sfxBase || !sfxBase.key.startsWith(g.id + '-');
    sfxBase = { key, s: fresh ? snap() : sfxBase.last || snap(), done: false };
  }
  sfxBase.last = snap();
  if (sfxBase.done) return;
  const mine = val(me.uid) - (sfxBase.s[me.uid] || 0), others = g.players.some(p => p.uid !== me.uid && val(p.uid) > (sfxBase.s[p.uid] || 0));
  if (mine > 0) { sfxBase.done = true; playSfx('right', g.cfg?.sounds?.right); }
  else if (others && ['reveal', 'shown', 'over'].includes(g.phase)) { sfxBase.done = true; playSfx('wrong', g.cfg?.sounds?.wrong); }
}
let gameWalkie = false;          // true when the game (not you) switched the walkie-talkie on
function openGame() {
  if (!game) return openGamePicker();
  // voice games: hear each other live while the game runs (not for a finished game)
  if (['mafia', 'episode', 'imposter'].includes(game.kind) && game.phase !== 'over' && !walkie.on) { openWalkie(); gameWalkie = true; }
  const { d } = sheet('gameSheet', '');
  d.classList.add('game-sheet');
  renderGame();
  if (!d.open) {
    d.showModal();
    // closing the game puts the walkie-talkie back the way it was (unless you're talking right now)
    d.addEventListener('close', () => { if (gameWalkie && walkie.on && !walkie.talking) { closeWalkie(); repoll(); } gameWalkie = false; }, { once: true });
  }
  clearInterval(gameTick);
  gameTick = setInterval(() => { if (!d.open) { clearInterval(gameTick); return; } const t = d.querySelector('.g-timer'); if (t) t.textContent = timerText(); }, 500);
}
function timerText() {
  if (!game?.deadline) return '';
  const s = Math.max(0, Math.ceil((game.deadline - (Date.now() + gameClockOff)) / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}
function renderGame() {
  const d = $('gameSheet'); if (!d) return;
  const inner = d.querySelector('.sheet-inner'); if (!inner) return;
  const keepFocus = document.activeElement?.dataset?.gk;
  const oldYt = inner.querySelector('.g-yt'); oldYt?.remove();          // keep the playing clip (re-adding it as-is doesn't restart it)
  [...inner.children].slice(1).forEach(n => n.remove());
  inner.querySelector('.sheet-head h2').textContent = game ? game.name : 'Games';
  { const hd = inner.querySelector('.sheet-head'); if (hd && !hd.querySelector('.sfx-mute')) hd.lastElementChild.before(sfxMuteBtn()); }
  if (!game) { inner.append(el('p', 'empty-note', 'No game running.')); return; }
  const g = game, host = g.host === me.uid, canEnd = host || group?.isAdmin;
  if (g.data?.say && g.phase !== 'lobby') narrate(g.data.say);
  // header: round, timer, scoreboard
  const top = el('div', 'g-top');
  top.append(el('span', 'g-round', g.phase === 'lobby' ? 'Waiting for players' : g.phase === 'over' ? 'Game over' : `Round ${g.round}${g.rounds ? ' / ' + g.rounds : ''}`), el('span', 'g-timer', timerText()));
  inner.append(top);
  const board = el('div', 'g-scores');
  for (const p of [...g.players].sort((a, b) => (g.scores[b.uid] || 0) - (g.scores[a.uid] || 0))) {
    const c = el('span', 'g-chip' + (p.uid === me.uid ? ' me' : '') + (g.kind === 'mafia' && g.data.alive && !g.data.alive.includes(p.uid) ? ' out' : ''));
    c.append(el('b', null, String(g.scores[p.uid] || 0)), p.uid === me.uid ? 'You' : p.name);
    board.append(c);
  }
  inner.append(board);
  const body = el('div', 'g-body'); inner.append(body);
  const btn = (label, cls, fn) => { const b = el('button', 'btn ' + cls, label); b.type = 'button'; b.onclick = async () => { b.disabled = true; try { await fn(); } catch {} b.disabled = false; }; return b; };
  const say = (t, cls = '') => body.append(el('p', 'g-say ' + cls, t));
  const input = (key, ph, max = 60, area = false) => { const i = el(area ? 'textarea' : 'input', 'g-input'); i.placeholder = ph; i.maxLength = max; i.dataset.gk = key; i.value = gameDraft[key] || ''; i.oninput = () => { gameDraft[key] = i.value; }; if (area) i.rows = 3; return i; };
  const send = (key, body2) => async () => { const v = (gameDraft[key] || '').trim(); if (!v) return toast('Type something first'); await gameApi('move', body2(v)); gameDraft[key] = ''; };
  const players = (filter, onPick, label = p => pname(p.uid)) => { const w = el('div', 'g-pick'); for (const p of g.players.filter(filter)) w.append(btn(label(p), '', () => onPick(p))); return w; };

  if (g.phase === 'over' && !g.round) {
    say('The game was ended before it started.', 'strong');
  } else if (g.phase === 'lobby') {
    const cf = g.cfg || {}, bits = [];
    if (g.rounds) bits.push(`${g.rounds} round${g.rounds === 1 ? '' : 's'}`);
    if (cf.wins) bits.push(`first to ${cf.wins}`);
    if (cf.secs) bits.push(`${cf.timeLabel ? cf.timeLabel.toLowerCase() : 'time per turn'}: ${cf.secs >= 60 && cf.secs % 60 === 0 ? cf.secs / 60 + ' min' : cf.secs + ' s'}`);
    if (bits.length) say(bits.join(' · '), 'muted');
    say(`${g.players.length} player${g.players.length === 1 ? '' : 's'}: ${g.players.map(p => pname(p.uid)).join(', ')}`);
    if (!g.joined) body.append(btn('Join game', 'primary block', () => gameApi('join')));
    else if (!host) body.append(btn('Leave', 'ghost block', () => gameApi('leave')));
    if (host) body.append(btn('Start game', 'primary block', () => gameApi('begin')));
    else say(`Waiting for ${g.hostName} to start…`, 'muted');
  } else if (g.kind === 'imposter') {
    const card = el('div', 'g-card' + (g.you.imposter ? ' danger' : ''));
    if (g.you.imposter) card.append(el('small', null, 'You are the'), el('b', null, 'IMPOSTER'), el('small', null, `Category: ${g.data.cat}. Blend in!`));
    else if (g.you.word) card.append(el('small', null, `Category: ${g.data.cat}`), el('b', null, g.you.word), el('small', null, 'Give a clue — not too obvious!'));
    if (g.joined && card.childElementCount) body.append(card);
    if (g.phase === 'clue') {
      if (g.joined) { body.append(gameTalkButton('Hold to say your clue')); body.append(input('clue', 'Or type your one-word clue', 24)); body.append(btn('Send clue', 'primary block', send('clue', text => ({ text })))); }
      say('Everyone gives one clue, then you vote.', 'muted');
    } else {
      const cl = el('div', 'g-list'); for (const u of g.data.order || []) { const r = el('div', 'g-row'); r.append(el('b', null, pname(u)), el('span', null, g.data.clues?.[u] || '…')); cl.append(r); } body.append(cl);
      if (g.phase === 'vote') { say('Who is the imposter?'); if (g.joined) body.append(players(p => p.uid !== me.uid, p => gameApi('move', { target: p.uid }))); }
      if (g.phase === 'guess') { say(`${pname(g.data.imposter)} was caught! They get one guess at the word…`); if (g.you.imposter) { body.append(input('guess', 'Your guess', 40)); body.append(btn('Guess', 'primary block', send('guess', text => ({ text })))); } }
      if (g.phase === 'reveal' || g.phase === 'over') {
        say(`The word was “${g.data.word}”. Imposter: ${pname(g.data.imposter)}.`);
        say({ escaped: 'The imposter got away! (+2)', stole: 'Caught — but guessed the word! (+2 to the imposter)', caught: 'Caught! Everyone else +1.' }[g.data.result] || '', 'strong');
      }
    }
  } else if (g.kind === 'mafia') {
    const night = ['mafia', 'doctor', 'detective'].includes(g.phase), alive = p => g.data.alive.includes(p.uid);
    if (g.data.say) body.append(el('div', 'g-narrator', g.data.say));
    if (night && !g.you.awake) {                           // everyone else: eyes closed
      const dark = el('div', 'g-night'); dark.append(el('div', 'g-moon', '🌙'), el('b', null, g.you.role && !g.you.alive ? 'You’re out — the city sleeps' : 'The city is asleep'), el('small', null, 'Close your eyes… the narrator will wake you.'));
      body.append(dark);
    } else {
      if (g.you.role) {
        const card = el('div', 'g-card' + (g.you.role === 'mafia' ? ' danger' : ''));
        card.append(el('small', null, g.you.alive ? 'Your secret role' : 'You’re out — your role was'), el('b', null, g.you.role.toUpperCase()),
          el('small', null, { mafia: `Team: ${(g.you.team || []).map(pname).join(', ')}`, doctor: 'Save one person each night (even yourself).', detective: 'Check one person each night.', villager: 'Find the mafia by talking and voting.' }[g.you.role]));
        if (g.phase !== 'reveal') body.append(card);
        if (g.you.checks?.length) say('Your checks: ' + g.you.checks.map(c => `${pname(c.uid)} ${c.mafia ? 'IS mafia' : 'is not mafia'}`).join(' · '));
      }
      const choose = (filter, verb) => {
        const opts = g.players.filter(filter);
        body.append(players(filter, p => gameApi('move', { target: p.uid }).then(() => toast(`${verb} ${p.name}`))));
        body.append(btn('🎙 Say a name', 'ghost block', async () => { try { const p = await listenForName(opts); await gameApi('move', { target: p.uid }); toast(`${verb} ${p.name}`); } catch (e) { toast(e.message); } }));
      };
      if (night && g.you.awake) {
        say({ mafia: 'Choose someone to eliminate:', doctor: 'Choose someone to save:', detective: 'Choose someone to investigate:' }[g.phase], 'strong');
        choose(p => alive(p) && !(g.phase === 'mafia' && (g.you.team || []).includes(p.uid)) && !(g.phase === 'detective' && p.uid === me.uid), { mafia: 'Chose', doctor: 'Saving', detective: 'Checking' }[g.phase]);
      }
      if (g.phase === 'day') {
        if (g.you.alive) { body.append(gameTalkButton('Hold to talk to the town')); say('Vote who to throw out:'); choose(p => alive(p) && p.uid !== me.uid, 'Voted'); body.append(btn('Skip vote', 'ghost block', () => gameApi('move', { target: 'skip' }))); }
        else say('You’re out — listen to the town decide.', 'muted');
      }
    }
    if (g.data.winner) say(g.data.winner === 'town' ? 'Town wins! The mafia is gone.' : 'Mafia wins!', 'strong');
    if (g.data.roles) { const l = el('div', 'g-list'); for (const [u, r] of Object.entries(g.data.roles)) { const row = el('div', 'g-row'); row.append(el('b', null, pname(u)), el('span', null, r)); l.append(row); } body.append(l); }
  } else if (g.kind === 'episode') {
    const teller = g.data.teller, tname = pname(teller);
    say(`${g.data.series || ''}`, 'muted');
    if (g.phase === 'pick') {
      if (g.you.teller) {
        if (g.data.notice) say(g.data.notice, 'warn');
        say('Your turn! Pick an episode number — you’ll get a random 15–20 s clip from it, then tell its storyline out loud.', 'strong');
        body.append(input('ep', `Episode number (1–${g.data.maxEp || 4000})`, 6));
        const r = el('div', 'g-pick');
        r.append(btn('Play episode', 'primary', async () => { const n = parseInt(gameDraft.ep, 10); if (!n) return toast('Type an episode number'); await gameApi('move', { episode: n }).catch(e => { if (e.code === 'no_search') gameDraft.needLink = true; renderGame(); }); }));
        r.append(btn('🎲 Random', '', () => gameApi('move', { random: true }).catch(e => { if (e.code === 'no_search') { gameDraft.needLink = true; renderGame(); } })));
        body.append(r);
        if (gameDraft.needLink) { body.append(input('link', 'Paste a YouTube link to the episode', 300)); body.append(btn('Use this link', 'block', () => gameApi('move', { url: gameDraft.link }))); }
      } else { if (g.data.notice) say(g.data.notice, 'muted'); say(`${tname} is picking an episode…`); }
    }
    if ((g.phase === 'watch' || g.phase === 'tell') && g.data.clip) {
      const c = g.data.clip, f = el('iframe', 'g-yt');
      f.src = `https://www.youtube-nocookie.com/embed/${c.id}?start=${c.start}&end=${c.start + c.dur}&autoplay=1&playsinline=1&rel=0&modestbranding=1&controls=0&disablekb=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`;
      f.allow = 'autoplay; encrypted-media'; f.title = 'Clip';
      if (!(oldYt && oldYt.src === f.src)) {
        // Ask the player to tell us about errors (blocked in this country, removed, not embeddable…)
        f.dataset.clip = c.id;
        f.onload = () => { try { f.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 'g-yt', channel: 'widget' }), '*'); f.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'addEventListener', args: ['onError'], id: 'g-yt', channel: 'widget' }), '*'); } catch {} };
      }
      body.append(oldYt && oldYt.src === f.src ? oldYt : f);
      if (g.data.episode) say(`Episode ${g.data.episode}`, 'muted');
    }
    if (g.phase === 'watch') say(g.you.teller ? 'Watch closely — you’ll tell the story next!' : `Watch with ${tname}…`, 'strong');
    if (g.phase === 'tell') {
      if (g.you.teller) {
        say('Tell everyone the storyline of this episode — hold the button and talk.', 'strong');
        body.append(gameTalkButton('Hold to tell the story'));
        body.append(input('told', 'Optional: type a short summary too', 400, true));
        body.append(btn('I’m done', 'primary block', async () => { await gameApi('move', { done: true, text: gameDraft.told || '' }); gameDraft.told = ''; }));
      } else say(`🎙 ${tname} is telling the story — listen!`, 'strong');
    }
    if (g.phase === 'judge') {
      if (g.data.told) say(`“${g.data.told}”`);
      if (g.you.teller) say('The others are deciding if you got it right…', 'muted');
      else { say(`Did ${tname} get the storyline right?`, 'strong'); const r = el('div', 'g-pick'); r.append(btn('✓ Correct', 'primary', () => gameApi('move', { verdict: 'yes' }).then(() => toast('Voted ✓'))), btn('✗ Wrong', 'danger', () => gameApi('move', { verdict: 'no' }).then(() => toast('Voted ✗')))); body.append(r); }
    }
    if (g.phase === 'reveal') {
      if (g.data.skipped) say(`${tname} didn’t pick an episode in time.`, 'muted');
      else say(g.data.right ? `✓ ${tname} got it right! (+3)` : `✗ Not quite (${g.data.yes || 0} ✓ · ${g.data.no || 0} ✗)`, 'strong');
      if (g.data.videoTitle) say(`It was: ${g.data.videoTitle}`, 'muted');
    }
  } else if (g.kind === 'emoji') {
    if (gameDraft.egRound !== `${g.id}-${g.round}-${g.phase}`) { gameDraft.egRound = `${g.id}-${g.round}-${g.phase}`; gameDraft.eg = ''; gameDraft.egFb = null; }   // new puzzle → empty box
    body.append(el('div', 'g-emoji', g.data.emoji));
    say(`${g.data.cat} · ${g.data.letters} letters`, 'muted');
    if (g.phase === 'guess' && g.joined) {
      const solved = (g.data.solved || []).includes(me.uid);
      if (solved) say('You got it! Waiting for the others…', 'strong');
      else {
        const gi = input('eg', 'Your guess', 60), fbk = gameDraft.egFb;
        if (fbk?.shake) { gi.classList.add('wrong'); fbk.shake = false; }
        const go = async () => {
          const v = (gameDraft.eg || '').trim(); if (!v) return;
          let r; try { r = await gameApi('move', { text: v }); } catch { return; }      // gameApi already shows the error
          if (r.correct) { gameDraft.eg = ''; gameDraft.egFb = null; toast('Correct!'); }
          else { playSfx('wrong', g.cfg?.sounds?.wrong); if (!r.hint) gameDraft.eg = ''; gameDraft.egFb = { msg: r.msg || 'Not quite — try again', hint: r.hint, shake: true }; if (navigator.vibrate) navigator.vibrate(60); }
          renderGame(); setTimeout(() => document.querySelector('.g-input[data-gk="eg"]')?.focus(), 0);
        };
        gi.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
        body.append(gi);
        if (fbk) body.append(el('p', 'g-fb ' + (fbk.hint ? 'close' : 'bad'), fbk.msg));
        body.append(btn('Guess', 'primary block', go));
      }
    }
    if ((g.data.solved || []).length) say('Solved: ' + g.data.solved.map(pname).join(', '));
    if (g.phase === 'reveal') say(`Answer: ${g.data.answer}`, 'strong');
  } else if (g.kind === 'wyr') {
    say('Would you rather…', 'strong');
    for (const k of ['a', 'b']) {
      const b = btn(g.data[k], 'g-wyr' + (g.data.picks?.[me.uid] === k ? ' on' : ''), () => gameApi('move', { choice: k }));
      if (g.phase === 'reveal') { const who = Object.entries(g.data.picks || {}).filter(([, c]) => c === k).map(([u]) => pname(u)); b.append(el('small', null, who.length ? who.join(', ') : 'nobody')); b.disabled = true; }
      body.append(b);
    }
  } else if (g.kind === 'ttt') {
    const grid = el('div', 'g-ttt');
    g.data.board.forEach((v, i) => { const c = el('button', 'g-cell' + (g.data.line?.includes(i) ? ' win' : ''), v || ''); c.type = 'button'; c.disabled = !!v || g.phase !== 'play' || g.data.turn !== me.uid; c.onclick = () => gameApi('move', { i }); grid.append(c); });
    body.append(grid);
    say(g.phase === 'play' ? (g.data.turn === me.uid ? `Your turn (${g.data.x === me.uid ? 'X' : 'O'})` : `${pname(g.data.turn)}’s turn`) : g.data.draw ? 'Draw!' : `${pname(g.data.winner)} wins!`, 'strong');
  } else if (g.kind === 'rps') {
    const w = g.data.wins || {}; say(g.players.map(p => `${pname(p.uid)} ${w[p.uid] || 0}`).join(' — ') + ` · first to ${g.cfg?.wins || 3}`, 'strong');
    if (g.data.last && Object.values(g.data.last).some(Boolean)) say('Last throw: ' + Object.entries(g.data.last).map(([u, h]) => `${pname(u)} ${({ rock: '✊', paper: '✋', scissors: '✌️' })[h] || '—'}`).join('  vs  '));
    if (g.phase === 'throw' && g.joined) { const r = el('div', 'g-pick'); for (const [h, e] of [['rock', '✊'], ['paper', '✋'], ['scissors', '✌️']]) r.append(btn(e, 'g-rps', () => gameApi('move', { hand: h }).then(() => toast('Thrown — waiting…')))); body.append(r); }
    if (g.data.champ) say(`${pname(g.data.champ)} wins the match!`, 'strong');
  }

  // host controls
  const ctl = el('div', 'g-ctl');
  if (g.phase === 'reveal' && (host || (g.kind === 'episode' && g.you.teller))) ctl.append(btn(g.kind === 'mafia' || (g.rounds && g.round >= g.rounds) || (g.kind === 'episode' && g.round >= g.players.length) ? 'Finish game' : g.kind === 'ttt' || g.kind === 'rps' ? 'Play again' : g.kind === 'episode' ? 'Next player’s turn' : 'Next round', 'primary', () => gameApi('next')));
  if (g.phase === 'over') { say('Thanks for playing!', 'strong'); ctl.append(btn('New game', 'primary', async () => { await gameApi('end'); $('gameSheet').close(); openGamePicker(); })); }
  else if (canEnd) ctl.append(btn('End game', 'ghost', () => gameApi('end')));
  inner.append(ctl);
  if (keepFocus) { const i = inner.querySelector(`[data-gk="${keepFocus}"]`); if (i) { i.focus(); i.value = gameDraft[keepFocus] ?? ''; } }   // the draft is the source of truth (cleared on a new round)
}


/* ---------------- Fun mode: friends set your lock / home screen (photo or live doodle) ----------------
   Opt-in per chat. Only the Android app can change wallpapers; anyone can draw and send. */
const FUN_W = 1080, FUN_H = 2340;                    // a tall phone screen; Android crops it to fit
const funTargetName = t => t === 'both' ? 'lock & home screen' : t === 'home' ? 'home screen' : 'lock screen';
async function openFun() {
  if (!current) return;
  const room = current;
  let st; try { st = await api('fun/state', { room }); } catch (e) { return toast(e.message); }
  const { d, inner } = sheet('funSheet', 'Fun mode');
  inner.append(el('p', 'muted small', 'Friends here can set your phone’s lock screen or home screen — a photo, or a doodle you watch appear live. Only if you turn it on, and you can turn it off anytime.'));
  // your screen
  const mine = el('div', 'fun-sec'); mine.append(el('h3', null, 'Your screen'));
  if (nativeApp()) {
    const sw = (label, key) => {
      const r = el('button', 'al-row'); r.type = 'button'; const t = el('div'); t.append(el('b', null, label), el('small', null, st.me[key] ? 'Friends here can change it' : 'Off'));
      r.append(t, el('span', 'al-switch' + (st.me[key] ? ' on' : ''))); r.onclick = async () => {
        const next = { ...st.me, [key]: !st.me[key] };
        try { st.me = (await api('fun/settings', { room, ...next })).me; await window.Capacitor.nativePromise('Fun', 'setAllowed', { lock: st.me.lock, home: st.me.home, baseUrl: location.origin }); setupNativePush(false); }
        catch (e) { return toast(e.message); }
        openFun();
      };
      return r;
    };
    mine.append(sw('Lock screen', 'lock'), sw('Home screen', 'home'));
    if (st.last) mine.append(el('p', 'muted small', `Last change: ${st.last.byName}, ${funTargetName(st.last.target)} · ${timeLabel(st.last.at)}`));
    const row = el('div', 'fun-btns');
    const back = el('button', 'btn', 'Lock screen back to normal'); back.type = 'button';
    back.onclick = async () => { try { await window.Capacitor.nativePromise('Fun', 'restore', { target: 'lock' }); toast('Lock screen is back to your home wallpaper'); } catch (e) { toast(e.message); } };
    const own = el('button', 'btn', 'Use my own photo'); own.type = 'button';
    own.onclick = () => pickImage(async img => {
      const target = await popup({ icon: 'image', title: 'Use it as…', ok: '', cancel: 'Cancel', choices: [{ label: 'Lock screen', value: 'lock' }, { label: 'Home screen', value: 'home' }, { label: 'Both', value: 'both' }] });
      if (!target) return;
      try { await window.Capacitor.nativePromise('Fun', 'setOwn', { data: funCover(img).toDataURL('image/jpeg', 0.9), target }); toast('Wallpaper set'); } catch (e) { toast(e.message); }
    });
    row.append(back, own); mine.append(row);
  } else mine.append(el('p', 'muted small', 'To let friends change your screen, open this chat in the Intra Chat Android app. You can still draw on theirs from here.'));
  inner.append(mine);
  // their screens
  const theirs = el('div', 'fun-sec'); theirs.append(el('h3', null, 'Draw on their screen'));
  if (!st.people.length) theirs.append(el('p', 'muted small', group?.dm ? 'They haven’t turned on fun mode in this chat yet.' : 'Nobody here has turned on fun mode yet.'));
  else {
    const list = el('div', 'fun-people');
    for (const p of st.people) { const c = el('span', 'chip brand'); c.append(p.name + ' · ' + [p.lock && 'lock', p.home && 'home'].filter(Boolean).join(' + ')); list.append(c); }
    theirs.append(list);
    const row = el('div', 'fun-btns');
    const dood = el('button', 'btn primary', 'Doodle live'); dood.type = 'button'; dood.prepend(icoEl('pencil'));
    dood.onclick = () => { d.close(); funPad(room, st.people); };
    const photo = el('button', 'btn', 'Send a photo'); photo.type = 'button'; photo.prepend(icoEl('image'));
    photo.onclick = () => pickImage(img => { d.close(); funPad(room, st.people, img, true); });
    row.append(dood, photo); theirs.append(row);
  }
  inner.append(theirs);
  if (!d.open) d.showModal();
}
function pickImage(cb) {
  const f = el('input'); f.type = 'file'; f.accept = 'image/*';
  f.onchange = () => { const file = f.files[0]; if (!file) return; const img = new Image(); img.onload = () => cb(img); img.onerror = () => toast('That picture couldn’t be opened'); img.src = URL.createObjectURL(file); };
  f.click();
}
// a picture scaled to cover the phone-shaped canvas
function funCover(img, c = Object.assign(document.createElement('canvas'), { width: FUN_W, height: FUN_H })) {
  const x = c.getContext('2d'), s = Math.max(FUN_W / img.width, FUN_H / img.height), w = img.width * s, h = img.height * s;
  x.drawImage(img, (FUN_W - w) / 2, (FUN_H - h) / 2, w, h); return c;
}
// ---- One drawing engine for the pad, the live viewer and replays. A stroke: { tool, color, size, seed, pts } on the
// 1080 × 2340 canvas; shapes (line, arrow, rect, circle, heart, star) use two points: where the drag started and ended.
const FUN_SHAPES = new Set(['line', 'arrow', 'rect', 'circle', 'heart', 'star']);
const FUN_BRUSHES = [['pen', 'Pen'], ['marker', 'Marker'], ['neon', 'Neon'], ['rainbow', 'Rainbow'], ['spray', 'Spray'], ['eraser', 'Eraser']];
const FUN_SHAPE_ICONS = {
  line: '<path d="M5 19L19 5"/>', arrow: '<path d="M5 19L19 5M10 5h9v9"/>', rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
  circle: '<circle cx="12" cy="12" r="8"/>', heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
};
const funPrng = seed => { let x = (seed >>> 0) || 1; return () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296; };
function funPath(c, p, m) {
  c.beginPath(); c.moveTo(p[0][0], p[0][1]);
  for (let i = 1; i < m; i++) { const [a, b] = p[i - 1], [x, y] = p[i]; c.quadraticCurveTo(a, b, (a + x) / 2, (b + y) / 2); }
  if (m === 1) c.lineTo(p[0][0] + 0.1, p[0][1]);
}
function funShape(c, st, t) {
  const [a, b] = [st.pts[0], st.pts[1] || st.pts[0]];
  const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]), w = Math.abs(b[0] - a[0]) * t, h = Math.abs(b[1] - a[1]) * t;
  const ex = a[0] + (b[0] - a[0]) * t, ey = a[1] + (b[1] - a[1]) * t;
  c.beginPath();
  if (st.tool === 'line' || st.tool === 'arrow') {
    c.moveTo(a[0], a[1]); c.lineTo(ex, ey); c.stroke();
    if (st.tool === 'arrow' && t > 0.6) {
      const ang = Math.atan2(ey - a[1], ex - a[0]), L = Math.max(30, st.size * 3);
      c.beginPath(); c.moveTo(ex - L * Math.cos(ang - 0.5), ey - L * Math.sin(ang - 0.5)); c.lineTo(ex, ey); c.lineTo(ex - L * Math.cos(ang + 0.5), ey - L * Math.sin(ang + 0.5)); c.stroke();
    }
  } else if (st.tool === 'rect') { c.strokeRect(a[0] < b[0] ? x0 : a[0] - w, a[1] < b[1] ? y0 : a[1] - h, w, h); }
  else if (st.tool === 'circle') { const rx = Math.abs(b[0] - a[0]) / 2, ry = Math.abs(b[1] - a[1]) / 2; c.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.max(1, rx), Math.max(1, ry), 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t); c.stroke(); }
  else {                    // heart / star: filled, growing from the middle
    const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, W = Math.max(20, Math.abs(b[0] - a[0])) * t, H = Math.max(20, Math.abs(b[1] - a[1])) * t;
    if (st.tool === 'heart') {
      c.moveTo(cx, cy + H * 0.42);
      c.bezierCurveTo(cx - W * 0.62, cy, cx - W * 0.5, cy - H * 0.52, cx, cy - H * 0.2);
      c.bezierCurveTo(cx + W * 0.5, cy - H * 0.52, cx + W * 0.62, cy, cx, cy + H * 0.42);
    } else for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.4 : 1, an = -Math.PI / 2 + i * Math.PI / 5; c[i ? 'lineTo' : 'moveTo'](cx + Math.cos(an) * W / 2 * r, cy + Math.sin(an) * H / 2 * r); }
    c.closePath(); c.fill();
  }
}
// Draw a stroke: freehand up to its first m points; shapes at progress t (0–1) — that's how drawing animates
function funStroke(c, st, m = st.pts.length, t = 1) {
  const p = st.pts; if (!p?.length) return;
  m = Math.max(1, Math.min(Math.floor(m), p.length));
  c.save(); c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = st.size; c.strokeStyle = c.fillStyle = st.color;
  c.globalCompositeOperation = st.tool === 'eraser' ? 'destination-out' : 'source-over';
  if (FUN_SHAPES.has(st.tool)) funShape(c, st, t);
  else if (st.tool === 'spray') {
    const r = funPrng(st.seed), rad = st.size * 1.3, k = 6 + Math.round(st.size / 4);
    for (let i = 0; i < m; i++) for (let j = 0; j < k; j++) { const an = r() * Math.PI * 2, d = Math.sqrt(r()) * rad; c.globalAlpha = 0.5 + r() * 0.5; const dot = Math.max(2.6, st.size / 7); c.fillRect(p[i][0] + Math.cos(an) * d, p[i][1] + Math.sin(an) * d, dot, dot); }
  } else if (st.tool === 'rainbow') {
    const h0 = st.seed % 360;
    for (let i = 1; i < m; i++) { c.strokeStyle = `hsl(${(h0 + i * 5) % 360} 95% 58%)`; c.beginPath(); c.moveTo(p[i - 1][0], p[i - 1][1]); c.lineTo(p[i][0], p[i][1]); c.stroke(); }
    if (m === 1) { c.fillStyle = `hsl(${h0} 95% 58%)`; c.beginPath(); c.arc(p[0][0], p[0][1], st.size / 2, 0, 7); c.fill(); }
  } else if (st.tool === 'neon') {
    c.shadowBlur = st.size * 1.4; c.shadowColor = st.color; funPath(c, p, m); c.stroke(); c.stroke();
    c.shadowBlur = 0; c.lineWidth = Math.max(2, st.size * 0.32); c.strokeStyle = '#ffffff'; funPath(c, p, m); c.stroke();
  } else {
    if (st.tool === 'marker') { c.globalAlpha = 0.45; c.lineWidth = st.size * 1.6; }
    funPath(c, p, m); c.stroke();
  }
  c.restore();
}
function funBackground(c, bg, bgImg) { if (bgImg) funCover(bgImg, c.canvas); else { c.fillStyle = bg || '#101418'; c.fillRect(0, 0, FUN_W, FUN_H); } }
const funLoadImg = url => new Promise(r => { if (!url) return r(null); const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = url; });

// The drawing pad. Strokes go out live (~4 times a second) for anyone watching in the app, and a picture of the
// canvas goes to their phone's wallpaper about every 1.6 s; Done keeps the final picture.
function funPad(room, people, bgImg = null, photoOnly = false) {
  const o = el('div', 'fun-pad'); o.setAttribute('role', 'dialog'); o.setAttribute('aria-label', 'Doodle');
  const sid = Array.from(crypto.getRandomValues(new Uint8Array(10)), b => (b % 36).toString(36)).join('');
  const canLock = people.some(p => p.lock), canHome = people.some(p => p.home);
  let target = canLock ? 'lock' : 'home', to = null, bg = '#101418', bgUrl = null, color = '#ffffff', size = 14, tool = 'pen';
  let dirty = false, busy = false, done = false, opsBusy = false, needReset = false, bgChanged = false;
  const strokes = [], sent = [];
  // header
  const head = el('div', 'fun-head');
  const x = el('button', 'icon-btn'); x.type = 'button'; x.innerHTML = svgFor('x'); x.setAttribute('aria-label', 'Close');
  const title = el('b', null, photoOnly ? 'Send a photo' : 'Doodle');
  const live = el('span', 'fun-live hidden', 'LIVE');
  head.append(x, title, live);
  const opts = el('div', 'fun-opts');
  const tsel = el('select'); tsel.setAttribute('aria-label', 'Which screen');
  for (const [v, n] of [['lock', 'Lock screen'], ['home', 'Home screen'], ['both', 'Both']]) if ((v !== 'home' || canHome) && (v !== 'lock' || canLock) && (v !== 'both' || (canLock && canHome))) tsel.append(Object.assign(document.createElement('option'), { value: v, textContent: n }));
  tsel.value = target; tsel.onchange = () => { target = tsel.value; };
  opts.append(tsel);
  if (people.length > 1) {
    const psel = el('select'); psel.setAttribute('aria-label', 'Who');
    psel.append(Object.assign(document.createElement('option'), { value: '', textContent: `Everyone (${people.length})` }));
    for (const p of people) psel.append(Object.assign(document.createElement('option'), { value: p.uid, textContent: p.name }));
    psel.onchange = () => { to = psel.value ? [psel.value] : null; }; opts.append(psel);
  } else opts.append(el('span', 'muted small', 'for ' + people[0].name));
  // canvas: background + finished strokes (ink) + the stroke being drawn
  const wrap = el('div', 'fun-canvas'); const cv = document.createElement('canvas'); cv.width = FUN_W; cv.height = FUN_H; wrap.append(cv);
  const g = cv.getContext('2d');
  const ink = Object.assign(document.createElement('canvas'), { width: FUN_W, height: FUN_H }), k = ink.getContext('2d');
  let cur = null, raf = 0;
  const compose = () => { raf = 0; funBackground(g, bg, bgImg); g.drawImage(ink, 0, 0); if (cur && cur.tool !== 'eraser') funStroke(g, cur); };
  const later = () => { if (!raf) raf = requestAnimationFrame(compose); };
  const redraw = () => { k.clearRect(0, 0, FUN_W, FUN_H); for (const st of strokes) funStroke(k, st); compose(); };
  const pos = e => { const r = cv.getBoundingClientRect(); return [Math.round((e.clientX - r.left) * FUN_W / r.width), Math.round((e.clientY - r.top) * FUN_H / r.height)]; };
  if (!photoOnly) {
    cv.onpointerdown = e => {
      e.preventDefault(); cv.setPointerCapture(e.pointerId);
      const p = pos(e);
      cur = { tool, color, size: tool === 'eraser' ? size * 2 : size, seed: Math.floor(Math.random() * 1e9), pts: FUN_SHAPES.has(tool) ? [p, p] : [p] };
      strokes.push(cur); sent.push(0); dirty = true;
      if (cur.tool === 'eraser') funStroke(k, cur);
      later();
    };
    cv.onpointermove = e => {
      if (!cur) return;
      const p = pos(e);
      if (FUN_SHAPES.has(cur.tool)) cur.pts[1] = p;
      else { const q = cur.pts[cur.pts.length - 1]; if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 3) return; cur.pts.push(p); if (cur.tool === 'eraser') funStroke(k, { ...cur, pts: cur.pts.slice(-2) }); }
      dirty = true; later();
    };
    cv.onpointerup = cv.onpointercancel = () => {
      if (!cur) return;
      if (FUN_SHAPES.has(cur.tool) && Math.hypot(cur.pts[1][0] - cur.pts[0][0], cur.pts[1][1] - cur.pts[0][1]) < 12) cur.pts[1] = [cur.pts[0][0] + 220, cur.pts[0][1] + 220];   // a tap: a default-size shape
      if (cur.tool !== 'eraser') funStroke(k, cur);
      cur = null; dirty = true; later();
    };
  }
  // tools
  const tools = el('div', 'fun-tools');
  if (!photoOnly) {
    const toolRow = el('div', 'fun-toolrow');
    const pick = (name, btn) => { tool = name; toolRow.querySelectorAll('.fun-tool').forEach(z => z.classList.toggle('on', z === btn)); };
    for (const [name, label] of FUN_BRUSHES) { const b = el('button', 'fun-tool' + (name === tool ? ' on' : ''), label); b.type = 'button'; b.onclick = () => pick(name, b); toolRow.append(b); }
    for (const [name, icon] of Object.entries(FUN_SHAPE_ICONS)) { const b = el('button', 'fun-tool shape'); b.type = 'button'; b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>`; b.setAttribute('aria-label', name); b.title = name[0].toUpperCase() + name.slice(1); b.onclick = () => pick(name, b); toolRow.append(b); }
    const sw = el('div', 'fun-swatches');
    for (const c of ['#ffffff', '#111111', '#ef4444', '#f97316', '#facc15', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899']) {
      const b = el('button', 'fun-sw' + (c === color ? ' on' : '')); b.type = 'button'; b.style.background = c; b.setAttribute('aria-label', 'Colour ' + c);
      b.onclick = () => { color = c; sw.querySelectorAll('.fun-sw').forEach(z => z.classList.toggle('on', z === b)); if (tool === 'eraser') pick('pen', toolRow.firstChild); }; sw.append(b);
    }
    const sizeRow = el('div', 'fun-row');
    const dot = el('span', 'fun-dot'); const rng = el('input'); rng.type = 'range'; rng.min = 2; rng.max = 80; rng.value = size; rng.setAttribute('aria-label', 'Brush size');
    const paintDot = () => { const d = Math.max(4, Math.min(34, size / 2.2)); dot.style.width = dot.style.height = d + 'px'; dot.style.background = color; };
    rng.oninput = () => { size = +rng.value; paintDot(); }; sw.addEventListener('click', paintDot); paintDot();
    const undo = el('button', 'btn small', 'Undo'); undo.type = 'button'; undo.onclick = () => { strokes.pop(); sent.pop(); redraw(); dirty = true; needReset = true; };
    const clear = el('button', 'btn small', 'Clear'); clear.type = 'button'; clear.onclick = () => { strokes.length = 0; sent.length = 0; redraw(); dirty = true; needReset = true; };
    sizeRow.append(dot, rng, undo, clear);
    const bgs = el('div', 'fun-bgs'); bgs.append(el('small', 'muted', 'Background'));
    for (const c of ['#101418', '#ffffff', '#fde68a', '#bfdbfe', '#fbcfe8', '#bbf7d0']) { const b = el('button', 'fun-sw small'); b.type = 'button'; b.style.background = c; b.setAttribute('aria-label', 'Background ' + c); b.onclick = () => { bg = c; bgImg = null; bgUrl = null; bgChanged = true; compose(); dirty = true; }; bgs.append(b); }
    const ph = el('button', 'btn small', 'Photo'); ph.type = 'button';
    ph.onclick = () => pickImage(async img => {
      bgImg = img; compose(); dirty = true;
      try { const c2 = funCover(img); const blob = await new Promise(r => c2.toBlob(r, 'image/jpeg', 0.8)); bgUrl = await upload(blob); bgChanged = true; } catch {}
    });
    bgs.append(ph);
    tools.append(toolRow, sw, sizeRow, bgs);
  }
  const send = el('button', 'btn primary block', photoOnly ? 'Set as their wallpaper' : 'Done — keep it on their screen'); send.type = 'button';
  tools.append(send);
  o.append(head, opts, wrap, tools); document.body.append(o);
  const layer = pushLayer(() => close());
  const close = () => { done = true; clearInterval(tick); clearInterval(opsTick); cancelAnimationFrame(raf); o.remove(); };
  x.onclick = () => closeLayer(layer, close);
  compose();
  // live strokes for people watching in the app: only what's new since the last send
  const pushOps = async () => {
    if (photoOnly || opsBusy || done) return;
    const ops = []; const reset = needReset;
    // sent[i]: freehand — how many points went out; shapes — the position last sent (resent whenever it moves)
    strokes.forEach((st, i) => {
      const base = { i, tool: st.tool, color: st.color, size: st.size, seed: st.seed };
      if (FUN_SHAPES.has(st.tool)) { const sig = st.pts.join(); if (!reset && sent[i] === sig) return; ops.push({ ...base, from: 0, pts: st.pts }); sent[i] = sig; }
      else { const from = reset ? 0 : sent[i]; if (from >= st.pts.length) return; ops.push({ ...base, from, pts: st.pts.slice(from) }); sent[i] = st.pts.length; }
    });
    if (!ops.length && !reset && !bgChanged) return;
    const body = { room, sid, target, to, ops, reset };
    if (bgChanged) { if (bgUrl) body.bgUrl = bgUrl; else body.bg = bg; }
    needReset = false; bgChanged = false; opsBusy = true;
    try { const r = await api('fun/live', body); if (r.watchers) live.classList.remove('hidden'); } catch { needReset = true; } finally { opsBusy = false; }
  };
  const opsTick = setInterval(pushOps, 250);
  // pictures for their phone's wallpaper
  const frame = async (final) => {
    if (cur) compose();
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.84));
    const url = await upload(blob);
    return api('fun/send', { room, url, target, to, sid, live: !photoOnly, final, kind: photoOnly ? 'photo' : 'doodle' });
  };
  const tick = setInterval(async () => {
    if (photoOnly || !dirty || busy || done) return;
    busy = true; dirty = false;
    try { const r = await frame(false); if (r.sent.length) live.classList.remove('hidden'); } catch {} finally { busy = false; }
  }, 1600);
  send.onclick = async () => {
    send.disabled = true; send.textContent = 'Sending…';
    while (busy || opsBusy) await new Promise(r => setTimeout(r, 80));
    await pushOps(); while (opsBusy) await new Promise(r => setTimeout(r, 80));
    done = true;
    let r; try { r = await frame(true); } catch (e) { toast(e.message); send.disabled = false; send.textContent = 'Try again'; done = false; return; }
    closeLayer(layer, close);
    toast(r.sent.length ? `On ${r.sent.join(', ')}’s ${funTargetName(target)} now` : r.skipped.length ? `Couldn’t reach ${r.skipped.join(', ')}’s phone — they need to open the latest Intra Chat Android app once` : 'Nobody here allows that screen right now');
  };
}

// Watching a doodle: live while a friend draws on your screen (strokes animate in as they arrive), or a replay from the chat
const funView = { sid: '', seq: -1, o: null, strokes: [], shown: [], prog: [], raf: 0, closed: new Set() };
function funViewer(title) {
  if (funView.o?.isConnected) { funView.o.querySelector('.fun-watch-title').textContent = title; return funView.o; }
  // a modal dialog, so it shows above any open sheet (and Back closes it like other dialogs)
  const o = document.createElement('dialog'); o.className = 'fun-watch'; o.setAttribute('aria-label', title);
  const card = el('div', 'fun-watch-card');
  const head = el('div', 'fun-head'); const t = el('b', 'fun-watch-title', title); const badge = el('span', 'fun-live', 'LIVE');
  const x = el('button', 'icon-btn'); x.type = 'button'; x.innerHTML = svgFor('x'); x.setAttribute('aria-label', 'Close');
  head.append(t, badge, x);
  const cv = document.createElement('canvas'); cv.width = FUN_W; cv.height = FUN_H; cv.className = 'fun-watch-canvas';
  const foot = el('div', 'fun-watch-foot');
  card.append(head, cv, foot); o.append(card); document.body.append(o);
  o.addEventListener('close', () => { if (funView.sid) funView.closed.add(funView.sid); cancelAnimationFrame(funView.raf); funView.raf = 0; o.remove(); funView.o = null; });
  x.onclick = () => o.close();
  o.onclick = e => { if (e.target === o) o.close(); };
  o.showModal();
  funView.o = o; funView.ctx = cv.getContext('2d');
  return o;
}
function funAnimate() {
  const v = funView; if (!v.o) return;
  let busy = false;
  const finished = i => { const st = v.strokes[i]; return !st || (FUN_SHAPES.has(st.tool) ? v.prog[i] >= 1 : v.shown[i] >= st.pts.length); };
  for (let i = 0; i < v.strokes.length; i++) {
    const st = v.strokes[i]; if (!st) continue;
    if (v.replay && i > 0 && !finished(i - 1)) break;          // replay: one stroke after another
    if (FUN_SHAPES.has(st.tool)) { if (v.prog[i] < 1) { v.prog[i] = Math.min(1, v.prog[i] + (v.replay ? 0.06 : 0.09)); busy = true; } }
    else if (v.shown[i] < st.pts.length) { v.shown[i] = Math.min(st.pts.length, v.shown[i] + Math.max(v.replay ? 1.2 : 1, (st.pts.length - v.shown[i]) / (v.replay ? 40 : 14))); busy = true; }
  }
  const c = v.ctx; funBackground(c, v.bg, v.bgImg);
  const layer = v.layer || (v.layer = Object.assign(document.createElement('canvas'), { width: FUN_W, height: FUN_H })); const k = layer.getContext('2d');
  k.clearRect(0, 0, FUN_W, FUN_H);
  v.strokes.forEach((st, i) => { if (st && (v.shown[i] > 0 || v.prog[i] > 0)) funStroke(k, st, v.shown[i] || 1, v.prog[i] || 0); });
  c.drawImage(layer, 0, 0);
  if (busy) v.raf = requestAnimationFrame(funAnimate);
  else { v.raf = 0; if (v.replay || v.done) funViewDone(); }
}
const funKick = () => { if (!funView.raf) funView.raf = requestAnimationFrame(funAnimate); };
function funViewDone() {
  const f = funView.o?.querySelector('.fun-watch-foot'); if (!f || f.childElementCount) return;
  funView.o.querySelector('.fun-live')?.classList.add('hidden');
  const again = el('button', 'btn', 'Watch again'); again.type = 'button';
  again.onclick = () => { funView.shown = funView.strokes.map(() => 0); funView.prog = funView.strokes.map(() => 0); funView.replay = true; f.innerHTML = ''; funKick(); };
  f.append(again);
}
async function funApplyBg(d) { if (d.bgUrl && d.bgUrl !== funView.bgUrl) { funView.bgUrl = d.bgUrl; funView.bgImg = await funLoadImg(d.bgUrl); } else if (!d.bgUrl && d.bg) { funView.bg = d.bg; funView.bgImg = null; funView.bgUrl = null; } }
// live doodle data from a poll
async function funLive(d) {
  if (!d?.sid || funView.closed.has(d.sid)) { if (d?.sid) { funView.sid = d.sid; funView.seq = d.seq; } return; }
  if (funView.sid !== d.sid) Object.assign(funView, { sid: d.sid, seq: -1, strokes: [], shown: [], prog: [], replay: false, done: false, bgImg: null, bgUrl: null, bg: '#101418' });
  funView.seq = d.seq; funView.done = d.done;
  if (d.reset) { funView.strokes = []; funView.shown = []; funView.prog = []; }
  for (const [i, st] of d.strokes) {
    const old = funView.strokes[i];
    funView.strokes[i] = st;
    if (!old || old.tool !== st.tool || FUN_SHAPES.has(st.tool)) { funView.shown[i] = FUN_SHAPES.has(st.tool) ? st.pts.length : 0; funView.prog[i] = FUN_SHAPES.has(st.tool) && old && FUN_SHAPES.has(old.tool) ? Math.max(0.6, funView.prog[i] || 0) : 0; }
  }
  await funApplyBg(d);
  funViewer(`${d.byName} is drawing on your ${funTargetName(d.target)}`);
  if (d.done) funView.o.querySelector('.fun-watch-title').textContent = `${d.byName} drew on your ${funTargetName(d.target)}`;
  funKick();
}
async function funReplay(sid) {
  let r; try { r = await api('fun/replay', { room: current, sid }); } catch (e) { return toast(e.message); }
  const d = r.doodle;
  Object.assign(funView, { sid: '', seq: -1, strokes: d.strokes.map(([, st]) => st), replay: true, done: true, bgImg: null, bgUrl: null, bg: '#101418' });
  funView.shown = funView.strokes.map(() => 0); funView.prog = funView.strokes.map(() => 0);
  await funApplyBg(d);
  funViewer(`${d.byName}’s doodle`); funView.o.querySelector('.fun-live')?.classList.add('hidden');
  funKick();
}

/* ---------------- Hidden chats & privacy mode ---------------- */
let privacyState = { hasPin: false }, hiddenOpen = false, leftAt = 0;
async function loadPrivacy() { try { privacyState = await api('privacy/hidden', { room: 'general' }); } catch {} }
const askPin = (title, text, ok = 'Unlock') => popup({ icon: 'lock', title, text, ok, input: { type: 'password', placeholder: 'PIN', maxLength: 8, required: true, requiredMsg: 'Enter your PIN' } });
async function setNewPin() {
  const a = await popup({ icon: 'lock', title: 'Create a PIN', text: 'Choose 4–8 digits. You’ll need it to open your hidden chats on any device.', ok: 'Next',
    input: { type: 'password', placeholder: 'New PIN', maxLength: 8, required: true }, onConfirm: async v => /^\d{4,8}$/.test(v) ? null : 'Use 4–8 digits' });
  if (a === null) return false;
  const b = await popup({ icon: 'lock', title: 'Confirm PIN', ok: 'Save PIN', input: { type: 'password', placeholder: 'Type it again', maxLength: 8, required: true },
    onConfirm: async v => { if (v !== a) return 'PINs don’t match'; try { privacyState = await api('privacy/pin', { room: 'general', pin: v }); return null; } catch (e) { return e.message; } } });
  if (b === null) return false;
  toast('PIN saved'); return true;
}
async function unlockHidden() {
  if (hiddenOpen) return true;
  const bio = await hiddenBioProof('Open hidden chats');
  if (bio) { try { await api('privacy/unlock', { room: 'general', bio }); hiddenOpen = true; return true; } catch (e) { toast(e.message); } }
  const v = await popup({ icon: 'lock', title: 'Hidden chats', text: 'Enter your PIN.', ok: 'Unlock', input: { type: 'password', placeholder: 'PIN', maxLength: 8, required: true, requiredMsg: 'Enter your PIN' },
    onConfirm: async x => { try { await api('privacy/unlock', { room: 'general', pin: x }); return null; } catch (e) { return e.message; } } });
  if (v === null) return false;
  hiddenOpen = true; return true;
}
async function openHidden() {
  if (!privacyState.hasPin) {
    const go = await popup({ icon: 'lock', title: 'Hidden chats', text: 'Hide chats you want to keep private. They disappear from your chat list, counts and search, notifications say only “New message”, and they open only with your PIN.', ok: 'Set a PIN' });
    if (!go || !(await setNewPin())) return;
  }
  if (!(await unlockHidden())) return;
  roomFilter = 'hidden';
  document.querySelectorAll('#filterChips .chip-btn').forEach(x => x.classList.remove('on'));
  setTab('chats'); renderRooms();
}
function lockHidden() {
  hiddenOpen = false;
  if (roomFilter === 'hidden') { roomFilter = 'all'; document.querySelectorAll('#filterChips .chip-btn').forEach(x => x.classList.toggle('on', x.dataset.filter === 'all')); }
  if (current && roomInfo(current)?.hidden) { dropLayer(chatLayer); closeChatUI(); }
  renderRooms();
}
async function hideChat(room, on) {
  if (on) {
    if (!privacyState.hasPin && !(await setNewPin())) return;
    try { privacyState = await api('privacy/hide', { room, on: true }); } catch (e) { return toast(e.message); }
    roomInfo(room).hidden = true; toast('Chat hidden — open it from the menu → Hidden chats');
    hiddenOpen = false; dropLayer(chatLayer); closeChatUI(); renderRooms();
  } else {
    const bio = await hiddenBioProof('Unhide this chat');
    let pin = null;
    if (!bio) { pin = await askPin('Unhide this chat?', 'Enter your PIN to move it back to your chat list.', 'Unhide'); if (pin === null) return; }
    try { privacyState = await api('privacy/hide', bio ? { room, on: false, bio } : { room, on: false, pin }); } catch (e) { return toast(e.message); }
    roomInfo(room).hidden = false; toast('Chat is back in your list'); renderRooms();
  }
}
async function changeHiddenPin() {
  const old = await askPin('Change PIN', 'Enter your current PIN.', 'Next'); if (old === null) return;
  const nw = await popup({ icon: 'lock', title: 'New PIN', text: '4–8 digits.', ok: 'Save', input: { type: 'password', placeholder: 'New PIN', maxLength: 8, required: true },
    onConfirm: async v => { if (!/^\d{4,8}$/.test(v)) return 'Use 4–8 digits'; try { privacyState = await api('privacy/pin', { room: 'general', pin: v, old }); return null; } catch (e) { return e.message; } } });
  if (nw !== null) toast('PIN changed');
}

/* ---------------- Fingerprint / face (passkeys in the browser, BiometricPlugin in the Android app) ---------------- */
let bioBusy = false, lockSkip = false;
const b64uEnc = buf => { let s = ''; for (const c of new Uint8Array(buf)) s += String.fromCharCode(c); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const b64uDec = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
const bioNat = (m, a = {}) => window.Capacitor.nativePromise('Biometric', m, a);
const bioCancelled = e => e?.code === 'CANCELLED' || e?.name === 'NotAllowedError' || e?.name === 'AbortError';
async function bioStatus() {        // { available, strong } — strong: can be used for hidden chats
  try {
    if (nativeApp()) return await bioNat('status');
    const ok = !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
    return { available: ok, strong: ok };
  } catch { return { available: false, strong: false }; }
}
const bioKeyName = () => `ic-bio-${me.uid}`;
const bioLocal = () => store.json(bioKeyName(), null);        // this device's key: { id, kind, spki? }
async function bioRun(fn) { bioBusy = true; try { return await fn(); } finally { setTimeout(() => { bioBusy = false; }, 800); } }
// Make this device's key (browser passkey or Android Keystore key). The public key goes to the server for hidden chats.
async function bioCreate() {
  if (nativeApp()) { const alias = `hidden-${me.uid}-${Date.now().toString(36)}`; const r = await bioNat('createKey', { alias }); return { id: alias, kind: 'android', spki: r.publicKey }; }
  const cred = await bioRun(() => navigator.credentials.create({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)), rp: { name: 'Intra Chat', id: location.hostname },
    user: { id: new TextEncoder().encode(me.uid), name: me.username || me.name, displayName: me.name },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' }, timeout: 60000, attestation: 'none' } }));
  const spki = cred.response.getPublicKey?.();
  if (!spki) throw new Error('This browser can’t do fingerprint unlock — try Chrome or Safari');
  return { id: cred.id, kind: 'webauthn', spki: b64uEnc(spki) };
}
// Sign a server challenge with this device's key after fingerprint/face → proof for privacy/unlock and privacy/hide
async function bioProve(dev, title) {
  const { challenge } = await api('privacy/bio/challenge', { room: 'general' });
  if (dev.kind === 'android') { const r = await bioRun(() => bioNat('sign', { alias: dev.id, challenge, title, cancel: 'Use PIN' })); return { id: dev.id, sig: r.signature }; }
  const a = await bioRun(() => navigator.credentials.get({ publicKey: { challenge: b64uDec(challenge), rpId: location.hostname, allowCredentials: [{ type: 'public-key', id: b64uDec(dev.id) }], userVerification: 'required', timeout: 60000 } }));
  return { id: dev.id, authData: b64uEnc(a.response.authenticatorData), clientData: b64uEnc(a.response.clientDataJSON), sig: b64uEnc(a.response.signature) };
}
// Fingerprint/face just to open the app (checked on the device, like WhatsApp)
async function bioLocalCheck(title = 'Unlock Intra Chat') {
  if (nativeApp()) { await bioRun(() => bioNat('verify', { title })); return true; }
  const dev = bioLocal(); if (!dev) throw new Error('Fingerprint unlock isn’t set up in this browser');
  const a = await bioRun(() => navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), rpId: location.hostname, allowCredentials: [{ type: 'public-key', id: b64uDec(dev.id) }], userVerification: 'required', timeout: 60000 } }));
  return !!a && (new Uint8Array(a.response.authenticatorData)[32] & 0x04) === 0x04;
}

// Hidden chats with fingerprint / face
const hiddenBioOn = () => { const d = bioLocal(); return !!(d && (privacyState.bio || []).some(b => b.id === d.id)); };
async function hiddenBioProof(title) {           // null → use the PIN instead
  if (!hiddenBioOn()) return null;
  try { return await bioProve(bioLocal(), title); }
  catch (e) {
    if (e?.code === 'KEY_CHANGED' || e?.code === 'NO_KEY') { store.del(bioKeyName()); toast(e.message); }
    else if (!bioCancelled(e)) toast(e.message || 'Fingerprint didn’t work — use your PIN');
    return null;
  }
}
async function toggleHiddenBio() {
  if (hiddenBioOn()) {
    const d = bioLocal();
    try { privacyState = await api('privacy/bio/remove', { room: 'general', id: d.id }); } catch (e) { return toast(e.message); }
    if (d.kind === 'android') bioNat('deleteKey', { alias: d.id }).catch(() => {});
    if (!appLock().bio) store.del(bioKeyName());
    toast('Hidden chats now open with your PIN only'); return renderSettings();
  }
  const st = await bioStatus();
  if (!st.strong) return popup({ icon: 'fingerprint', title: 'Not available here', text: nativeApp() ? 'Set up a fingerprint (or a screen lock PIN) in your phone’s settings first. Face unlock works for hidden chats only on phones with secure face unlock.' : 'This browser or computer has no fingerprint, face or Windows Hello unlock.', ok: 'OK', cancel: '' });
  const pin = await askPin('Use fingerprint / face', 'Enter your hidden-chats PIN to turn this on for this device.', 'Next');
  if (pin === null) return;
  try {
    const dev = bioLocal()?.kind === (nativeApp() ? 'android' : 'webauthn') && bioLocal().spki ? bioLocal() : await bioCreate();
    privacyState = await api('privacy/bio/add', { room: 'general', pin, ...dev, label: nativeApp() ? 'Android app' : (/(iPhone|iPad|Android|Mac|Windows)/.exec(navigator.userAgent)?.[1] || 'Browser') });
    store.setJson(bioKeyName(), dev);
    toast('Hidden chats open with your fingerprint / face on this device');
  } catch (e) { if (!bioCancelled(e)) toast(e.message); }
  renderSettings();
}

/* ---------------- App lock (code + fingerprint / face, checked on this device) ---------------- */
const APP_LOCK_AFTER = { 0: 'immediately', 60000: 'after 1 minute', 1800000: 'after 30 minutes' };
const appLock = () => store.json('ic-applock', {}) || {};
const appLockOn = () => !!appLock().on && !!me?.token;
let appLockShown = false, lockTries = { n: 0, until: 0 };
async function hashCode(code, salt) {
  const data = new TextEncoder().encode(salt + ':' + code);
  if (crypto.subtle) { const k = await crypto.subtle.importKey('raw', data, 'PBKDF2', false, ['deriveBits']); return b64uEnc(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 120000, hash: 'SHA-256' }, k, 256)); }
  let h = 0x811c9dc5; for (let r = 0; r < 20000; r++) for (const b of data) { h ^= b + r; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36);   // plain-http LAN fallback
}
async function newAppCode(title = 'Create an app code') {
  const a = await popup({ icon: 'lock', title, text: '4–8 digits. You’ll use it when fingerprint / face doesn’t work.', ok: 'Next', input: { type: 'password', inputmode: 'numeric', placeholder: 'New code', maxLength: 8, required: true }, onConfirm: async v => /^\d{4,8}$/.test(v) ? null : 'Use 4–8 digits' });
  if (a === null) return null;
  const b = await popup({ icon: 'lock', title: 'Confirm code', ok: 'Save', input: { type: 'password', inputmode: 'numeric', placeholder: 'Type it again', maxLength: 8, required: true }, onConfirm: async v => v === a ? null : 'Codes don’t match' });
  if (b === null) return null;
  const salt = b64uEnc(crypto.getRandomValues(new Uint8Array(12)));
  return { salt, hash: await hashCode(a, salt) };
}
const checkAppCode = async v => { const l = appLock(); return !!l.hash && await hashCode(v, l.salt) === l.hash; };
async function confirmAppLockOwner(why) {        // fingerprint/face or the code, before changing app-lock settings
  if (appLock().bio) { try { if (await bioLocalCheck(why)) return true; } catch (e) { if (!bioCancelled(e)) toast(e.message); } }
  const v = await popup({ icon: 'lock', title: why, text: 'Enter your app code.', ok: 'OK', input: { type: 'password', inputmode: 'numeric', placeholder: 'App code', maxLength: 8, required: true }, onConfirm: async x => (await checkAppCode(x)) ? null : 'Wrong code' });
  return v !== null;
}
async function enableAppBio() {
  const st = await bioStatus();
  if (!st.available) { toast(nativeApp() ? 'Set up a fingerprint or face unlock in your phone’s settings first' : 'This browser has no fingerprint / face unlock'); return false; }
  try {
    if (!nativeApp() && !bioLocal()) store.setJson(bioKeyName(), await bioCreate());
    if (!(await bioLocalCheck('Confirm it’s you'))) return false;
    return true;
  } catch (e) { if (!bioCancelled(e)) toast(e.message); return false; }
}
function openAppLockSettings() {
  const { d, inner } = sheet('appLockSheet', 'App lock');
  const paint = async () => {
    [...inner.children].slice(1).forEach(n => n.remove());
    const l = appLock(), st = await bioStatus();
    inner.append(el('p', 'muted small', 'When it’s on, Intra Chat asks for your fingerprint, face or app code each time you open it. Notifications still arrive.'));
    const sw = (label, sub, on, fn) => { const r = el('button', 'al-row'); r.type = 'button'; const t = el('div'); t.append(el('b', null, label), sub ? el('small', null, sub) : ''); const k = el('span', 'al-switch' + (on ? ' on' : '')); r.append(t, k); r.onclick = fn; inner.append(r); };
    sw('App lock', l.on ? 'On' : 'Off', !!l.on, async () => {
      if (l.on) { if (!(await confirmAppLockOwner('Turn off app lock'))) return; store.setJson('ic-applock', {}); toast('App lock off'); }
      else {
        const c = await newAppCode(); if (!c) return;
        const next = { on: true, ...c, after: 0, bio: false };
        store.setJson('ic-applock', next);
        if (st.available && await popup({ icon: 'fingerprint', title: 'Use fingerprint / face too?', text: 'Unlock with your fingerprint or face; the code is the backup.', ok: 'Use fingerprint / face', cancel: 'Code only' })) next.bio = await enableAppBio();
        store.setJson('ic-applock', next); toast('App lock on');
      }
      paint(); renderSettings();
    });
    if (!l.on) return;
    if (st.available) sw('Unlock with fingerprint / face', l.bio ? 'On' : 'Off', !!l.bio, async () => {
      const nx = appLock();
      if (nx.bio) nx.bio = false; else { if (!(await confirmAppLockOwner('Use fingerprint / face'))) return; nx.bio = await enableAppBio(); }
      store.setJson('ic-applock', nx); paint(); renderSettings();
    });
    const box = el('div', 'al-after'); box.append(el('b', null, 'Lock automatically'));
    const chips = el('div', 'gs-chips');
    for (const [ms, name] of Object.entries(APP_LOCK_AFTER)) { const c = el('button', 'chip-btn' + (+ms === (l.after || 0) ? ' on' : ''), name[0].toUpperCase() + name.slice(1)); c.type = 'button'; c.onclick = () => { store.setJson('ic-applock', { ...appLock(), after: +ms }); paint(); renderSettings(); }; chips.append(c); }
    box.append(chips); inner.append(box);
    const ch = el('button', 'btn block', 'Change app code'); ch.type = 'button';
    ch.onclick = async () => { if (!(await confirmAppLockOwner('Change app code'))) return; const c = await newAppCode('New app code'); if (c) { store.setJson('ic-applock', { ...appLock(), ...c }); toast('Code changed'); } };
    inner.append(ch);
  };
  paint(); if (!d.open) d.showModal();
}
function showAppLock() {
  if (appLockShown || !appLockOn()) return;
  appLockShown = true;
  document.querySelectorAll('dialog[open]').forEach(x => { if (x.id !== 'appLockSheet') x.close?.(); });
  const o = el('div', 'app-lock'); o.id = 'appLock'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-label', 'Intra Chat is locked');
  const box = el('div', 'al-box');
  box.append(icoEl('lock', 'al-ic'), el('h2', null, 'Intra Chat is locked'));
  const msg = el('p', 'al-msg', appLock().bio ? 'Use your fingerprint or face, or enter your code' : 'Enter your app code');
  const f = el('form', 'al-form'); const inp = el('input'); inp.type = 'password'; inp.inputMode = 'numeric'; inp.autocomplete = 'off'; inp.maxLength = 8; inp.placeholder = 'App code'; inp.setAttribute('aria-label', 'App code');
  const go = el('button', 'btn primary', 'Unlock'); go.type = 'submit'; f.append(inp, go);
  const unlock = () => { o.classList.add('out'); setTimeout(() => o.remove(), 200); appLockShown = false; lockTries = { n: 0, until: 0 }; leftAt = Date.now(); };
  f.onsubmit = async e => {
    e.preventDefault(); if (!inp.value) return;
    if (lockTries.until > Date.now()) { msg.textContent = `Too many tries — wait ${Math.ceil((lockTries.until - Date.now()) / 1000)} s`; return; }
    if (await checkAppCode(inp.value)) return unlock();
    lockTries.n++; if (lockTries.n >= 5) { lockTries = { n: 0, until: Date.now() + 30_000 }; }
    msg.textContent = 'Wrong code'; msg.classList.add('bad'); inp.value = ''; inp.classList.remove('wrong'); void inp.offsetWidth; inp.classList.add('wrong'); if (navigator.vibrate) navigator.vibrate(80);
  };
  box.append(msg, f);
  if (appLock().bio) {
    const b = el('button', 'btn block al-bio'); b.type = 'button'; b.append(icoEl('fingerprint'), 'Use fingerprint / face');
    b.onclick = async () => { try { if (await bioLocalCheck()) unlock(); } catch (e) { if (!bioCancelled(e)) { msg.textContent = e.message || 'Didn’t work — enter your code'; msg.classList.add('bad'); } } };
    box.append(b);
    if (nativeApp()) setTimeout(() => b.click(), 350);          // Android: show the fingerprint prompt straight away
  }
  const out = el('button', 'link-btn al-forgot', 'Forgot code? Sign out'); out.type = 'button';
  out.onclick = async () => { if (await popup({ icon: 'logout', title: 'Sign out?', text: 'App lock is turned off and you sign in again with your username and password. Your chats stay on your account.', ok: 'Sign out', danger: true })) { store.setJson('ic-applock', {}); o.remove(); appLockShown = false; signOut(true); } };
  box.append(out); o.append(box); document.body.append(o);
  if (!nativeApp()) setTimeout(() => inp.focus(), 100);
}

// Privacy mode: blur message text, photos and previews; tap a message to read it for a few seconds
const privacyOn = () => store.get('ic-privacy') === '1';
function applyPrivacy() { document.documentElement.toggleAttribute('data-privacy', privacyOn()); const b = $('privacyBtn'); if (b) { b.innerHTML = svgFor(privacyOn() ? 'eyeOff' : 'eye'); b.classList.toggle('on', privacyOn()); b.title = privacyOn() ? 'Privacy mode is on (tap to turn off)' : 'Privacy mode'; } }
function togglePrivacy() {
  store.set('ic-privacy', privacyOn() ? '0' : '1'); applyPrivacy(); renderSettings();
  toast(privacyOn() ? 'Privacy mode on — tap a message to read it' : 'Privacy mode off');
}
{
  // eye button in the chat header
  const b = document.createElement('button'); b.className = 'icon-btn'; b.id = 'privacyBtn'; b.type = 'button'; b.setAttribute('aria-label', 'Privacy mode');
  b.onclick = togglePrivacy; $('walkieBtn').before(b);
  // tap to peek at one message (re-blurs after 5 s)
  $('messages').addEventListener('click', e => {
    if (!privacyOn()) return;
    const m = e.target.closest('.msg, .sys-msg'); if (!m || e.target.closest('button, a, .voice')) return;
    m.classList.add('peek'); clearTimeout(m._peekT); m._peekT = setTimeout(() => m.classList.remove('peek'), 5000);
  });
  // leaving the app: cover the screen (recent-apps preview) and re-lock hidden chats after a minute away
  const cover = document.createElement('div'); cover.className = 'privacy-cover'; cover.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + IC.lock + '</svg><b>Intra Chat</b>'; document.body.append(cover);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { leftAt = Date.now(); document.documentElement.toggleAttribute('data-covered', privacyOn() || hiddenOpen || appLockOn()); }
    else {
      if (hiddenOpen && Date.now() - leftAt > 60_000) lockHidden();
      if (appLockOn() && !bioBusy && !lockSkip && me?.token && Date.now() - leftAt >= (appLock().after || 0)) showAppLock();
      lockSkip = false;
      setTimeout(() => document.documentElement.removeAttribute('data-covered'), 150);
    }
  });
  window.addEventListener('pagehide', () => { if (privacyOn() || hiddenOpen || appLockOn()) document.documentElement.setAttribute('data-covered', ''); });
  // picking a photo/file leaves the page for a moment: that shouldn't trigger the app lock
  document.addEventListener('click', e => { if (e.target.closest?.('input[type=file], label[for]') || e.target.matches?.('input[type=file]')) lockSkip = true; }, true);
  applyPrivacy();
}

/* ---------------- Challenges (step challenges with points, tasks and a live leaderboard) ---------------- */
const chView = { id: null, layer: null, all: false, data: null };
const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
const fmtDay = d => { const t = new Date(d + 'T12:00:00'); return `${ordinal(t.getDate())} ${t.toLocaleDateString('en-US', { month: 'short' })}`; };
const STATUS_TXT = { live: 'Live', upcoming: 'Starts soon', ended: 'Ended', draft: 'Not published' };
async function loadChallenges() {
  const body = $('challengesBody'); if (!body) return;
  $('chTitle').textContent = 'Challenges'; $('chSub').textContent = 'Step challenges for your team';
  $('newChallengeBtn').classList.remove('hidden');
  let list; try { list = (await api('challenge/list', { room: 'general', today: localDay() })).challenges; } catch (e) { body.replaceChildren(el('p', 'empty-note', e.message)); return; }
  if (currentTab !== 'challenges' || chView.id) return;
  body.innerHTML = '';
  if (!list.length) {
    const e = el('div', 'empty-note'); e.append(icoEl('trophy', 'big'), 'No challenges yet. Tap + to create one — set dates, a steps target, points and daily tasks, and invite your team.');
    body.append(e); return;
  }
  for (const c of list) {
    const card = el('button', 'ch-card'); card.type = 'button'; card.onclick = () => openChallenge(c.id);
    const ban = el('div', 'ch-banner'); if (okPhoto(c.banner)) ban.style.backgroundImage = `url("${c.banner}")`; else ban.classList.add('plain');
    ban.append(el('span', 'ch-status s-' + c.status, STATUS_TXT[c.status]));
    const meta = el('div', 'ch-meta');
    meta.append(el('b', null, c.title));
    const line = el('div', 'ch-line'); line.append(icoText('calendar', `${fmtDay(c.start)} – ${fmtDay(c.end)}`), icoText('users', `${c.participants}`));
    if (c.joined) line.append(el('span', 'chip ok', 'Joined'));
    meta.append(line);
    card.append(ban, meta); body.append(card);
  }
}
async function openChallenge(id, keepScroll) {
  chView.id = id;
  if (!layerLive(chView.layer)) chView.layer = pushLayer(() => { chView.id = null; chView.all = false; loadChallenges(); });
  if (currentTab !== 'challenges') setTab('challenges');
  const body = $('challengesBody');
  if (!keepScroll) { body.innerHTML = ''; body.append(el('p', 'muted small empty-note', 'Loading…')); }
  try { chView.data = await api('challenge/get', { room: 'general', id, all: chView.all, today: localDay(), tz: new Date().getTimezoneOffset() }); }
  catch (e) { toast(e.message); closeLayer(chView.layer, () => { chView.id = null; loadChallenges(); }); return; }
  renderChallenge(keepScroll);
}
function renderChallenge(keepScroll) {
  const d = chView.data, c = d.challenge, a = c.activity, body = $('challengesBody'), scroll = body.scrollTop;
  $('chTitle').textContent = c.title; $('chSub').textContent = `${STATUS_TXT[c.status]} · by ${c.mine ? 'you' : c.createdName}`;
  $('newChallengeBtn').classList.add('hidden');
  body.innerHTML = '';
  // back row
  const back = el('button', 'ch-back'); back.type = 'button'; back.append(icoEl('arrowLeft'), 'All challenges'); back.onclick = () => closeLayer(chView.layer, () => { chView.id = null; chView.all = false; loadChallenges(); });
  body.append(back);
  // info card
  const info = el('div', 'ch-info');
  info.append(icoText('calendar', `${fmtDay(c.start)} – ${fmtDay(c.end)}`), icoText('users', `${c.participants}`), el('span', 'ch-status s-' + c.status, STATUS_TXT[c.status]));
  body.append(info);
  if (okPhoto(c.banner)) { const im = el('img', 'ch-hero'); im.src = c.banner; im.alt = c.title; im.onclick = () => viewPhoto(c.banner); body.append(im); }
  if (c.desc) body.append(el('p', 'ch-desc', c.desc));
  // join / manage
  const acts = el('div', 'ch-acts');
  if (!d.joined && c.status !== 'ended') { const j = el('button', 'btn primary', 'Join challenge'); j.type = 'button'; j.onclick = async () => { try { await api('challenge/join', { room: 'general', id: c.id, today: localDay(), tz: new Date().getTimezoneOffset() }); toast(`You joined ${c.title}`); openChallenge(c.id); } catch (e) { toast(e.message); } }; acts.append(j); }
  if (c.mine) {
    const e1 = el('button', 'btn', 'Edit'); e1.type = 'button'; e1.onclick = () => openChallengeForm(c); acts.append(e1);
    const e2 = el('button', 'btn ghost', 'Delete'); e2.type = 'button'; e2.onclick = () => deleteChallenge(c); acts.append(e2);
  } else if (d.joined) { const l = el('button', 'btn ghost', 'Leave'); l.type = 'button'; l.onclick = () => leaveChallenge(c); acts.append(l); }
  if (acts.childElementCount) body.append(acts);
  // my ranking
  const me1 = d.board.me;
  const mr = el('div', 'ch-sec'); const mh = el('div', 'ch-sec-head'); mh.append(el('h3', null, 'My Ranking'));
  const rf = el('button', 'btn small', 'Refresh'); rf.type = 'button'; rf.onclick = async () => { rf.disabled = true; try { if (healthStatus?.connected) await syncHealthNow(true); chView.data = await api('challenge/refresh', { room: 'general', id: c.id, all: chView.all, today: localDay() }); renderChallenge(true); toast('Leaderboard updated'); } catch (e) { toast(e.message); rf.disabled = false; } };
  if (d.joined) {
    const bell = el('button', 'icon-btn ch-bell' + (d.notify ? ' on' : '')); bell.type = 'button'; bell.innerHTML = svgFor(d.notify ? 'bell' : 'bellOff');
    bell.title = d.notify ? 'Challenge reminders on (max 2 a day)' : 'Challenge reminders off'; bell.setAttribute('aria-label', bell.title);
    bell.onclick = async () => { try { const r = await api('challenge/notify', { room: 'general', id: c.id, on: !d.notify }); d.notify = r.notify; toast(r.notify ? 'Reminders on — at most 2 a day, 8 AM–9 PM' : 'Reminders off for this challenge'); if (r.notify && !pushActive) enableNotifications(); renderChallenge(true); } catch (e) { toast(e.message); } };
    mh.append(bell);
  }
  mh.append(rf); mr.append(mh);
  const tiles = el('div', 'ch-tiles');
  const tile = (cls, label, val) => { const t = el('div', 'ch-tile ' + cls); t.append(el('small', null, label), el('b', null, val)); tiles.append(t); };
  tile('steps', 'Steps', fmtN(me1?.steps || 0)); tile('rank', 'My Rank', me1 ? String(me1.rank) : '–'); tile('pts', 'Points', fmtN(me1?.points || 0));
  mr.append(tiles);
  if (d.mine) {
    const lv = d.mine.level, lc = el('button', 'ch-level lv-' + lv.idx); lc.type = 'button'; lc.onclick = () => openPointsHistory(c);
    const badge = el('div', 'lv-badge'); badge.innerHTML = svgFor('trophy');
    const mid = el('div', 'lv-mid');
    const top = el('div', 'lv-top'); top.append(el('b', null, `${lv.name} level`));
    if (d.mine.streak) { const f = el('span', 'lv-streak'); f.append(icoEl('flame'), `${d.mine.streak}-day streak`); top.append(f); }
    mid.append(top);
    if (lv.next) {
      const span = Math.max(1, lv.next.min - lv.min), pct = Math.min(1, ((me1?.points || 0) - lv.min) / span);
      const bar = el('div', 'lv-bar'); const f = el('i'); f.style.width = pct * 100 + '%'; bar.append(f);
      mid.append(bar, el('small', null, `${fmtN(Math.max(0, lv.next.min - (me1?.points || 0)))} points to ${lv.next.name}`));
    } else mid.append(el('small', null, 'Top level reached!'));
    const hb = el('span', 'lv-hist'); hb.append(icoEl('clock'), 'Points history');
    lc.append(badge, mid, hb); mr.append(lc);
    if (d.mine.todayPts) mr.append(el('p', 'muted small ch-today-pts', `+${fmtN(d.mine.todayPts)} points so far today`));
  }
  if (d.joined && c.status === 'live' && a.target) {
    const p = el('div', 'ch-target'); const pct = Math.min(1, d.period / a.target);
    p.append(el('div', 'ct-label', `${a.per === 'week' ? 'This week' : 'Today'}: ${fmtN(d.period)} / ${fmtN(a.target)} steps${pct >= 1 ? ' · target reached!' : ''}`));
    const bar = el('div', 'ct-bar'); const f = el('i'); f.style.width = pct * 100 + '%'; if (pct >= 1) f.classList.add('done'); bar.append(f); p.append(bar);
    mr.append(p);
  }
  const syncText = healthStatus?.connected ? `Steps sync from Google Health every 15 minutes${healthStatus.lastSync ? ` · last ${agoText(healthStatus.lastSync)}` : ''}.` : 'Steps come from walk mode, Google Health or the Android app (every 15 minutes), or add them in Settings → My steps.';
  mh.querySelector('h3').append(infoTip(syncText, 'Where steps come from'));
  body.append(mr);
  // daily tasks
  if (c.game && d.gameToday) {
    const gt = d.gameToday, info = CG_INFO[c.game.kind];
    const gs = el('div', 'ch-sec'); const gh = el('h3'); gh.append('Today’s game', infoTip(`${info.how} ${c.game.ptsPer} point${c.game.ptsPer === 1 ? '' : 's'} per ${info.unit}; ${c.game.mode === 'sum' ? 'all plays add up' : 'your best play of the day counts'}. ${c.game.perDay} play${c.game.perDay > 1 ? 's' : ''} a day — leaving a game uses up the play.`, 'How the game works')); gs.append(gh);
    const card = el('div', 'cg-card'); card.append(icoEl('sparkles', 'cg-ic'));
    const mid = el('div', 'cg-mid'); mid.append(el('b', null, info.name), el('small', null, gt.best !== null ? `Best today ${fmtN(gt.best)} · ${gt.playsLeft} play${gt.playsLeft === 1 ? '' : 's'} left` : `${gt.playsLeft} play${gt.playsLeft === 1 ? '' : 's'} left today`));
    if (c.gameRecord) mid.append(el('small', 'cg-rec', `Record: ${c.gameRecord.uid === me.uid ? 'you' : c.gameRecord.name} · ${fmtN(c.gameRecord.score)}`));
    card.append(mid);
    const pb = el('button', 'btn primary small', gt.playsLeft ? 'Play' : 'Done'); pb.type = 'button'; pb.disabled = !gt.playsLeft || !d.joined || c.status !== 'live';
    pb.onclick = () => playChallengeGame(c); card.append(pb); gs.append(card);
    if (!d.joined) gs.append(el('small', 'muted', 'Join the challenge to play.'));
    body.append(gs);
  }
  if (c.tasks.length) {
    const ts = el('div', 'ch-sec'); ts.append(el('h3', null, 'Daily tasks'));
    for (const t of d.tasks) {
      const r = el('div', 'ch-task' + (t.done ? ' done' : ''));
      const box = el('button', 'ct-check'); box.type = 'button'; box.innerHTML = t.done ? svgFor('check') : '';
      box.setAttribute('aria-label', t.done ? 'Done' : 'Mark done');
      if (t.kind === 'check' && d.joined && c.status === 'live') box.onclick = async () => { try { await api('challenge/task', { room: 'general', id: c.id, task: t.id, done: !t.done, today: localDay() }); if (!t.done) toast(`+${t.points} points`); openChallenge(c.id, true); } catch (e) { toast(e.message); } };
      else box.disabled = true;
      const m = el('div', 'ct-mid'); m.append(el('b', null, t.title));
      m.append(el('small', null, t.kind === 'steps' ? `${fmtN(t.progress)} / ${fmtN(t.target)} steps · completes automatically` : 'Tick it when you’ve done it'));
      r.append(box, m, el('span', 'ct-pts', `+${t.points}`)); ts.append(r);
    }
    body.append(ts);
  }
  // how points work
  const rules = el('details', 'ch-sec ch-rules'); rules.append(el('summary', null, 'How points work'));
  const ul = el('ul');
  ul.append(el('li', null, `${a.points} point${a.points === 1 ? '' : 's'} for every ${fmtN(a.every)} steps`));
  if (a.target) ul.append(el('li', null, `Target: ${fmtN(a.target)} steps a ${a.per}${a.bonus ? ` · +${a.bonus} bonus points each ${a.per} you reach it` : ''}`));
  if (a.cap) ul.append(el('li', null, `Daily step cap: only the first ${fmtN(a.cap)} steps each day count`));
  if (c.game) ul.append(el('li', null, `Game: ${CG_INFO[c.game.kind].name} — ${c.game.ptsPer} pts per ${CG_INFO[c.game.kind].unit}, ${c.game.mode === 'sum' ? 'all plays add up' : 'best play of the day'}, ${c.game.perDay} a day`));
  ul.append(el('li', null, `Tie-breaker: ${{ steps: 'more steps', days: `more ${a.per === 'week' ? 'weeks' : 'days'} hitting the target`, joined: 'joined first' }[c.tiebreak]}`));
  ul.append(el('li', null, `Publish ${fmtDay(c.publishAt)} · runs ${fmtDay(c.start)} – ${fmtDay(c.end)}`));
  rules.append(ul); body.append(rules);
  // leaderboard
  const lb = el('div', 'ch-sec'); const lh = el('div', 'ch-sec-head');
  const t = el('h3'); t.append('Leaderboard', el('small', null, ` · Updated at ${new Date(d.board.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)); lh.append(t);
  if (c.game) {
    const sg = el('div', 'seg small ch-lbmode');
    for (const [v, t2] of [['all', 'Overall'], ['game', 'Game']]) { const b = el('button', (chView.mode || 'all') === v ? 'on' : '', t2); b.type = 'button'; b.onclick = () => { chView.mode = v; renderChallenge(true); }; sg.append(b); }
    lb.append(sg);
  }
  if (d.board.total > 10) { const sa = el('button', 'btn small', chView.all ? 'Top 10' : 'See all'); sa.type = 'button'; sa.onclick = () => { chView.all = !chView.all; openChallenge(c.id, true); }; lh.append(sa); }
  lb.append(lh);
  const rowEl = (r, pin) => {
    const row = el('div', 'ch-row' + (r.uid === me.uid ? ' me' : '') + (pin ? ' pin' : ''));
    const rk = el('div', 'cr-rank'); rk.append(el('b', null, String(r.rank)));
    if (r.prev && r.prev !== r.rank) { const up = r.prev > r.rank; const mv = el('span', 'cr-move ' + (up ? 'up' : 'down')); mv.innerHTML = `<svg viewBox="0 0 24 24"><path d="${up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'}"/></svg>`; mv.append(String(Math.abs(r.prev - r.rank))); rk.append(mv); }
    const av = el('div', 'avatar'); paintAvatar(av, r.name, { photo: r.photo });
    const m = el('div', 'cr-mid'); m.append(el('b', null, r.uid === me.uid ? `${r.name} (you)` : r.name));
    const st = el('small'); st.append(icoEl('footprints'), `${fmtN(r.steps)} steps`);
    if (r.level) st.append(el('span', 'cr-lv lv-' + r.level, (d.levels || [])[r.level] || ''));
    if (r.streak > 1) { const f = el('span', 'cr-streak'); f.append(icoEl('flame'), String(r.streak)); st.append(f); }
    m.append(st);
    row.tabIndex = 0; row.setAttribute('role', 'button'); row.onclick = () => r.uid === me.uid ? openPointsHistory(c) : openMemberCard(c, r.uid);
    row.append(rk, av, m, el('div', 'cr-pts', r._game ? `${fmtN(r.gameBest)}\nbest` : `${fmtN(r.points)}\npts`));
    return row;
  };
  if (!d.board.rows.length) lb.append(el('p', 'muted small empty-note', 'Nobody has joined yet.'));
  const gameMode = c.game && chView.mode === 'game';
  const rows = gameMode ? d.board.rows.filter(r => r.gameBest).slice().sort((x, y) => y.gameBest - x.gameBest).map((r, i) => ({ ...r, rank: i + 1, prev: null, _game: true })) : d.board.rows;
  if (gameMode && !rows.length) lb.append(el('p', 'muted small empty-note', 'Nobody has played yet. Be the first!'));
  for (const r of rows) lb.append(rowEl(r));
  body.append(lb);
  if (me1 && !d.board.rows.some(r => r.uid === me.uid)) body.append(rowEl(me1, true));      // keep my row in view
  if (keepScroll) body.scrollTop = scroll;
}
const LV_COLORS = ['#94a3b8', '#b45309', '#64748b', '#d97706', '#0891b2', '#7c3aed'];
const dayName = d => d === localDay() ? 'Today' : d === (() => { const x = new Date(); x.setDate(x.getDate() - 1); return new Date(x - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10); })() ? 'Yesterday' : new Date(d + 'T12:00').toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
const atTime = t => t ? new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
// Your points statement: what earned each point, and when it was credited
async function openPointsHistory(c) {
  let h; try { h = await api('challenge/history', { room: 'general', id: c.id, today: localDay() }); } catch (e) { return toast(e.message); }
  const { d, inner } = sheet('pointsSheet', 'Points history'); d.classList.add('ph-sheet');
  const sum = el('div', 'ph-sum');
  const lv = el('div', 'ph-lv lv-' + h.level.idx); lv.append(icoEl('trophy'), el('b', null, h.level.name));
  const tot = el('div', 'ph-total'); tot.append(el('b', null, fmtN(h.points)), el('small', null, 'points'));
  sum.append(lv, tot);
  const split = el('div', 'ph-split');
  for (const [k, label] of [['stepPts', 'From steps'], ['bonus', 'Target bonus'], ['taskPts', 'Daily tasks'], ...(c.game ? [['gamePts', 'Game']] : [])]) { const x = el('div'); x.append(el('b', null, fmtN(h.totals[k])), el('small', null, label)); split.append(x); }
  const facts = el('div', 'ph-facts');
  facts.append(icoText('footprints', `${fmtN(h.steps)} steps counted`), icoText('flame', `Streak ${h.streak} · best ${h.bestStreak}`), icoText('flag', `Target hit ${h.targetDays}×`));
  if (h.bestDay) facts.append(icoText('trophy', `Best day ${fmtN(h.bestDay.steps)} (${dayName(h.bestDay.date)})`));
  if (c.game) split.classList.add('four');
  facts.append(infoTip(`Points are credited when your steps sync (Google Health / Android every 15 minutes, walk mode, or added by hand), when you tick a task${c.game ? ' and when you finish a game' : ''}.${c.activity.cap ? ` Only the first ${fmtN(c.activity.cap)} steps a day count.` : ''}`, 'How points are credited'));
  inner.append(sum, split, facts);
  for (const w of h.weekBonus || []) {
    const card = el('div', 'ph-day'); const hd = el('div', 'ph-head'); hd.append(el('b', null, `Week ${w.week} target reached`), el('span', 'ph-plus', `+${w.bonus}`)); card.append(hd);
    card.append(el('small', 'muted', `${fmtN(w.steps)} steps (${dayName(w.start)} – ${dayName(w.end)})${w.at ? ' · credited ' + atTime(w.at) : ''}`)); inner.append(card);
  }
  if (!h.days.length) inner.append(el('p', 'empty-note', 'The challenge hasn’t started yet.'));
  for (const x of h.days) {
    const card = el('div', 'ph-day' + (x.total ? '' : ' zero'));
    const hd = el('div', 'ph-head'); hd.append(el('b', null, dayName(x.date)), el('span', 'ph-plus', x.total ? `+${fmtN(x.total)}` : '0')); card.append(hd);
    const line = (ic, text, pts, when) => { const r = el('div', 'ph-line'); r.append(icoEl(ic), el('span', 'ph-what', text), el('span', 'ph-pts', pts ? `+${fmtN(pts)}` : '0')); if (when) r.append(el('small', 'ph-when', when)); card.append(r); };
    if (!x.raw) line('footprints', 'No steps synced', 0, null);
    else line('footprints', `${fmtN(x.counted)} steps${x.capped ? ` (walked ${fmtN(x.raw)}, capped)` : ''} → ${fmtN(Math.floor(x.counted / c.activity.every))} × ${c.activity.points} pts`, x.stepPts, x.at ? `credited ${atTime(x.at)}` : null);
    if (x.bonus) line('flag', `Daily target of ${fmtN(c.activity.target)} reached`, x.bonus, x.at ? `credited ${atTime(x.at)}` : null);
    if (x.game) line('sparkles', `Game: ${CG_INFO[x.game.kind].name} — ${c.game.mode === 'sum' ? 'total' : 'best'} score ${fmtN(x.game.score)} × ${c.game.ptsPer} (${x.game.plays.length} play${x.game.plays.length > 1 ? 's' : ''})`, x.game.points, x.game.plays.length ? `last played ${atTime(x.game.plays[x.game.plays.length - 1].at)}` : null);
    for (const t of x.tasks) line(t.kind === 'steps' ? 'footprints' : 'check', `Task: ${t.title}`, t.points, t.at ? `${t.kind === 'steps' ? 'credited' : 'ticked'} ${atTime(t.at)}` : null);
    inner.append(card);
  }
  d.showModal();
}
// Someone else's summary card
async function openMemberCard(c, uid) {
  let m; try { m = await api('challenge/member', { room: 'general', id: c.id, uid, today: localDay() }); } catch (e) { return toast(e.message); }
  const { d, inner } = sheet('memberSheet', ''); d.classList.add('mc-sheet');
  const hero = el('div', 'mc-hero'); const av = el('div', 'avatar'); paintAvatar(av, m.name, { photo: m.photo });
  const lv = el('span', 'ph-lv lv-' + m.level.idx); lv.append(icoEl('trophy'), el('b', null, m.level.name));
  hero.append(av, el('h2', null, m.name), lv); inner.append(hero);
  const grid = el('div', 'mc-grid');
  const stat = (v, l) => { const x = el('div'); x.append(el('b', null, v), el('small', null, l)); grid.append(x); };
  stat(m.rank ? '#' + m.rank : '–', 'Rank'); stat(fmtN(m.points), 'Points'); stat(fmtN(m.steps), 'Steps'); stat(String(m.streak), 'Day streak'); stat(fmtN(m.avg), 'Avg / day'); stat(String(m.targetDays), 'Targets hit');
  inner.append(grid);
  if (m.bestDay) inner.append(el('p', 'muted small', `Best day: ${fmtN(m.bestDay.steps)} steps on ${dayName(m.bestDay.date)} · longest streak ${m.bestStreak} days`));
  if (m.week.length) {
    const wk = el('div', 'mc-week'); const max = Math.max(1, ...m.week.map(x => x.steps));
    for (const x of m.week) { const col = el('div'); const b = el('i'); b.style.height = Math.max(4, x.steps / max * 100) + '%'; b.title = `${fmtN(x.steps)} steps`; col.append(b, el('small', null, new Date(x.date + 'T12:00').toLocaleDateString([], { weekday: 'narrow' }))); wk.append(col); }
    inner.append(wk);
  }
  const btns = el('div', 'btn-row');
  const prof = el('button', 'btn', 'View profile'); prof.type = 'button'; prof.onclick = () => { d.close(); showProfile(uid); }; btns.append(prof);
  inner.append(btns);
  d.showModal();
}
async function leaveChallenge(c) {
  const yes = await popup({ icon: 'logout', title: `Leave ${c.title}?`, text: 'You’ll disappear from the leaderboard. You can join again while it’s running.', ok: 'Leave', danger: true });
  if (!yes) return;
  try { await api('challenge/leave', { room: 'general', id: c.id }); toast('You left the challenge'); openChallenge(c.id); } catch (e) { toast(e.message); }
}
async function deleteChallenge(c) {
  const yes = await popup({ icon: 'trash', title: `Delete ${c.title}?`, text: 'The challenge, its leaderboard and everyone’s progress in it are removed. Steps themselves are kept.', ok: 'Delete', danger: true });
  if (!yes) return;
  try { await api('challenge/delete', { room: 'general', id: c.id }); toast('Challenge deleted'); closeLayer(chView.layer, () => { chView.id = null; loadChallenges(); }); } catch (e) { toast(e.message); }
}
// Create / edit form
function openChallengeForm(old) {
  const { d, inner } = sheet('challengeSheet', old ? 'Edit challenge' : 'New challenge');
  d.classList.add('ch-sheet');
  const f = el('form', 'ch-form'); f.noValidate = true;
  const field = (label, input, hint) => { const l = el('label', 'field'); l.append(el('span', null, label), input); if (hint) l.append(el('small', 'muted', hint)); f.append(l); return input; };
  const inp = (type, value, attrs = {}) => { const i = el('input'); i.type = type; if (value !== undefined && value !== null) i.value = value; Object.assign(i, attrs); return i; };
  // banner
  let bannerUrl = old?.banner || null, bannerFile = null;
  const ban = el('button', 'ch-ban-pick'); ban.type = 'button';
  const paintBan = () => { ban.innerHTML = ''; if (bannerFile) ban.style.backgroundImage = `url("${URL.createObjectURL(bannerFile)}")`; else if (okPhoto(bannerUrl)) ban.style.backgroundImage = `url("${bannerUrl}")`; else { ban.style.backgroundImage = ''; ban.append(icoEl('image'), 'Add a banner'); } };
  const file = el('input'); file.type = 'file'; file.accept = 'image/*'; file.hidden = true; file.onchange = () => { if (file.files[0]) { bannerFile = file.files[0]; paintBan(); } };
  ban.onclick = () => file.click(); paintBan(); f.append(ban, file);
  const title = field('Challenge name', inp('text', old?.title || '', { maxLength: 60, placeholder: 'e.g. Mission Moon' }));
  const desc = el('textarea'); desc.rows = 3; desc.maxLength = 600; desc.placeholder = 'What is it about? e.g. Our goal is to reach the moon in 30 days. One team, one mission.'; desc.value = old?.desc || ''; field('Description', desc);
  const t0 = localDay();
  const dates = el('div', 'ch-dates');
  const dField = (label, v, cls = '') => { const l = el('label', 'field ' + cls); const i = inp('date', v); l.append(el('span', null, label), i); dates.append(l); return i; };
  const pub = dField('Publish (visible & open to join)', old?.publishAt || t0, 'full'), st = dField('Start', old?.start || t0), en = dField('End', old?.end || (() => { const x = new Date(); x.setDate(x.getDate() + 29); return new Date(x - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10); })());
  f.append(dates, el('small', 'muted ch-hint', 'People can see and join from the publish date. Steps count from start to end.'));
  // audience
  const aud = el('select');
  aud.append(Object.assign(document.createElement('option'), { value: '', textContent: 'Everyone' }));
  for (const r of rooms.filter(r => !r.dm && r.room !== 'general' && !r.hidden)) aud.append(Object.assign(document.createElement('option'), { value: r.room, textContent: `Members of ${r.title || '#' + r.room}` }));
  aud.value = old?.audience?.room || ''; field('Who can join', aud);
  // steps activity
  f.append(el('h3', 'ch-form-sec', 'Activity: steps'));
  const a = old?.activity || { per: 'day', target: 8000, every: 1000, points: 5, cap: 20000, bonus: 10 };
  const tgtRow = el('div', 'ch-grid2');
  const target = inp('number', a.target, { min: 0, step: 500 }); const tl = el('label', 'field'); tl.append(el('span', null, 'Target steps'), target); tgtRow.append(tl);
  const per = el('select'); per.append(Object.assign(document.createElement('option'), { value: 'day', textContent: 'per day' }), Object.assign(document.createElement('option'), { value: 'week', textContent: 'per week' })); per.value = a.per;
  const pl = el('label', 'field'); pl.append(el('span', null, 'Every'), per); tgtRow.append(pl); f.append(tgtRow);
  const ptsRow = el('div', 'ch-grid2'); const every = inp('number', a.every, { min: 1, step: 100 }), points = inp('number', a.points, { min: 0 });
  const el1 = el('label', 'field'); el1.append(el('span', null, 'For every (steps)'), every);
  const el2 = el('label', 'field'); el2.append(el('span', null, 'Give (points)'), points);
  ptsRow.append(el1, el2); f.append(ptsRow);
  const ptsHint = el('small', 'muted ch-hint'); const paintPts = () => { ptsHint.textContent = `${+points.value || 0} points for every ${(+every.value || 0).toLocaleString()} steps`; };
  every.oninput = points.oninput = paintPts; paintPts(); f.append(ptsHint);
  const capRow = el('div', 'ch-grid2');
  const cap = inp('number', a.cap, { min: 0, step: 1000 }); const cl = el('label', 'field'); cl.append(el('span', null, 'Daily step cap'), cap, el('small', 'muted', '0 = no cap. Steps above it don’t count.')); capRow.append(cl);
  const bonus = inp('number', a.bonus, { min: 0 }); const bl = el('label', 'field'); bl.append(el('span', null, 'Target bonus points'), bonus, el('small', 'muted', 'Extra points each time the target is hit.')); capRow.append(bl);
  f.append(capRow);
  const tb = el('select'); for (const [v, l] of [['steps', 'More steps'], ['days', 'More days hitting the target'], ['joined', 'Joined first']]) tb.append(Object.assign(document.createElement('option'), { value: v, textContent: l }));
  tb.value = old?.tiebreak || 'steps'; field('Tie-breaker (equal points)', tb);
  // daily tasks
  f.append(el('h3', 'ch-form-sec', 'Daily tasks'));
  const tasksBox = el('div', 'ch-tasks-edit'); f.append(tasksBox);
  const tasks = (old?.tasks || [{ kind: 'steps', title: 'Walk 5,000 steps', target: 5000, points: 10 }, { kind: 'check', title: 'Take the stairs once', points: 5 }]).map(x => ({ ...x }));
  const drawTasks = () => {
    tasksBox.innerHTML = '';
    tasks.forEach((t, i) => {
      const r = el('div', 'cte-row');
      const k = el('select'); k.append(Object.assign(document.createElement('option'), { value: 'steps', textContent: 'Steps' }), Object.assign(document.createElement('option'), { value: 'check', textContent: 'Tick off' })); k.value = t.kind; k.onchange = () => { t.kind = k.value; drawTasks(); };
      const ti = inp('text', t.title, { maxLength: 60, placeholder: t.kind === 'steps' ? 'Walk 5,000 steps' : 'e.g. Drink 8 glasses of water' }); ti.oninput = () => { t.title = ti.value; };
      const tg = inp('number', t.target || 5000, { min: 100, step: 500, title: 'Steps' }); tg.oninput = () => { t.target = +tg.value; }; tg.classList.toggle('hidden', t.kind !== 'steps');
      const tp = inp('number', t.points ?? 10, { min: 0, title: 'Points' }); tp.oninput = () => { t.points = +tp.value; };
      const rm = el('button', 'icon-btn'); rm.type = 'button'; rm.innerHTML = svgFor('x'); rm.setAttribute('aria-label', 'Remove task'); rm.onclick = () => { tasks.splice(i, 1); drawTasks(); };
      const top = el('div', 'cte-top'); top.append(ti, rm);
      const lab = (txt, ctl) => { const l = el('label', 'cte-f'); l.append(el('small', null, txt), ctl); return l; };
      const bot = el('div', 'cte-bot' + (t.kind === 'steps' ? '' : ' two'));
      bot.append(lab('Type', k)); if (t.kind === 'steps') bot.append(lab('Steps', tg)); bot.append(lab('Points', tp));
      r.append(top, bot); tasksBox.append(r);
    });
    tasksBox.querySelectorAll('input, select').forEach(x => x.classList.add('ch-ctl'));
    if (tasks.length < 12) { const add = el('button', 'link-btn', '+ Add a daily task'); add.type = 'button'; add.onclick = () => { tasks.push({ kind: 'check', title: '', points: 5 }); drawTasks(); }; tasksBox.append(add); }
  };
  drawTasks();
  f.append(el('h3', 'ch-form-sec', 'Game (optional)'));
  const gk = el('select'); gk.append(Object.assign(document.createElement('option'), { value: '', textContent: 'No game' }));
  for (const [label, fun] of [['Fun games', true], ['Brain games', false]]) {
    const og = document.createElement('optgroup'); og.label = label;
    for (const [k2, v2] of Object.entries(CG_INFO)) if (!!v2.fun === fun) og.append(Object.assign(document.createElement('option'), { value: k2, textContent: v2.name }));
    gk.append(og);
  }
  gk.value = old?.game?.kind || ''; field('Daily mini-game', gk);
  const gBox = el('div', 'ch-game-opts');
  const gPer = inp('number', old?.game?.perDay ?? 3, { min: 1, max: 10 }), gPts = inp('number', old?.game?.ptsPer ?? 2, { min: 0.01, step: 0.01 });
  const gMode = el('select'); gMode.append(Object.assign(document.createElement('option'), { value: 'best', textContent: 'Best play of the day' }), Object.assign(document.createElement('option'), { value: 'sum', textContent: 'All plays add up' })); gMode.value = old?.game?.mode || 'best';
  const g2 = el('div', 'ch-grid2'); const gl1 = el('label', 'field'); gl1.append(el('span', null, 'Plays per day'), gPer); const gl2 = el('label', 'field'); gl2.append(el('span', null, 'Points per score'), gPts); g2.append(gl1, gl2);
  const gl3 = el('label', 'field'); gl3.append(el('span', null, 'What counts'), gMode);
  const gHint = el('small', 'muted ch-hint');
  const gSounds = { wrong: 'fahh', right: 'crore', ...(old?.game?.sounds || {}) };
  const gl4 = el('div', 'field'); gl4.append(el('span', null, 'Sounds'), soundPicker(gSounds));
  gBox.append(g2, gl3, gl4, gHint); f.append(gBox);
  const paintGame = () => { gBox.classList.toggle('hidden', !gk.value); if (gk.value) gHint.textContent = `${CG_INFO[gk.value].how} e.g. ${gPts.value || 0} pts per ${CG_INFO[gk.value].unit}.`; };
  gk.onchange = () => { if (gk.value && !old?.game) gPts.value = { math: 2, reaction: 0.05, memory: 5, bubbles: 1, dash: 0.5, stack: 3, emoji: 5, scramble: 3, rps: 2, ttt: 3 }[gk.value]; paintGame(); }; gPts.oninput = paintGame; paintGame();
  const err = el('p', 'error'); const save = el('button', 'btn primary block', old ? 'Save changes' : 'Create challenge'); save.type = 'submit';
  f.append(err, save);
  f.onsubmit = async e => {
    e.preventDefault(); err.textContent = ''; save.disabled = true;
    try {
      let banner = bannerUrl;
      if (bannerFile) {
        const blob = await (await fetch(await shrinkImage(bannerFile, 1600, .85))).blob();
        const r = await fetch('/api/challenge/banner', { method: 'POST', body: blob, headers: { 'Content-Type': 'image/jpeg', 'X-Chat-Device': me.device, Authorization: 'Bearer ' + me.token } });
        const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Banner upload failed'); banner = j.url;
      }
      const payload = { room: 'general', audience: aud.value || null, id: old?.id, title: title.value, desc: desc.value, banner, publishAt: pub.value, start: st.value, end: en.value, today: localDay(),
        activity: { per: per.value, target: +target.value, every: +every.value, points: +points.value, cap: +cap.value, bonus: +bonus.value }, tiebreak: tb.value,
        tasks: tasks.map(t => ({ id: t.id, kind: t.kind, title: t.title, target: t.target, points: t.points })),
        game: gk.value ? { kind: gk.value, perDay: +gPer.value, ptsPer: +gPts.value, mode: gMode.value, sounds: gSounds } : null };
      const r = await api(old ? 'challenge/update' : 'challenge/create', payload);
      d.close(); toast(old ? 'Challenge updated' : 'Challenge created — share it with your team!');
      openChallenge(r.challenge.id);
    } catch (e2) { err.textContent = e2.message; save.disabled = false; }
  };
  f.querySelectorAll('input:not([type=file]), select, textarea').forEach(x => x.classList.add('ch-ctl'));
  inner.append(f);
  d.showModal();
}
$('newChallengeBtn').onclick = () => openChallengeForm(null);

/* ---------------- Small info tooltip (ⓘ) ---------------- */
function infoTip(text, label = 'More info') {
  const w = el('span', 'itip'); const b = el('button', 'itip-btn'); b.type = 'button'; b.innerHTML = svgFor('info'); b.setAttribute('aria-label', label); b.setAttribute('aria-expanded', 'false');
  const bub = el('span', 'itip-bubble', text); bub.setAttribute('role', 'tooltip');
  b.onclick = e => { e.stopPropagation(); const open = !w.classList.contains('open'); document.querySelectorAll('.itip.open').forEach(x => x.classList.remove('open')); w.classList.toggle('open', open); b.setAttribute('aria-expanded', String(open)); };
  w.append(b, bub); return w;
}
document.addEventListener('click', () => document.querySelectorAll('.itip.open').forEach(x => x.classList.remove('open')));

/* ---------------- Challenge games (single player) ---------------- */
const CG_INFO = {
  math: { name: 'Quick Math', how: 'Solve as many sums as you can in 60 seconds. Score = correct answers.', unit: 'correct answer' },
  reaction: { name: 'Reaction Time', how: 'Tap the moment the screen turns green — 5 rounds. Score = 1000 − your average time in ms.', unit: 'score point' },
  memory: { name: 'Memory Path', how: 'Watch the tiles light up, then tap the same path. Each level adds one tile. Score = longest path.', unit: 'tile' },
  bubbles: { name: 'Bubble Pop', fun: true, how: 'Pop as many rising bubbles as you can in 30 seconds. Golden bubbles count 3.', unit: 'bubble' },
  dash: { name: 'Step Dash', fun: true, how: 'Tap (or press Space) to jump over the blocks. It gets faster the further you run. Score = metres.', unit: 'metre' },
  stack: { name: 'Tower Stack', fun: true, how: 'Tap to drop the sliding block on the tower — only the overlap stays. Score = blocks stacked.', unit: 'block' },
  emoji: { name: 'Emoji Guess', fun: true, how: 'Guess the movie, song, place or phrase from the emojis — as many as you can in 90 seconds. Skip if you are stuck.', unit: 'puzzle solved' },
  scramble: { name: 'Word Scramble', fun: true, how: 'Unscramble the letters to make a word — as many as you can in 75 seconds.', unit: 'word' },
  rps: { name: 'Rock Paper Scissors', fun: true, how: '10 rounds against the computer. A win scores 2, a draw 1.', unit: 'score point' },
  ttt: { name: 'Tic-tac-toe', fun: true, how: '5 games against the computer (you take turns going first). A win scores 3, a draw 1.', unit: 'score point' },
};
const cg = { layer: null, c: null };
function cgEl() {
  let o = $('cgPlay'); if (o) return o;
  o = el('div', 'cg-play hidden'); o.id = 'cgPlay'; o.setAttribute('role', 'dialog');
  document.body.append(o); return o;
}
function cgClose(refresh = true) {
  const o = $('cgPlay'); if (o) { o.classList.add('hidden'); o.innerHTML = ''; }
  clearInterval(cg.tick); clearTimeout(cg.timer); cg.done = true;
  if (refresh && cg.c) openChallenge(cg.c.id, true);
}
async function playChallengeGame(c) {
  const g = c.game, info = CG_INFO[g.kind];
  const yes = await popup({ icon: 'sparkles', title: info.name, text: `${info.how}\n\n${g.ptsPer} point${g.ptsPer === 1 ? '' : 's'} per ${info.unit}, ${g.mode === 'sum' ? 'all plays add up' : 'your best play of the day counts'}. Leaving a game uses up the play.`, ok: 'Start' });
  if (!yes) return;
  let s; try { s = await api('challenge/game/start', { room: 'general', id: c.id, today: localDay() }); } catch (e) { return toast(e.message); }
  cg.c = c; cg.s = s; cg.done = false;
  document.activeElement?.blur?.();        // keys go to the game, not the button behind it
  const o = cgEl(); o.classList.remove('hidden'); o.innerHTML = '';
  cg.layer = pushLayer(() => cgClose());
  const head = el('div', 'cg-head'); const x = el('button', 'icon-btn'); x.type = 'button'; x.innerHTML = svgFor('x'); x.setAttribute('aria-label', 'Quit'); x.onclick = () => closeLayer(cg.layer, () => cgClose());
  head.append(el('b', null, info.name), sfxMuteBtn(), x); o.append(head);
  const stage = el('div', 'cg-stage'); o.append(stage);
  ({ math: cgMath, reaction: cgReaction, memory: cgMemory, bubbles: cgBubbles, dash: cgDash, stack: cgStack, emoji: cgGuess, scramble: cgGuess, rps: cgRps, ttt: cgTtt })[g.kind](stage, s);
}
const cgSfx = kind => playSfx(kind, cg.c?.game?.sounds?.[kind]);
async function cgFinish(stage, payload) {
  if (cg.done) return; cg.done = true; clearInterval(cg.tick); clearTimeout(cg.timer);
  stage.innerHTML = ''; stage.append(el('p', 'cg-big', 'Checking…'));
  let r; try { r = await api('challenge/game/finish', { room: 'general', id: cg.c.id, sid: cg.s.sid, today: localDay(), ...payload }); } catch (e) { stage.replaceChildren(el('p', 'cg-msg', e.message)); return; }
  stage.innerHTML = '';
  const res = el('div', 'cg-result');
  if (r.score > 0) cgSfx('right');
  res.append(icoEl('trophy', 'cg-trophy'), el('small', null, 'Your score'), el('b', 'cg-score', fmtN(r.score)), el('span', 'muted', r.detail));
  res.append(el('p', 'cg-pts', `Game points today: ${fmtN(r.points)}${r.best > r.score ? ` (best today ${fmtN(r.best)})` : ''}`));
  res.append(el('p', 'muted small', 'The leaderboard is already updated.'));
  const btns = el('div', 'cg-btns');
  if (r.playsLeft > 0) { const again = el('button', 'btn', `Play again (${r.playsLeft} left)`); again.type = 'button'; again.onclick = () => { const c = cg.c; closeLayer(cg.layer, () => cgClose(false)); setTimeout(() => playChallengeGame(c), 250); }; btns.append(again); }
  const done = el('button', 'btn primary', 'Done'); done.type = 'button'; done.onclick = () => closeLayer(cg.layer, () => cgClose()); btns.append(done);
  res.append(btns); stage.append(res);
  if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
}
// Emoji Guess / Word Scramble: type answers against the clock; each one is checked on the server
function cgGuess(stage, s) {
  const emoji = cg.c.game.kind === 'emoji'; let cur = emoji ? s.puzzle : s.word, score = 0, busy = false; const end = performance.now() + s.secs * 1000;
  const top = el('div', 'cg-top'); const bar = el('div', 'cg-bar'); const fill = el('i'); bar.append(fill); const cnt = el('b', null, '0'); top.append(bar, cnt);
  const cat = el('small', 'cg-cat'), big = el('div', emoji ? 'cg-emoji' : 'cg-letters'), hint = el('small', 'muted'), fb = el('p', 'cg-fb');
  const form = el('form', 'cg-guess'); const inp = el('input'); inp.type = 'text'; inp.autocomplete = 'off'; inp.autocapitalize = 'off'; inp.spellcheck = false; inp.placeholder = 'Your answer'; inp.maxLength = 60;
  const go = el('button', 'btn primary', 'Guess'); go.type = 'submit'; const skip = el('button', 'btn', 'Skip'); skip.type = 'button';
  form.append(inp, go); const row = el('div', 'cg-btns'); row.append(skip);
  const show = () => {
    if (emoji) { cat.textContent = cur.cat; big.textContent = cur.emoji; hint.textContent = `${cur.words} word${cur.words > 1 ? 's' : ''}, ${cur.letters} letters`; }
    else { cat.textContent = `Word ${cur.i + 1}`; big.replaceChildren(...cur.letters.toUpperCase().split('').map(ch => el('span', null, ch))); hint.textContent = `${cur.len} letters`; }
  };
  const send = async extra => {
    if (busy || cg.done) return; busy = true;
    let r; try { r = await api('challenge/game/move', { room: 'general', id: cg.c.id, sid: s.sid, today: localDay(), ...extra }); } catch (e) { busy = false; fb.textContent = e.message; return; }
    busy = false; if (cg.done) return;
    score = r.score ?? score; cnt.textContent = score;
    if (r.tryAgain) {           // stay on this puzzle: say how close it was, shake, clear for a new try
      cgSfx('wrong');
      fb.className = 'cg-fb ' + (r.hint ? 'close' : 'bad'); fb.textContent = r.msg || 'Not quite — try again';
      fb.classList.remove('pop'); void fb.offsetWidth; fb.classList.add('pop');
      inp.classList.remove('wrong'); void inp.offsetWidth; inp.classList.add('wrong'); if (navigator.vibrate) navigator.vibrate(60);
      if (!r.hint) inp.value = ''; inp.focus(); if (r.hint) inp.select(); return;
    }
    if (r.correct) cgSfx('right');
    fb.className = 'cg-fb ' + (r.correct ? 'good' : ''); fb.textContent = r.correct ? `Yes! ${r.answer}` : r.answer ? `It was: ${r.answer}` : '';
    if (r.over || !r.next) return cgFinish(stage, {});
    cur = r.next; inp.value = ''; inp.classList.remove('wrong'); show(); inp.focus();
  };
  form.onsubmit = e => { e.preventDefault(); if (inp.value.trim()) send({ guess: inp.value }); };
  skip.onclick = () => send({ skip: true });
  stage.append(top, cat, big, hint, form, row, fb); show(); setTimeout(() => inp.focus(), 50);
  cg.tick = setInterval(() => { const left = end - performance.now(); fill.style.width = Math.max(0, left / (s.secs * 1000) * 100) + '%'; if (left <= 0) cgFinish(stage, {}); }, 100);
}
// Rock Paper Scissors: 10 rounds; the computer's pick comes from the server
function cgRps(stage, s) {
  const names = { rock: 'Rock', paper: 'Paper', scissors: 'Scissors' }, art = { rock: '\u270A', paper: '\u270B', scissors: '\u270C\uFE0F' };
  let busy = false;
  const msg = el('p', 'cg-msg', `Round 1 of ${s.rounds}`), arena = el('div', 'cg-rps-arena'), you = el('div', 'cg-rps-hand', '?'), bot = el('div', 'cg-rps-hand', '?');
  const yw = el('div', 'cg-rps-side'); yw.append(el('small', null, 'You'), you); const bw = el('div', 'cg-rps-side'); bw.append(el('small', null, 'Computer'), bot);
  arena.append(yw, el('b', 'cg-vs', 'vs'), bw);
  const res = el('p', 'cg-fb'), score = el('b', 'cg-score', '0'), dots = el('div', 'cg-dots'); for (let k = 0; k < s.rounds; k++) dots.append(el('i'));
  const picks = el('div', 'cg-rps-picks');
  for (const k of ['rock', 'paper', 'scissors']) {
    const b = el('button', 'cg-rps-btn'); b.type = 'button'; b.append(el('span', null, art[k]), el('small', null, names[k]));
    b.onclick = async () => {
      if (busy || cg.done) return; busy = true; you.textContent = art[k]; bot.textContent = '…'; bot.classList.add('shake');
      let r; try { r = await api('challenge/game/move', { room: 'general', id: cg.c.id, sid: s.sid, today: localDay(), choice: k }); } catch (e) { busy = false; res.textContent = e.message; return; }
      await new Promise(ok => setTimeout(ok, 450)); bot.classList.remove('shake'); bot.textContent = art[r.bot];
      if (r.result !== 'draw') cgSfx(r.result === 'win' ? 'right' : 'wrong');
      res.className = 'cg-fb ' + (r.result === 'win' ? 'good' : r.result === 'lose' ? 'bad' : '');
      res.textContent = r.result === 'win' ? `${names[k]} beats ${names[r.bot].toLowerCase()} — +2` : r.result === 'lose' ? `${names[r.bot]} beats ${names[k].toLowerCase()}` : 'Draw — +1';
      score.textContent = r.score; [...dots.children].forEach((d, j) => d.classList.toggle('on', j < r.round));
      if (r.over) return void (cg.timer = setTimeout(() => cgFinish(stage, {}), 1100));
      msg.textContent = `Round ${r.round + 1} of ${s.rounds}`; busy = false;
    };
    picks.append(b);
  }
  stage.append(msg, dots, arena, res, score, picks);
}
// Tic-tac-toe vs the computer: same bot rules as the server, which replays every game to check the score
const CG_TTT_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const cgTttWin = b => { for (const [a, c, d] of CG_TTT_LINES) if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a]; return b.every(Boolean) ? 'draw' : null; };
function cgTttBot(b) {
  const free = i => !b[i];
  for (const who of ['O', 'X']) for (const line of CG_TTT_LINES) { const mine = line.filter(i => b[i] === who).length, empty = line.filter(free); if (mine === 2 && empty.length === 1) return empty[0]; }
  if (free(4)) return 4;
  for (const i of [0, 2, 6, 8, 1, 3, 5, 7]) if (free(i)) return i;
  return -1;
}
function cgTtt(stage, s) {
  const games = []; let b, moves, busy = false, w = 0, d = 0;
  const msg = el('p', 'cg-msg'), grid = el('div', 'cg-ttt'), tally = el('p', 'muted small'), cells = [];
  for (let k = 0; k < 9; k++) { const c = el('button', 'cg-ttt-cell'); c.type = 'button'; c.setAttribute('aria-label', `Square ${k + 1}`); c.onclick = () => tap(k); cells.push(c); grid.append(c); }
  const paint = () => cells.forEach((c, k) => { c.textContent = b[k] || ''; c.className = 'cg-ttt-cell' + (b[k] ? ' ' + b[k].toLowerCase() : ''); });
  const newGame = () => {
    b = Array(9).fill(null); moves = []; busy = false;
    const youFirst = games.length % 2 === 0; if (!youFirst) b[cgTttBot(b)] = 'O';
    msg.textContent = `Game ${games.length + 1} of ${s.games} · you are X${youFirst ? '' : ' (computer went first)'}`; paint();
  };
  const over = r => {
    games.push(moves); busy = true; if (r === 'X') w++; else if (r === 'draw') d++;
    if (r !== 'draw') cgSfx(r === 'X' ? 'right' : 'wrong');
    msg.textContent = r === 'X' ? 'You win! +3' : r === 'draw' ? 'Draw — +1' : 'Computer wins';
    tally.textContent = `${w} won · ${d} drawn · ${games.length - w - d} lost`;
    cg.timer = setTimeout(() => games.length >= s.games ? cgFinish(stage, { games }) : newGame(), 1100);
  };
  const tap = k => {
    if (busy || cg.done || b[k]) return;
    b[k] = 'X'; moves.push(k); paint(); let r = cgTttWin(b); if (r) return over(r);
    busy = true; cg.timer = setTimeout(() => { b[cgTttBot(b)] = 'O'; paint(); busy = false; const r2 = cgTttWin(b); if (r2) over(r2); }, 320);
  };
  stage.append(msg, grid, tally); newGame();
}
// Quick Math: 60 s of sums with an on-screen keypad (also works with a keyboard)
function cgMath(stage, s) {
  const answers = []; let i = 0, typed = '', right = 0; const end = performance.now() + s.secs * 1000;
  const top = el('div', 'cg-top'); const bar = el('div', 'cg-bar'); const fill = el('i'); bar.append(fill); const cnt = el('b', null, '0'); top.append(bar, cnt);
  const q = el('div', 'cg-q'), ans = el('div', 'cg-ans'), pad = el('div', 'cg-pad');
  const show = () => { const p = s.problems[i]; q.textContent = p ? `${p.a} ${p.op} ${p.b} =` : 'Done!'; ans.textContent = typed || ' '; };
  const submit = () => {
    if (!typed || cg.done) return;
    const p = s.problems[i], v = Number(typed), ok = v === (p.op === '+' ? p.a + p.b : p.op === '-' ? p.a - p.b : p.a * p.b);
    answers[i] = v; if (ok) right++; cnt.textContent = right; ans.classList.remove('good', 'bad'); void ans.offsetWidth; ans.classList.add(ok ? 'good' : 'bad');
    typed = ''; i++; if (i >= s.problems.length) return cgFinish(stage, { answers }); show();
  };
  const key = k => { if (cg.done) return; if (k === 'del') typed = typed.slice(0, -1); else if (k === 'ok') return submit(); else if (typed.length < 5) typed += k; show(); };
  for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok']) { const b = el('button', 'cg-key' + (k === 'ok' ? ' ok' : k === 'del' ? ' del' : '')); b.type = 'button'; if (k === 'del') b.innerHTML = '&#9003;'; else if (k === 'ok') b.innerHTML = svgFor('check'); else b.textContent = k; b.onpointerdown = e => { e.preventDefault(); key(k); }; pad.append(b); }
  const onKey = e => { if ($('cgPlay').classList.contains('hidden') || cg.done) return document.removeEventListener('keydown', onKey); if (/^\d$/.test(e.key)) { e.preventDefault(); key(e.key); } else if (e.key === 'Backspace') { e.preventDefault(); key('del'); } else if (e.key === 'Enter') { e.preventDefault(); key('ok'); } };
  document.addEventListener('keydown', onKey);
  stage.append(top, q, ans, pad); show();
  cg.tick = setInterval(() => { const left = end - performance.now(); fill.style.width = Math.max(0, left / (s.secs * 1000) * 100) + '%'; if (left <= 0) cgFinish(stage, { answers }); }, 100);
}
// Reaction Time: 5 rounds — wait for green, then tap
function cgReaction(stage, s) {
  const times = []; let state = 'idle', t0 = 0;
  const pad = el('button', 'cg-react'); pad.type = 'button'; const msg = el('b'), sub = el('small'); pad.append(msg, sub);
  const dots = el('div', 'cg-dots'); for (let k = 0; k < s.rounds; k++) dots.append(el('i'));
  const paint = (cls, a, b) => { pad.className = 'cg-react ' + cls; msg.textContent = a; sub.textContent = b || ''; [...dots.children].forEach((d, k) => d.classList.toggle('on', k < times.length)); };
  const round = () => { state = 'wait'; paint('wait', 'Wait for green…', `Round ${times.length + 1} of ${s.rounds}`); cg.timer = setTimeout(() => { state = 'go'; t0 = performance.now(); paint('go', 'TAP!'); }, 1200 + Math.random() * 2200); };
  pad.onpointerdown = e => {
    e.preventDefault(); if (cg.done) return;
    if (state === 'idle') return round();
    if (state === 'wait') { cgSfx('wrong'); clearTimeout(cg.timer); state = 'idle'; paint('early', 'Too soon!', 'Tap to try this round again'); return; }
    if (state === 'go') {
      const ms = Math.round(performance.now() - t0); times.push(Math.max(100, ms)); state = 'shown';
      paint('shown', `${ms} ms`, times.length < s.rounds ? 'Next round…' : 'Nice!');
      cg.timer = setTimeout(() => times.length >= s.rounds ? cgFinish(stage, { times }) : round(), 900);
    }
  };
  stage.append(dots, pad); paint('idle', 'Tap to start', 'Then wait for green and tap as fast as you can');
}
// Memory Path: watch, then repeat — one more tile each level
function cgMemory(stage, s) {
  const levels = []; let n = 1, input = [], busy = true;
  const msg = el('p', 'cg-msg'), grid = el('div', 'cg-grid'), tiles = [];
  for (let k = 0; k < 9; k++) { const t = el('button', 'cg-tile'); t.type = 'button'; t.setAttribute('aria-label', `Tile ${k + 1}`); t.onpointerdown = e => { e.preventDefault(); tap(k); }; tiles.push(t); grid.append(t); }
  const flash = (k, cls = 'lit', ms = 420) => { tiles[k].classList.add(cls); setTimeout(() => tiles[k].classList.remove(cls), ms); };
  const watch = () => {
    busy = true; input = []; msg.textContent = `Level ${n} · watch`;
    s.path.slice(0, n).forEach((k, j) => { cg.timer = setTimeout(() => flash(k), 500 + j * 620); });
    cg.timer = setTimeout(() => { busy = false; msg.textContent = `Level ${n} · your turn`; }, 500 + n * 620);
  };
  const tap = k => {
    if (busy || cg.done) return;
    input.push(k); flash(k, 'tap', 200);
    const j = input.length - 1;
    if (k !== s.path[j]) { cgSfx('wrong'); levels.push(input.slice()); busy = true; tiles[k].classList.add('wrong'); msg.textContent = `Oops! You reached a path of ${n - 1}`; return void (cg.timer = setTimeout(() => cgFinish(stage, { levels }), 1100)); }
    if (input.length === n) { levels.push(input.slice()); if (n >= s.path.length) return cgFinish(stage, { levels }); n++; busy = true; msg.textContent = 'Correct!'; cg.timer = setTimeout(watch, 700); }
  };
  stage.append(msg, grid); watch();
}

// ---- Fun arcade games ----
// Bubble Pop: 30 s, tap the rising bubbles (golden ones are worth 3)
function cgBubbles(stage, s) {
  let score = 0, spawnEvery = 520, last = 0; const end = performance.now() + s.secs * 1000;
  const top = el('div', 'cg-top'); const bar = el('div', 'cg-bar'); const fill = el('i'); bar.append(fill); const cnt = el('b', null, '0'); top.append(bar, cnt);
  const field = el('div', 'cg-field'); stage.append(top, field);
  const spawn = () => {
    const gold = Math.random() < .1, size = gold ? 54 : 48 + Math.random() * 34, b = el('button', 'cg-bubble' + (gold ? ' gold' : ''));
    b.type = 'button'; b.setAttribute('aria-label', gold ? 'Golden bubble' : 'Bubble');
    b.style.width = b.style.height = size + 'px'; b.style.left = `calc(${Math.random() * 100}% - ${size / 2}px)`;
    const dur = 2600 + Math.random() * 2200; b.style.animationDuration = dur + 'ms';
    b.onpointerdown = e => { e.preventDefault(); if (cg.done || b.classList.contains('popped')) return; b.style.transform = getComputedStyle(b).transform; b.classList.add('popped'); score += gold ? 3 : 1; cnt.textContent = score; if (navigator.vibrate) navigator.vibrate(8); setTimeout(() => b.remove(), 180); };
    b.addEventListener('animationend', () => b.remove());
    field.append(b);
  };
  cg.tick = setInterval(() => {
    const now = performance.now(), left = end - now;
    fill.style.width = Math.max(0, left / (s.secs * 1000) * 100) + '%';
    if (now - last > spawnEvery) { last = now; spawn(); spawnEvery = Math.max(260, spawnEvery - 6); }
    if (left <= 0) { field.querySelectorAll('.cg-bubble').forEach(x => x.remove()); cgFinish(stage, { score }); }
  }, 50);
}
// Canvas helper (sharp on high-DPI screens)
function cgCanvas(stage, h) {
  const c = el('canvas', 'cg-canvas'); stage.append(c);
  const w = Math.min(stage.clientWidth || 360, 440), dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = w * dpr; c.height = h * dpr; c.style.width = w + 'px'; c.style.height = h + 'px';
  const ctx = c.getContext('2d'); ctx.scale(dpr, dpr);
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';
  return { c, ctx, w, h, css };
}
// Step Dash: tap / Space to jump over the blocks; it speeds up
function cgDash(stage, s) {
  const msg = el('p', 'cg-msg', 'Tap to jump — start running!'); stage.append(msg);
  const { c, ctx, w, h, css } = cgCanvas(stage, 300);
  const ground = h - 46, P = { x: 56, y: ground - 34, w: 30, h: 34, vy: 0 };
  let obs = [], speed = 260, dist = 0, next = 260, t0 = 0, last = 0, running = false, dead = false;
  const brand = css('--brand'), text = css('--text'), muted = css('--muted');
  const jump = () => { if (cg.done || dead) return; if (!running) { running = true; t0 = last = performance.now(); msg.textContent = 'Jump the blocks!'; requestAnimationFrame(loop); } if (P.y >= ground - P.h - 1) P.vy = -820; };
  c.onpointerdown = e => { e.preventDefault(); jump(); };
  const onKey = e => { if ($('cgPlay').classList.contains('hidden') || cg.done) return document.removeEventListener('keydown', onKey); if (e.code === 'Space' || e.key === 'ArrowUp') { e.preventDefault(); jump(); } };
  document.addEventListener('keydown', onKey);
  const draw = () => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = muted; ctx.globalAlpha = .25; ctx.fillRect(0, ground, w, 3); ctx.globalAlpha = 1;
    for (let k = 0; k < 6; k++) { ctx.fillStyle = muted; ctx.globalAlpha = .15; ctx.fillRect(((k * 97 - dist * .5) % (w + 40) + w + 40) % (w + 40) - 20, ground + 14 + (k % 3) * 8, 18, 3); ctx.globalAlpha = 1; }
    ctx.fillStyle = '#f97316'; for (const o of obs) { ctx.beginPath(); ctx.roundRect(o.x, ground - o.h, o.w, o.h, 5); ctx.fill(); }
    ctx.fillStyle = brand; ctx.beginPath(); ctx.roundRect(P.x, P.y, P.w, P.h, 8); ctx.fill();
    const leg = running && P.y >= ground - P.h - 1 ? Math.sin(dist / 14) * 5 : 0;
    ctx.fillRect(P.x + 6 + leg, P.y + P.h - 2, 6, 6); ctx.fillRect(P.x + P.w - 12 - leg, P.y + P.h - 2, 6, 6);
    ctx.fillStyle = '#fff'; ctx.fillRect(P.x + P.w - 11, P.y + 8, 6, 6);
    ctx.fillStyle = text; ctx.font = '700 20px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.fillText(`${Math.floor(dist / 40)} m`, w - 12, 30);
  };
  const loop = now => {
    if (cg.done || dead) return;
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    speed = Math.min(520, 260 + (now - t0) / 1000 * 12);
    dist += speed * dt; P.vy += 2200 * dt; P.y = Math.min(ground - P.h, P.y + P.vy * dt); if (P.y >= ground - P.h) P.vy = 0;
    for (const o of obs) o.x -= speed * dt;
    obs = obs.filter(o => o.x + o.w > -10);
    next -= speed * dt; if (next <= 0) { const big = Math.random() < .35; obs.push({ x: w + 10, w: big ? 30 : 18 + Math.random() * 10, h: big ? 44 : 24 + Math.random() * 16 }); next = 230 + Math.random() * 260 + speed * .35; }
    if (obs.some(o => P.x + P.w - 5 > o.x && P.x + 5 < o.x + o.w && P.y + P.h - 3 > ground - o.h)) { dead = true; draw(); msg.textContent = 'Bonk! Game over'; if (navigator.vibrate) navigator.vibrate(120); setTimeout(() => cgFinish(stage, { score: Math.floor(dist / 40) }), 700); return; }
    draw(); requestAnimationFrame(loop);
  };
  draw();
}
// Tower Stack: tap to drop the sliding block; only the overlapping part stays
function cgStack(stage, s) {
  const msg = el('p', 'cg-msg', 'Tap to drop the block'); stage.append(msg);
  const { c, ctx, w, h, css } = cgCanvas(stage, 380);
  const BH = 26, base = { x: w / 2 - 80, w: 160 }; let stack = [base], cur = null, dir = 1, v = 150, score = 0, lastDrop = 0, over = false, last = performance.now();
  const colors = ['#00a884', '#0ea5e9', '#7c3aed', '#f97316', '#e11d48', '#16a34a', '#ca8a04'];
  const newBlock = () => { const top = stack[stack.length - 1]; cur = { x: dir > 0 ? 0 : w - top.w, w: top.w }; v = Math.min(420, 150 + score * 12); };   // starts at the visible edge
  const draw = () => {
    ctx.clearRect(0, 0, w, h);
    const shown = stack.slice(-12), y0 = h - 20;
    shown.forEach((b, k) => { ctx.fillStyle = colors[(stack.length - shown.length + k) % colors.length]; ctx.beginPath(); ctx.roundRect(b.x, y0 - (k + 1) * BH, b.w, BH - 2, 5); ctx.fill(); });
    if (cur && !over) { ctx.fillStyle = colors[stack.length % colors.length]; ctx.globalAlpha = .9; ctx.beginPath(); ctx.roundRect(cur.x, y0 - (shown.length + 1) * BH - 8, cur.w, BH - 2, 5); ctx.fill(); ctx.globalAlpha = 1; }
    ctx.fillStyle = css('--text'); ctx.font = '700 22px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.fillText(String(score), w - 12, 30);
  };
  const drop = () => {
    const now = performance.now(); if (cg.done || over || now - lastDrop < 350) return; lastDrop = now;
    const top = stack[stack.length - 1], l = Math.max(cur.x, top.x), r = Math.min(cur.x + cur.w, top.x + top.w);
    if (r - l <= 0) { over = true; msg.textContent = 'Missed! Game over'; draw(); if (navigator.vibrate) navigator.vibrate(120); return void setTimeout(() => cgFinish(stage, { score }), 700); }
    const perfect = Math.abs(cur.x - top.x) < 5;
    stack.push(perfect ? { x: top.x, w: top.w } : { x: l, w: r - l }); score++;
    msg.textContent = perfect ? 'Perfect!' : score % 5 === 0 ? `${score} high!` : 'Nice'; if (navigator.vibrate) navigator.vibrate(perfect ? 30 : 10);
    dir = -dir; newBlock();
  };
  c.onpointerdown = e => { e.preventDefault(); drop(); };
  const onKey = e => { if ($('cgPlay').classList.contains('hidden') || cg.done) return document.removeEventListener('keydown', onKey); if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); drop(); } };
  document.addEventListener('keydown', onKey);
  const loop = now => { if (cg.done || over) return; const dt = Math.min(.05, (now - last) / 1000); last = now; cur.x += dir * v * dt; if (cur.x > w - cur.w) { cur.x = w - cur.w; dir = -1; } if (cur.x < 0) { cur.x = 0; dir = 1; } draw(); requestAnimationFrame(loop); };
  newBlock(); requestAnimationFrame(loop);
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
      const t = el('b', null, st.name); if (st.id === appStyle()) t.append(icoEl('check'));
      b.append(stylePreview(st), t, el('small', null, st.desc));
      b.onclick = () => { store.set('ic-style', st.id); applyTheme(); renderSettings(); render(); if (current) applyWallpaper(current); };
      grid.append(b);
    }
    inner.append(grid);
    const th = el('button', 'btn block'); th.type = 'button'; th.append(icoEl('contrast')); th.classList.add('with-ic'); th.append('Theme: ' + ({ system: 'System default', light: 'Light', dark: 'Dark' }[store.get('ic-theme') || 'system']));
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
