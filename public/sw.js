// Service worker for MOT PWA
// IMPORTANT: BASE must match vite.config.js base exactly
const BASE       = '/MOT_Circle_v2/';
const CACHE_NAME = 'mot-pwa-v3';
const PRECACHE = [
  BASE,
  BASE + 'index.html',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Only handle requests within our scope
  if (!url.pathname.startsWith(BASE)) return;

  // Navigation requests: network-first so updated HTML always loads immediately
  // Falls back to cache only if offline
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(BASE + 'index.html')
        .then(res => {
          // Update cache with fresh response
          caches.open(CACHE_NAME).then(c => c.put(BASE + 'index.html', res.clone()));
          return res;
        })
        .catch(() => caches.match(BASE + 'index.html'))
    );
    return;
  }

  // Assets: cache-first, fall back to network and cache the response
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          caches.open(CACHE_NAME).then(c => c.put(e.request, res.clone()));
        }
        return res;
      });
    })
  );
});
