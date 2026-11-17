// Offline cache. Bump VERSION whenever an app file changes.
// The audio file is versioned by name (sit-bell-v3.ogg) and never changes in place.
var VERSION = 'sit-v9';
var AUDIO = 'sit-bell-v3.ogg';
var FILES = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

// GitHub Pages lets browsers reuse files for 10 minutes. Always bypass that
// here, or a new version can keep serving the old app.js.
function fresh(url) {
  return new Request(url, { cache: 'no-cache', credentials: 'same-origin' });
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(VERSION).then(function (c) {
      return Promise.all([
        c.addAll(FILES.map(function (f) { return new Request(f, { cache: 'reload' }); })),
        // Keep the (large, unchanging) audio from the previous version if we have it.
        caches.match(AUDIO).then(function (hit) {
          return hit ? c.put(AUDIO, hit) : c.add(AUDIO);
        })
      ]);
    }).then(function () { return self.skipWaiting(); })
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

  // Everything else: network first (past the browser cache) so updates show
  // up straight away; the offline copy when there is no connection.
  event.respondWith(
    fetch(fresh(req.url))
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
