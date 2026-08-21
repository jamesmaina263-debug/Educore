// EduCore service worker.
//
// Phase 1 (see audit item #1): installable PWA + a clean "you're offline"
// screen instead of the browser's default error page when a navigation
// fails.
//
// Phase 2 (this pass): lets someone move between modules while offline,
// not just stay on the one page they had open. Two things are cached, on
// two different, deliberately separate strategies:
//
//  - App pages (full-document navigations, e.g. clicking a sidebar link
//    while offline forces a hard navigation -- see sidebar-nav.tsx): cached
//    network-first, in RUNTIME_CACHE. Every successful visit refreshes the
//    cached copy; if the network is down, the last-cached copy is served
//    instead of failing. This DOES contain rendered, per-user, per-school
//    data (whatever that page's Server Component fetched at cache time) --
//    which is exactly why it's wiped from the client side on every sign-out
//    (see clearOfflineCaches() in lib/offline/clear-on-logout.ts / the
//    postMessage listener below). Never assume a cached page here still
//    reflects who's signed in.
//  - Next's built JS/CSS chunks (`/_next/static/*`): cached cache-first, in
//    STATIC_CACHE. Safe to treat completely differently from the above --
//    these files are content-hashed by Next's build, contain no tenant
//    data, and a given hash never changes meaning. Kept across sign-outs
//    (no reason to force a re-download of the exact same bytes just
//    because a different user logged in on the same device); still wiped
//    on every deploy via the cache-name version bump below, same as
//    everything else.
//
// Server Actions, API routes, and Supabase calls are still never touched
// by any of this -- every write in EduCore still requires a live
// connection and goes through the pending-mutations queue
// (lib/offline/queue.ts), not this file.
//
// Bump CACHE_VERSION whenever the precached files below, or the caching
// logic itself, changes -- this also invalidates RUNTIME_CACHE and
// STATIC_CACHE for every device on the next activate, so a bad or stale
// cached page can't outlive a deploy.
const CACHE_VERSION = "educore-shell-v3";
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const KNOWN_CACHES = [CACHE_VERSION, RUNTIME_CACHE, STATIC_CACHE];

const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = [OFFLINE_URL, "/icon-192.png", "/icon-512.png", "/manifest.webmanifest"];

// A minimal, fully inline fallback -- used only if OFFLINE_URL itself somehow
// isn't in the cache when a navigation fails (e.g. this device installed the
// service worker moments ago and precaching hasn't finished, or one of the
// other precache entries transiently failed), AND there's no cached copy of
// the requested page either. This never touches the network, so it can't
// itself fail; it exists purely so a failed navigation always ends up on
// *some* EduCore-branded screen instead of the browser's bare native error
// page.
const INLINE_FALLBACK = new Response(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>You're offline — EduCore</title></head>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    display:flex;min-height:100vh;align-items:center;justify-content:center;
    margin:0;background:#f8fafc;color:#1e293b;text-align:center;padding:24px;box-sizing:border-box;">
    <div>
      <h1 style="font-size:1.25rem;margin:0 0 8px;">No connection</h1>
      <p style="color:#64748b;margin:0 0 20px;max-width:340px;">This page hasn't been visited on this device yet, so EduCore can't show it offline. Check your connection and try again.</p>
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
      .then((keys) => Promise.all(keys.filter((key) => !KNOWN_CACHES.includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Client-triggered cache clear -- called from lib/offline/clear-on-logout.ts
// right before sign-out completes, so the next person to use this device
// (or this same person at a different school) can never have a stale,
// still-cached page from the previous session served to them offline.
// STATIC_CACHE is deliberately left alone (see file header) -- only
// RUNTIME_CACHE holds anything tenant-specific.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "CLEAR_RUNTIME_CACHE") return;
  event.waitUntil(caches.delete(RUNTIME_CACHE));
});

function isStaticAsset(url) {
  return url.origin === self.location.origin && url.pathname.startsWith("/_next/static/");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Next's content-hashed build output: cache-first. A given hashed
  // filename's bytes never change, so there's no staleness risk, and this
  // is what lets a previously-visited page's JS actually hydrate (not just
  // display static HTML) once it's served from RUNTIME_CACHE below while
  // offline.
  if (request.method === "GET" && isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        });
        // No offline fallback for a missing static chunk -- if this happens
        // it means the page itself (see below) also won't be servable from
        // cache, so this request failing is moot; the navigation fallback
        // is what the user actually sees.
      }),
    );
    return;
  }

  // Only handle top-level page navigations from here on. API routes,
  // Server Actions, RSC payload fetches (Next's client-side <Link>
  // navigation, which never reaches this service worker at all -- see
  // sidebar-nav.tsx for why offline clicks force a real navigation
  // instead), and third-party requests pass straight through untouched.
  if (request.mode !== "navigate") return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Network-first: cache every successful same-origin page visit so
        // it's available offline later. Don't cache redirects/errors, and
        // don't cache cross-origin navigations (there are none in this app,
        // but being explicit costs nothing).
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cachedPage) => {
          if (cachedPage) return cachedPage;
          // Never visited this page while online, or it wasn't cacheable
          // (e.g. it redirected) -- fall back to the generic offline
          // screen instead of the browser's bare network-error page.
          return caches
            .match(OFFLINE_URL)
            .then((cached) => cached || fetch(OFFLINE_URL))
            .catch(() => INLINE_FALLBACK);
        }),
      ),
  );
});
