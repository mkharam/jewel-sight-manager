// رقم بصيغة wa.me الدولية. الأرقام تُدخَل محلياً (09xxxxxxxx) بينما wa.me يشترط رمز الدولة بلا
// صفر ولا +، وإلا فتح الرابط محادثة مع رقم غير موجود. الافتراضي ليبيا (218).
// يطابق whatsappNumber في تطبيق الصيانة (Goldsystem).
export const DEFAULT_COUNTRY_CODE = "218";

const EASTERN = "٠١٢٣٤٥٦٧٨٩";

export function whatsappNumber(phone: string, countryCode = DEFAULT_COUNTRY_CODE): string {
  const d = phone.replace(/[٠-٩]/g, (ch) => String(EASTERN.indexOf(ch))).replace(/\D/g, "");
  if (!d) return "";
  if (phone.trim().startsWith("+")) return d;
  if (d.startsWith("00")) return d.slice(2);
  if (d.startsWith("0")) return countryCode + d.slice(1);
  if (d.startsWith(countryCode) && d.length >= countryCode.length + 9) return d;
  return countryCode + d;
}

export function whatsappLink(phone: string | null | undefined, message: string): string | null {
  const n = whatsappNumber(phone ?? "");
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(message)}` : null;
}
