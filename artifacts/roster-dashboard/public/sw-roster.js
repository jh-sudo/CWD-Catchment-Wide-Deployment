// Roster Dashboard — Push Notification Service Worker

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data?.json() ?? {}; } catch { /* use defaults */ }

  event.waitUntil(
    self.registration.showNotification(data.title ?? "Roster Update", {
      body:  data.body  ?? "",
      tag:   data.tag   ?? "roster",
      icon:  "/roster/favicon.svg",
      badge: "/roster/favicon.svg",
      data:  { url: data.url ?? "/roster/my-applications" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? "/roster/my-applications";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return clients.openWindow(target);
    })
  );
});
