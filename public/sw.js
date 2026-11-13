const CACHE_NAME = 'deep-hours-v9';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-maskable.svg'
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
        const manifestRes = await fetch('/precache-manifest.json', { cache: 'no-cache' });
        if (manifestRes && manifestRes.ok) {
          const manifestJson = await manifestRes.json();
          const list = Array.isArray(manifestJson)
            ? manifestJson
            : Array.isArray(manifestJson?.assets)
              ? manifestJson.assets
              : [];
          for (const entry of list) {
            if (typeof entry === 'string' && entry.startsWith('/')) {
              urlsToCache.add(entry);
            }
          }
        }
      } catch {
        // Manifest may not exist in Vite dev server; fall back to HTML asset discovery
      }

      try {
        const res = await fetch('/index.html', { cache: 'no-cache' });
        if (res && res.ok) {
          const html = await res.clone().text();
          await cache.put('/index.html', res.clone());
          await cache.put('/', res.clone());
          urlsToCache.delete('/index.html');
          urlsToCache.delete('/');
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
  if (
    url.pathname.startsWith('/src/') ||
    url.pathname.startsWith('/@') ||
    url.pathname.startsWith('/node_modules/')
  ) {
    return;
  }

  if (url.pathname === '/precache-manifest.json') {
    event.respondWith(fetch(event.request, { cache: 'no-cache' }));
    return;
  }

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
          .catch(() => cached || new Response('Offline', { status: 503, statusText: 'Offline' }));
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
