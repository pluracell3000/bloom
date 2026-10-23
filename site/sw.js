// Nightstand service worker.
// Shell: cache-first. feed.json: network-first with cache fallback (marked
// with an X-Nightstand-Source header so the app can show its quiet note).
// All paths are relative so the app works under a GitHub Pages subpath.

const VERSION = "nightstand-v2";
const SHELL_CACHE = `${VERSION}-shell`;
const FEED_CACHE = `${VERSION}-feed`;

const SHELL = [
  "./",
  "./style.css",
  "./app.js",
  "./scheduler.mjs",
  "./state.mjs",
  "./manifest.webmanifest",
  "./fonts/Literata.woff2",
  "./fonts/Fraunces.woff2",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET") return;

  if (url.pathname.endsWith("/feed.json") || url.pathname === "/api/feed") {
    event.respondWith(networkFirstFeed(event.request));
    return;
  }
  event.respondWith(cacheFirst(event.request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && request.method === "GET") {
    const cache = await caches.open(SHELL_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstFeed(request) {
  const cache = await caches.open(FEED_CACHE);
  // Cache API does not normally distinguish bearer headers. Use a one-way
  // key fingerprint so a different/missing reader key cannot read this cache.
  let cacheRequest = request;
  if (new URL(request.url).pathname === "/api/feed") {
    const auth = request.headers.get("Authorization");
    if (!auth) return fetch(request);
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(auth));
    const key = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
    cacheRequest = new Request(`${request.url}?reader=${key}`);
  }
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(cacheRequest, response.clone());
    if (response.status === 401 || response.status === 403) await cache.delete(cacheRequest);
    return response;
  } catch {
    const cached = await cache.match(cacheRequest);
    if (cached) {
      // Re-wrap so the app can tell this came from the cache.
      const headers = new Headers(cached.headers);
      headers.set("X-Nightstand-Source", "cache");
      const body = await cached.blob();
      return new Response(body, { status: 200, headers });
    }
    return new Response(JSON.stringify({ error: "offline, no cached feed" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}
