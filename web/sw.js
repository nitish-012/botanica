// Botanica service worker: caches the app so it runs fully offline.
// It never sends data anywhere; it only serves the files listed below.
// BUILD is a hash of every cached file. Run `node tests/helpers/stamp.js` after changing any app file;
// the unit tests fail (and block publishing) if it is stale, so phones always pick up the update.
const BUILD = "a3ddf3a6612e";
const VERSION = "botanica-" + BUILD;
const FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./core.js",
  "./app.js",
  "./plants_database.json",
  "./manifest.webmanifest",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  // Take over as soon as the new files are cached, so phones don't keep running an old version.
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
});

// Cache first: the app opens instantly and works with no connection.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req))
  );
});
