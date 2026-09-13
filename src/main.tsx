import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

// تثبيت التطبيق على الآيفون/أندرويد + فتح أسرع (لا يخزّن أي بيانات API)
if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener("load", async () => {
      try {
        // مسار ونطاق نسبيّان لـ BASE_URL حتى يعملا سواء استُضيف التطبيق على الجذر
        // (Lovable/نطاق مخصّص) أو تحت مسار فرعي (GitHub Pages: /jewel-sight-manager/).
        const swUrl = `${import.meta.env.BASE_URL}sw.js`;
        const reg = await navigator.serviceWorker.register(swUrl, {
          updateViaCache: "none",
          scope: import.meta.env.BASE_URL,
        });
        // تحديث فوري عند نزول نسخة جديدة حتى لا يبقى المستخدم على نسخة قديمة
        reg.addEventListener("updatefound", () => {
          const sw = reg.installing;
          sw?.addEventListener("statechange", () => {
            if (sw.state === "installed" && navigator.serviceWorker.controller) window.location.reload();
          });
        });
        reg.update().catch(() => {});

        // مهم على آيفون تحديداً: التطبيق المثبَّت لا يُعاد تحميله فعلياً في أغلب
        // الأحيان عند فتحه من الأيقونة — iOS يُبقي الصفحة معلّقة في الذاكرة ويُظهرها
        // كما هي (نفس الجافاسكربت القديم، لا "load" جديد، لا فحص تحديث). فيبقى
        // الموظف على نسخة قديمة من الكود بصمت لأيام حتى لو نزلنا إصلاحات كثيرة —
        // فيبدو الإصلاح "مش شغال" رغم نزوله فعلاً. نتحقق من نسخة جديدة صراحة في كل
        // مرة تعود فيها الصفحة للظهور (فتح من الأيقونة، عودة من الخلفية).
        const checkForUpdate = () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); };
        document.addEventListener("visibilitychange", checkForUpdate);
        // bfcache: عودة الصفحة من الأمام/الخلف على أندرويد أحياناً تُرجع نسخة مخزّنة
        // بلا أي تنفيذ جافاسكربت جديد إطلاقاً — إعادة تحميل كاملة أضمن هنا.
        window.addEventListener("pageshow", (e) => { if (e.persisted) window.location.reload(); });
      } catch {
        /* ignore */
      }
    });
  } else {
    // في المعاينة: أزل أي Service Worker قديم قد يمنع تحميل التطبيق
    navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
    if ("caches" in window) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
  }
}
