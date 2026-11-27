const CACHE_NAME = 'amt-eusebio-v12-bank-holidays-reports-restore-r1-offline-t1';
const TAILWIND_URL = 'https://cdn.tailwindcss.com/';
const APP_SHELL = [
  './',
  './index.html',
  './fundo-amt.jpeg',
  './manifest.webmanifest',
  './apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/icon-180.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Each path is relative to this service worker, including GitHub Pages project sites.
    await cache.addAll(APP_SHELL);
    // Preserve the original CDN script, including its runtime configuration.
    const request = new Request(TAILWIND_URL, {mode: 'no-cors', cache: 'reload'});
    const response = await fetch(request);
    if (!response.ok && response.type !== 'opaque') throw new Error('Tailwind unavailable');
    await cache.put(TAILWIND_URL, response);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.includes('eusebio') && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.href === TAILWIND_URL) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(TAILWIND_URL);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok || response.type === 'opaque') await cache.put(TAILWIND_URL, response.clone());
      return response;
    })());
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put('./index.html', response.clone());
        }
        return response;
      } catch (_) {
        return (await caches.match(request)) || (await caches.match('./index.html'));
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response && response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    } catch (_) {
      return new Response('', {status: 503, statusText: 'Offline'});
    }
  })());
});
