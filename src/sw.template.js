// SPDX-License-Identifier: AGPL-3.0-only
// RSVP Speed Reader service worker. TEMPLATE: scripts/build.mjs fills in the version and the file list and writes dist/sw.js.
const APP = 'rsvp-app-__VERSION__', FONTS = 'rsvp-fonts';
const FILES = __FILES__;
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
