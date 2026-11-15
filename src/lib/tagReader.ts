// قارئ ليبل أمارسوفت (Code128، رقم 8 أرقام زي 01002717) بمكتبة zxing-cpp المترجمة لـ WebAssembly.
// أدق وأسرع بوضوح من ZXing-JS على الباركود الخطي الرفيع، ويخدم في سفاري الآيفون (ما فيهش
// BarcodeDetector). ملف الـwasm (~1MB) يجي من التطبيق نفسه مش من CDN، ويتحمّل أول مرة بس.
// نفس القارئ للكاميرا الحيّة (منطقة الإطار) وللصور المرفوعة من المعرض (الصورة كاملة).
import { prepareZXingModule, readBarcodes, type ReaderOptions } from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { locateBarcodes } from "@/lib/barcodeLocate";

prepareZXingModule({
  overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) },
});

const FORMATS: ReaderOptions["formats"] = ["Code128", "Code39", "Code93", "ITF", "Codabar", "EAN-13", "EAN-8", "UPC-A"];

/** رقم التاق من نص الباركود: الأرقام بس (الليبل أحياناً فيه مسافات ولا حروف زيادة). */
export function tagKey(text: string | null | undefined) {
  const d = (text ?? "").replace(/\D/g, "");
  return d.length >= 6 ? d : null;
}

// من عدة باركودات في نفس الصورة نختار اللي شكله رقم أمارسوفت (8 أرقام)، والا الأطول.
function best(texts: string[]) {
  const keys = texts.map(tagKey).filter((k): k is string => !!k);
  return keys.find((k) => k.length === 8) ?? keys.sort((a, b) => b.length - a.length)[0] ?? null;
}

/** يقرا رقم التاق من صورة (ملف ولا ImageData). يرجّع null لو ما لقاش. ما يرميش أخطاء. */
export async function readTag(input: Blob | ImageData, opts: { fast?: boolean } = {}): Promise<string | null> {
  try {
    const res = await readBarcodes(input, {
      formats: FORMATS,
      tryHarder: !opts.fast,
      tryRotate: !opts.fast,
      tryDownscale: true,
      maxNumberOfSymbols: opts.fast ? 1 : 4,
    });
    return best(res.filter((r) => r.isValid).map((r) => r.text));
  } catch {
    return null;
  }
}

/** يحمّل القارئ مسبقاً (لما تنفتح الكاميرا) باش أول قراءة ما تتأخرش. */
export function warmTagReader() {
  void readTag(new ImageData(8, 8), { fast: true });
}

// ===== قراءة عميقة لليبل صُوّر من بعيد أو مائل =====

const DEEP: ReaderOptions = { formats: ["Code128"], tryHarder: true, tryRotate: true, tryDownscale: false, maxNumberOfSymbols: 2 };

/** ليبل المحل Code128 برقم 8 أرقام بالضبط — في القراءة العميقة لا نقبل غيره، حتى لا يطلع كود غلط من زخرفة. */
async function readStrict(input: ImageData): Promise<string | null> {
  try {
    const res = await readBarcodes(input, DEEP);
    for (const r of res) {
      const k = r.isValid ? tagKey(r.text) : null;
      if (k && k.length === 8) return k;
    }
  } catch { /* نكمل */ }
  return null;
}

/**
 * يقرا رقم التاق من صورة كاملة بأقصى دقة: القراءة العادية أولاً (سريعة، تكفي لليبل القريب)، وإن
 * فشلت يحدّد مناطق الباركود المحتملة في الصورة بدقتها الأصلية (barcodeLocate)، ويقصّ كل منطقة
 * ويعدّل ميلها ويكبّرها ×1 و×2 و×3 ثم يقراها. يلتقط ليبل عرضه ~200 بكسل في صورة 12 ميغابكسل
 * وبأي زاوية ميل. صورة قطعة بلا ليبل تمرّ سريعاً (لا مناطق مرشّحة غالباً).
 */
export async function readTagDeep(file: Blob): Promise<string | null> {
  const quick = await readTag(file);
  if (quick) return quick;
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { return null; }
  try {
    // الدقة الأصلية (حتى 4096) — التصغير هو ما يضيّع الليبل البعيد.
    const k = Math.min(1, 4096 / Math.max(bmp.width, bmp.height));
    const W = Math.round(bmp.width * k), H = Math.round(bmp.height * k);
    const full = document.createElement("canvas");
    full.width = W; full.height = H;
    const fctx = full.getContext("2d", { willReadFrequently: true });
    if (!fctx) return null;
    fctx.drawImage(bmp, 0, 0, W, H);
    const regions = locateBarcodes(fctx.getImageData(0, 0, W, H).data, W, H);

    const crop = document.createElement("canvas");
    const cctx = crop.getContext("2d", { willReadFrequently: true });
    if (!cctx) return null;
    for (const r of regions) {
      for (const scale of [1, 2, 3]) {
        const out = Math.round(r.size * scale);
        if (out > 2200) break;
        if (out < 260) continue;
        crop.width = out; crop.height = out;
        cctx.fillStyle = "#fff";
        cctx.fillRect(0, 0, out, out);
        cctx.imageSmoothingEnabled = true;
        cctx.imageSmoothingQuality = "high";
        cctx.save();
        cctx.translate(out / 2, out / 2);
        cctx.scale(scale, scale);
        cctx.rotate(-r.angle); // اتجاه المسح يصير أفقياً
        cctx.drawImage(full, -r.cx, -r.cy);
        cctx.restore();
        const tag = await readStrict(cctx.getImageData(0, 0, out, out));
        if (tag) return tag;
      }
    }
    return null;
  } finally {
    bmp.close();
  }
}
