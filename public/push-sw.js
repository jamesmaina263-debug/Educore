// EduCore push-only service worker (WP 8.3).
//
// Deliberately SEPARATE from /sw.js, the offline/app-shell worker that every device already runs: adding
// push handlers there would put offline mode at risk for everyone. This worker is registered on its own
// narrow scope (/push-sw/) and does exactly two things: show a notification when a push arrives, and open
// the app when the notification is clicked. It caches nothing and never touches the network.
//
// The device does not trust the payload: titles and bodies are length-capped, and the click target must be a
// same-origin path (see src/lib/push/payload.ts, which applies the same rule when the server builds a message).

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function safeUrl(url) {
  if (typeof url !== "string") return "/";
  var u = url.trim();
  if (u.length === 0 || u.length > 300) return "/";
  if (u.charAt(0) !== "/" || u.indexOf("//") === 0 || u.indexOf("\\") !== -1) return "/";
  if (/[\u0000-\u001f]/.test(u)) return "/";
  return u;
}

self.addEventListener("push", function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "EduCore", body: event.data ? event.data.text() : "" };
  }
  var title = typeof data.title === "string" && data.title ? data.title.slice(0, 80) : "EduCore";
  var options = {
    body: typeof data.body === "string" ? data.body.slice(0, 200) : "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: safeUrl(data.url) },
  };
  if (typeof data.tag === "string" && data.tag) options.tag = data.tag.slice(0, 60);
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var target = safeUrl(event.notification.data && event.notification.data.url);
  var absolute = new URL(target, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (windows) {
      for (var i = 0; i < windows.length; i += 1) {
        var w = windows[i];
        if (w.url === absolute && "focus" in w) return w.focus();
      }
      if (windows.length > 0 && "navigate" in windows[0] && "focus" in windows[0]) {
        return windows[0].navigate(absolute).then(function (c) {
          return c ? c.focus() : undefined;
        });
      }
      return self.clients.openWindow(absolute);
    }),
  );
});
