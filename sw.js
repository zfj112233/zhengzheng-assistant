const CACHE = "life-desk-v1";
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(["/", "/manifest.webmanifest"]))));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  if (new URL(event.request.url).pathname.endsWith("/data/hotspots.json")) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); return response;
  }).catch(() => caches.match(event.request)));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(windows => {
    const existing = windows.find(client => client.url.includes("/zhengzheng-assistant"));
    if (existing) return existing.focus();
    return clients.openWindow("/zhengzheng-assistant/");
  }));
});
self.addEventListener("push", event => {
  let data = { title: "郑郑的私人助理提醒", body: "你有一个提醒到时间了。" };
  try { data = event.data.json(); } catch {}
  event.waitUntil(self.registration.showNotification(data.title || "郑郑的私人助理提醒", {
    body: data.body || data.text || "你有一个提醒到时间了。",
    icon: "/zhengzheng-assistant/icon-192.png",
    badge: "/zhengzheng-assistant/icon-192.png",
    tag: data.id || "zhengzheng-reminder",
    renotify: true
  }));
});
