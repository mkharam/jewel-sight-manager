// استمارة التقييم الشهري — نفسها في الرابط اللي يتبعت للموظفين (token) وفي التطبيق لمسؤول التقييم
// (أيمن) اللي يسجّل نيابة عن اللي ما يعرفوش يبلّغوا. الخطوات: موظف ولا مشرف ← مين أنت ← البنود.
//  * الموظف: يقيّم نفسه (لازم)، ويقيّم مشرف فرعه (اختياري).
//  * المشرف: يقيّم كل موظف في فرعه، ويقيّم نفسه.
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, ChevronLeft, Loader2, UserCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  db, EMPLOYEE_CRITERIA, MANAGER_CRITERIA, SCALE, defaultMonth, monthLabel, shiftMonth,
  type EvalStaff, type Kind, type Role,
} from "@/lib/evaluation";

type Entry = { scores: Record<string, number>; strengths: string; improvements: string; notes: string };
type Card_ = { key: string; kind: Kind; subject: EvalStaff | null; title: string; criteria: readonly { key: string; label: string }[]; required: boolean };
const blank = (): Entry => ({ scores: {}, strengths: "", improvements: "", notes: "" });

export default function EvaluationForm({ token, recorder }: { token?: string; recorder?: boolean }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["eval-form", token ?? "recorder"],
    queryFn: async () => {
      const { data, error } = await db.rpc("eval_form", { p_token: token ?? null });
      if (error) throw error;
      if (!data) throw new Error("الرابط غير صالح — اطلب من الإدارة رابط جديد");
      return data as { staff: EvalStaff[]; today: string };
    },
  });
  const [role, setRole] = useState<Role | null>(null);
  const [me, setMe] = useState<EvalStaff | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const months = useMemo(() => {
    if (!data) return [];
    const d = defaultMonth(data.today);
    return [shiftMonth(d, -1), d, ...(d < `${data.today.slice(0, 7)}-01` ? [`${data.today.slice(0, 7)}-01`] : [])];
  }, [data]);
  const curMonth = month ?? (data ? defaultMonth(data.today) : null);

  // البطاقات حسب الدور: نفسه دايماً، وموظفين فرعه (للمشرف) ولا مشرف فرعه (للموظف).
  const cards = useMemo<Card_[]>(() => {
    if (!me || !data) return [];
    const sameBranch = data.staff.filter((s) => s.id !== me.id && s.branch_id === me.branch_id);
    if (me.role === "manager") {
      return [
        ...sameBranch.filter((s) => s.role === "employee").map((s) => ({
          key: `by_manager:${s.id}`, kind: "by_manager" as Kind, subject: s, title: `قيّم ${s.name}`, criteria: EMPLOYEE_CRITERIA, required: false,
        })),
        { key: "self", kind: "self", subject: null, title: "قيّم نفسك", criteria: MANAGER_CRITERIA, required: true },
      ];
    }
    return [
      { key: "self", kind: "self", subject: null, title: "قيّم نفسك", criteria: EMPLOYEE_CRITERIA, required: true },
      ...sameBranch.filter((s) => s.role === "manager").map((s) => ({
        key: `of_manager:${s.id}`, kind: "of_manager" as Kind, subject: s, title: `قيّم مشرفك ${s.name} (اختياري)`, criteria: MANAGER_CRITERIA, required: false,
      })),
    ];
  }, [me, data]);

  const entry = (k: string) => entries[k] ?? blank();
  const setEntry = (k: string, patch: Partial<Entry>) => setEntries((s) => ({ ...s, [k]: { ...entry(k), ...patch } }));
  const answered = (c: Card_) => c.criteria.filter((x) => entry(c.key).scores[x.key]).length;
  const problems = cards.filter((c) => (c.required && answered(c) < c.criteria.length) || (!c.required && answered(c) > 0 && answered(c) < c.criteria.length));

  const submit = useMutation({
    mutationFn: async () => {
      const list = cards.filter((c) => answered(c) > 0).map((c) => ({
        kind: c.kind, subject_id: c.subject?.id ?? me!.id, scores: entry(c.key).scores,
        strengths: entry(c.key).strengths, improvements: entry(c.key).improvements, notes: entry(c.key).notes,
      }));
      const { data, error } = await db.rpc("eval_submit", { p_token: token ?? null, p: { month: curMonth, evaluator_id: me!.id, entries: list } });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => setDone(n),
  });

  if (isLoading) return <div className="flex justify-center py-20"><Loader2 className="size-7 animate-spin text-primary" /></div>;
  if (error || !data) return <Card className="p-6 text-center font-semibold text-destructive">{(error as Error)?.message ?? "تعذّر فتح الاستمارة"}</Card>;

  if (done != null) {
    return (
      <Card className="p-8 text-center space-y-3">
        <CheckCircle2 className="size-14 mx-auto text-emerald-600" />
        <p className="text-xl font-bold">تم إرسال التقييم، شكراً {recorder ? "" : me?.name}</p>
        <p className="text-sm text-muted-foreground">{n(done)} تقييم لشهر {monthLabel(curMonth!)}{recorder ? ` باسم ${me?.name}` : ""}</p>
        <Button variant="outline" onClick={() => { setDone(null); setMe(null); setRole(null); setEntries({}); }}>
          {recorder ? "سجّل تقييم شخص ثاني" : "رجوع"}
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* الشهر */}
      <div>
        <p className="text-sm font-semibold mb-1.5">تقييم شهر</p>
        <div className="flex gap-1.5 flex-wrap">
          {months.map((m) => (
            <Button key={m} size="sm" variant={curMonth === m ? "default" : "outline"} onClick={() => setMonth(m)}>{monthLabel(m)}</Button>
          ))}
        </div>
      </div>

      {/* موظف ولا مشرف */}
      {!me && (
        <>
          <div>
            <p className="text-sm font-semibold mb-1.5">{recorder ? "اللي تسجّل عنه:" : "أنت:"}</p>
            <div className="grid grid-cols-2 gap-2">
              {([["employee", "موظف", Users], ["manager", "مشرف", UserCheck]] as const).map(([r, l, Icon]) => (
                <button key={r} onClick={() => setRole(r)}
                  className={`rounded-2xl border-2 p-4 flex flex-col items-center gap-1.5 font-bold text-lg ${role === r ? "border-primary bg-gold-soft" : "border-border bg-card"}`}>
                  <Icon className="size-8 text-primary" />{l}
                </button>
              ))}
            </div>
          </div>
          {role && (
            <div>
              <p className="text-sm font-semibold mb-1.5">اختار {recorder ? "الاسم" : "اسمك"}:</p>
              <div className="space-y-3">
                {Object.entries(groupBy(data.staff.filter((s) => s.role === role), (s) => s.branch_name ?? "بدون فرع")).map(([b, list]) => (
                  <div key={b}>
                    <p className="text-xs text-muted-foreground mb-1">{b}</p>
                    <div className="grid grid-cols-2 gap-2">
                      {list.map((s) => (
                        <Button key={s.id} variant="outline" className="h-12 text-base justify-between" onClick={() => { setMe(s); setOpen(null); }}>
                          {s.name}<ChevronLeft className="size-4" />
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
                {!data.staff.some((s) => s.role === role) && <p className="text-sm text-muted-foreground">ما فيش أسماء — اطلب من الإدارة تزيدك.</p>}
              </div>
            </div>
          )}
        </>
      )}

      {/* البنود */}
      {me && (
        <>
          <Card className="p-3 flex items-center justify-between bg-gold-soft border-primary/30">
            <div>
              <p className="font-bold text-lg">{me.name}</p>
              <p className="text-xs text-muted-foreground">{me.role === "manager" ? "مشرف" : "موظف"} · {me.branch_name ?? "بدون فرع"}{recorder ? " · تسجيل نيابة عنه" : ""}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => { setMe(null); setEntries({}); }}>تغيير</Button>
          </Card>
          <p className="text-xs text-muted-foreground">اختار من 1 (ضعيف) لـ 5 (ممتاز) لكل بند. كن صريح — التقييم يعاون الكل يتحسّن.</p>

          {cards.map((c) => {
            const isOpen = open === c.key || (open === null && c === cards[0]);
            const a = answered(c);
            return (
              <Card key={c.key} className="overflow-hidden">
                <button className="w-full flex items-center justify-between p-3 text-right" onClick={() => setOpen(isOpen ? "__none" : c.key)}>
                  <span className="font-bold">{c.title}</span>
                  <span className="flex items-center gap-2 text-xs">
                    <span className={a === c.criteria.length ? "text-emerald-600 font-bold" : "text-muted-foreground"}>{a}/{c.criteria.length}</span>
                    <ChevronDown className={`size-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  </span>
                </button>
                {isOpen && (
                  <div className="px-3 pb-3 space-y-3">
                    {c.criteria.map((cr) => (
                      <div key={cr.key}>
                        <p className="text-sm font-semibold mb-1">{cr.label}</p>
                        <div className="grid grid-cols-5 gap-1">
                          {SCALE.map((s) => {
                            const on = entry(c.key).scores[cr.key] === s.v;
                            return (
                              <button key={s.v} onClick={() => setEntry(c.key, { scores: { ...entry(c.key).scores, [cr.key]: s.v } })}
                                className={`rounded-lg py-1.5 flex flex-col items-center border ${on ? `${s.cls} text-white border-transparent` : "bg-card border-border"}`}>
                                <span className="text-base font-bold leading-none">{s.v}</span>
                                <span className="text-[9px] leading-tight mt-0.5">{s.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    <Textarea placeholder="نقاط القوة" value={entry(c.key).strengths} onChange={(e) => setEntry(c.key, { strengths: e.target.value })} rows={2} />
                    <Textarea placeholder="شن يحتاج يتحسّن" value={entry(c.key).improvements} onChange={(e) => setEntry(c.key, { improvements: e.target.value })} rows={2} />
                    <Textarea placeholder="ملاحظات (اختياري)" value={entry(c.key).notes} onChange={(e) => setEntry(c.key, { notes: e.target.value })} rows={2} />
                  </div>
                )}
              </Card>
            );
          })}

          {problems.length > 0 && (
            <p className="text-sm text-amber-700 dark:text-amber-400">كمّل كل البنود في: {problems.map((p) => p.title).join("، ")}</p>
          )}
          {submit.isError && <p className="text-sm text-destructive">{(submit.error as Error).message}</p>}
          <Button size="lg" className="w-full h-14 text-lg" disabled={problems.length > 0 || submit.isPending} onClick={() => submit.mutate()}>
            {submit.isPending ? <Loader2 className="size-5 animate-spin" /> : "إرسال التقييم"}
          </Button>
        </>
      )}
    </div>
  );
}

const n = (v: number) => v.toLocaleString("en-US");
function groupBy<T>(xs: T[], f: (x: T) => string) {
  return xs.reduce<Record<string, T[]>>((m, x) => { (m[f(x)] ??= []).push(x); return m; }, {});
}
