// ClickVenice: rende l'app installabile e la apre anche con poca rete (i dati arrivano sempre freschi quando c'è)
const C = "clickvenice-v1", SHELL = ["index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "assist.json", "fermate.json", "velox.json", "rotte-lavoro.json"];
self.addEventListener("install", e => { e.waitUntil(caches.open(C).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;   // mappe, server e dati esterni: sempre dalla rete
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
});
