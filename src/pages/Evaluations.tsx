// لوحة التقييمات — للمدير العام ومسؤول التقييم (أيمن). ثلاث خانات:
// الإيقاع: المشرف يقيّم موظفينه كل يوم، والموظفين (ونفس المشرف لنفسه) مرتين في الشهر.
//  * اللوحة: الدرجة من تقييمهم لبعض بس (المشرف للموظف، الموظفين للمشرف) — التقييم الذاتي لوحده للمقارنة،
//    وعلامة على اللي قيّم نفسه 5 في كل البنود. مين اتقيّم ومين لا (يوم بيوم)، الفروع، البنود، وشهر بشهر.
//    كل رقم واسم ويوم يتضغط ويفتح تفاصيله (الحسبة في lib/evalBoard، والأقسام في components/evaluations).
//  * تسجيل تقييم: نفس استمارة الرابط، لأيمن يسجّل عن اللي ما يعرفوش يبلّغوا.
//  * الإعدادات: رابط التقييم (نسخ/واتساب)، قائمة الموظفين، والمسؤولين على التقييم.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, ChevronRight, ClipboardList, Copy, Loader2, MessageCircle, Plus, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import EvaluationForm from "@/components/EvaluationForm";
import { BranchesCard, CriteriaCard, Kpis, ResultCard, SelfCompare, TrendCard, WhoEvaluated } from "@/components/evaluations/EvalSections";
import { EvalDetail } from "@/components/evaluations/EvalDetail";
import type { Detail } from "@/components/evaluations/bits";
import { businessToday } from "@/lib/dates";
import { GM_EVAL_ENABLED, db, defaultMonth, monthLabel, shiftMonth, type EvalStaff, type Evaluation, useIsEvalAdmin } from "@/lib/evaluation";
import { buildBoard } from "@/lib/evalBoard";

type Tab = "board" | "record" | "settings";

/** أقسام اللوحة — للقفز السريع. */
const JUMPS: [string, string][] = [
  ["ev-result", "النتيجة"], ["ev-who", "مين اتقيّم"], ["ev-self", "التقييم الذاتي"], ["ev-branches", "الفروع"], ["ev-criteria", "البنود"],
];

/** التقييم اليومي يكثّر الصفوف: نجيبوهم صفحات (السيرفر يرجّع 1000 صف بالكثير في المرة). */
async function fetchEvals(from: string, to: string) {
  const out: Evaluation[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await db.from("staff_evaluations").select("*")
      .gte("month", from).lte("month", to).order("period").order("id").range(i, i + 999);
    if (error) throw error;
    out.push(...((data ?? []) as Evaluation[]));
    if (!data || data.length < 1000) return out;
  }
}

export default function Evaluations() {
  const { roles } = useAuth();
  const isAdmin = roles.includes("admin");
  const allowed = useIsEvalAdmin();
  const [tab, setTab] = useState<Tab>("board");
  const [month, setMonth] = useState(() => defaultMonth(businessToday()));
  const [recordMode, setRecordMode] = useState<"gm" | "behalf">(GM_EVAL_ENABLED ? "gm" : "behalf");
  // التفاصيل: كل ضغطة تفتح فوق اللي قبلها، و«رجوع» يرجّع خطوة.
  const [stack, setStack] = useState<Detail[]>([]);
  const open = useCallback((d: Detail) => setStack((s) => [...s, d]), []);
  const top = stack.length ? stack[stack.length - 1] : null;
  const sheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => { sheetRef.current?.scrollTo({ top: 0 }); }, [top]);

  const { data, isLoading } = useQuery({
    queryKey: ["evaluations", month],
    queryFn: async () => {
      const [staff, evals] = await Promise.all([
        db.from("eval_staff").select("*, branch:branches(name)").order("name"),
        fetchEvals(shiftMonth(month, -5), month),
      ]);
      if (staff.error) throw staff.error;
      return {
        staff: ((staff.data ?? []) as (EvalStaff & { branch: { name: string } | null })[]).map((s) => ({ ...s, branch_name: s.branch?.name ?? null })),
        evals,
      };
    },
  });

  const b = useMemo(() => (data ? buildBoard(data.staff, data.evals, month, businessToday()) : null), [data, month]);
  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(defaultMonth(businessToday()), -i));

  if (allowed === undefined) return <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>;
  if (!allowed) return <Card className="max-w-md mx-auto p-6 text-center text-muted-foreground">هذي الصفحة للمدير العام ومسؤول التقييم بس.</Card>;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="hub-title flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold flex items-center gap-2"><ClipboardList className="size-7 text-primary" />تقييم الموظفين</h1>
      </div>
      <div className="grid gap-1.5 grid-cols-3">
        {([["board", "اللوحة", Award], ["record", "تسجيل", Plus], ["settings", "الإعدادات", Settings2]] as const).map(([k, l, Icon]) => (
          <Button key={k} variant={tab === k ? "default" : "outline"} onClick={() => { setTab(k); setStack([]); }} className="gap-1 px-1"><Icon className="size-4" />{l}</Button>
        ))}
      </div>

      {tab === "board" && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {months.map((m) => (
            <Button key={m} size="sm" variant={m === month ? "default" : "outline"} onClick={() => { setMonth(m); setStack([]); }} className="shrink-0">{monthLabel(m)}</Button>
          ))}
        </div>
      )}

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

      {tab === "board" && (isLoading || !b ? (
        <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : (
        <>
          <p className="rounded-lg bg-primary/5 p-2 text-xs leading-relaxed">
            <b>الدرجة من تقييمهم لبعض بس</b>: المشرف يقيّم موظفينه كل يوم، والموظفين يقيّموا مشرفهم مرتين في الشهر.
            <b> التقييم الذاتي لوحده</b> للمقارنة وما يدخلش في الترتيب. اضغط على أي رقم ولا اسم ولا يوم تشوف تفاصيله.
          </p>
          <Kpis b={b} open={open} />
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {JUMPS.map(([id, label]) => (
              <button key={id} type="button" onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="shrink-0 rounded-full border bg-card px-3 py-1 text-xs font-semibold text-muted-foreground active:bg-muted">{label}</button>
            ))}
          </div>
          <section id="ev-result" className="scroll-mt-24"><ResultCard b={b} open={open} /></section>
          <section id="ev-who" className="scroll-mt-24"><WhoEvaluated key={b.month} b={b} open={open} onRecord={() => setTab("record")} /></section>
          <section id="ev-self" className="scroll-mt-24"><SelfCompare b={b} open={open} /></section>
          <div className="grid gap-4 sm:grid-cols-2">
            <section id="ev-branches" className="scroll-mt-24"><BranchesCard b={b} open={open} /></section>
            <section id="ev-criteria" className="scroll-mt-24"><CriteriaCard b={b} open={open} /></section>
          </div>
          <TrendCard b={b} />
        </>
      ))}

      <Sheet open={!!top} onOpenChange={(o) => !o && setStack([])}>
        <SheetContent ref={sheetRef} side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-2xl pb-8">
          {stack.length > 1 && (
            <div className="mb-2 flex justify-end">
              <button type="button" onClick={() => setStack((s) => s.slice(0, -1))} className="flex items-center gap-1 text-sm font-semibold text-primary">
                <ChevronRight className="size-4" />رجوع
              </button>
            </div>
          )}
          {top && b && data && <EvalDetail key={`${stack.length}:${JSON.stringify(top)}`} d={top} b={b} staff={data.staff} open={open} />}
        </SheetContent>
      </Sheet>
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
        <p className="text-xs text-muted-foreground">نفس الرابط للكل، يفتح بلا تسجيل دخول: يختار موظف ولا مشرف، ثم اسمه، ويعبّي التقييم. <b>المشرف كل يوم</b> يقيّم موظفينه، و<b>الموظفين مرتين في الشهر</b> (من 1 لـ 15، ومن 16 لآخر الشهر).</p>
        <Input readOnly value={link} dir="ltr" className="text-xs" onFocus={(e) => e.target.select()} />
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" disabled={!link} onClick={() => { void navigator.clipboard.writeText(link); toast.success("انسخ الرابط"); }}><Copy className="size-4" />نسخ</Button>
          <Button asChild variant="outline" disabled={!link}>
            <a href={`https://wa.me/?text=${encodeURIComponent(`رابط التقييم — المشرف يعبّيه كل يوم، والموظفين مرتين في الشهر (1–15 و16–آخر الشهر):\n${link}`)}`} target="_blank" rel="noreferrer"><MessageCircle className="size-4" />واتساب</a>
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
