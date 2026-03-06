const IMG_CACHE = "mitocards-img-v2";
const API_CACHE = "mitocards-api-v2";
const MAX_IMAGE_ITEMS = 800;
const PLACEHOLDER = "/img/placeholder-card.svg";

const isCacheableImage = (url, destination) => {
  if (destination !== "image") return false;
  return /\/img\/cartas\/(webp_m|webp_l|webp_l_BN)\//.test(url.pathname);
};

const isDecksApi = (url, request) => {
  return (
    request.method === "GET" &&
    url.origin === self.location.origin &&
    url.pathname.startsWith("/api/decks")
  );
};

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("mitocards-") && key !== IMG_CACHE && key !== API_CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (isCacheableImage(url, event.request.destination)) {
    event.respondWith(cacheFirstImage(event.request));
    return;
  }

  if (isDecksApi(url, event.request)) {
    event.respondWith(staleWhileRevalidateApi(event.request));
  }
});

self.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || msg.type !== "invalidate" || !Array.isArray(msg.urls)) return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(API_CACHE);
      await Promise.all(
        msg.urls.map((url) => cache.delete(new Request(url), { ignoreSearch: false }))
      );
    })()
  );
});

async function cacheFirstImage(request) {
  const cache = await caches.open(IMG_CACHE);
  const cached = await cache.match(request, { ignoreSearch: false });
  if (cached) return cached;

  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response.ok) {
      await cache.put(request, response.clone());
      await trimImageCache(cache);
    }
    return response;
  } catch {
    return (await cache.match(PLACEHOLDER)) || Response.error();
  }
}

async function staleWhileRevalidateApi(request) {
  const cache = await caches.open(API_CACHE);
  const cached = await cache.match(request, { ignoreSearch: false });
  const network = fetch(request, { cache: "no-store", credentials: "include" })
    .then(async (response) => {
      if (response && response.ok) {
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached || Response.error());

  return cached || network;
}

async function trimImageCache(cache) {
  const keys = await cache.keys();
  const overflow = keys.length - MAX_IMAGE_ITEMS;
  if (overflow <= 0) return;
  await Promise.all(keys.slice(0, overflow).map((key) => cache.delete(key)));
}
