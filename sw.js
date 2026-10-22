const CACHE_NAME = 'escala-amt-eusebio-v44';
const APP_SHELL = ['./index.html', './fundo-amt.jpeg', './manifest.webmanifest', './brasao-amt-oficial.jpeg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/icon-180.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('escala-amt-eusebio-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Navigation: network first, with the cached app as offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
      return response;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  // Cache same-origin app files and cache successful CDN/font responses after first use.
  event.respondWith(caches.match(request).then(cached => {
    if (cached) return cached;
    return fetch(request).then(response => {
      if (response && (response.ok || response.type === 'opaque')) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
      }
      return response;
    }).catch(() => {
      if (url.origin === self.location.origin) return caches.match('./index.html');
      return new Response('', {status: 503, statusText: 'Offline'});
    });
  }));
});
