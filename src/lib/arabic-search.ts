/**
 * بحث نصي عربي متسامح — يفهم اللهجة الليبية، الأخطاء الإملائية، الحروف الناقصة،
 * ويوسّع البحث تلقائياً ليشمل الأحجار والألوان والمرادفات.
 */

/** توحيد النص العربي: تشكيل، همزات، ياء/ألف مقصورة، تاء مربوطة، أرقام… */
export function normalizeAr(input: string): string {
  return (input || "")
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670\u06D6-\u06ED]/g, "") // تشكيل
    .replace(/\u0640/g, "") // تطويل
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[ىئي]/g, "ي")
    .replace(/[ؤ]/g, "و")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[^0-9a-z\u0621-\u064A\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** مجموعات مرادفات — أي كلمة في المجموعة تجلب كل كلمات المجموعة. */
const SYNONYM_GROUPS: string[][] = [
  // أحجار بيضاء / ألماس
  ["الماس", "دايموند", "ديمن", "برلنت", "سوليتير", "زركون", "زيركون", "كريستال", "حجر ابيض", "احجار بيضاء", "cz"],
  // زمرد
  ["زمرد", "زمردي", "اخضر", "امرلد", "emerald"],
  // ياقوت
  ["ياقوت", "احمر", "روبي", "ruby"],
  // سفير
  ["سفير", "صفير", "ازرق", "زرقاء", "sapphire"],
  // جمشت
  ["جمشت", "امشيست", "بنفسجي", "موف", "amethyst"],
  // سيترين
  ["سيترين", "اصفر", "citrine", "توباز"],
  // لؤلؤ
  ["لولو", "لؤلؤ", "لولي", "بيرل", "pearl"],
  ["فيروز", "تركواز", "turquoise"],
  ["عقيق", "كارنيليان"],
  // معدن
  ["ابيض", "ذهب ابيض", "روديوم", "بلاتين", "white"],
  ["اصفر", "ذهب اصفر", "yellow"],
  ["وردي", "روز", "روز غولد", "rose"],
  ["فضه", "فضي", "silver"],
  // فئات باللهجة الليبية
  ["حلق", "اقراط", "قرط", "تراكي", "حلقان"],
  ["سلسله", "كردان", "عقد", "قلاده", "شوكر", "تشوكر"],
  ["خاتم", "دبله", "محبس", "خواتم"],
  ["اسوره", "غويشه", "بنجل", "بنغل", "مسكه", "سواره", "تنس"],
  ["طقم", "اطقم", "شنو", "سيت"],
  ["خلخال", "خلاخل"],
  ["تعليقه", "دلايه", "بندلوك", "بندنتيف"],
];

const SYNONYM_INDEX = (() => {
  const m = new Map<string, Set<string>>();
  for (const g of SYNONYM_GROUPS) {
    const norm = g.map(normalizeAr);
    for (const w of norm) {
      const set = m.get(w) ?? new Set<string>();
      norm.forEach((x) => set.add(x));
      m.set(w, set);
    }
  }
  return m;
})();

/** يوسّع نص البحث إلى قائمة كلمات للبحث بها في قاعدة البيانات. */
export function expandQuery(raw: string): { tokens: string[]; terms: string[] } {
  const norm = normalizeAr(raw);
  const tokens = norm.split(" ").filter((t) => t.length >= 2);
  const terms = new Set<string>();
  if (norm) terms.add(norm);
  for (const t of tokens) {
    terms.add(t);
    for (const s of SYNONYM_INDEX.get(t) ?? []) terms.add(s);
  }
  // كلمات مركبة مثل "ذهب ابيض"
  for (const [key, set] of SYNONYM_INDEX) {
    if (key.includes(" ") && norm.includes(key)) set.forEach((s) => terms.add(s));
  }
  return { tokens, terms: Array.from(terms).slice(0, 24) };
}

/** مسافة ليفنشتاين (محدودة) للتسامح مع الحروف الناقصة/المقلوبة. */
function lev(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

function tolerance(len: number) {
  if (len <= 3) return 0;
  if (len <= 5) return 1;
  return 2;
}

/** هل يظهر التوكن (أو ما يشبهه) داخل النص؟ يرجّع درجة 0..1 */
export function tokenScore(haystackNorm: string, token: string): number {
  if (!token) return 0;
  if (haystackNorm.includes(token)) return 1;
  const tol = tolerance(token.length);
  if (tol === 0) return 0;
  let best = 0;
  for (const w of haystackNorm.split(" ")) {
    if (!w) continue;
    if (w.startsWith(token.slice(0, Math.max(2, token.length - 1)))) best = Math.max(best, 0.8);
    const d = lev(w, token, tol);
    if (d <= tol) best = Math.max(best, 1 - d / (tol + 1));
  }
  return best;
}

/** نص قابل للبحث من صف منتج. */
export function productHaystack(p: any): string {
  return normalizeAr(
    [
      p?.name,
      p?.sku,
      p?.description,
      p?.karat,
      p?.category?.name,
      p?.branch?.name,
      ...((p?.search_tags ?? []) as string[]),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

/**
 * درجة تطابق منتج مع نص البحث: 0 = لا يطابق.
 * يحسب مع المرادفات (لون → أحجار، لهجة → فئة) بدون الحاجة لذكر الكلمة نصياً.
 */
export function matchScore(p: any, raw: string): number {
  const { tokens } = expandQuery(raw);
  if (!tokens.length) return 1;
  const hay = productHaystack(p);
  let total = 0;
  for (const t of tokens) {
    let best = tokenScore(hay, t);
    if (best < 1) {
      for (const s of SYNONYM_INDEX.get(t) ?? []) {
        if (s === t) continue;
        best = Math.max(best, tokenScore(hay, s) * 0.85);
        if (best >= 0.85) break;
      }
    }
    if (best <= 0) return 0; // كل كلمة يجب أن تُطابق بشكل ما
    total += best;
  }
  return total / tokens.length;
}
