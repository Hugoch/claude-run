self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || "Claude Run";
  const options = {
    body: data.body || "",
    tag: data.sessionId || data.tag || "default",
    renotify: true,
    data: { sessionId: data.sessionId, url: data.url },
    icon: "/icon-192.png",
    badge: "/icon-192.png",
  };
  event.waitUntil(
    self.registration.showNotification(title, options).then(async () => {
      const badge = self.navigator?.setAppBadge || navigator?.setAppBadge;
      if (badge) {
        const notifications = await self.registration.getNotifications();
        const uniqueTags = new Set(
          notifications.map((n) => n.tag || "default"),
        );
        await badge.call(self.navigator || navigator, uniqueTags.size);
      }
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const externalUrl = event.notification.data?.url;
  if (externalUrl) {
    event.waitUntil(clients.openWindow(externalUrl));
    return;
  }
  const sessionId = event.notification.data?.sessionId;
  const url = sessionId ? `/#${sessionId}` : "/";

  event.waitUntil(
    (async () => {
      const remaining = await self.registration.getNotifications();
      if (remaining.length === 0) {
        (self.navigator || navigator).clearAppBadge?.();
      } else {
        (self.navigator || navigator).setAppBadge?.(remaining.length);
      }
      const clientList = await clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clientList) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      return clients.openWindow(url);
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname === "/share") {
    const text =
      url.searchParams.get("text") || url.searchParams.get("url") || "";
    event.respondWith(Response.redirect(`/?share=${encodeURIComponent(text)}`));
  }
});
