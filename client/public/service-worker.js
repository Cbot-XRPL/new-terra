/* eslint-disable */
// Minimal service worker for the New Terra portal.
//
// What it does:
//   - Caches the SPA shell (index.html + the built JS/CSS bundle) so the app
//     opens offline.
//   - Caches /uploads/* on first fetch (project photos, receipt thumbs).
//   - Does NOT intercept /api requests — the offline-receipt-queue lives in
//     the page-level IndexedDB helper instead, where we can show pending
//     status in the UI.
//
// Bump SHELL_CACHE when the manifest changes so old shells get evicted.

// Bump these whenever the SW logic changes so browsers fetch the new
// service-worker.js + drop the old caches on next visit. The old SW
// had a clone() bug that left users with broken /assets/ responses;
// v2 is the fixed version.
const SHELL_CACHE = 'newterra-shell-v2';
const RUNTIME_CACHE = 'newterra-runtime-v2';
const SHELL_URLS = ['/', '/portal', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS).catch(() => undefined)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Drop old caches we no longer use.
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache /api responses — they're personalised + changing.
  if (url.pathname.startsWith('/api/')) return;

  // /uploads/* — stale-while-revalidate so photos open instantly the second
  // time even on flaky connections.
  if (url.pathname.startsWith('/uploads/')) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  // Built JS/CSS hashed assets — cache-first, they're immutable.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => cached ?? fetch(request).then((res) => {
        // Clone BEFORE returning — the same response body can't be
        // consumed twice. Without this, cacheClone's internal .clone()
        // throws "Response body is already used" the moment the
        // browser starts reading `res`.
        cacheClone(RUNTIME_CACHE, request, res.clone());
        return res;
      })),
    );
    return;
  }

  // Navigation requests fall back to the cached shell when offline so the
  // SPA opens even with no network. The router takes it from there.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          cacheClone(SHELL_CACHE, request, res.clone());
          return res;
        })
        .catch(() => caches.match('/') || caches.match('/index.html')),
    );
  }
});

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((res) => {
      if (res && res.status === 200) cache.put(request, res.clone()).catch(() => undefined);
      return res;
    })
    .catch(() => cached);
  return cached || networkPromise;
}

function cacheClone(cacheName, request, response) {
  if (!response || response.status !== 200) return;
  caches.open(cacheName).then((cache) => cache.put(request, response.clone()).catch(() => undefined));
}
