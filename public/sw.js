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
const CACHE_VERSION = "educore-shell-v2";
const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = [OFFLINE_URL, "/icon-192.png", "/icon-512.png", "/manifest.webmanifest"];

// A minimal, fully inline fallback -- used only if OFFLINE_URL itself somehow
// isn't in the cache when a navigation fails (e.g. this device installed the
// service worker moments ago and precaching hasn't finished, or one of the
// other precache entries transiently failed). This never touches the
// network, so it can't itself fail; it exists purely so a failed navigation
// always ends up on *some* EduCore-branded screen instead of the browser's
// bare native error page.
const INLINE_FALLBACK = new Response(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>You're offline — EduCore</title></head>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    display:flex;min-height:100vh;align-items:center;justify-content:center;
    margin:0;background:#f8fafc;color:#1e293b;text-align:center;padding:24px;box-sizing:border-box;">
    <div>
      <h1 style="font-size:1.25rem;margin:0 0 8px;">No connection</h1>
      <p style="color:#64748b;margin:0 0 20px;max-width:340px;">EduCore couldn't reach the server. Check your connection and try again.</p>
      <button onclick="location.reload()" style="background:#1e3a8a;color:#fff;border:none;
        border-radius:8px;padding:10px 20px;font-size:0.9375rem;font-weight:500;cursor:pointer;">Try again</button>
    </div>
  </body></html>`,
  { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) =>
        // Cache each precache URL independently instead of cache.addAll(),
        // which is all-or-nothing -- one failed fetch (a transient blip, or
        // a single missing icon) used to abort the whole precache batch,
        // silently leaving OFFLINE_URL uncached and reintroducing the exact
        // bug this fallback exists to prevent.
        Promise.all(
          PRECACHE_URLS.map((url) =>
            cache.add(url).catch((err) => console.warn(`[sw] precache failed for ${url}:`, err)),
          ),
        ),
      )
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
    fetch(event.request).catch(() =>
      caches
        .match(OFFLINE_URL)
        // Cache miss (e.g. precache hadn't finished on this device yet) --
        // try fetching the offline page live before giving up on it.
        .then((cached) => cached || fetch(OFFLINE_URL))
        // If that also fails, use the fully inline fallback so the browser
        // never renders its own bare network-error page in EduCore's place.
        .catch(() => INLINE_FALLBACK),
    ),
  );
});
