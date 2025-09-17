const CACHE_NAME = 'mitocards-img-v1';
const MAX_ITEMS = 800;
const PLACEHOLDER = '/img/placeholder-card.png';

// Cacheamos solo medianas y bajas (coincide con tus rutas /img/cartas/webp_{m,l}/…)
const isCacheableImage = (url, dest) => {
  if (dest !== 'image') return false;
  return /\/img\/cartas\/(webp_m|webp_l)\//.test(url.pathname);
};

self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (isCacheableImage(url, e.request.destination)) {
    e.respondWith(cacheFirst(e.request));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: false });
  if (cached) return cached; // cache-first puro → 0 descargas repetidas
  try {
    const resp = await fetch(request, { cache: 'no-store' });
    if (resp.ok) {
      await cache.put(request, resp.clone());
      trim(cache);
    }
    return resp;
  } catch {
    return cache.match(PLACEHOLDER) || Response.error();
  }
}

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_ITEMS) await cache.delete(keys[0]); // FIFO simple
}
