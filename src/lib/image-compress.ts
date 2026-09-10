/**
 * ضغط الصور داخل الهاتف قبل الرفع — يقلّل حجم صور الآيفون (3–6MB) إلى ~200–400KB
 * فيصبح الرفع والتحليل أسرع بكثير على واي‑فاي المحل.
 */

export type CompressOptions = {
  maxDimension?: number; // أطول ضلع بالبكسل
  quality?: number; // 0..1
  mimeType?: "image/jpeg" | "image/webp";
};

const DEFAULTS: Required<CompressOptions> = {
  maxDimension: 1600,
  quality: 0.82,
  mimeType: "image/jpeg",
};

/** يقرأ الصورة ويعيد Bitmap/Image بشكل متوافق مع سفاري iOS. */
async function loadImage(file: File): Promise<{ width: number; height: number; draw: CanvasImageSource; close?: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file);
      return { width: bmp.width, height: bmp.height, draw: bmp, close: () => bmp.close?.() };
    } catch {
      /* fallback */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    return { width: img.naturalWidth, height: img.naturalHeight, draw: img, close: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

/**
 * يضغط صورة واحدة. عند أي فشل يرجّع الملف الأصلي (لا نكسر الرفع أبداً).
 */
export async function compressImage(file: File, opts: CompressOptions = {}): Promise<File> {
  const { maxDimension, quality, mimeType } = { ...DEFAULTS, ...opts };
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;

  let handle: Awaited<ReturnType<typeof loadImage>> | null = null;
  try {
    handle = await loadImage(file);
    const { width, height } = handle;
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    // صورة صغيرة أصلاً وخفيفة — لا داعي لإعادة الترميز
    if (scale === 1 && file.size <= 600 * 1024) return file;

    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(handle.draw, 0, 0, w, h);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeType, quality));
    if (!blob || blob.size >= file.size) return file;

    const ext = mimeType === "image/webp" ? "webp" : "jpg";
    const base = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${base}.${ext}`, { type: mimeType, lastModified: Date.now() });
  } catch {
    return file;
  } finally {
    handle?.close?.();
  }
}

/**
 * نسخة أصغر مخصّصة لاستدعاء الذكاء الاصطناعي فقط (منفصلة عن الصورة المرفوعة/المخزّنة
 * بدقتها الكاملة) — نماذج الرؤية لا تستفيد من دقة أعلى من ~1024px للتصنيف والوصف، وتصغير
 * حمولة base64 يقلّل زمن الرفع والاستدلال بشكل ملموس خصوصاً على شبكات المحلات البطيئة.
 */
export async function prepareForAIBase64(
  file: File,
  opts: CompressOptions = {},
): Promise<{ base64: string; mimeType: string }> {
  const small = await compressImage(file, { maxDimension: 1024, quality: 0.75, ...opts });
  const base64: string = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || "").split(",")[1] ?? "");
    r.onerror = reject;
    r.readAsDataURL(small);
  });
  return { base64, mimeType: small.type || file.type || "image/jpeg" };
}

/**
 * نسخة مصغّرة للعرض في الشبكات والقوائم. الصورة المخزّنة بدقتها الكاملة ~250KB وسطياً،
 * وشاشة الكتالوج تعرض ~48 قطعة — أي ~12MB لمجرد فتح الصفحة على بيانات الهاتف. المصغّرة
 * ~20–35KB فيصير نفس المشهد أقل من 2MB. الصورة الكاملة تبقى لصفحة تفاصيل القطعة فقط.
 * نمرّ دائماً عبر canvas هنا (بعكس compressImage الذي يُرجع الأصل إن كان صغيراً أصلاً)
 * لأن المطلوب حجم عرض ثابت لا "أصغر من الأصل".
 */
export async function makeThumbnail(file: File, maxDimension = 400, quality = 0.7): Promise<File | null> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return null;
  let handle: Awaited<ReturnType<typeof loadImage>> | null = null;
  try {
    handle = await loadImage(file);
    const scale = Math.min(1, maxDimension / Math.max(handle.width, handle.height));
    const w = Math.max(1, Math.round(handle.width * scale));
    const h = Math.max(1, Math.round(handle.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(handle.draw, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) return null;
    return new File([blob], "thumb.jpg", { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return null;
  } finally {
    handle?.close?.();
  }
}

export type NormalizedBbox = { x: number; y: number; w: number; h: number };

/**
 * يقصّ منطقة من صورة الصينية (نسبة 0..1 من الأبعاد) وتُعيد صورة القطعة وحدها بدل
 * صورة الصينية كاملة — تُستخدم لوضع "الصينية" بعد أن يُرجع الذكاء الاصطناعي مستطيل
 * كل قطعة. تُضيف هامشاً بسيطاً (5%) لأن مستطيلات الذكاء الاصطناعي أحياناً محكمة جداً
 * وتقصّ حافة القطعة. عند أي فشل أو مستطيل غير منطقي تُعيد null فيسقط المستدعي لصورة
 * الصينية الكاملة بدل كسر الحفظ.
 */
export async function cropImageToBbox(file: File, rawBbox: NormalizedBbox, opts: CompressOptions = {}): Promise<File | null> {
  const { maxDimension, quality, mimeType } = { ...DEFAULTS, ...opts };
  if (!rawBbox || [rawBbox.x, rawBbox.y, rawBbox.w, rawBbox.h].some((n) => typeof n !== "number" || !isFinite(n))) return null;

  // نماذج الرؤية (خصوصاً Gemini) غالباً تتجاهل طلب "0 إلى 1" وتُرجع مقياسها الأصلي
  // المُدرَّب عليه للكشف عن الأجسام (0 إلى 1000) رغم طلب العكس صراحة في الطلب — نتعامل
  // مع كِلا الاحتمالين هنا بدل رفض كل مستطيل بصمت والسقوط دائماً لصورة الصينية كاملة.
  const scale = [rawBbox.x, rawBbox.y, rawBbox.w, rawBbox.h].some((n) => n > 1) ? 1000 : 1;
  const bbox = { x: rawBbox.x / scale, y: rawBbox.y / scale, w: rawBbox.w / scale, h: rawBbox.h / scale };
  if (bbox.w <= 0.01 || bbox.h <= 0.01 || bbox.w > 1 || bbox.h > 1) return null;

  let handle: Awaited<ReturnType<typeof loadImage>> | null = null;
  try {
    handle = await loadImage(file);
    const { width, height } = handle;

    const margin = 0.02;
    const x0 = Math.max(0, bbox.x - bbox.w * margin);
    const y0 = Math.max(0, bbox.y - bbox.h * margin);
    const x1 = Math.min(1, bbox.x + bbox.w * (1 + margin));
    const y1 = Math.min(1, bbox.y + bbox.h * (1 + margin));

    const sx = Math.round(x0 * width);
    const sy = Math.round(y0 * height);
    const sw = Math.max(1, Math.round((x1 - x0) * width));
    const sh = Math.max(1, Math.round((y1 - y0) * height));

    const scale = Math.min(1, maxDimension / Math.max(sw, sh));
    const dw = Math.max(1, Math.round(sw * scale));
    const dh = Math.max(1, Math.round(sh * scale));

    const canvas = document.createElement("canvas");
    canvas.width = dw;
    canvas.height = dh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(handle.draw, sx, sy, sw, sh, 0, 0, dw, dh);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeType, quality));
    if (!blob) return null;

    const ext = mimeType === "image/webp" ? "webp" : "jpg";
    const base = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${base}-crop.${ext}`, { type: mimeType, lastModified: Date.now() });
  } catch {
    return null;
  } finally {
    handle?.close?.();
  }
}

/** يضغط عدة صور بالتوازي المحدود حتى لا يتجمّد الهاتف. */
export async function compressMany(
  files: File[],
  opts: CompressOptions = {},
  concurrency = 3,
  onProgress?: (done: number, total: number) => void,
): Promise<File[]> {
  const out: File[] = new Array(files.length);
  let i = 0;
  let done = 0;
  const worker = async () => {
    while (i < files.length) {
      const k = i++;
      out[k] = await compressImage(files[k], opts);
      onProgress?.(++done, files.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  return out;
}
