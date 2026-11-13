/* Reef Ops service worker.
 *
 * Purpose: make the web app installable, give a friendly page when the
 * phone has no signal, and show push notifications (service reminders) even
 * when the app is closed. It never caches API, Supabase or server-function
 * responses, so data on screen is always live and private data is never
 * stored on the device by this worker.
 *
 * Bump CACHE_VERSION when this file changes so old caches are removed.
 */
const CACHE_VERSION = "reef-v2";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/badge-96.png",
  "/favicon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => !key.startsWith(CACHE_VERSION)).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isNeverCached(url) {
  return (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/_server") ||
    url.pathname.startsWith("/_serverFn") ||
    url.pathname === "/sw.js"
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Only handle our own site. Render API, Supabase and fonts go straight to the network.
  if (url.origin !== self.location.origin) return;
  if (isNeverCached(url)) return;

  // Page loads: always try the network first; show the offline page if there is no signal.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // Built JS/CSS files have a content hash in their name, so they never change: cache-first.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Icons and images: serve from cache if present, refresh in the background.
  if (request.destination === "image") {
    event.respondWith(
      caches.open(STATIC_CACHE).then((cache) =>
        cache.match(request).then((cached) => {
          const network = fetch(request)
            .then((response) => {
              if (response.ok) cache.put(request, response.clone());
              return response;
            })
            .catch(() => cached);
          return cached || network;
        }),
      ),
    );
  }
});

// ---------- Push notifications ----------

/** Only ever open screens on this site, whatever the message says. */
function safeUrl(value) {
  try {
    const url = new URL(value || "/", self.location.origin);
    return url.origin === self.location.origin ? url.href : self.location.origin + "/";
  } catch {
    return self.location.origin + "/";
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Reef Ops";
  const options = {
    body: data.body || "You have a new notification.",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    tag: data.tag || "reef",
    renotify: Boolean(data.tag),
    data: { url: safeUrl(data.url) },
  };
  event.waitUntil(
    self.registration.showNotification(title, options).then(() =>
      // Let any open tab refresh its bell straight away.
      self.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((clients) => clients.forEach((c) => c.postMessage({ type: "reef-push" }))),
    ),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || safeUrl("/");
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Reuse an open Reef Ops window rather than opening a second one.
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          return client.focus().then((c) => (c && "navigate" in c ? c.navigate(target) : c));
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
