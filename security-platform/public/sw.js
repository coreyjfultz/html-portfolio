// Caches the app shell so it opens instantly and survives flaky signal in the field.
// API data is never cached: it always comes live from the server.
const CACHE = 'secureops-v16';
const SHELL = ['/', '/css/app.css', '/js/app.js', '/js/ui.js', '/js/api.js', '/js/schema.js', '/icons/icon.svg', '/icons/sprite.svg', '/fonts/inter-latin-wght-normal.woff2', '/manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Network first, fall back to cache when offline.
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('/'))));
});

// Chat notifications. Pushes carry no data: ask the server what's new, then show it.
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some(w => w.visibilityState === 'visible')) return; // the open app already shows it
    const hdr = { credentials: 'same-origin', headers: { 'X-Requested-With': 'SecureOps' } };
    let note = null;
    try { note = await (await fetch('/api/push/latest', hdr)).json(); } catch { /* offline */ }
    if (note?.title) return self.registration.showNotification(note.title, { body: note.body || '', tag: note.tag || 'note', renotify: true, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: note.url || '/' } });
    let u = null;
    try { u = await (await fetch('/api/chat/unread', { credentials: 'same-origin', headers: { 'X-Requested-With': 'SecureOps' } })).json(); } catch { /* offline */ }
    if (!u?.total) return self.registration.showNotification('SecureOps', { body: 'You have a new message', tag: 'chat', icon: '/icons/icon-192.png', data: { url: '/#/chat' } });
    const l = u.latest;
    return self.registration.showNotification(l ? `${l.from} · ${l.title}` : 'New message', {
      body: `${l?.text || ''}${u.total > 1 ? `  (+${u.total - 1} more)` : ''}`.trim(), tag: 'chat', renotify: true,
      icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: l ? `/#/chat/${l.channel_id}` : '/#/chat' },
    });
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/#/chat';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins[0];
    if (w) { await w.focus(); return w.navigate ? w.navigate(url) : null; }
    return self.clients.openWindow(url);
  })());
});
