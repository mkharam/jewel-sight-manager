import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

// تثبيت التطبيق على الآيفون/أندرويد + فتح أسرع (لا يخزّن أي بيانات API)
if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener("load", async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
        // تحديث فوري عند نزول نسخة جديدة حتى لا يبقى المستخدم على نسخة قديمة
        reg.addEventListener("updatefound", () => {
          const sw = reg.installing;
          sw?.addEventListener("statechange", () => {
            if (sw.state === "installed" && navigator.serviceWorker.controller) window.location.reload();
          });
        });
        reg.update().catch(() => {});
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
