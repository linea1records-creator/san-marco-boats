// ClickVenice: rende l'app installabile e la apre anche con poca rete (i dati arrivano sempre freschi quando c'è)
const C = "unclick-v81", SHELL = ["index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "logo.png", "logo-mark.png", "splash.jpg", "apple-touch-icon.png", "icon-maskable.png", "assist.json", "fermate.json", "velox.json", "cantieri.json", "stadio.json", "rotte-lavoro.json", "rive-diporto.json"];
self.addEventListener("install", e => { e.waitUntil(caches.open(C).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;   // mappe, server e dati esterni: sempre dalla rete
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then(r => { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
});

self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "clickVenice", {
    body: d.body || "", tag: d.tag || "unclick", renotify: true,
    icon: "icon-192.png", badge: "icon-192.png",
    data: { url: d.url || "./index.html" }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const u = (e.notification.data && e.notification.data.url) || "./index.html";
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => {
    for (const c of cs) { if ("focus" in c) { c.navigate && c.navigate(u); return c.focus(); } }
    if (clients.openWindow) return clients.openWindow(u);
  }));
});
