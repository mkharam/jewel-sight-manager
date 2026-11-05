// يفحص فقط المنطقة المحصورة داخل "إطار التصويب" الظاهر على الشاشة (وليس الصورة كاملة) —
// مهم جداً في محل مجوهرات لأن أي لقطة قد تحتوي عشرات وسوم الباركود على قطع مجاورة في
// نفس خزانة العرض؛ فك التشفير من الصورة كاملة قد يلتقط باركود قطعة أخرى بالخطأ بدل
// الباركود الذي يحاول الموظف تصويبه فعلياً. حصر الفحص بمنطقة الإطار فقط يعني: "اقرأ
// الباركود الذي أُحوّم فوقه تحديداً".
//
// القراءة نفسها بـ zxing-cpp (WebAssembly، راجع tagReader.ts) بدل ZXing-JS — كانت تفوّت
// ليبلات أمارسوفت الرفيعة على الآيفون. نقتصّ المنطقة بـ drawImage بمعاملاته التسعة.
import { useEffect, useRef } from "react";
import { readTag, warmTagReader } from "@/lib/tagReader";

// نسب إطار التصويب من أبعاد عنصر الفيديو المعروض (وليس دقة الكاميرا الخام) — عريض
// وقصير لأن ليبلات المحل خطية أفقية (Code128) لا مربعة كـQR.
export const SCAN_BOX = { widthPct: 0.82, heightPct: 0.26 };

/**
 * يفحص فقط المستطيل النسبي (SCAN_BOX) من منتصف الفيديو المعروض، ويستدعي onDetect برقم
 * التاق عند نجاح القراءة. يتوقف تلقائياً عندما active=false أو عند تفكيك المكوّن.
 */
export function useBoxedBarcodeScanner(
  videoRef: React.RefObject<HTMLVideoElement>,
  active: boolean,
  onDetect: (text: string) => void,
) {
  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;

  useEffect(() => {
    if (!active) return;
    const video = videoRef.current;
    if (!video) return;
    warmTagReader();

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      if (stopped) return;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!ctx || !vw || !vh || video.readyState < 2) {
        timer = setTimeout(tick, 200);
        return;
      }
      const boxW = Math.round(vw * SCAN_BOX.widthPct);
      const boxH = Math.round(vh * SCAN_BOX.heightPct);
      canvas.width = boxW;
      canvas.height = boxH;
      ctx.drawImage(video, Math.round((vw - boxW) / 2), Math.round((vh - boxH) / 2), boxW, boxH, 0, 0, boxW, boxH);
      const tag = await readTag(ctx.getImageData(0, 0, boxW, boxH), { fast: true });
      if (!stopped && tag) onDetectRef.current(tag);
      // القراءة نفسها تاخذ وقت، فالانتظار بين المحاولات قصير.
      if (!stopped) timer = setTimeout(tick, 120);
    };
    timer = setTimeout(tick, 200);

    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [active, videoRef]);
}
