/*!
 * Mylingo — Service Worker (Agent 32: offline cache consistency + freshness)
 *
 * Strategy:
 *  - Cache-first for immutable static assets (audio, images, icons): these
 *    are content-addressed/rarely-changing, so once cached they're served
 *    instantly and work fully offline. A background revalidation fetch
 *    keeps the cache from ever going stale for long.
 *  - Network-first (falling back to cache) for mutable content JSON
 *    (quiz data, the offline pack index, placement data, dashboards) and
 *    for HTML navigations: a learner online always gets the latest data,
 *    while still getting whatever was last cached if they're offline.
 *
 * Cache ownership (do not blur these):
 *  - STATIC_CACHE / RUNTIME_CACHE (below, versioned by CACHE_VERSION) hold
 *    only the core app shell. They are NOT where selective offline packs
 *    live, and installing/updating the shell must never silently pull in
 *    every pack's content.
 *  - Per-pack caches are owned by `shared/js/offline-packs.js` and are
 *    named `PACK_CACHE_PREFIX + <packId>`. This file must never write pack
 *    content into STATIC_CACHE/RUNTIME_CACHE, and its cache-cleanup on
 *    `activate` must never delete a cache with PACK_CACHE_PREFIX — that
 *    would silently delete a learner's installed offline packs on every
 *    app update. PACK_CACHE_PREFIX must be kept in sync with the
 *    `CACHE_PREFIX` constant in offline-packs.js.
 *
 * Scope: this file must be served from the `site/` root so its scope
 * covers every level app (a1..c2), `main/`, and `shared/`.
 */
'use strict';

var CACHE_VERSION = 'mylingo-v4';
var STATIC_CACHE = CACHE_VERSION + '-static';
var RUNTIME_CACHE = CACHE_VERSION + '-runtime';
// Must match CACHE_PREFIX in shared/js/offline-packs.js.
var PACK_CACHE_PREFIX = 'mylingo-offline-pack-v1-';

// The offline core manifest is generated from offline_packs.py and is the
// single canonical list of files required by the browser shell. Keeping the
// service worker dependent on that manifest prevents the downloadable core
// ZIP and browser precache from drifting apart as the shell changes.
var CORE_MANIFEST_URL = './offline/core-manifest.json';

function coreManifestUrls() {
  return fetch(CORE_MANIFEST_URL, { cache: 'no-store' }).then(function (response) {
    if (!response.ok) throw new Error('core manifest fetch failed: ' + response.status);
    return response.json();
  }).then(function (manifest) {
    if (!manifest || manifest.schema !== 'mylingo.offline-core.v1' || !Array.isArray(manifest.files)) {
      throw new Error('invalid offline core manifest');
    }
    return manifest.files.map(function (rel) {
      return './' + String(rel).replace(/^\.\//, '');
    });
  });
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(function (cache) {
        // The core manifest is intentionally the only source of precache
        // membership. It includes the small offline pack index so the UI can
        // list packs before anything is installed, but never expands into a
        // level pack's quiz-content files. Pack content is fetched and cached
        // exclusively by shared/js/offline-packs.js in per-pack caches.
        return coreManifestUrls().then(function (urls) {
          return cache.addAll(urls);
        });
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) {
              // Never touch a learner's installed offline packs.
              if (key.indexOf(PACK_CACHE_PREFIX) === 0) return false;
              // Only clean up our own previous app-shell cache versions
              // (e.g. mylingo-v3-static). Leave any other/unrecognized
              // cache alone rather than deleting anything not on our
              // current version.
              return key.indexOf('mylingo-v') === 0 && key.indexOf(CACHE_VERSION) !== 0;
            })
            .map(function (key) { return caches.delete(key); })
        );
      })
      .then(function () { return self.clients.claim(); })
  );
});

// Immutable/rarely-changing binary assets: safe to serve cache-first and
// revalidate in the background.
function isImmutableAsset(url) {
  return /\.(mp3|png|svg|ico)$/.test(url.pathname);
}

// Mutable content JSON (quiz data, offline pack index, placement data,
// dashboards, etc.): these can be updated server-side, so freshness matters
// more than instant response. Network-first with a cache fallback keeps an
// online learner current while still working offline from the last-known
// copy — this is also what lets an installed pack's JSON be refreshed
// simply by being online again, without any special "update" step.
function isMutableJson(url) {
  return /\.json$/.test(url.pathname);
}

// R-005 fix: a fetch handler must NEVER let its promise resolve to
// `undefined` — that produces a hard browser network error (or a thrown
// TypeError) instead of a controlled offline experience. Every strategy
// below now guarantees a real Response even on a full cache miss while
// offline. These are deliberate last-resort fallbacks, not real content.
function offlineFallbackResponse(kind) {
  if (kind === 'document') {
    return new Response(
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<title>Offline — Mylingo</title></head><body>' +
      '<h1>You\u2019re offline</h1>' +
      '<p>This page hasn\u2019t been saved for offline use yet. ' +
      'Reconnect and try again, or open a lesson you\u2019ve already visited.</p>' +
      '</body></html>',
      { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
  if (kind === 'json') {
    return new Response(
      JSON.stringify({ error: 'offline', offline: true, cached: false }),
      { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'application/json' } }
    );
  }
  // Binary/misc assets: no synthetic content is meaningful, but we still
  // must not resolve to undefined — return a real (empty) Response.
  return new Response(null, { status: 503, statusText: 'Offline' });
}

function cacheFirst(request, fallbackKind) {
  return caches.match(request).then(function (cached) {
    var networkFetch = fetch(request)
      .then(function (response) {
        if (response && response.ok) {
          var copy = response.clone();
          caches.open(RUNTIME_CACHE).then(function (cache) { cache.put(request, copy); });
        }
        return response;
      })
      .catch(function () {
        // offline: fall back to whatever we had, and if we had nothing,
        // fall back to a deliberate synthetic Response (never undefined).
        return cached || offlineFallbackResponse(fallbackKind);
      });
    // Cache-first: return the cached copy immediately if we have one, but
    // still revalidate in the background so the cache doesn't go stale.
    return cached || networkFetch;
  });
}

function networkFirst(request, fallbackKind) {
  return fetch(request)
    .then(function (response) {
      if (response && response.ok) {
        var copy = response.clone();
        caches.open(RUNTIME_CACHE).then(function (cache) { cache.put(request, copy); });
      }
      return response;
    })
    .catch(function () {
      return caches.match(request).then(function (cached) {
        return cached || offlineFallbackResponse(fallbackKind);
      });
    });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // don't intercept cross-origin requests

  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(networkFirst(request, 'document'));
    return;
  }

  if (isMutableJson(url)) {
    event.respondWith(networkFirst(request, 'json'));
    return;
  }

  if (isImmutableAsset(url)) {
    event.respondWith(cacheFirst(request, 'asset'));
    return;
  }
  // everything else (fonts, misc) — just pass through
});
