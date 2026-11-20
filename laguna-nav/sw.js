// ClickVenice: rende l'app installabile e la apre anche con poca rete (i dati arrivano sempre freschi quando c'è)
const C = "unclick-v21", SHELL = ["index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "logo.png", "assist.json", "fermate.json", "velox.json", "cantieri.json", "stadio.json", "rotte-lavoro.json"];
self.addEventListener("install", e => { e.waitUntil(caches.open(C).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;   // mappe, server e dati esterni: sempre dalla rete
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then(r => { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
});
