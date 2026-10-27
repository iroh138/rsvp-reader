// SPDX-License-Identifier: AGPL-3.0-only
// RSVP Speed Reader service worker. TEMPLATE: scripts/build.mjs fills in the version and the file list and writes dist/sw.js.
// Only same-origin requests are handled; the app makes no third-party requests (CONTROLS.md PRV-04).
// Activation deletes every other cache, including the old 'rsvp-fonts' cache of Google Fonts files.
const APP = 'rsvp-app-__VERSION__';
const FILES = __FILES__;
// Hosts may answer a file with a redirect (Cloudflare Pages: /index.html -> /). A cached response that was redirected
// is refused by browsers for page loads (ERR_FAILED), so every file is stored as a plain, non-redirected copy.
async function store(c, f) {
  const r = await fetch(f, { cache: 'reload' });
  if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
  await c.put(f, r.redirected ? new Response(await r.blob(), { status: r.status, statusText: r.statusText, headers: r.headers }) : r);
}
self.addEventListener('install', e => { e.waitUntil(caches.open(APP).then(c => Promise.all(FILES.map(f => store(c, f)))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== APP).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.origin === location.origin) {
    // the app works offline: answer from the cache first, page loads always get the cached app
    const key = req.mode === 'navigate' ? './' : req;   // the app's own URL, never the redirecting 'index.html'
    e.respondWith(caches.open(APP).then(c => c.match(key, { ignoreSearch: true }).then(hit => hit || fetch(req))));
    return;
  }
});
