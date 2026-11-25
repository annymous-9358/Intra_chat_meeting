// Intra Chat moved to https://app.intrachat.workers.dev
// This replaces the old app's service worker: it clears the old offline copy, removes itself and
// sends any open Intra Chat tab to the new address.
const NEW = 'https://app.intrachat.workers.dev/';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) await caches.delete(k);
  await self.registration.unregister();
  for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
    const u = new URL(c.url);
    try { c.navigate(NEW + u.pathname.slice(1) + u.search + u.hash); } catch {}
  }
})()));
self.addEventListener('fetch', e => {
  if (e.request.mode === 'navigate') { const u = new URL(e.request.url); e.respondWith(Response.redirect(NEW + u.pathname.slice(1) + u.search + u.hash, 301)); }
});
