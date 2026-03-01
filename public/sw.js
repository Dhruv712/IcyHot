// Lumos Service Worker — Push Notifications Only (no offline caching)

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Handle incoming push notifications
self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || "Lumos";
  const options = {
    body: data.body || "",
    icon: "/lumos-icon-192.png",
    badge: "/lumos-icon-192.png",
    data: { url: data.url || "/dashboard" },
    tag: data.tag || "icyhot-daily",
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Handle notification clicks — open/focus the dashboard
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/dashboard";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Focus existing tab if one is open on our domain
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Otherwise open a new window
      return self.clients.openWindow(url);
    })
  );
});
