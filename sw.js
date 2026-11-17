// Offline cache. Bump VERSION whenever an app file changes.
// The audio file is versioned by name (sit-bell-v1.ogg) and never changes in place.
var VERSION = 'sit-v2';
var AUDIO = 'sit-bell-v1.ogg';
var FILES = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  AUDIO
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(VERSION)
      .then(function (c) { return c.addAll(FILES); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== VERSION; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.endsWith('/' + AUDIO)) {
    // Media range requests go to the network untouched (the app plays the
    // cached copy from memory instead). The full-file fetch is cache-first:
    // the file is large and never changes.
    if (req.headers.has('range')) return;
    event.respondWith(
      caches.match(AUDIO).then(function (hit) {
        return hit || fetch(req).then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(VERSION).then(function (c) { c.put(AUDIO, copy); });
          }
          return res;
        });
      })
    );
    return;
  }

  // Everything else: network first so updates show up, cache when offline.
  event.respondWith(
    fetch(req)
      .then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      })
      .catch(function () {
        return caches.match(req, { ignoreSearch: true }).then(function (hit) {
          return hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error());
        });
      })
  );
});
