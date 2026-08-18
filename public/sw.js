// EduCore service worker — Phase 1 of offline support (see audit item #1).
//
// Scope, deliberately narrow: this makes the app installable as a PWA and
// gives a clean "you're offline" screen instead of the browser's default
// error page when a navigation fails. It does NOT cache or queue any
// application data, and does NOT intercept API calls, Server Actions, or
// React Server Component data fetches — those always hit the network live,
// same as today. Every write in EduCore (attendance, payments, marks, etc.)
// still requires a live connection; this phase only covers the app shell.
//
// Bump CACHE_VERSION when the precached files below change.
const CACHE_VERSION = "educore-shell-v1";
const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = [OFFLINE_URL, "/icon-192.png", "/icon-512.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  // Only handle top-level page navigations. Everything else (JS/CSS chunks,
  // images, API routes, Server Actions, RSC payload fetches) passes straight
  // through untouched -- no caching, no interception, no risk of serving
  // stale application data.
  if (event.request.mode !== "navigate") return;

  event.respondWith(
    fetch(event.request).catch(() => caches.match(OFFLINE_URL).then((res) => res || Response.error())),
  );
});
