// يفحص فقط المنطقة المحصورة داخل "إطار التصويب" الظاهر على الشاشة (وليس الصورة كاملة) —
// مهم جداً في محل مجوهرات لأن أي لقطة قد تحتوي عشرات وسوم الباركود على قطع مجاورة في
// نفس خزانة العرض؛ فك التشفير من الصورة كاملة قد يلتقط باركود قطعة أخرى بالخطأ بدل
// الباركود الذي يحاول الموظف تصويبه فعلياً. حصر الفحص بمنطقة الإطار فقط يعني: "اقرأ
// الباركود الذي أُحوّم فوقه تحديداً" — ويرفع الدقة أيضاً لأن ZXing يحلّل بكسلات أقل وأنظف.
import { useEffect, useRef } from "react";
import {
  BinaryBitmap,
  DecodeHintType,
  HTMLCanvasElementLuminanceSource,
  HybridBinarizer,
  MultiFormatReader,
  NotFoundException,
  BarcodeFormat,
} from "@zxing/library";

// نسب إطار التصويب من أبعاد عنصر الفيديو المعروض (وليس دقة الكاميرا الخام) — عريض
// وقصير لأن أغلب باركودات المحل خطية أفقية (Code128) لا مربعة كـQR.
export const SCAN_BOX = { widthPct: 0.82, heightPct: 0.26 };

function buildReader(): MultiFormatReader {
  const hints = new Map<DecodeHintType, unknown>();
  // Code128 هو تنسيق وسوم المحل الفعلي (تأكّدنا من صورة الوسم) — نضعه أولاً صراحة لتسريع
  // وتحسين دقة القراءة، مع إبقاء التنسيقات الشائعة الأخرى كاحتياط لو استُخدم وسم مختلف.
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.CODABAR,
    BarcodeFormat.ITF,
    BarcodeFormat.QR_CODE,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new MultiFormatReader();
  reader.setHints(hints);
  return reader;
}

/**
 * يفحص فقط المستطيل النسبي (SCAN_BOX) من منتصف الفيديو المعروض، بمعدّل ثابت، ويستدعي
 * onDetect عند نجاح القراءة. يتوقف تلقائياً عندما active=false أو عند تفكيك المكوّن.
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

    const reader = buildReader();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      if (stopped) return;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!ctx || !vw || !vh || video.readyState < 2) {
        timer = setTimeout(tick, 200);
        return;
      }
      canvas.width = vw;
      canvas.height = vh;
      ctx.drawImage(video, 0, 0, vw, vh);

      // نفس نسبة إطار التصويب المرسوم فوق الفيديو (object-contain لا يغيّر دقة البكسل
      // الخام، فقط طريقة عرضه — النسبة المئوية من الفيديو المعروض تطابق النسبة من
      // دقته الخام مباشرة).
      const boxW = vw * SCAN_BOX.widthPct;
      const boxH = vh * SCAN_BOX.heightPct;
      const boxX = (vw - boxW) / 2;
      const boxY = (vh - boxH) / 2;

      try {
        const source = new HTMLCanvasElementLuminanceSource(canvas).crop(boxX, boxY, boxW, boxH);
        const bitmap = new BinaryBitmap(new HybridBinarizer(source));
        const result = reader.decode(bitmap);
        if (!stopped && result) onDetectRef.current(result.getText());
      } catch (e) {
        if (!(e instanceof NotFoundException)) {
          // أخطاء أخرى (تنسيق/تحقق) متوقعة أثناء المسح المستمر — تُتجاهل بصمت.
        }
      }
      if (!stopped) timer = setTimeout(tick, 280);
    };
    timer = setTimeout(tick, 280);

    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [active, videoRef]);
}
