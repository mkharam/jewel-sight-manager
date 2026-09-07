// قارئ مخصّص لوجه بيانات الوسم (BRANCH/KARAT/TYPE/WEIGHT) — يعمل محلياً بالكامل في
// المتصفح عبر Tesseract.js (OCR) بدل الاعتماد فقط على نداء شبكة للذكاء الاصطناعي، تماماً
// كما decodeBarcodeFromImage.ts قارئ مخصّص لوجه الباركود. أسرع (لا رحلة شبكة)، يعمل بلا
// اتصال إنترنت، ولا يتأثر بازدحام مزوّدات الذكاء الاصطناعي — لكنه أقل دقة من الرؤية
// الاصطناعية في الصور غير الواضحة، لذا يبقى نداء analyze-tag احتياطياً في LiveAdd عندما
// لا يجد هذا القارئ شيئاً.
import { createWorker } from "tesseract.js";

export type LocalTagInfo = {
  branch_code: string | null;
  karat_raw: string | null;
  type_raw: string | null;
  weight_grams: number | null;
};

async function toPreprocessedCanvas(source: File | Blob): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(source);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });

    // نكبّر قليلاً إن كانت الصورة صغيرة، ونحوّلها لتدرج رمادي مع رفع التباين — يحسّن
    // قراءة الخط النقطي (dot-matrix) المطبوع على وسوم المحل بشكل ملحوظ.
    const scale = img.naturalWidth < 900 ? 900 / img.naturalWidth : 1;
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas;
    ctx.drawImage(img, 0, 0, w, h);

    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      // عتبة ثنائية بسيطة: نص أسود غامق على خلفية بيضاء لامعة — أبيض/أسود صريحان يريحان OCR.
      const v = gray < 150 ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function parseInfoText(text: string): LocalTagInfo {
  const branch = text.match(/BRANCH\s*[:;.]?\s*([0-9A-Z]{1,6})/i)?.[1] ?? null;
  const karat = text.match(/KARAT\s*[:;.]?\s*([0-9A-Z]{2,6})/i)?.[1] ?? null;
  const type = text.match(/TYPE\s*[:;.]?\s*([A-Z]{1,6})/i)?.[1] ?? null;
  const weightMatch = text.match(/WEIGHT\s*[:;.]?\s*([0-9]+[.,]?[0-9]*)/i)?.[1] ?? null;
  const weight = weightMatch ? parseFloat(weightMatch.replace(",", ".")) : null;
  return {
    branch_code: branch,
    karat_raw: karat,
    type_raw: type,
    weight_grams: weight != null && !isNaN(weight) ? weight : null,
  };
}

let workerPromise: ReturnType<typeof createWorker> | null = null;
async function getWorker() {
  if (!workerPromise) workerPromise = createWorker("eng");
  return workerPromise;
}

/**
 * يقرأ وجه بيانات الوسم محلياً بلا أي اتصال شبكة. يُعيد null إن لم يتعرّف على أي حقل
 * إطلاقاً (عندها يُستحسن اللجوء لقراءة الذكاء الاصطناعي كاحتياط).
 */
export async function readInfoTagLocally(source: File | Blob): Promise<LocalTagInfo | null> {
  const canvas = await toPreprocessedCanvas(source);
  const worker = await getWorker();
  const { data } = await worker.recognize(canvas);
  const parsed = parseInfoText(data.text || "");
  const hasAny = parsed.branch_code || parsed.karat_raw || parsed.type_raw || parsed.weight_grams != null;
  return hasAny ? parsed : null;
}
