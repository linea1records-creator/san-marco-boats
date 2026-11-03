/* San Marco Boat - service worker: notifiche push + copia dell'app sul telefono per aprirla anche senza internet */
var CACHE = 'smb-app-v2';
var FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];
self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).catch(function () {}));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k.indexOf('smb-app-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
// solo i file dell'app (stesso sito): prima la rete, così le novità arrivano subito; senza rete la copia salvata.
// Database, mappe e font non passano di qui.
self.addEventListener('fetch', function (e) {
  var r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== self.location.origin) return;
  var page = r.mode === 'navigate';
  e.respondWith(new Promise(function (ok) {
    var done = false;
    function fromCache() { return caches.match(page ? './index.html' : r, { ignoreSearch: page }).then(function (m) { return m || caches.match('./'); }); }
    // con internet si aspetta sempre la versione nuova; la copia salvata si apre solo senza rete
    // (o se dopo 25 secondi la rete non ha ancora risposto)
    var t = setTimeout(function () { fromCache().then(function (m) { if (m && !done) { done = true; ok(m); } }); }, self.navigator && self.navigator.onLine === false ? 0 : 25000);
    fetch(r).then(function (res) {
      if (res && res.ok) { var cp = res.clone(); caches.open(CACHE).then(function (c) { c.put(page ? './index.html' : r, cp); }); }
      clearTimeout(t); if (!done) { done = true; ok(res); }
    }).catch(function () {
      clearTimeout(t); fromCache().then(function (m) { if (!done) { done = true; ok(m || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })); } });
    });
  }));
});
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: 'San Marco Boat', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'San Marco Boat', {
    body: d.body || '', tag: d.tag || 'smb', icon: 'icon-192.png', badge: 'icon-192.png',
    data: { url: d.url || './' }, vibrate: [120, 60, 120], renotify: true
  }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) { if ('focus' in list[i]) return list[i].focus(); }
    return self.clients.openWindow(url);
  }));
});
