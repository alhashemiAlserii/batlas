/*
 * Batlas service worker: makes the site installable and gives a friendly offline page.
 *
 * It caches ONLY the site shell (public HTML pages, /css, /js, /img, /fonts, the manifest and icons).
 * It NEVER touches (no respondWith, so the browser handles them exactly as without a worker):
 *   /api/*  /media/*  /uploads/*  /play/** (Sky Crew)  /ws/*  /healthz  /studio-console*  /admin*
 *   any non-GET request, any request with a Range header, cross-origin requests and WebSockets
 *   (WebSocket traffic never passes through a service worker anyway).
 * Strategy: network-first for pages, CSS and JS (online users always get the fresh deploy; the cache is
 * only the offline copy); cache-first for images/fonts/icons. HTTP errors (e.g. the 503 maintenance page)
 * are passed through unchanged and never cached; only an unreachable network falls back to the cache,
 * then to /offline.html. Bump VERSION to drop every old cache on the next visit.
 */
const VERSION = 'batlas-shell-v2';
const PRECACHE = ['/offline.html', '/css/site.css', '/js/offline.js', '/manifest.webmanifest', '/img/icons/icon-192.png', '/img/icons/icon-512.png', '/img/icons/apple-touch-icon-180.png', '/favicon.ico'];

const NEVER = /^\/(api|media|uploads|play|ws|studio-console|admin)(\/|$)|^\/healthz$|^\/sw\.js$/;
const STATIC_NET_FIRST = /^\/(css|js)\//;
const STATIC_CACHE_FIRST = /^\/(img|fonts)\/|^\/favicon\.ico$|^\/apple-touch-icon\.png$|^\/manifest\.webmanifest$/;
/** Public page routes (same list as the server's page routes, minus private/gated ones). */
const PAGES = /^\/($|games(\/[^/]+)?$|news(\/[^/]+)?$|login$|register$|profile$|u\/[^/]+$|contact$|settings$|set-pin$|forgot-password$|reset-password$|verify-email$|offline\.html$)/;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

/** Only complete, same-origin, 200 responses that allow storing go into the cache. */
function cacheable(res) {
  if (!res || res.status !== 200 || res.type !== 'basic' || res.redirected) return false;
  const cc = res.headers.get('Cache-Control') || '';
  return !/no-store|private/i.test(cc);
}

async function put(req, res) {
  if (!cacheable(res)) return;
  try { await (await caches.open(VERSION)).put(req, res); } catch { /* quota or opaque: ignore */ }
}

async function networkFirst(event, isPage) {
  const req = event.request;
  try {
    const res = await fetch(req);
    // cache key for pages ignores the query string (e.g. /login?next=...)
    event.waitUntil(put(isPage ? new Request(new URL(req.url).pathname) : req, res.clone()));
    return res;
  } catch (err) {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(isPage ? new URL(req.url).pathname : req);
    if (hit) return hit;
    if (isPage || req.mode === 'navigate') {
      const off = await cache.match('/offline.html');
      if (off) return off;
    }
    throw err;
  }
}

async function cacheFirst(event) {
  const hit = await caches.match(event.request, { cacheName: VERSION });
  if (hit) return hit;
  const res = await fetch(event.request);
  event.waitUntil(put(event.request, res.clone()));
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER.test(url.pathname)) return;
  if (req.mode === 'navigate' || PAGES.test(url.pathname)) {
    if (!PAGES.test(url.pathname)) return; // unknown page: let the server answer (404 etc.)
    return event.respondWith(networkFirst(event, true));
  }
  if (STATIC_NET_FIRST.test(url.pathname)) return event.respondWith(networkFirst(event, false));
  if (STATIC_CACHE_FIRST.test(url.pathname)) return event.respondWith(cacheFirst(event));
  // anything else: not part of the shell, leave it to the network
});

// Lets the page ask which version is active (used by tests / debugging).
self.addEventListener('message', (event) => {
  if (event.data === 'batlas:version') event.source?.postMessage({ version: VERSION });
});
