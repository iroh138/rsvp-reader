// RSVP Speed Reader service worker. Version 57f47aacb2
const APP = 'rsvp-app-57f47aacb2', FONTS = 'rsvp-fonts';
const FILES = ["./", "index.html", "manifest.webmanifest", "vendor/pdf.min.js", "vendor/pdf.worker.min.js", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png"];
self.addEventListener('install', e => { e.waitUntil(caches.open(APP).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== APP && k !== FONTS).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.origin === location.origin) {
    // the app works offline: answer from the cache first, page loads always get the cached app
    const key = req.mode === 'navigate' ? 'index.html' : req;
    e.respondWith(caches.open(APP).then(c => c.match(key, { ignoreSearch: true }).then(hit => hit || fetch(req))));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONTS).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
  }
});
