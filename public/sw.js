// Service worker خفيف: يجعل التطبيق يعمل كتطبيق مثبَّت على الآيفون
// ويسرّع فتح الشاشة الأولى. لا نخزّن أي طلبات API/قاعدة بيانات.
const CACHE = "mkharrm-shell-v4";
// نطاق تسجيل هذا الـ SW هو الأساس الصحيح للمسارات — يعمل سواء كان التطبيق على
// الجذر (Lovable/نطاق مخصّص) أو تحت مسار فرعي (GitHub Pages: /jewel-sight-manager/).
const SCOPE = self.registration.scope;
const SHELL = ["", "index.html", "manifest.webmanifest", "app-icon-192.png", "apple-touch-icon.png"].map((p) =>
  new URL(p, SCOPE).toString(),
);

self.addEventListener("install", (e) => {
  // إن فشل تخزين أحد الملفات (مثلاً أيقونة غير موجودة) لا نُفشل التثبيت كاملاً —
  // فشل addAll يمنع تفعيل الـ SW نهائياً ويُبقي المستخدم على نسخة قديمة معطّلة أو شاشة بيضاء.
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.all(SHELL.map((url) => c.add(url).catch(() => {}))),
    ).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// إشعار Web Push — يظهر على شاشة القفل حتى والتطبيق مغلق تماماً.
self.addEventListener("push", (event) => {
  let data = { title: "مخرّم", body: "لديك إشعار جديد", url: SCOPE };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    /* ignore */
  }
  // رابط الإشعار يصل من مشغّلات قاعدة البيانات كمسار مطلق من الجذر (مثال: "/products/123").
  // مهم: new URL("/chat", scope) يتجاهل مسار الاستضافة الفرعي كلياً ويُعطي
  // https://mkharam.github.io/chat بدل .../jewel-sight-manager/chat — أي صفحة 404 خارج
  // التطبيق عند كل ضغطة على إشعار. نزيل الشرطة الأولى ليُحسب المسار نسبةً لنطاق الـSW.
  const targetUrl = new URL(String(data.url || ".").replace(/^\/+/, ""), SCOPE).toString();
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: new URL("app-icon-192.png", SCOPE).toString(),
      badge: new URL("app-icon-192.png", SCOPE).toString(),
      data: { url: targetUrl },
      dir: "rtl",
      lang: "ar",
    }),
  );
});

// الضغط على الإشعار: يفتح التطبيق على الرابط المرتبط، أو يُركّز نافذة مفتوحة بالفعل.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // نفس الاحتياط هنا: الإشعار قد يكون مخزّناً من نسخة قديمة من الـSW تحمل مساراً مطلقاً.
  const raw = event.notification.data?.url || SCOPE;
  const url = new URL(String(raw).replace(/^\/+/, ""), SCOPE).toString();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ("focus" in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
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
    event.respondWith(
      fetch(req).catch(() => caches.match(new URL("index.html", SCOPE).toString()).then((r) => r || fetch(req))),
    );
    return;
  }

  // الأصول الثابتة: الصور والخطوط من الكاش، أما ملفات JS/CSS فمن الشبكة دائماً
  // (حتى لا يبقى المستخدم على نسخة قديمة معطّلة من التطبيق)
  if (/\.(js|css)$/.test(url.pathname)) return;

  if (/\.(png|jpg|jpeg|webp|svg|ico|woff2?)$/.test(url.pathname)) {
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
