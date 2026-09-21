// تاريخ العمل بتوقيت طرابلس لا UTC: بين منتصف الليل والثانية صباحاً بتوقيت المحل يكون تاريخ
// UTC ما زال «أمس»، فكان سعر الذهب يُسجَّل بتاريخ الأمس ويُعدّ متقادماً ويُقفَل اليوم بتاريخ خاطئ.
export const BUSINESS_TZ = "Africa/Tripoli";

/** تاريخ اليوم بصيغة YYYY-MM-DD بتوقيت المحل. */
export function businessToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** عدد الأيام الكاملة بين تاريخين YYYY-MM-DD (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);
}
