// Service worker خفيف: يجعل التطبيق يعمل كتطبيق مثبَّت على الآيفون
// ويسرّع فتح الشاشة الأولى. لا نخزّن أي طلبات API/قاعدة بيانات.
const CACHE = "mkharrm-shell-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/app-icon-192.png", "/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // لا نتدخل في Supabase أو أي API
  if (url.pathname.startsWith("/src/") || url.pathname.startsWith("/@")) return; // dev assets

  // التنقّل: الشبكة أولاً ثم النسخة المخزّنة عند انقطاع الإنترنت
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/index.html").then((r) => r || fetch(req))));
    return;
  }

  // الأصول الثابتة: النسخة المخزّنة أولاً
  if (/\.(png|jpg|jpeg|webp|svg|ico|css|js|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((hit) =>
        hit ||
        fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        }),
      ),
    );
  }
});
