// Fuerza service worker: works offline. Data JSON = network first; images = cache first.
const CACHE = 'fuerza-v8';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'data/exercises.json', 'data/routines.json', 'data/plan.json'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL);
    try { // precache every exercise image so the first session works without signal
      const ex = await (await fetch('data/exercises.json', {cache: 'no-cache'})).json();
      await c.addAll([...new Set(ex.flatMap(x => x.images || []))]);
    } catch (err) {}
    self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const isImg = url.pathname.includes('/img/') || url.pathname.includes('/icons/');
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    if (isImg) {
      const hit = await c.match(e.request); if (hit) return hit;
      const r = await fetch(e.request); if (r.ok) c.put(e.request, r.clone()); return r;
    }
    try { // network first so new plans/routines and app updates arrive right away
      const r = await fetch(e.request, {cache: 'no-cache'}); if (r.ok) c.put(e.request, r.clone()); return r;
    } catch (err) {
      return (await c.match(e.request, {ignoreSearch: true})) || (await c.match('index.html')) || Response.error();
    }
  })());
});
