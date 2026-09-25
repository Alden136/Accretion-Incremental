/* Cache-first app shell. npm run build versions the cache from shell contents. */
const CACHE = 'accretion-abb683275c06c52e';
const SHELL = ['./', './index.html', './app.js', './manifest.webmanifest', './icon.svg',
               './icon-192.png', './icon-512.png', './icon-512-maskable.png'];

/* cache: 'reload' skips the HTTP cache. Without it, a host that sends max-age
   (GitHub Pages sends ten minutes) can hand the new worker the OLD app.js, which
   it then stores under the new version and serves until the next deploy. */
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('accretion-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      // only keep good answers: a cached 404 or 500 would be served forever
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
