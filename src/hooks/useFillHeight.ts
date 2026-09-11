import { useEffect, useRef, useState } from "react";

/**
 * يحسب الارتفاع المتاح فعلياً من أعلى العنصر حتى أسفل الشاشة المرئية، بدل تخمين ثابت
 * (مثل calc(100dvh - 13.5rem)) كان يخطئ حسب المحتوى الفعلي فوق العنصر (بانر ترحيب،
 * تفاف عنوان الصفحة على الجوال...) فيدفع صندوق الإدخال جزئياً خارج الشاشة أو خلف الشريط
 * السفلي الثابت — وهذا بالضبط ما كان يمنع الضغط على زر الإرسال أحياناً على الهاتف.
 *
 * يعيد الحساب عند تغيّر حجم الشاشة، وعند ظهور/اختفاء لوحة مفاتيح الهاتف (visualViewport)،
 * ويطرح ارتفاع الشريط السفلي الثابت للجوال (data-mobile-bottom-nav) إن كان ظاهراً.
 */
export function useFillHeight(bottomGapPx = 12, minPx = 320) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const compute = () => {
      const top = el.getBoundingClientRect().top;
      const vh = window.visualViewport?.height ?? window.innerHeight;
      const bottomNav = document.querySelector<HTMLElement>("[data-mobile-bottom-nav]");
      const navH = bottomNav && getComputedStyle(bottomNav).display !== "none" ? bottomNav.getBoundingClientRect().height : 0;
      setHeight(Math.max(minPx, vh - top - navH - bottomGapPx));
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(document.body);
    window.addEventListener("resize", compute);
    window.visualViewport?.addEventListener("resize", compute);
    window.visualViewport?.addEventListener("scroll", compute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", compute);
      window.visualViewport?.removeEventListener("resize", compute);
      window.visualViewport?.removeEventListener("scroll", compute);
    };
  }, [bottomGapPx, minPx]);

  return { ref, height };
}
