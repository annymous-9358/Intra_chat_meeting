/* Intra Chat service worker: offline app shell + WhatsApp-style push notifications */
const CACHE = 'intra-chat-v17';
const SHELL = ['/', '/index.html', '/app.css', '/app.js', '/manifest.webmanifest', '/logo.svg', '/favicon.ico', '/icons/icon-192.png', '/icons/badge-96.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// App files: network first (so updates show up straight away), cache as fallback when offline. API calls are never cached.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request);
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {}); }
      return res;
    } catch {
      return (await caches.match(e.request)) || (e.request.mode === 'navigate' ? caches.match('/index.html') : Response.error());
    }
  })());
});

// Which group each open window is showing (so we don't notify about the chat you're looking at)
const viewing = new Map();   // clientId -> { room, visible }
self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type === 'viewing' && e.source) viewing.set(e.source.id, { room: d.room || null, visible: !!d.visible });
  if (d.type === 'read' && d.room) e.waitUntil(clearRoom(d.room));
});
async function clearRoom(room) {
  for (const n of await self.registration.getNotifications({ tag: 'room-' + room })) n.close();
  await updateBadge();
}
// App-icon badge is updated by the open app (navigator.setAppBadge); calling it from the worker crashes some Chromium builds.
async function updateBadge() {}

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Intra Chat', body: e.data?.text() || 'New message' }; }
  e.waitUntil(showMessage(d));
});
async function showMessage(d) {
  const room = d.room || 'general';
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  // Someone is looking at this exact chat right now → no notification needed
  const watching = wins.some(c => { const v = viewing.get(c.id); return v && v.visible && v.room === room && c.visibilityState === 'visible'; });
  if (watching) return;

  // "Remind me" notifications stand alone and always show
  if (d.type === 'reminder') {
    return self.registration.showNotification(d.title || '⏰ Reminder', {
      body: d.body || '', tag: 'reminder-' + (d.ts || Date.now()), requireInteraction: true,
      icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', timestamp: d.ts || Date.now(), vibrate: [120, 60, 120],
      data: { url: d.url || '/', room, act: 'show', key: (d.url || '').split('k=')[1] ? decodeURIComponent(d.url.split('k=')[1]) : null, direct: true },
    });
  }
  // Stack messages per group like WhatsApp: "Floor (3 messages)" with the latest lines
  const tag = 'room-' + room;
  const prev = (await self.registration.getNotifications({ tag }))[0];
  const line = d.name ? `${d.name}: ${d.body}` : d.body;
  const lines = [...(prev?.data?.lines || []), line].slice(-5);
  const count = (prev?.data?.count || 0) + 1;
  const title = (d.mentioned === true ? '@ ' : d.replyToYou === true ? '↩ ' : '') + (count > 1 ? `${d.title} (${count} messages)` : d.title);
  await self.registration.showNotification(title, {
    body: count > 1 ? lines.join('\n') : line,
    tag, renotify: true,
    icon: '/icons/icon-192.png', badge: '/icons/badge-96.png',
    timestamp: d.ts || Date.now(),
    vibrate: [80, 40, 80],
    // Quick actions: voice/walkie messages get Reply (hold-to-talk) and Play; other messages get Reply
    actions: d.type === 'friend' ? [] : d.audio ? [{ action: 'reply', title: '🎙 Reply' }, { action: 'play', title: '▶ Play' }] : [{ action: 'reply', title: '↩ Reply' }],
    data: { url: d.url || '/', room, count, lines, key: d.key, audio: !!d.audio },
  });
  await updateBadge();
}

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const { url = '/', room, key, audio, act: dataAct, direct } = e.notification.data || {};
  const act = e.action === 'reply' ? (audio ? 'talk' : 'reply') : e.action === 'play' ? 'play' : dataAct || 'open';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find(c => new URL(c.url).origin === location.origin);
    if (win) { await win.focus(); win.postMessage({ type: 'open', room, act, key }); }
    else await self.clients.openWindow(act === 'open' || direct ? url : `${url}?a=${act}&k=${encodeURIComponent(key || '')}`);
    await updateBadge();
  })());
});
self.addEventListener('notificationclose', e => e.waitUntil(updateBadge()));
