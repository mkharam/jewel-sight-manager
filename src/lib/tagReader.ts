// قارئ ليبل أمارسوفت (Code128، رقم 8 أرقام زي 01002717) بمكتبة zxing-cpp المترجمة لـ WebAssembly.
// أدق وأسرع بوضوح من ZXing-JS على الباركود الخطي الرفيع، ويخدم في سفاري الآيفون (ما فيهش
// BarcodeDetector). ملف الـwasm (~1MB) يجي من التطبيق نفسه مش من CDN، ويتحمّل أول مرة بس.
// نفس القارئ للكاميرا الحيّة (منطقة الإطار) وللصور المرفوعة من المعرض (الصورة كاملة).
import { prepareZXingModule, readBarcodes, type ReaderOptions } from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

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
