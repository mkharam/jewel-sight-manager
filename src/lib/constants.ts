// لوحات المفاتيح العربية على أغلب الهواتف (خصوصاً iOS حين تكون لغة النظام عربية) تكتب
// أرقاماً هندية شرقية (٠١٢٣٤٥٦٧٨٩) بدل الأرقام اللاتينية حتى داخل حقول type="number" —
// والمتصفح يرفضها بصمت هناك (input.value يصبح "" فوراً)، فيبدو للموظف أن الحقل "ما يخدمش"
// رغم أنه يكتب فيه فعلياً. نستخدم type="text" لحقول كهذه ونمرّر القيمة عبر هذه الدالة أولاً.
const EASTERN_ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
export function normalizeDecimalInput(raw: string): string {
  let out = "";
  for (const ch of raw) {
    const eastern = EASTERN_ARABIC_DIGITS.indexOf(ch);
    const persian = eastern === -1 ? PERSIAN_DIGITS.indexOf(ch) : -1;
    if (eastern !== -1) out += String(eastern);
    else if (persian !== -1) out += String(persian);
    else if (/[0-9]/.test(ch)) out += ch;
    else if ((ch === "." || ch === "٫" || ch === "،" || ch === ",") && !out.includes(".")) out += ".";
  }
  return out;
}

export const PRODUCT_STATUS = {
  available: { label: "متوفر", color: "bg-status-available text-white" },
  reserved: { label: "محجوز", color: "bg-status-reserved text-white" },
  sold: { label: "مبيع", color: "bg-status-sold text-white" },
  in_transfer: { label: "تحويل", color: "bg-status-transfer text-white" },
  damaged: { label: "تالف", color: "bg-status-damaged text-white" },
  lost: { label: "مفقود", color: "bg-status-lost text-white" },
  in_repair: { label: "في الصيانة", color: "bg-status-transfer text-white" },
  stock_discrepancy: { label: "فرق جرد", color: "bg-status-damaged text-white" },
  archived: { label: "مؤرشف", color: "bg-muted text-foreground" },
} as const;

export type ProductStatus = keyof typeof PRODUCT_STATUS;

export const INQUIRY_STATUS = {
  pending: { label: "بانتظار", color: "bg-muted text-foreground" },
  found: { label: "وُجد", color: "bg-status-transfer text-white" },
  quoted: { label: "تم التسعير", color: "bg-status-reserved text-white" },
  shown: { label: "تم العرض", color: "bg-accent text-accent-foreground" },
  sold: { label: "بيع", color: "bg-status-available text-white" },
  lost: { label: "ضائع", color: "bg-status-sold text-white" },
} as const;

export type InquiryStatus = keyof typeof INQUIRY_STATUS;

export const KARAT_OPTIONS = ["18K", "21K"];

// اللغة العربية (ar-LY/ar) تستخدم افتراضياً الأرقام الهندية الشرقية (١٢٣) في Intl —
// نطلب صراحةً "latn" (الأرقام اللاتينية 123) لأن الموظفين يقرؤون ويكتبون بالأرقام
// العادية، والأرقام الهندية تبطئ القراءة السريعة للأسعار والتواريخ.
export function formatCurrency(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("ar-LY-u-nu-latn", { maximumFractionDigits: 2 }).format(n) + " د.ل";
}

export function formatWeight(n: number | null | undefined) {
  if (n == null) return "—";
  return n.toFixed(3) + " غ";
}

export function formatDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("ar-u-nu-latn", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(date);
}

export function getImageUrl(path: string | null | undefined) {
  if (!path) return null;
  const base = import.meta.env.VITE_SUPABASE_URL;
  return `${base}/storage/v1/object/public/product-images/${path}`;
}
