// لوحة التقييمات — للمدير العام ومسؤول التقييم (أيمن). ثلاث خانات:
//  * اللوحة: كل شهر — كم واحد اتقيّم، المتوسط، الأحسن واللي يحتاج متابعة، الناقصين، الترتيب، الفروع،
//    أضعف البنود، وتفاصيل كل شخص (بنوده، تقييمه لنفسه مقابل تقييم مشرفه، ملاحظاته، وتطوّره شهر بشهر).
//  * تسجيل تقييم: نفس استمارة الرابط، لأيمن يسجّل عن اللي ما يعرفوش يبلّغوا.
//  * الإعدادات: رابط التقييم (نسخ/واتساب)، قائمة الموظفين، والمسؤولين على التقييم.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Award, ClipboardList, Copy, Loader2, MessageCircle, Plus, Settings2, Star, TrendingDown, TrendingUp, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import EvaluationForm from "@/components/EvaluationForm";
import { businessToday } from "@/lib/dates";
import {
  ALL_CRITERIA, EMPLOYEE_CRITERIA, GM_CRITERIA, GM_EVAL_ENABLED, MANAGER_CRITERIA, KIND_LABEL, db, defaultMonth, grade, monthLabel, shiftMonth,
  type EvalStaff, type Evaluation, useIsEvalAdmin,
} from "@/lib/evaluation";

type Tab = "board" | "record" | "settings";
type Person = EvalStaff & {
  final: number | null; self: number | null; others: number | null; gm: number | null; prev: number | null;
  evals: Evaluation[]; missing: string[];
};

const avg = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => x != null).map(Number);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const f1 = (v: number | null | undefined) => (v == null ? "—" : Number(v).toFixed(1));

export default function Evaluations() {
  const { roles } = useAuth();
  const isAdmin = roles.includes("admin");
  const allowed = useIsEvalAdmin();
  const [tab, setTab] = useState<Tab>("board");
  const [month, setMonth] = useState(() => defaultMonth(businessToday()));
  const [openId, setOpenId] = useState<string | null>(null);
  const [recordMode, setRecordMode] = useState<"gm" | "behalf">(GM_EVAL_ENABLED ? "gm" : "behalf");

  const { data, isLoading } = useQuery({
    queryKey: ["evaluations", month],
    queryFn: async () => {
      const from = shiftMonth(month, -5);
      const [staff, evals] = await Promise.all([
        db.from("eval_staff").select("*, branch:branches(name)").order("name"),
        db.from("staff_evaluations").select("*").gte("month", from).lte("month", month),
      ]);
      if (staff.error) throw staff.error;
      if (evals.error) throw evals.error;
      return {
        staff: ((staff.data ?? []) as (EvalStaff & { branch: { name: string } | null })[]).map((s) => ({ ...s, branch_name: s.branch?.name ?? null })),
        evals: (evals.data ?? []) as Evaluation[],
      };
    },
  });

  const v = useMemo(() => {
    if (!data) return null;
    // «المدير العام» صف للتقييم بس (هو اللي يقيّم)، ما يدخلش في الترتيب.
    const active = data.staff.filter((s) => s.active !== false && s.role !== "gm");
    const byMonth = (m: string) => data.evals.filter((e) => e.month === m);
    // درجة الشخص في شهر: تقييم الغير (المشرف للموظف، الموظفين للمشرف) ولو ما فيش، تقييمه لنفسه.
    const scoreOf = (s: EvalStaff, m: string) => {
      const es = byMonth(m).filter((e) => e.subject_id === s.id);
      const others = avg(es.filter((e) => e.kind !== "self").map((e) => e.overall));
      const self = avg(es.filter((e) => e.kind === "self").map((e) => e.overall));
      const gm = avg(es.filter((e) => e.kind === "by_gm").map((e) => e.overall));
      return { others, self, gm, final: others ?? self, evals: es };
    };
    const people: Person[] = active.map((s) => {
      const cur = scoreOf(s, month);
      const prev = scoreOf(s, shiftMonth(month, -1)).final;
      const hasManager = active.some((m) => m.role === "manager" && m.branch_id === s.branch_id && m.id !== s.id);
      const missing = [
        ...(cur.evals.some((e) => e.kind === "self") ? [] : ["تقييمه لنفسه"]),
        ...(s.role === "employee" && hasManager && !cur.evals.some((e) => e.kind === "by_manager") ? ["تقييم المشرف ليه"] : []),
        ...(!GM_EVAL_ENABLED || cur.evals.some((e) => e.kind === "by_gm") ? [] : ["تقييم المدير العام"]),
      ];
      return { ...s, ...cur, prev, missing };
    });
    const rated = people.filter((p) => p.final != null).sort((a, b) => (b.final ?? 0) - (a.final ?? 0));
    const branches = Object.entries(rated.reduce<Record<string, number[]>>((m, p) => {
      ((m[p.branch_name ?? "بدون فرع"] ??= [])).push(p.final!); return m;
    }, {})).map(([name, xs]) => ({ name, avg: avg(xs)!, n: xs.length })).sort((a, b) => b.avg - a.avg);
    // متوسط كل بند (من تقييم الغير لو موجود، والا الذاتي) — أضعف البنود أول.
    const crit: Record<string, number[]> = {};
    for (const p of rated) {
      const src = p.evals.filter((e) => e.kind !== "self").length ? p.evals.filter((e) => e.kind !== "self") : p.evals;
      for (const e of src) for (const [k, val] of Object.entries(e.scores ?? {})) (crit[k] ??= []).push(Number(val));
    }
    const criteria = Object.entries(crit).map(([k, xs]) => ({ key: k, label: ALL_CRITERIA[k] ?? k, avg: avg(xs)!, n: xs.length }))
      .sort((a, b) => a.avg - b.avg);
    // المتوسط العام شهر بشهر (آخر 6 أشهر).
    const trend = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5)).map((m) => ({
      month: monthLabel(m).split(" ")[0], avg: avg(active.map((s) => scoreOf(s, m).final)),
    }));
    return { people, rated, branches, criteria, trend, scoreOf, overall: avg(rated.map((p) => p.final)), missing: people.filter((p) => p.missing.length) };
  }, [data, month]);

  const open = v?.people.find((p) => p.id === openId) ?? null;
  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(defaultMonth(businessToday()), -i));

  if (allowed === undefined) return <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>;
  if (!allowed) return <Card className="max-w-md mx-auto p-6 text-center text-muted-foreground">هذي الصفحة للمدير العام ومسؤول التقييم بس.</Card>;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold flex items-center gap-2"><ClipboardList className="size-7 text-primary" />تقييم الموظفين</h1>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {([["board", "اللوحة", Award], ["record", "تسجيل تقييم", Plus], ["settings", "الإعدادات", Settings2]] as const).map(([k, l, Icon]) => (
          <Button key={k} variant={tab === k ? "default" : "outline"} onClick={() => setTab(k)} className="gap-1"><Icon className="size-4" />{l}</Button>
        ))}
      </div>

      {tab === "record" && (
        <Card className="p-3 space-y-3">
          {GM_EVAL_ENABLED && (
            <div className="grid grid-cols-2 gap-1.5">
              <Button variant={recordMode === "gm" ? "default" : "outline"} onClick={() => setRecordMode("gm")}>تقييم المدير العام</Button>
              <Button variant={recordMode === "behalf" ? "default" : "outline"} onClick={() => setRecordMode("behalf")}>نيابة عن موظف</Button>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            {recordMode === "gm"
              ? "تقييم المدير العام لكل موظف ومشرف: الحضور والانصراف، الالتزام، النتائج… منفصل على تقييم المشرف."
              : "سجّل التقييم اللي وصلك من موظف ولا مشرف ما يعرفش يبعته من الرابط — اختار اسمه وعبّي البنود كيف قالك."}
          </p>
          <EvaluationForm key={recordMode} recorder={recordMode === "behalf"} gm={recordMode === "gm"} />
        </Card>
      )}

      {tab === "settings" && <SettingsTab isAdmin={isAdmin} staff={data?.staff ?? []} />}

      {tab === "board" && (
        <>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {months.map((m) => (
              <Button key={m} size="sm" variant={m === month ? "default" : "outline"} onClick={() => setMonth(m)} className="shrink-0">{monthLabel(m)}</Button>
            ))}
          </div>
          {isLoading || !v ? (
            <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>
          ) : (
            <>
              {/* الأرقام الكبيرة */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Kpi icon={Users} label="اتقيّموا" value={`${v.rated.length} / ${v.people.length}`} />
                <Kpi icon={Star} label="المتوسط العام" value={f1(v.overall)} sub={grade(v.overall).label} tone={grade(v.overall).text} />
                <Kpi icon={Award} label="الأحسن" value={v.rated[0]?.name ?? "—"} sub={v.rated[0] ? f1(v.rated[0].final) : ""} tone="text-emerald-600" />
                <Kpi icon={AlertTriangle} label="يحتاج متابعة" value={String(v.rated.filter((p) => (p.final ?? 5) < 3).length)} sub="أقل من 3" tone="text-red-600" />
              </div>

              {/* الناقصين */}
              {v.missing.length > 0 && (
                <Card className="p-3 border-amber-500/40">
                  <h2 className="font-bold mb-1 flex items-center gap-1.5"><AlertTriangle className="size-4 text-amber-600" />ناقصين لشهر {monthLabel(month)} ({v.missing.length})</h2>
                  <p className="text-xs text-muted-foreground mb-2">اتصل بيهم ولا ابعتلهم الرابط، ولا سجّل عنهم من «تسجيل تقييم».</p>
                  <div className="space-y-1">
                    {v.missing.map((p) => (
                      <div key={p.id} className="flex justify-between gap-2 text-sm py-1 border-b last:border-0">
                        <span className="font-semibold">{p.name} <span className="text-xs text-muted-foreground font-normal">· {p.branch_name ?? "—"}</span></span>
                        <span className="text-xs text-amber-700 dark:text-amber-400">{p.missing.join(" + ")}</span>
                      </div>
                    ))}
                  </div>
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => setTab("record")}><Plus className="size-4" />سجّل تقييم</Button>
                </Card>
              )}

              {/* الترتيب */}
              <Card className="p-3">
                <h2 className="text-lg font-bold mb-1">الترتيب</h2>
                <p className="text-xs text-muted-foreground mb-2">الدرجة = متوسط تقييم المدير العام وتقييم المشرف (وللمشرف تقييم موظفينه)، ولو ما فيش، تقييمه لنفسه. اضغط على أي اسم للتفاصيل.</p>
                {!v.rated.length ? <p className="text-center text-muted-foreground py-6">ما فيش تقييمات لهذا الشهر لين توا.</p> : v.rated.map((p, i) => {
                  const g = grade(p.final);
                  const d = p.prev != null && p.final != null ? p.final - p.prev : null;
                  return (
                    <button key={p.id} onClick={() => setOpenId(p.id)} className="w-full text-right py-2 border-b last:border-0 active:bg-muted/40">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2 min-w-0">
                          <span className={`size-7 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${i < 3 ? "bg-gold-gradient text-primary-foreground" : "bg-muted"}`}>{i + 1}</span>
                          <span className="min-w-0">
                            <span className="block font-bold truncate">{p.name}</span>
                            <span className="block text-[11px] text-muted-foreground truncate">{p.role === "manager" ? "مشرف" : "موظف"} · {p.branch_name ?? "—"}{p.gm != null ? ` · المدير العام ${f1(p.gm)}` : ""}{p.self != null && p.others != null ? ` · قيّم نفسه ${f1(p.self)}` : ""}</span>
                          </span>
                        </span>
                        <span className="shrink-0 text-left">
                          <span className={`block text-xl font-bold ${g.text}`}>{f1(p.final)}</span>
                          <span className="flex items-center gap-0.5 text-[11px] justify-end">
                            {d != null && Math.abs(d) >= 0.1 && (d > 0
                              ? <span className="text-emerald-600 flex items-center"><TrendingUp className="size-3" />{f1(d)}</span>
                              : <span className="text-red-600 flex items-center"><TrendingDown className="size-3" />{f1(-d)}</span>)}
                            <span className="text-muted-foreground mr-1">{g.label}</span>
                          </span>
                        </span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full mt-1.5 overflow-hidden"><div className={`h-full ${g.bg}`} style={{ width: `${((p.final ?? 0) / 5) * 100}%` }} /></div>
                    </button>
                  );
                })}
              </Card>

              <div className="grid sm:grid-cols-2 gap-4">
                {/* الفروع */}
                <Card className="p-3">
                  <h2 className="font-bold mb-2">الفروع</h2>
                  {!v.branches.length ? <p className="text-sm text-muted-foreground">—</p> : v.branches.map((b) => (
                    <div key={b.name} className="mb-2">
                      <div className="flex justify-between text-sm"><span>{b.name}</span><span className={`font-bold ${grade(b.avg).text}`}>{f1(b.avg)}</span></div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden"><div className={`h-full ${grade(b.avg).bg}`} style={{ width: `${(b.avg / 5) * 100}%` }} /></div>
                    </div>
                  ))}
                </Card>
                {/* البنود */}
                <Card className="p-3">
                  <h2 className="font-bold mb-1">البنود — الأضعف أول</h2>
                  <p className="text-[11px] text-muted-foreground mb-2">وين الفريق يحتاج تدريب ولا متابعة.</p>
                  {!v.criteria.length ? <p className="text-sm text-muted-foreground">—</p> : v.criteria.map((c) => (
                    <div key={c.key} className="mb-1.5">
                      <div className="flex justify-between text-xs"><span className="truncate">{c.label}</span><span className={`font-bold ${grade(c.avg).text}`}>{f1(c.avg)}</span></div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden"><div className={`h-full ${grade(c.avg).bg}`} style={{ width: `${(c.avg / 5) * 100}%` }} /></div>
                    </div>
                  ))}
                </Card>
              </div>

              {/* المتوسط شهر بشهر */}
              {v.trend.filter((t) => t.avg != null).length > 1 && (
                <Card className="p-3">
                  <h2 className="font-bold mb-2">المتوسط العام شهر بشهر</h2>
                  <div className="h-48" dir="ltr">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={v.trend} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                        <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(val: number) => f1(val)} />
                        <Line type="monotone" dataKey="avg" stroke="#C9A227" strokeWidth={3} dot={{ r: 4 }} connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              )}
            </>
          )}
        </>
      )}

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[92dvh] overflow-y-auto pb-8">
          {open && v && data && <PersonDetail p={open} month={month} staff={data.staff} scoreOf={v.scoreOf} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, tone }: { icon: typeof Star; label: string; value: string; sub?: string; tone?: string }) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="size-3.5" />{label}</div>
      <div className={`text-xl font-bold truncate ${tone ?? ""}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </Card>
  );
}

function PersonDetail({ p, month, staff, scoreOf }: {
  p: Person; month: string; staff: EvalStaff[];
  scoreOf: (s: EvalStaff, m: string) => { others: number | null; self: number | null; gm: number | null; final: number | null; evals: Evaluation[] };
}) {
  const criteria = p.role === "manager" ? MANAGER_CRITERIA : EMPLOYEE_CRITERIA;
  const others = p.evals.filter((e) => e.kind !== "self" && e.kind !== "by_gm");
  const gmEvals = p.evals.filter((e) => e.kind === "by_gm");
  const self = p.evals.find((e) => e.kind === "self");
  const crit = (k: string, es: Evaluation[]) => {
    const xs = es.map((e) => e.scores?.[k]).filter((x) => x != null).map(Number);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };
  const history = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5)).map((m) => {
    const s = scoreOf(p, m);
    return { month: monthLabel(m).split(" ")[0], others: s.others, self: s.self };
  });
  const nameOf = (id: string) => staff.find((s) => s.id === id)?.name ?? "—";
  const g = grade(p.final);
  return (
    <div className="space-y-4">
      <SheetHeader className="text-right">
        <SheetTitle className="text-xl">{p.name}</SheetTitle>
        <p className="text-xs text-muted-foreground">{p.role === "manager" ? "مشرف" : "موظف"} · {p.branch_name ?? "—"} · {monthLabel(month)}</p>
      </SheetHeader>
      <div className={`grid gap-2 text-center ${GM_EVAL_ENABLED ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
        <Card className="p-2"><div className="text-[11px] text-muted-foreground">الدرجة</div><div className={`text-2xl font-bold ${g.text}`}>{f1(p.final)}</div><div className="text-[11px]">{g.label}</div></Card>
        {GM_EVAL_ENABLED && <Card className="p-2"><div className="text-[11px] text-muted-foreground">المدير العام</div><div className="text-xl font-bold">{f1(p.gm)}</div></Card>}
        <Card className="p-2"><div className="text-[11px] text-muted-foreground">{p.role === "manager" ? "تقييم موظفينه" : "تقييم المشرف"}</div><div className="text-xl font-bold">{f1(avg(others.map((e) => e.overall)))}</div></Card>
        <Card className="p-2"><div className="text-[11px] text-muted-foreground">قيّم نفسه</div><div className="text-xl font-bold">{f1(p.self)}</div></Card>
      </div>

      {gmEvals.length > 0 && (
        <Card className="p-3">
          <h3 className="font-bold mb-2">بنود المدير العام</h3>
          {GM_CRITERIA.map((c) => {
            const val = crit(c.key, gmEvals);
            return (
              <div key={c.key} className="mb-1.5">
                <div className="flex justify-between text-sm"><span>{c.label}</span><span className={`font-bold ${grade(val).text}`}>{f1(val)}</span></div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden"><div className={`h-full ${grade(val).bg}`} style={{ width: `${((val ?? 0) / 5) * 100}%` }} /></div>
              </div>
            );
          })}
        </Card>
      )}
      {p.self != null && p.others != null && Math.abs(p.self - p.others) >= 0.75 && (
        <p className="text-xs rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-300 p-2">
          فرق كبير بين تقييمه لنفسه ({f1(p.self)}) و{p.role === "manager" ? "تقييم موظفينه" : "تقييم مشرفه"} ({f1(p.others)}) — يستاهل جلسة كلام معاه.
        </p>
      )}

      <Card className="p-3">
        <h3 className="font-bold mb-2">البنود</h3>
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1.5 text-sm items-center">
          <span className="text-[11px] text-muted-foreground">البند</span>
          <span className="text-[11px] text-muted-foreground text-center">{p.role === "manager" ? "الموظفين" : "المشرف"}</span>
          <span className="text-[11px] text-muted-foreground text-center">نفسه</span>
          {criteria.map((c) => {
            const o = crit(c.key, others), s = crit(c.key, self ? [self] : []);
            return [
              <span key={c.key} className="truncate">{c.label}</span>,
              <span key={c.key + "o"} className={`text-center font-bold ${grade(o).text}`}>{f1(o)}</span>,
              <span key={c.key + "s"} className="text-center text-muted-foreground">{f1(s)}</span>,
            ];
          })}
        </div>
      </Card>

      {history.some((h) => h.others != null || h.self != null) && (
        <Card className="p-3">
          <h3 className="font-bold mb-2">شهر بشهر</h3>
          <div className="h-40" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(val: number, k: string) => [f1(val), k === "self" ? "نفسه" : p.role === "manager" ? "الموظفين" : "المشرف"]} />
                <Line type="monotone" dataKey="others" stroke="#C9A227" strokeWidth={3} dot={{ r: 3 }} connectNulls />
                <Line type="monotone" dataKey="self" stroke="#94a3b8" strokeWidth={2} strokeDasharray="4 4" dot={{ r: 2 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-muted-foreground">الذهبي: {p.role === "manager" ? "تقييم الموظفين" : "تقييم المشرف"} · المقطّع: تقييمه لنفسه</p>
        </Card>
      )}

      {p.evals.length > 0 && (
        <Card className="p-3 space-y-3">
          <h3 className="font-bold">الملاحظات</h3>
          {p.evals.map((e) => (
            <div key={e.id} className="text-sm border-b last:border-0 pb-2">
              <p className="text-xs text-muted-foreground">{KIND_LABEL[e.kind]}{e.kind !== "self" ? ` · من ${nameOf(e.evaluator_id)}` : ""} · {f1(e.overall)}{e.source === "recorder" ? " · سجّلها المسؤول" : ""}</p>
              {e.strengths && <p><b className="text-emerald-600">قوة: </b>{e.strengths}</p>}
              {e.improvements && <p><b className="text-amber-600">يتحسّن: </b>{e.improvements}</p>}
              {e.notes && <p className="text-muted-foreground">{e.notes}</p>}
              {!e.strengths && !e.improvements && !e.notes && <p className="text-muted-foreground text-xs">بدون ملاحظات</p>}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function SettingsTab({ isAdmin, staff }: { isAdmin: boolean; staff: EvalStaff[] }) {
  const qc = useQueryClient();
  const { data: cfg } = useQuery({
    queryKey: ["eval-config"],
    queryFn: async () => ((await db.from("eval_config").select("link_token").maybeSingle()).data?.link_token as string | undefined) ?? null,
  });
  const { data: branches = [] } = useQuery({
    queryKey: ["branches"],
    queryFn: async () => ((await supabase.from("branches").select("id,name").order("name")).data ?? []) as { id: string; name: string }[],
  });
  const { data: people = [] } = useQuery({
    queryKey: ["eval-recorder-candidates"],
    enabled: isAdmin,
    queryFn: async () => {
      const [p, r] = await Promise.all([
        supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
        db.from("eval_recorders").select("profile_id"),
      ]);
      const set = new Set(((r.data ?? []) as { profile_id: string }[]).map((x) => x.profile_id));
      return ((p.data ?? []) as { id: string; full_name: string }[]).map((x) => ({ ...x, recorder: set.has(x.id) }));
    },
  });
  const link = cfg ? `${window.location.origin}${import.meta.env.BASE_URL}evaluate/${cfg}` : "";
  const [form, setForm] = useState({ name: "", branch_id: "", role: "employee" });

  const refresh = () => { qc.invalidateQueries({ queryKey: ["evaluations"] }); qc.invalidateQueries({ queryKey: ["eval-form"] }); };
  const add = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("اكتب الاسم");
      const { error } = await db.from("eval_staff").insert({ name: form.name.trim(), branch_id: form.branch_id || null, role: form.role });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("تمت الإضافة"); setForm({ name: "", branch_id: "", role: "employee" }); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const patch = useMutation({
    mutationFn: async ({ id, p }: { id: string; p: Record<string, unknown> }) => {
      const { error } = await db.from("eval_staff").update(p).eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });
  const regen = useMutation({
    mutationFn: async () => {
      const t = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
      const { error } = await db.from("eval_config").update({ link_token: t }).eq("id", true);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("تبدّل الرابط — الرابط القديم ما عادش يخدم"); qc.invalidateQueries({ queryKey: ["eval-config"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggleRecorder = useMutation({
    mutationFn: async ({ id, on }: { id: string; on: boolean }) => {
      const { error } = on ? await db.from("eval_recorders").insert({ profile_id: id }) : await db.from("eval_recorders").delete().eq("profile_id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["eval-recorder-candidates"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Card className="p-3 space-y-2">
        <h2 className="font-bold">رابط التقييم</h2>
        <p className="text-xs text-muted-foreground">ابعته للموظفين والمشرفين آخر كل شهر. يفتح بلا تسجيل دخول: يختار موظف ولا مشرف، ثم اسمه، ويعبّي التقييم.</p>
        <Input readOnly value={link} dir="ltr" className="text-xs" onFocus={(e) => e.target.select()} />
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" disabled={!link} onClick={() => { void navigator.clipboard.writeText(link); toast.success("انسخ الرابط"); }}><Copy className="size-4" />نسخ</Button>
          <Button asChild variant="outline" disabled={!link}>
            <a href={`https://wa.me/?text=${encodeURIComponent(`تقييم الشهر — عبّي التقييم من هنا:\n${link}`)}`} target="_blank" rel="noreferrer"><MessageCircle className="size-4" />واتساب</a>
          </Button>
        </div>
        {isAdmin && <Button variant="ghost" size="sm" className="text-destructive" disabled={regen.isPending} onClick={() => regen.mutate()}>تبديل الرابط (لو انتشر لناس برا)</Button>}
      </Card>

      <Card className="p-3 space-y-2">
        <h2 className="font-bold">اللي يتقيّموا ({staff.filter((s) => s.active !== false && s.role !== "gm").length})</h2>
        <p className="text-xs text-muted-foreground">زيد أي موظف ولا مشرف حتى لو ما عندهش حساب في التطبيق. اللي يخرج من الشغل وقّفه بدل ما تمسحه — تقييماته القديمة تبقى.</p>
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="الاسم" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="col-span-2 h-11" />
          <select value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })} className="h-11 rounded-md border border-input bg-background px-2 text-sm">
            <option value="">الفرع…</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="h-11 rounded-md border border-input bg-background px-2 text-sm">
            <option value="employee">موظف</option>
            <option value="manager">مشرف</option>
          </select>
          <Button className="col-span-2" disabled={add.isPending} onClick={() => add.mutate()}><Plus className="size-4" />إضافة</Button>
        </div>
        <div className="divide-y">
          {staff.filter((s) => s.role !== "gm").map((s) => (
            <div key={s.id} className={`flex items-center gap-2 py-2 text-sm ${s.active === false ? "opacity-50" : ""}`}>
              <span className="flex-1 min-w-0 truncate font-semibold">{s.name} <span className="text-xs text-muted-foreground font-normal">· {s.branch_name ?? "—"}</span></span>
              <select value={s.role} onChange={(e) => patch.mutate({ id: s.id, p: { role: e.target.value } })} className="h-8 rounded-md border border-input bg-background px-1 text-xs">
                <option value="employee">موظف</option>
                <option value="manager">مشرف</option>
              </select>
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => patch.mutate({ id: s.id, p: { active: s.active === false } })}>
                {s.active === false ? "تفعيل" : "إيقاف"}
              </Button>
            </div>
          ))}
        </div>
      </Card>

      {isAdmin && (
        <Card className="p-3 space-y-2">
          <h2 className="font-bold">المسؤولين على التقييم</h2>
          <p className="text-xs text-muted-foreground">اللي تعلّم عليه يشوف هذي اللوحة ويسجّل التقييمات (زي أيمن). لازم يكون عنده حساب في التطبيق — لو ما عندهش، اعمله حساب من صفحة «الموظفون» أول.</p>
          {people.map((x) => (
            <label key={x.id} className="flex items-center gap-2 py-1 text-sm">
              <input type="checkbox" className="size-5" checked={x.recorder} onChange={(e) => toggleRecorder.mutate({ id: x.id, on: e.target.checked })} />
              {x.full_name}
            </label>
          ))}
        </Card>
      )}
    </div>
  );
}
