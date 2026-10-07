// Service worker: makes the app installable and keeps it working offline.
// Network-first, so a deploy shows up on the next load; the cache is the offline fallback.
// Bump VERSION when the shell file list changes. Mascot images aren't listed:
// they're cached the first time they load, so a missing one can't break install.
const VERSION = "v9";
const CACHE = `switchboard-${VERSION}`;
const SHELL = [
  "/",
  "/styles.css",
  "/js/app.js",
  "/js/ais.js",
  "/js/rules.js",
  "/js/audio.js",
  "/js/surprises.js",
  "/js/themes.js",
  "/js/usage.js",
  "/js/usage-import.js",
  "/js/store.js",
  "/js/setup.js",
  "/js/attachment.js",
  "/js/world.js",
  "/js/world-nav.js",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];
// Fonts and the pinned Three.js build never change at a given URL, so cache them on first use.
const CACHE_FIRST_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com", "cdn.jsdelivr.net"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: request.mode === "navigate" });
    return cached || (request.mode === "navigate" ? cache.match("/") : Response.error());
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === "opaque") cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // The router is live-only; the page falls back to offline rules on its own.
  if (url.pathname.startsWith("/api/")) return;

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  } else if (CACHE_FIRST_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request));
  }
});
