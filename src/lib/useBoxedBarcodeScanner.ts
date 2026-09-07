// يفحص فقط المنطقة المحصورة داخل "إطار التصويب" الظاهر على الشاشة (وليس الصورة كاملة) —
// مهم جداً في محل مجوهرات لأن أي لقطة قد تحتوي عشرات وسوم الباركود على قطع مجاورة في
// نفس خزانة العرض؛ فك التشفير من الصورة كاملة قد يلتقط باركود قطعة أخرى بالخطأ بدل
// الباركود الذي يحاول الموظف تصويبه فعلياً. حصر الفحص بمنطقة الإطار فقط يعني: "اقرأ
// الباركود الذي أُحوّم فوقه تحديداً" — ويرفع الدقة أيضاً لأن ZXing يحلّل بكسلات أقل وأنظف.
//
// ملاحظة مهمة: لا نستخدم HTMLCanvasElementLuminanceSource.crop() — تلك الدالة في مكتبة
// ZXing لا تُطبّق فعلياً (ترث تطبيق الفئة الأساسية الذي يرمي UnsupportedOperationException
// دائماً)، فكل محاولة قراءة كانت تفشل بصمت فوراً قبل الوصول لفك التشفير أصلاً. الحل الصحيح:
// نقتصّ المنطقة يدوياً أثناء الرسم على الكانفاس نفسه عبر drawImage بمعاملاته التسعة
// (تحديد منطقة المصدر) بدل رسم الإطار كاملاً ثم محاولة اقتصاصه لاحقاً.
import { useEffect, useRef } from "react";
import {
  BinaryBitmap,
  ChecksumException,
  DecodeHintType,
  FormatException,
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

      // نفس نسبة إطار التصويب المرسوم فوق الفيديو (object-contain لا يغيّر دقة البكسل
      // الخام، فقط طريقة عرضه — النسبة المئوية من الفيديو المعروض تطابق النسبة من
      // دقته الخام مباشرة).
      const boxW = Math.round(vw * SCAN_BOX.widthPct);
      const boxH = Math.round(vh * SCAN_BOX.heightPct);
      const boxX = Math.round((vw - boxW) / 2);
      const boxY = Math.round((vh - boxH) / 2);

      canvas.width = boxW;
      canvas.height = boxH;
      // drawImage بمعاملاته التسعة: يقتصّ منطقة المصدر (boxX..boxX+boxW) مباشرة أثناء
      // الرسم بدل رسم الإطار كاملاً — أبسط وأسرع من أي اقتصاص لاحق على مستوى البكسل.
      ctx.drawImage(video, boxX, boxY, boxW, boxH, 0, 0, boxW, boxH);

      try {
        const source = new HTMLCanvasElementLuminanceSource(canvas);
        const bitmap = new BinaryBitmap(new HybridBinarizer(source));
        const result = reader.decode(bitmap);
        if (!stopped && result) onDetectRef.current(result.getText());
      } catch (e) {
        // NotFound/Checksum/Format هي فشل قراءة طبيعي متوقع في كل إطار لا يحتوي باركوداً
        // واضحاً — لا نُبلّغ عنها. أي خطأ آخر غير متوقع (خطأ برمجي فعلي) نُسجّله في الكونسول
        // ليظهر أثناء التطوير بدل أن يُبتلع بصمت كما حدث سابقاً مع crop() غير المدعومة.
        if (!(e instanceof NotFoundException) && !(e instanceof ChecksumException) && !(e instanceof FormatException)) {
          console.warn("barcode decode unexpected error", e);
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
