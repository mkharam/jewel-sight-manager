// تقييم الموظفين الشهري: البنود، والدرجات، وأدوات الشهر. مشتركة بين الاستمارة (الرابط) واللوحة.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = supabase as any; // جداول التقييم جديدة ومش في الأنواع المولّدة بعد.

export type Role = "employee" | "manager";
export type Kind = "self" | "by_manager" | "of_manager";
export type EvalStaff = { id: string; name: string; role: Role; branch_id: string | null; branch_name: string | null; active?: boolean; profile_id?: string | null };
export type Evaluation = {
  id: string; month: string; kind: Kind; evaluator_id: string; subject_id: string; scores: Record<string, number>;
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
  { key: "app", label: "استعمال التطبيق والمنظومة" },
] as const;

/** بنود تقييم المشرف (يقيّمها موظفينه، وهو يقيّم بيها نفسه). */
export const MANAGER_CRITERIA = [
  { key: "leadership", label: "قيادة الفريق وتوزيع الشغل" },
  { key: "followup", label: "المتابعة اليومية للفرع" },
  { key: "fairness", label: "العدل والتعامل مع الموظفين" },
  { key: "problems", label: "حل المشاكل والشكاوي" },
  { key: "stock", label: "ضبط البضاعة والجرد" },
  { key: "reporting", label: "التواصل مع الإدارة" },
] as const;

export const ALL_CRITERIA: Record<string, string> = Object.fromEntries(
  [...EMPLOYEE_CRITERIA, ...MANAGER_CRITERIA].map((c) => [c.key, c.label]),
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
