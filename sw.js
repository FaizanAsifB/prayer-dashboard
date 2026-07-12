/**
 * sw.js
 * ---------------------------------------------------------------------------
 * Service worker responsibility: make the app shell (HTML/CSS/JS/icons)
 * installable and fully functional offline via a cache-first strategy.
 *
 * Versioned cache: bump CACHE_VERSION whenever any precached file
 * changes. The activate handler deletes every cache whose name doesn't
 * match the current version, so old assets never linger and silently
 * eat the Pi's limited storage. This is the "automatic cache update"
 * mechanism the brief asks for — no manual cache-clearing step needed
 * on deploy, just bump the version string below.
 *
 * Strategy split:
 *  - Same-origin GET requests (the app shell): cache-first, falling
 *    back to network and populating the cache on a miss. This is what
 *    makes the kiosk boot instantly and work with zero connectivity.
 *  - Cross-origin requests (Open-Meteo, AlAdhan): NOT intercepted here.
 *    They pass straight through to the network. Offline resilience for
 *    those lives in js/api.js's localStorage cache instead, which
 *    already understands per-endpoint staleness (e.g. "weather is fine
 *    up to 3h old, prayer times up to 36h old") — logic that belongs in
 *    application code, not a generic HTTP cache.
 */

const CACHE_VERSION = "v1.1.0";
const CACHE_NAME = `prayer-dashboard-${CACHE_VERSION}`;

// Every file required for a fully offline first paint. Kept as an
// explicit list (rather than a glob) so a broken/renamed file surfaces
// immediately as an install failure instead of a silent runtime 404.
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/variables.css",
  "./css/typography.css",
  "./css/layout.css",
  "./css/components.css",
  "./css/animations.css",
  "./js/app.js",
  "./js/api.js",
  "./js/clock.js",
  "./js/weather.js",
  "./js/prayers.js",
  "./js/countdown.js",
  "./js/hijri.js",
  "./js/settings.js",
  "./js/ui.js",
  "./data/settings.json",
  "./data/prayer-timings.json",
  "./assets/icons/icon-192.svg",
  "./assets/icons/icon-512.svg",
  "./assets/icons/icon-maskable-512.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      // Activate the new service worker as soon as it finishes
      // installing rather than waiting for all tabs to close — a kiosk
      // typically has exactly one long-lived tab, so the default
      // "wait for reload" behaviour would delay updates indefinitely.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith("prayer-dashboard-") && key !== CACHE_NAME,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle same-origin GET requests; let everything else
  // (cross-origin API calls, non-GET requests) pass through untouched.
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        // Cache-first: serve immediately, then refresh the cache in the
        // background so the next load picks up any change without the
        // current load having to wait on the network.
        fetchAndUpdateCache(request);
        return cached;
      }
      return fetchAndUpdateCache(request).catch(() => {
        // Last resort for a navigation request with nothing cached and
        // no network: serve the app shell so the kiosk shows *something*
        // rather than a browser error page.
        if (request.mode === "navigate") {
          return caches.match("./index.html");
        }
        throw new Error("Resource unavailable offline and not cached");
      });
    }),
  );
});

function fetchAndUpdateCache(request) {
  return fetch(request).then((response) => {
    if (response && response.ok) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
    }
    return response;
  });
}
