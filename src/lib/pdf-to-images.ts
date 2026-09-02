// تحويل صفحات PDF إلى صور JPEG داخل المتصفح بالكامل (بدون أي تكلفة ذكاء اصطناعي).
//
// ملاحظة: أصدارات pdfjs-dist 5.x/6.x تستخدم داخلياً ميزات JS حديثة جداً (Iterator helpers،
Map.prototype.getOrInsertComputed) غير موجودة بعد في نسخ سفاري الأقدم من iOS 18.4، ما كان
// يُسقط تحويل PDF بالكامل على هذه الأجهزة. لذلك المشروع مثبّت على pdfjs-dist@4.x تحديداً —
// آخر خط إصدارات متوافق مع نطاق أوسع من المتصفحات دون هذه الميزات. لا تُحدّث هذه الحزمة
// لإصدار 5+ بدون التأكد من التوافق مع سفاري القديم.
//
// نُحمّلها ديناميكياً (dynamic import) فقط عند الحاجة الفعلية لتحويل PDF حتى لا تُحمّل
// (1.2MB+) على كل زيارة للتطبيق.
let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;
async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [pdfjs, workerUrlModule] = await Promise.all([
        import("pdfjs-dist"),
        import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
      ]);
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrlModule.default;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

export const isPdf = (f: File) =>
  f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");

/**
 * يرسم كل صفحة إلى صورة JPEG بحد أقصى ~1600px على الضلع الأطول
 * (نفس إعدادات ضغط الصور العادية) لتجنّب مشاكل الذاكرة على iPhone Safari.
 */
export async function pdfToImageFiles(
  file: File,
  opts: { maxDimension?: number; quality?: number } = {},
  onProgress?: (done: number, total: number) => void,
): Promise<File[]> {
  const maxDimension = opts.maxDimension ?? 1600;
  const quality = opts.quality ?? 0.82;

  const pdfjs = await loadPdfjs();

  // تحميل المستند كاملاً كـ ArrayBuffer — المسار الأكثر ثباتاً في pdf.js عبر كل المتصفحات
  // (تحميل عبر Range requests فوق blob URL غير مدعوم بشكل متسق بين المتصفحات).
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const out: File[] = [];
  const base = file.name.replace(/\.pdf$/i, "") || "pdf";

  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const base1 = page.getViewport({ scale: 1 });
      const scale = Math.min(1, maxDimension / Math.max(base1.width, base1.height));
      const viewport = page.getViewport({ scale: scale || 1 });

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("تعذّر إنشاء لوحة الرسم");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await (page.render({ canvas, canvasContext: ctx, viewport } as any) as any).promise;

      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob((b) => res(b), "image/jpeg", quality),
      );
      // تحرير الذاكرة فوراً — مهم على الهواتف
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();

      if (blob) {
        out.push(
          new File([blob], `${base}-p${String(n).padStart(3, "0")}.jpg`, {
            type: "image/jpeg",
            lastModified: Date.now(),
          }),
        );
      }
      onProgress?.(n, pdf.numPages);
    }
  } finally {
    await (pdf as any).destroy?.();
  }

  return out;
}
