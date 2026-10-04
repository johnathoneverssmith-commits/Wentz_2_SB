// Franchise Sim's service worker: it exists only to show push notifications
// (online/src/push.ts) when a league needs you and the game isn't open.
// It caches nothing and intercepts no requests.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Franchise Sim", {
      body: data.body || "Your league needs you.",
      tag: data.tag || "fs-push",
      renotify: true,
      data: { leagueId: data.leagueId || null },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of open) {
        if ("focus" in c) return c.focus();
      }
      return self.clients.openWindow("./");
    })(),
  );
});
