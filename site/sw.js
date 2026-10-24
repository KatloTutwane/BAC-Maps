/* BAC Maps service worker: lets the installed app open offline.
 *
 * To ship an update, change VERSION. The new worker precaches everything
 * again under the new name, takes over, and deletes the old caches.
 *
 *   App shell (pages, CSS, JS, icons, campus-map.js, nav-engine.js, the two
 *     campus drawings): cache first.
 *   map_data.js, interiors.js, nav_seed.js and data/timetables.json: network
 *     first, so new map, navigation and timetable data arrive when online; the
 *     cached copy is used offline.
 *   Fonts: the Google Fonts stylesheet is precached when reachable; the font
 *     files it points to change per browser, so they are cached the first
 *     time they load.
 *   /api/ (demo sign in, profile, timetable): never cached, always network.
 */
const VERSION = "v8";   // v8: routes are placed beside or above the panel, never behind it
const SHELL = "cn-shell-" + VERSION;
const RUNTIME = "cn-runtime-" + VERSION;

const SHELL_FILES = [
  "./",
  "index.html",
  "login.html",
  "manifest.webmanifest",
  "tokens.css",
  "app.css",
  "map-theme.css",
  "login.css",
  "icons.js",
  "map-adapter.js",
  "nav-adapter.js",
  "places.js",
  "store.js",
  "geo.js",
  "location.js",
  "pwa.js",
  "theme.js",
  "app.js",
  "login.js",
  "assets/bac-logo.png",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/icon-maskable-512.png",
  "assets/icons/apple-touch-icon.png",
  "assets/icons/favicon-32.png",
  "../web/campus-map.js",
  "../web/map_data.js",
  "../web/interiors.js",
  "../web/nav_seed.js",
  "../web/nav-engine.js",
  "../web/renders/upper_floor.webp",
  "../web/renders/ground_floor.webp",
  "data/timetables.json"
];

const FONT_CSS = "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap";
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // cache: "reload" skips the HTTP cache, so the precache is always fresh
    await cache.addAll(SHELL_FILES.map((url) => new Request(url, { cache: "reload" })));
    // Fonts are a nice to have: a failed font fetch must not break install
    try {
      const res = await fetch(FONT_CSS, { mode: "cors" });
      if (res.ok) await (await caches.open(RUNTIME)).put(FONT_CSS, res);
    } catch (e) { /* offline during install: fonts get cached on first use */ }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = [SHELL, RUNTIME];
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith("cn-") && !keep.includes(n)).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) return;   // network only

  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req, RUNTIME));
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (/\/web\/(map_data|interiors|nav_seed)\.js(on)?$/.test(url.pathname) || url.pathname.endsWith("/site/data/timetables.json")) {
    event.respondWith(networkFirst(req));
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(navigation(req));
    return;
  }
  event.respondWith(cacheFirst(req, SHELL));
});

/* Pages: the cached page, ignoring ?query (for example ?map=off) */
async function navigation(req) {
  const cached = await caches.match(req, { ignoreSearch: true });
  if (cached) return cached;
  try {
    return await fetch(req);
  } catch (e) {
    return (await caches.match("index.html")) || Response.error();
  }
}

async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  // keep fonts (opaque or CORS) and same origin files that weren't precached
  if (res.ok || res.type === "opaque") {
    const copy = res.clone();
    caches.open(cacheName).then((c) => c.put(req, copy));
  }
  return res;
}

async function networkFirst(req) {
  try {
    const res = await fetch(req, { cache: "no-cache" });
    if (res.ok) {
      const copy = res.clone();
      caches.open(SHELL).then((c) => c.put(req, copy));
    }
    return res;
  } catch (e) {
    const cached = await caches.match(req);
    if (cached) return cached;
    throw e;
  }
}
