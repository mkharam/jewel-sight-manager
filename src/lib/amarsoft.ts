// أدوات صفحات أمارسوفت: المال بالدرهم (1 د.ل = 1000 درهم) والتوقيت بتوقيت طرابلس (UTC+2 بدون توقيت صيفي).
import { supabase } from "@/integrations/supabase/client";

// جداول أمارسوفت قد لا تظهر في الأنواع المولّدة؛ نستخدم عميلاً غير مُنمّط لها فقط.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const sb = supabase as any;

export const TZ = "Africa/Tripoli";
const OFFSET = "+02:00";

export function formatLD(dirhams: number | null | undefined) {
  const v = Math.round(Number(dirhams ?? 0) / 1000);
  return `${v.toLocaleString("en-US")} د.ل`;
}

/** تاريخ اليوم بتوقيت طرابلس بصيغة YYYY-MM-DD */
export function tripoliToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);
}

function addDays(ymd: string, n: number) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type Period = "today" | "yesterday" | "week" | "month";

/** نطاق تاريخي [from, to] بالأيام (شامل) — الأسبوع يبدأ السبت */
export function periodDays(p: Period, now = new Date()): { from: string; to: string } {
  const today = tripoliToday(now);
  if (p === "today") return { from: today, to: today };
  if (p === "yesterday") { const y = addDays(today, -1); return { from: y, to: y }; }
  if (p === "week") {
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0=أحد .. 6=سبت
    const back = (dow + 1) % 7;
    return { from: addDays(today, -back), to: today };
  }
  return { from: today.slice(0, 8) + "01", to: today };
}

/** تحويل نطاق أيام إلى حدود timestamptz: [start, end) */
export function daysToRange(from: string, to: string) {
  return { start: `${from}T00:00:00${OFFSET}`, end: `${addDays(to, 1)}T00:00:00${OFFSET}` };
}

export function formatTripoli(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("ar-LY", {
    timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}
