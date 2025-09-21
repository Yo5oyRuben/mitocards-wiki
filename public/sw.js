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

// ======== API cache (decks) con stale-while-revalidate ========
const API_CACHE = 'mitocards-api-v1';
const isDecksAPI = (url, req) =>
  req.method === 'GET' &&
  url.origin === self.location.origin &&
  url.pathname.startsWith('/api/decks');

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Imágenes (lo que ya tenías)
  if (isCacheableImage(url, e.request.destination)) {
    e.respondWith(cacheFirst(e.request));
    return;
  }

  // API decks → S-W-R
  if (isDecksAPI(url, e.request)) {
    e.respondWith(staleWhileRevalidateAPI(e.request));
    return;
  }
});

async function staleWhileRevalidateAPI(request) {
  const cache = await caches.open(API_CACHE);
  const cached = await cache.match(request, { ignoreSearch: false });
  const networkPromise = fetch(request, { cache: 'no-store', credentials: 'include' })
    .then(async (resp) => {
      if (resp && resp.ok) await cache.put(request, resp.clone());
      return resp;
    })
    .catch(() => cached || Response.error());

  return cached || networkPromise;
}

// === Invalida entradas concretas del caché cuando la app lo pida ===
self.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg && msg.type === 'invalidate' && Array.isArray(msg.urls)) {
    e.waitUntil((async () => {
      const cache = await caches.open(API_CACHE);
      await Promise.all(msg.urls.map(u =>
        cache.delete(new Request(u), { ignoreSearch: false })
      ));
    })());
  }
});

