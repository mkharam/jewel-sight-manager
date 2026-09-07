// يقرأ باركود من ملف صورة مرفوع (بدل الكاميرا الحية) — يُستخدم كخيار احتياطي في صفحة
// "الإضافة المباشرة" عندما تفشل القراءة الحية أو عندما يكون الباركود مُصوَّراً مسبقاً.
// يجرّب الصورة بأربع زوايا دوران (0/90/180/270) لأن صور الوسوم كثيراً ما تكون جانبية.
import {
  BarcodeFormat,
  BinaryBitmap,
  ChecksumException,
  DecodeHintType,
  FormatException,
  HTMLCanvasElementLuminanceSource,
  HybridBinarizer,
  MultiFormatReader,
  NotFoundException,
} from "@zxing/library";

function buildReader(): MultiFormatReader {
  const hints = new Map<DecodeHintType, unknown>();
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

function isExpectedMiss(e: unknown): boolean {
  return e instanceof NotFoundException || e instanceof ChecksumException || e instanceof FormatException;
}

export async function decodeBarcodeFromFile(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return null;

    const reader = buildReader();
    for (const angle of [0, 90, 180, 270]) {
      const canvas = document.createElement("canvas");
      if (angle % 180 === 0) { canvas.width = w; canvas.height = h; } else { canvas.width = h; canvas.height = w; }
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((angle * Math.PI) / 180);
      ctx.drawImage(img, -w / 2, -h / 2);
      try {
        const source = new HTMLCanvasElementLuminanceSource(canvas);
        const bitmap = new BinaryBitmap(new HybridBinarizer(source));
        const result = reader.decode(bitmap);
        if (result) return result.getText();
      } catch (e) {
        if (!isExpectedMiss(e)) console.warn("barcode image decode unexpected error", e);
      }
    }
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
