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
