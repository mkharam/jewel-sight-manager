// تقييم الموظفين: البنود، والدرجات، وأدوات الفترات. مشتركة بين الاستمارة (الرابط) واللوحة.
// الإيقاع: المشرف يقيّم موظفينه كل يوم؛ الموظف يقيّم نفسه ومشرفه مرتين في الشهر (1–15، 16–آخر الشهر)؛
// المشرف يقيّم نفسه برضو مرتين في الشهر. اللوحة تجمع كل شي شهر بشهر.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = supabase as any; // جداول التقييم جديدة ومش في الأنواع المولّدة بعد.

export type Role = "employee" | "manager" | "gm";
export type Kind = "self" | "by_manager" | "of_manager" | "by_gm";
export type EvalStaff = { id: string; name: string; role: Role; branch_id: string | null; branch_name: string | null; active?: boolean; profile_id?: string | null };
export type Evaluation = {
  id: string; month: string; period: string; kind: Kind; evaluator_id: string; subject_id: string; scores: Record<string, number>;
  overall: number | null; strengths: string | null; improvements: string | null; notes: string | null;
  source: "link" | "recorder"; entered_by: string | null; created_at: string; updated_at: string;
};

/** بنود تقييم الموظف (يقيّمها المشرف، والموظف يقيّم بيها نفسه). */
export const EMPLOYEE_CRITERIA = [
  { key: "attendance", label: "الالتزام بالدوام والمواعيد" },
  { key: "appearance", label: "المظهر والانضباط" },
  { key: "customers", label: "التعامل مع الزبائن" },
  { key: "sales", label: "البيع والمبادرة" },
  { key: "knowledge", label: "معرفة البضاعة والأسعار" },
  { key: "cleanliness", label: "نظافة وصيانة المحل" },
  { key: "display", label: "ترتيب الفترينة والعروض" },
  { key: "goods_care", label: "سلامة البضاعة والتبليغ عن أي كسر في القطع" },
  { key: "teamwork", label: "التعاون مع الزملاء" },
  { key: "system", label: "الاهتمام بالمنظومة وإنشاء الفواتير أول بأول" },
  { key: "loyalty", label: "الاهتمام بولاء الزبائن" },
] as const;

/** بنود تقييم المشرف (يقيّمها موظفينه، وهو يقيّم بيها نفسه). */
export const MANAGER_CRITERIA = [
  { key: "leadership", label: "قيادة الفريق وتوزيع الشغل" },
  { key: "followup", label: "المتابعة اليومية للفرع" },
  { key: "fairness", label: "العدل والتعامل مع الموظفين" },
  { key: "problems", label: "حل المشاكل والشكاوي" },
  { key: "stock", label: "ضبط البضاعة والجرد" },
  { key: "reporting", label: "التواصل مع الإدارة" },
  { key: "system", label: "الاهتمام بالمنظومة وإنشاء الفواتير أول بأول" },
  { key: "loyalty", label: "الاهتمام بولاء الزبائن" },
] as const;

/** تقييم المدير العام موقّف لين يقرروا يرجّعوه — خلّيها true ترجع الخانة والبنود. */
export const GM_EVAL_ENABLED = false;

/** بنود المدير العام: اللي يهمّه هو في كل موظف ومشرف — منفصلة على اللي يقيّمه المشرف. */
export const GM_CRITERIA = [
  { key: "punctuality", label: "الحضور والانصراف في الوقت" },
  { key: "absence", label: "الغياب والإجازات (بإذن ومن غير تكرار)" },
  { key: "rules", label: "الالتزام بقوانين وتعليمات الإدارة" },
  { key: "results", label: "نتائج البيع والأرقام" },
  { key: "invoices", label: "تسجيل الفواتير في المنظومة أول بأول" },
  { key: "custody", label: "المحافظة على البضاعة والعهدة" },
  { key: "conduct", label: "السلوك والأخلاق مع الزملاء والزبائن" },
  { key: "growth", label: "التطوّر والاستعداد للتعلّم" },
] as const;

export const ALL_CRITERIA: Record<string, string> = Object.fromEntries(
  [...EMPLOYEE_CRITERIA, ...MANAGER_CRITERIA, ...GM_CRITERIA].map((c) => [`${c.key}`, c.label]),
);

export const SCALE = [
  { v: 1, label: "ضعيف", cls: "bg-red-500" },
  { v: 2, label: "مقبول", cls: "bg-orange-500" },
  { v: 3, label: "جيد", cls: "bg-amber-500" },
  { v: 4, label: "جيد جداً", cls: "bg-lime-600" },
  { v: 5, label: "ممتاز", cls: "bg-emerald-600" },
] as const;

export const KIND_LABEL: Record<Kind, string> = {
  self: "تقييم ذاتي",
  by_manager: "تقييم المشرف",
  of_manager: "تقييم الموظفين لمشرفهم",
  by_gm: "تقييم المدير العام",
};

const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
export const monthLabel = (ym: string) => { const [y, m] = ym.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; };
export const monthStart = (ymd: string) => `${ymd.slice(0, 7)}-01`;
export function shiftMonth(ym01: string, n: number) {
  const [y, m] = ym01.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}
/** الشهر اللي يتقيّم: في أول 10 أيام من الشهر نقيّموا الشهر اللي فات، بعدها الشهر الحالي. */
export function defaultMonth(today: string) {
  const cur = monthStart(today);
  return Number(today.slice(8, 10)) <= 10 ? shiftMonth(cur, -1) : cur;
}

/** لون ووصف لأي متوسط (1–5). */
export function grade(v: number | null | undefined) {
  if (v == null) return { label: "—", text: "text-muted-foreground", bg: "bg-muted" };
  if (v >= 4.5) return { label: "ممتاز", text: "text-emerald-600", bg: "bg-emerald-600" };
  if (v >= 3.75) return { label: "جيد جداً", text: "text-lime-600", bg: "bg-lime-600" };
  if (v >= 3) return { label: "جيد", text: "text-amber-600", bg: "bg-amber-500" };
  if (v >= 2) return { label: "مقبول", text: "text-orange-600", bg: "bg-orange-500" };
  return { label: "ضعيف", text: "text-red-600", bg: "bg-red-500" };
}

// ===== الفترات =====
const pad = (n: number) => String(n).padStart(2, "0");
export function addDaysYmd(ymd: string, n: number) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** أول يوم في نص الشهر اللي فيه اليوم: 1 ولا 16. */
export const halfStart = (ymd: string) => `${ymd.slice(0, 7)}-${Number(ymd.slice(8, 10)) <= 15 ? "01" : "16"}`;
const daysInMonth = (ymd: string) => new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)), 0)).getUTCDate();
/** «النص الأول من نوفمبر (1–15)» / «النص الثاني من نوفمبر (16–30)». */
export function halfLabel(ymd: string) {
  const first = Number(ymd.slice(8, 10)) <= 15;
  const m = MONTHS[Number(ymd.slice(5, 7)) - 1];
  return first ? `النص الأول من ${m} (1–15)` : `النص الثاني من ${m} (16–${daysInMonth(ymd)})`;
}
/** آخر يوم في النص اللي قبل نص اليوم. */
export const prevHalfDay = (ymd: string) => addDaysYmd(halfStart(ymd), -1);
/** «اليوم» / «أمس» / «السبت 21 نوفمبر». */
export function dayLabel(ymd: string, today: string) {
  if (ymd === today) return "اليوم";
  if (ymd === addDaysYmd(today, -1)) return "أمس";
  const d = new Date(`${ymd}T12:00:00Z`);
  return new Intl.DateTimeFormat("ar-LY", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(d);
}
export const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** هل المستخدم المدير العام ولا مسؤول تقييم (أيمن)؟ undefined لين يوصل الجواب. */
export function useIsEvalAdmin() {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["is-eval-admin", user?.id],
    enabled: !!user,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await db.rpc("is_eval_admin", { uid: user!.id });
      return !!data;
    },
  });
  return data;
}
