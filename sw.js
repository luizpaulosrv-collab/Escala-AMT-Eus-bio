const CACHE_NAME = 'amt-eusebio-v12-bank-holidays-reports-restore-r1-offline-s5-2';
const PREVIOUS_CACHE = 'amt-eusebio-v12-bank-holidays-reports-restore-r1-offline-s5-1';
const PDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const TAILWIND_URL = 'https://cdn.tailwindcss.com/';
const FA_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/';
const FA_ASSETS = ['css/all.min.css', 'webfonts/fa-solid-900.woff2', 'webfonts/fa-regular-400.woff2', 'webfonts/fa-brands-400.woff2', 'webfonts/fa-v4compatibility.woff2'].map(path => FA_BASE + path);
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Montserrat:wght@600;700;800;900&display=swap';
const APP_SHELL = [
  './',
  './index.html',
  './fundo-amt.jpeg',
  './brasao-amt-oficial.jpeg',
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
    await cache.addAll(APP_SHELL.map(path => new Request(new URL(path, self.registration.scope), {cache: 'reload'})));
    const html = await cache.match('./index.html');
    if (!html || !(await html.text()).includes('Restauração corrigida R1 | Offline S5.2')) throw new Error('Versão HTML incompatível');
    // Preserve the original CDN script, including its runtime configuration.
    const request = new Request(TAILWIND_URL, {mode: 'no-cors', cache: 'reload'});
    const response = await fetch(request);
    if (!response.ok && response.type !== 'opaque') throw new Error('Tailwind unavailable');
    await cache.put(TAILWIND_URL, response);
    await Promise.all(FA_ASSETS.map(async url => {
      const response = await fetch(url, {mode: 'cors', cache: 'reload'});
      if (!response.ok) throw new Error('Font Awesome unavailable: ' + url);
      await cache.put(url, response);
    }));
    // Cache the original Google Fonts stylesheet for this browser and its font files.
    const fontCSS = await fetch(FONT_CSS, {mode: 'cors', cache: 'reload'});
    if (!fontCSS.ok) throw new Error('Google Fonts stylesheet unavailable');
    const css = await fontCSS.clone().text();
    const fontURLs = [...new Set(Array.from(css.matchAll(/url\(\s*['"]?(https:\/\/fonts\.gstatic\.com\/[^)'"\s]+)['"]?\s*\)/g), m => m[1]))];
    if (!fontURLs.length) throw new Error('Google Fonts stylesheet contains no font URLs');
    await Promise.all(fontURLs.map(async url => {
      const response = await fetch(url, {mode: 'cors', cache: 'reload'});
      if (!response.ok) throw new Error('Google font unavailable: ' + url);
      await cache.put(url, response);
    }));
    await cache.put(FONT_CSS, fontCSS);
    const pdfRequest = new Request(PDF_URL, {mode: 'no-cors', cache: 'reload'});
    const pdfResponse = await fetch(pdfRequest);
    if (!pdfResponse.ok && pdfResponse.type !== 'opaque') throw new Error('jsPDF unavailable');
    await cache.put(PDF_URL, pdfResponse);
    const report = await inspectOffline(false);
    if (report.missing.length) throw new Error("Cache incompleto: " + report.missing.join(", "));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('amt-eusebio-') && key !== CACHE_NAME && key !== PREVIOUS_CACHE && !key.endsWith('-offline-a1') && !key.endsWith('-offline-a5')).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.href === TAILWIND_URL || url.href === PDF_URL) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(url.href);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok || response.type === 'opaque') await cache.put(url.href, response.clone());
      return response;
    })());
    return;
  }
  if (url.href.startsWith(FA_BASE)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok || response.type === 'opaque') await cache.put(request, response.clone());
      return response;
    })());
    return;
  }
  if (url.href === FONT_CSS || url.origin === 'https://fonts.gstatic.com') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok || response.type === 'opaque') await cache.put(request, response.clone());
      return response;
    })());
    return;
  }
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match('./index.html');
      if (cached) return cached;
      // Recover only the matching release, never mix a new HTML with an old worker.
      try {
        const response = await fetch(new Request(new URL('./index.html', self.registration.scope), {cache: 'reload'}));
        if (!response.ok || !(await response.clone().text()).includes('Restauração corrigida R1 | Offline S5.2')) throw new Error('Versão incompatível');
        await cache.put('./index.html', response.clone());
        return response;
      } catch (_) {
        return new Response('Aplicativo indisponível. Reconecte à internet e reabra para atualizar.', {status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8'}});
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
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

// Read-only inspection, with optional recovery of missing resources of this release.
async function inspectOffline(repair) {
  const cache = await caches.open(CACHE_NAME);
  const urls = [...APP_SHELL.map(path => new URL(path, self.registration.scope).href), TAILWIND_URL, PDF_URL, ...FA_ASSETS, FONT_CSS];
  const missing = [];
  async function check(url) {
    let response = await cache.match(url);
    if (!response && repair) {
      try {
        const external = new URL(url).origin !== self.location.origin;
        const mode = url === TAILWIND_URL || url === PDF_URL ? 'no-cors' : external ? 'cors' : 'same-origin';
        const fresh = await fetch(new Request(url, {mode, cache:'reload'}));
        if (!fresh.ok && fresh.type !== 'opaque') throw new Error('HTTP');
        if (url === new URL('./index.html', self.registration.scope).href || url === self.registration.scope) {
          if (!(await fresh.clone().text()).includes('Restauração corrigida R1 | Offline S5.2')) throw new Error('Versão incompatível');
        }
        await cache.put(url, fresh.clone()); response = fresh;
      } catch (_) {}
    }
    if (!response) missing.push(url);
    return response;
  }
  await Promise.all(urls.map(check));
  const css = await cache.match(FONT_CSS);
  if (css) {
    const fonts = [...new Set(Array.from((await css.text()).matchAll(/url\(\s*['"]?(https:\/\/fonts\.gstatic\.com\/[^)'"\s]+)['"]?\s*\)/g), m => m[1]))];
    if (!fonts.length) missing.push('Fontes: lista indisponível');
    urls.push(...fonts); await Promise.all(fonts.map(check));
  }
  return {version:'S5.2', total:urls.length, missing};
}
self.addEventListener('message', event => {
  if (!event.data || event.data.type !== 'AMT_OFFLINE_CHECK' || !event.ports[0]) return;
  event.waitUntil(inspectOffline(event.data.repair === true).then(report => event.ports[0].postMessage(report)).catch(() => event.ports[0].postMessage({error:true})));
});
