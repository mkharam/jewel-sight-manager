// قطع صغيرة مشتركة بين أقسام لوحة التقييم وشاشات التفاصيل.
import type { ReactNode } from "react";
import { ALL_CRITERIA, KIND_LABEL, dayLabel, grade, halfLabel, monthLabel, type Evaluation } from "@/lib/evaluation";
import { f1, per, type Board, type Flag } from "@/lib/evalBoard";

/** شن يفتح لما تضغط: شخص، فرع، بند، قائمة، ولا الفروع كلها. */
export type ListKind = "rated" | "low" | "flagged" | "noself";
export type Detail =
  | { t: "person"; id: string }
  | { t: "branch"; name: string }
  | { t: "crit"; key: string }
  | { t: "list"; which: ListKind }
  | { t: "branches" };
export type OpenFn = (d: Detail) => void;

export const roleLabel = (r: string) => (r === "manager" ? "مشرف" : "موظف");

/** شريط الدرجة (من 5). */
export function Bar({ v, className = "h-1.5" }: { v: number | null | undefined; className?: string }) {
  return (
    <div className={`${className} overflow-hidden rounded-full bg-muted`}>
      <div className={`h-full ${grade(v).bg}`} style={{ width: `${((v ?? 0) / 5) * 100}%` }} />
    </div>
  );
}

export function FlagBadge({ flag }: { flag: Flag | null }) {
  if (!flag) return null;
  return (
    <span className={`inline-flex max-w-full items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-tight ${flag.level === "red"
      ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300"
      : "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"}`}>
      ⚠️ <span className="truncate">{flag.short}</span>
    </span>
  );
}

export function FlagBanner({ flag }: { flag: Flag }) {
  return (
    <p className={`rounded-lg p-2 text-sm font-semibold ${flag.level === "red"
      ? "bg-red-500/10 text-red-700 dark:text-red-300"
      : "bg-amber-500/10 text-amber-800 dark:text-amber-300"}`}>
      ⚠️ {flag.text}
    </p>
  );
}

/** «اليوم» / «أمس» / «السبت 21 نوفمبر» للتقييم اليومي، والنص ولا الشهر للباقي. */
export const whenLabel = (e: Evaluation, today: string) =>
  e.kind === "by_manager" ? dayLabel(per(e), today) : e.kind === "by_gm" ? monthLabel(e.month) : halfLabel(per(e));

/** تقييم واحد بالتفصيل: مين، إمتى، كل بند بدرجته، والملاحظات. */
export function EvalCard({ e, b, nameOf }: { e: Evaluation; b: Board; nameOf: (id: string) => string }) {
  const crits = Object.entries(e.scores ?? {});
  return (
    <div className="space-y-1.5 rounded-lg border bg-muted/30 p-2 text-sm">
      <p className="text-xs text-muted-foreground">
        {KIND_LABEL[e.kind]}{e.kind !== "self" ? ` · من ${nameOf(e.evaluator_id)}` : ""} · {whenLabel(e, b.today)}
        {e.source === "recorder" ? " · سجّلها المسؤول" : ""}
      </p>
      {e.absent ? (
        <p className="font-bold text-red-600">غايب — {e.absence_reason ?? "بدون سبب"}</p>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
            {crits.map(([k, v]) => [
              <span key={k} className="text-[13px]">{ALL_CRITERIA[k] ?? k}</span>,
              <span key={k + "v"} className={`text-center font-bold tabular-nums ${grade(Number(v)).text}`}>{v}</span>,
            ])}
          </div>
          <p className="border-t pt-1 text-xs">المتوسط: <b className={grade(e.overall).text}>{f1(e.overall)}</b> · {grade(e.overall).label}</p>
        </>
      )}
      {e.strengths && <p><b className="text-emerald-600">قوة: </b>{e.strengths}</p>}
      {e.improvements && <p><b className="text-amber-600">يتحسّن: </b>{e.improvements}</p>}
      {e.notes && <p className="text-muted-foreground">{e.notes}</p>}
    </div>
  );
}

/** أيام الأسبوع من السبت. */
const WEEK = ["سبت", "أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة"];
export const weekdayOf = (d: string) => WEEK[(new Date(`${d}T12:00:00Z`).getUTCDay() + 1) % 7];

/** رزنامة الشهر (الأسبوع من السبت): كل يوم مربّع بلونه، والضغط يفتح تفاصيل اليوم. */
export function MonthGrid({ b, cell, sel, onSel }: {
  b: Board;
  cell: (day: string) => { cls: string; text: ReactNode; clickable: boolean };
  sel: string | null;
  onSel: (d: string | null) => void;
}) {
  const lead = (new Date(`${b.allDays[0]}T12:00:00Z`).getUTCDay() + 1) % 7;
  return (
    <div className="grid grid-cols-7 gap-1 text-center">
      {WEEK.map((w) => <span key={w} className="text-[10px] text-muted-foreground">{w}</span>)}
      {Array.from({ length: lead }, (_, i) => <span key={"x" + i} />)}
      {b.allDays.map((d) => {
        const c = cell(d);
        return (
          <button key={d} type="button" disabled={!c.clickable} onClick={() => onSel(sel === d ? null : d)}
            className={`flex h-11 flex-col items-center justify-center rounded-md border text-[11px] leading-tight ${c.cls} ${sel === d ? "ring-2 ring-primary ring-offset-1" : ""}`}>
            <span className="font-bold">{Number(d.slice(8))}</span>
            <span className="text-[10px]">{c.text}</span>
          </button>
        );
      })}
    </div>
  );
}

export const DAY_CLS = {
  ok: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
  part: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
  absent: "border-red-300 bg-red-100 text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300",
  miss: "border-red-200 bg-background text-red-600 dark:border-red-900",
  future: "border-transparent bg-muted/40 text-muted-foreground",
  /** اليوم ولسه ما كملش. */
  today: "border-dashed border-primary/70 bg-background text-foreground",
};
