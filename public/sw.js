const CACHE_NAME = 'deep-hours-v5';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg'
];

function extractSameOriginAssetUrls(html, origin) {
  const found = new Set();
  const attrRegex = /(?:src|href)=["']([^"']+)["']/gi;
  let match;
  while ((match = attrRegex.exec(html)) !== null) {
    try {
      const u = new URL(match[1], origin);
      if (u.origin === origin && u.pathname.startsWith('/assets/')) {
        found.add(u.pathname + u.search);
      }
    } catch {
      // ignore invalid URLs
    }
  }
  return Array.from(found);
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      const urlsToCache = new Set(ASSETS);
      try {
        const res = await fetch('/index.html', { cache: 'no-cache' });
        if (res && res.ok) {
          const html = await res.clone().text();
          await cache.put('/index.html', res.clone());
          await cache.put('/', res.clone());
          const assetUrls = extractSameOriginAssetUrls(html, self.location.origin);
          for (const assetUrl of assetUrls) {
            urlsToCache.add(assetUrl);
          }
        }
      } catch {
        // Fallback to caching base ASSETS if offline during install
      }
      await Promise.all(
        Array.from(urlsToCache).map(url => cache.add(url).catch(() => {}))
      );
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all([
        ...keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)),
        self.clients.claim()
      ])
    )
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const isNav =
    event.request.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname === '/index.html';

  if (isNav) {
    // F6: Network-first for navigation requests (index.html) with cache fallback
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            const indexClone = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, clone);
              cache.put('/index.html', indexClone);
            });
          }
          return response;
        })
        .catch(() =>
          caches
            .match(event.request)
            .then(cached => cached || caches.match('/index.html'))
        )
    );
    return;
  }

  // F6: Stale-while-revalidate for other same-origin assets
  event.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(event.request).then(cached => {
        const networkFetch = fetch(event.request)
          .then(response => {
            if (response && response.status === 200 && response.type === 'basic') {
              cache.put(event.request, response.clone());
            }
            return response;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    )
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
