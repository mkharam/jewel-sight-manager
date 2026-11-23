// استمارة التقييم — نفسها في الرابط اللي يتبعت للموظفين (token) وفي التطبيق لمسؤول التقييم (أيمن) اللي
// يسجّل نيابة عن اللي ما يعرفوش يبلّغوا. الخطوات: موظف ولا مشرف ← مين أنت ← البنود.
//  * المشرف: يقيّم كل موظف في فرعه كل يوم (اليوم، ولا أمس/قبل أمس لو نسي)، ويقيّم نفسه مرتين في الشهر.
//  * الموظف: مرتين في الشهر (1–15 و16–آخر الشهر): يقيّم نفسه، ويقيّم مشرف فرعه — الاثنين لازم،
//    وتقييمه لمشرفه سري (ما يشوفه إلا الإدارة).
// «نفس آخر تقييم» يعبّي البنود من آخر مرة على نفس الجهاز — يبدّل بس اللي تغيّر.
// كل جهاز يبعت معرّف عشوائي مع التقييم: اللوحة تعلّم 📱 لو تقييم الموظفين لمشرفهم اتبعت من تليفون المشرف،
// والاستمارة تنبّه الموظف لو التليفون اللي في يده اتبعت منه تقييم مشرفه قبل.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, ChevronLeft, Copy, Loader2, UserCheck, UserX, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  db, ABSENCE_REASONS, EMPLOYEE_CRITERIA, GM_CRITERIA, MANAGER_CRITERIA, SCALE, addDaysYmd, dayLabel, defaultMonth, halfLabel, halfStart, monthLabel,
  prevHalfDay, shiftMonth, type EvalStaff, type Kind, type Role,
} from "@/lib/evaluation";

// آخر تقييم لكل (اللي يقيّم، النوع، اللي يتقيّم) على هذا الجهاز — لزر «نفس آخر تقييم».
const LAST_KEY = "eval.last.v1";
type Saved = Record<string, Record<string, number>>;
const readLast = (): Saved => { try { return JSON.parse(localStorage.getItem(LAST_KEY) ?? "{}"); } catch { return {}; } };
const writeLast = (patch: Saved) => { try { localStorage.setItem(LAST_KEY, JSON.stringify({ ...readLast(), ...patch })); } catch { /* ignore */ } };

// معرّف عشوائي لهذا الجهاز (مش رقم التليفون ولا أي معلومة عليه)، ومين بعت تقييمه منه.
const DEVICE_KEY = "eval.device.v1";
const WHO_KEY = "eval.who.v1";
function deviceId(): string | null {
  try {
    let v = localStorage.getItem(DEVICE_KEY);
    if (!v) {
      v = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem(DEVICE_KEY, v);
    }
    return v;
  } catch { return null; }
}
const readWho = (): string[] => { try { const v = JSON.parse(localStorage.getItem(WHO_KEY) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
const addWho = (id: string) => {
  try { const xs = readWho(); if (!xs.includes(id)) localStorage.setItem(WHO_KEY, JSON.stringify([...xs, id].slice(-30))); } catch { /* ignore */ }
};

/** تذكير قبل التقييم: أمانة. آية النساء 135، وحديث «لا إيمان لمن لا أمانة له» (رواه أحمد). */
function TrustNote() {
  return (
    <Card className="p-4 bg-gold-soft border-primary/30 text-center space-y-2">
      <p className="font-bold text-lg text-primary">التقييم أمانة بينك وبين الله</p>
      <p className="text-[15px] leading-loose">
        ﴿يَا أَيُّهَا الَّذِينَ آمَنُوا كُونُوا قَوَّامِينَ بِالْقِسْطِ شُهَدَاءَ لِلَّهِ وَلَوْ عَلَىٰ أَنفُسِكُمْ﴾
        <span className="block text-xs text-muted-foreground">سورة النساء، الآية 135</span>
      </p>
      <p className="text-[15px]">
        قال رسول الله ﷺ: «لا إيمانَ لمن لا أمانةَ له، ولا دِينَ لمن لا عهدَ له»
        <span className="block text-xs text-muted-foreground">رواه أحمد</span>
      </p>
      <p className="text-sm text-muted-foreground">قيّم بصدق: لا تجامل ولا تظلم. التقييم يعاون الكل يتحسّن، ويبقى بين الإدارة وبينك.</p>
    </Card>
  );
}

type Entry = { scores: Record<string, number>; strengths: string; improvements: string; notes: string; absent?: boolean; reason?: string };
type Card_ = {
  key: string; kind: Kind; subject: EvalStaff | null; title: string; criteria: readonly { key: string; label: string }[]; required: boolean;
  done?: boolean; note?: string;
  /** تقييم الموظف لمشرفه: سري، وتنبيه لو المشرف بعت تقييمه من نفس التليفون. */
  secret?: boolean; phoneWarn?: boolean;
};
type Status = { rated_day: string[]; absent_day?: string[]; half_done: { kind: Kind; subject: string }[] };
const blank = (): Entry => ({ scores: {}, strengths: "", improvements: "", notes: "" });

/** gm: تقييم المدير العام لموظف ولا مشرف (بنود GM_CRITERIA) — من لوحة التقييم بس. */
export default function EvaluationForm({ token, recorder, gm }: { token?: string; recorder?: boolean; gm?: boolean }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["eval-form", token ?? "recorder"],
    queryFn: async () => {
      const { data, error } = await db.rpc("eval_form", { p_token: token ?? null });
      if (error) throw error;
      if (!data) throw new Error("الرابط غير صالح — اطلب من الإدارة رابط جديد");
      return data as { staff: EvalStaff[]; today: string; gm_id: string | null };
    },
  });
  const qc = useQueryClient();
  const [role, setRole] = useState<Role | null>(null);
  const [me, setMe] = useState<EvalStaff | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  // مين بعت تقييمه من هذا التليفون قبل (باش ننبّهوا الموظف لو تليفون مشرفه).
  const usedHere = useMemo(readWho, [done]);

  // تقييم المدير العام (موقّف حالياً) يبقى شهري.
  const months = useMemo(() => {
    if (!data) return [];
    const d = defaultMonth(data.today);
    return [shiftMonth(d, -1), d, ...(d < `${data.today.slice(0, 7)}-01` ? [`${data.today.slice(0, 7)}-01`] : [])];
  }, [data]);
  const curMonth = month ?? (data ? defaultMonth(data.today) : null);
  const gmId = data?.gm_id ?? null;
  const today = data?.today ?? "";
  // اليوم اللي يتقيّم: المشرف يختار يوم (لين 3 أيام لورا)، الموظف يختار النص (الحالي ولا اللي فات في أول 3 أيام).
  const day = gm ? (curMonth ?? today) : pickedDay ?? today;
  const isManager = me?.role === "manager";
  const dayChoices = useMemo(() => (today ? [today, addDaysYmd(today, -1), addDaysYmd(today, -2)] : []), [today]);
  const halfChoices = useMemo(() => {
    if (!today) return [];
    const d = Number(today.slice(8, 10));
    return (d <= 3 || (d >= 16 && d <= 18)) ? [today, prevHalfDay(today)] : [today];
  }, [today]);

  // شن سلّم قبل في نفس اليوم/النص (نعم/لا بس) — باش يعرف شن باقي.
  const status = useQuery({
    queryKey: ["eval-status", token ?? "recorder", me?.id, day],
    enabled: !!me && !gm && !!day,
    queryFn: async () => {
      const { data, error } = await db.rpc("eval_status", { p_token: token ?? null, p_evaluator: me!.id, p_day: day });
      if (error) return { rated_day: [], half_done: [] } as Status; // قبل ما يتحدّث السيرفر
      return (data ?? { rated_day: [], half_done: [] }) as Status;
    },
  });
  const ratedToday = new Set(status.data?.rated_day ?? []);
  const absentToday = new Set(status.data?.absent_day ?? []);
  const halfDone = (kind: Kind, subject?: string) => (status.data?.half_done ?? []).some((h) => h.kind === kind && (!subject || h.subject === subject));
  const periodText = gm ? `شهر ${monthLabel(curMonth ?? today)}` : isManager ? `يوم ${dayLabel(day, today)}` : halfLabel(day);

  // البطاقات حسب الدور: نفسه دايماً، وموظفين فرعه (للمشرف) ولا مشرف فرعه (للموظف).
  const cards = useMemo<Card_[]>(() => {
    if (!me || !data) return [];
    if (gm) {
      return [{ key: `by_gm:${me.id}`, kind: "by_gm" as Kind, subject: me, title: `تقييم المدير العام لـ ${me.name}`, criteria: GM_CRITERIA, required: true }];
    }
    const sameBranch = data.staff.filter((s) => s.id !== me.id && s.branch_id === me.branch_id);
    if (me.role === "manager") {
      const selfDone = halfDone("self");
      return [
        ...sameBranch.filter((s) => s.role === "employee").map((s) => ({
          key: `by_manager:${s.id}`, kind: "by_manager" as Kind, subject: s, title: `قيّم ${s.name}`, criteria: EMPLOYEE_CRITERIA, required: false,
          done: ratedToday.has(s.id),
          note: absentToday.has(s.id) ? `سجّلته غايب ${dayLabel(day, today)} — تقدر تعدّل` : ratedToday.has(s.id) ? `قيّمته ${dayLabel(day, today)} — تقدر تعدّل` : undefined,
        })),
        { key: "self", kind: "self", subject: null, title: "قيّم نفسك (مرتين في الشهر)", criteria: MANAGER_CRITERIA, required: false,
          done: selfDone, note: selfDone ? `سلّمته — ${halfLabel(day)} — تقدر تعدّل` : halfLabel(day) },
      ];
    }
    const selfDone = halfDone("self");
    return [
      { key: "self", kind: "self", subject: null, title: "قيّم نفسك", criteria: EMPLOYEE_CRITERIA, required: !selfDone,
        done: selfDone, note: selfDone ? "سلّمته لهذا النص — تقدر تعدّل" : undefined },
      // تقييم المشرف لازم مرتين في الشهر (إلا لو سلّمه في هذا النص) — هو اللي يتحاسب عليه المشرف.
      ...sameBranch.filter((s) => s.role === "manager").map((s) => {
        const did = halfDone("of_manager", s.id);
        return {
          key: `of_manager:${s.id}`, kind: "of_manager" as Kind, subject: s, title: `قيّم مشرفك ${s.name}`, criteria: MANAGER_CRITERIA,
          required: !did && !recorder,
          done: did, note: `${did ? "سلّمته لهذا النص — تقدر تعدّل · " : ""}🔒 سري — ما يشوفه إلا الإدارة`,
          secret: true, phoneWarn: !recorder && usedHere.includes(s.id),
        };
      }),
    ];
  }, [me, data, gm, status.data, day, today, usedHere]); // eslint-disable-line react-hooks/exhaustive-deps

  const entry = (k: string) => entries[k] ?? blank();
  const lastKey = (c: Card_) => `${gm ? gmId : me?.id}|${c.kind}|${c.subject?.id ?? me?.id}`;
  const saved = useMemo(readLast, [done, me?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const setEntry = (k: string, patch: Partial<Entry>) => setEntries((s) => ({ ...s, [k]: { ...entry(k), ...patch } }));
  const answered = (c: Card_) => c.criteria.filter((x) => entry(c.key).scores[x.key]).length;
  // الغايب: البطاقة كاملة لما يتكتب السبب (بلا بنود).
  const isAbsent = (c: Card_) => c.kind === "by_manager" && !!entry(c.key).absent;
  const filled = (c: Card_) => (isAbsent(c) ? (entry(c.key).reason?.trim() ? c.criteria.length : 0) : answered(c));
  const problems = cards.filter((c) => (isAbsent(c) && !entry(c.key).reason?.trim())
    || (c.required && filled(c) < c.criteria.length) || (!c.required && filled(c) > 0 && filled(c) < c.criteria.length));

  const submit = useMutation({
    mutationFn: async () => {
      const list = cards.filter((c) => filled(c) > 0).map((c) => (isAbsent(c)
        ? { kind: c.kind, subject_id: c.subject!.id, absent: true, absence_reason: entry(c.key).reason!.trim(), scores: {} }
        : {
          kind: c.kind, subject_id: c.subject?.id ?? me!.id, scores: entry(c.key).scores,
          strengths: entry(c.key).strengths, improvements: entry(c.key).improvements, notes: entry(c.key).notes,
        }));
      // في تقييم المدير العام: اللي يقيّم = صف المدير العام، واللي يتقيّم = الاسم المختار.
      const evaluator = gm ? gmId : me!.id;
      if (!evaluator) throw new Error("صف المدير العام مش موجود في قائمة التقييم");
      // month برضو: لين يتشغّل ملف التحديث، السيرفر القديم يحفظ شهري بدل ما يرفض.
      const { data, error } = await db.rpc("eval_submit", {
        p_token: token ?? null, p: { day, month: `${day.slice(0, 7)}-01`, evaluator_id: evaluator, entries: list, device: deviceId() },
      });
      if (error) throw error;
      if (!recorder && !gm) addWho(evaluator);
      writeLast(Object.fromEntries(cards.filter((c) => !isAbsent(c) && answered(c) > 0).map((c) => [lastKey(c), entry(c.key).scores])));
      return data as number;
    },
    onSuccess: (n) => { setDone(n); qc.invalidateQueries({ queryKey: ["eval-status"] }); },
  });

  if (isLoading) return <div className="flex justify-center py-20"><Loader2 className="size-7 animate-spin text-primary" /></div>;
  if (error || !data) return <Card className="p-6 text-center font-semibold text-destructive">{(error as Error)?.message ?? "تعذّر فتح الاستمارة"}</Card>;

  if (done != null) {
    return (
      <Card className="p-8 text-center space-y-3">
        <CheckCircle2 className="size-14 mx-auto text-emerald-600" />
        <p className="text-xl font-bold">تم إرسال التقييم{recorder || gm ? "" : `، شكراً ${me?.name}`}</p>
        <p className="text-sm text-muted-foreground">{n(done)} تقييم — {periodText}{gm ? ` لـ ${me?.name}` : recorder ? ` باسم ${me?.name}` : ""}</p>
        {isManager && !recorder && !gm && <p className="text-sm">نشوفوك بكرة إن شاء الله 🌙</p>}
        <Button variant="outline" onClick={() => { setDone(null); setMe(null); setRole(null); setEntries({}); }}>
          {recorder || gm ? "قيّم شخص ثاني" : "رجوع"}
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <TrustNote />
      {/* الفترة: المدير العام شهري؛ بعد ما يختار اسمه — المشرف يوم، والموظف نص شهر. */}
      {gm ? (
        <div>
          <p className="text-sm font-semibold mb-1.5">تقييم شهر</p>
          <div className="flex gap-1.5 flex-wrap">
            {months.map((m) => (
              <Button key={m} size="sm" variant={curMonth === m ? "default" : "outline"} onClick={() => setMonth(m)}>{monthLabel(m)}</Button>
            ))}
          </div>
        </div>
      ) : !me ? (
        <p className="rounded-xl bg-muted/50 p-3 text-sm leading-relaxed">
          <b>المشرف</b>: يقيّم موظفينه <b>كل يوم</b>. <b>الموظف</b>: يقيّم نفسه ومشرفه <b>مرتين في الشهر</b> (من 1 لـ 15، ومن 16 لآخر الشهر)
          — وتقييمه لمشرفه <b>سري</b>، ما يشوفه إلا الإدارة.
        </p>
      ) : recorder ? (
        <div>
          <p className="text-sm font-semibold mb-1.5">{isManager ? "تقييم يوم" : "تقييم"}: <span className="text-primary">{isManager ? dayLabel(day, today) : halfLabel(day)}</span></p>
          <Input type="date" dir="ltr" max={today} value={day} onChange={(e) => e.target.value && e.target.value <= today && setPickedDay(e.target.value)} className="h-11" />
        </div>
      ) : (
        <div>
          <p className="text-sm font-semibold mb-1.5">{isManager ? "تقييم يوم:" : "التقييم لـ:"}</p>
          <div className="flex gap-1.5 flex-wrap">
            {(isManager ? dayChoices : halfChoices).map((d) => {
              const on = isManager ? day === d : halfStart(day) === halfStart(d);
              return <Button key={d} size="sm" variant={on ? "default" : "outline"} onClick={() => setPickedDay(d)}>{isManager ? dayLabel(d, today) : halfLabel(d)}</Button>;
            })}
          </div>
        </div>
      )}

      {/* موظف ولا مشرف */}
      {!me && (
        <>
          <div>
            <p className="text-sm font-semibold mb-1.5">{gm ? "اللي تقيّمه:" : recorder ? "اللي تسجّل عنه:" : "أنت:"}</p>
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
              <p className="text-sm font-semibold mb-1.5">اختار {recorder || gm ? "الاسم" : "اسمك"}:</p>
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
              <p className="text-xs text-muted-foreground">{me.role === "manager" ? "مشرف" : "موظف"} · {me.branch_name ?? "بدون فرع"}{gm ? " · تقييم المدير العام" : recorder ? " · تسجيل نيابة عنه" : ""}</p>
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
                  <span className="min-w-0">
                    <span className="block font-bold">{c.done && <CheckCircle2 className="ml-1 inline size-4 text-emerald-600" />}{c.title}</span>
                    {c.note && <span className="block text-[11px] text-muted-foreground">{c.note}</span>}
                  </span>
                  <span className="flex items-center gap-2 text-xs">
                    {isAbsent(c)
                      ? <span className="rounded-full bg-destructive/15 px-2 py-0.5 font-bold text-destructive">غايب</span>
                      : <span className={a === c.criteria.length ? "text-emerald-600 font-bold" : "text-muted-foreground"}>{a}/{c.criteria.length}</span>}
                    <ChevronDown className={`size-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  </span>
                </button>
                {isOpen && (
                  <div className="px-3 pb-3 space-y-3">
                    {c.secret && (
                      <p className="rounded-lg bg-emerald-500/10 p-2 text-xs leading-relaxed text-emerald-800 dark:text-emerald-300">
                        🔒 تقييمك لمشرفك <b>سري</b>: ما يشوفه إلا الإدارة، و{c.subject?.name} ما يعرفش كم عطيته. قيّمه بصراحة — هذا اللي يتحاسب عليه المشرف.
                      </p>
                    )}
                    {c.phoneWarn && (
                      <p className="rounded-lg bg-destructive/10 p-2 text-xs font-semibold leading-relaxed text-destructive">
                        📱 هذا التليفون اتبعت منه تقييم {c.subject?.name} قبل. لو تقيّمه من هنا يطلع للإدارة بعلامة إنه من تليفون المشرف — الأحسن تقيّمه من تليفونك باش يبقى سري.
                      </p>
                    )}
                    {c.kind === "by_manager" && (
                      <div className="grid grid-cols-2 gap-1.5">
                        <Button size="sm" variant={isAbsent(c) ? "outline" : "default"} onClick={() => setEntry(c.key, { absent: false })}>
                          <UserCheck className="size-4" />حاضر — قيّمه
                        </Button>
                        <Button size="sm" variant={isAbsent(c) ? "destructive" : "outline"} onClick={() => setEntry(c.key, { absent: true })}>
                          <UserX className="size-4" />غايب
                        </Button>
                      </div>
                    )}
                    {isAbsent(c) ? (
                      <div className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/5 p-2.5">
                        <p className="text-sm font-semibold">سبب الغياب</p>
                        <div className="flex flex-wrap gap-1.5">
                          {ABSENCE_REASONS.map((r) => (
                            <Button key={r} size="sm" variant={entry(c.key).reason === r ? "default" : "outline"} onClick={() => setEntry(c.key, { reason: r })}>{r}</Button>
                          ))}
                        </div>
                        <Textarea placeholder="ولا اكتب السبب (مثلاً: عنده ظرف عائلي، اتصل الصبح)" value={ABSENCE_REASONS.includes(entry(c.key).reason as (typeof ABSENCE_REASONS)[number]) ? "" : entry(c.key).reason ?? ""}
                          onChange={(e) => setEntry(c.key, { reason: e.target.value })} rows={2} />
                        <p className="text-[11px] text-muted-foreground">الغايب يتسجّل في يومه، وما ينحسبش في درجته — ويطلع في نتيجة الشهر.</p>
                      </div>
                    ) : (<>
                    {a === 0 && saved[lastKey(c)] && (
                      <Button size="sm" variant="outline" className="w-full" onClick={() => setEntry(c.key, { scores: { ...saved[lastKey(c)] } })}>
                        <Copy className="size-4" />نفس آخر تقييم — بدّل بس اللي تغيّر
                      </Button>
                    )}
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
                    </>)}
                  </div>
                )}
              </Card>
            );
          })}

          {problems.length > 0 && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              {problems.filter(isAbsent).length > 0 && <>اكتب سبب غياب: {problems.filter(isAbsent).map((p) => p.subject?.name).join("، ")}. </>}
              {problems.filter((p) => !isAbsent(p)).length > 0 && <>كمّل كل البنود في: {problems.filter((p) => !isAbsent(p)).map((p) => p.title).join("، ")}</>}
            </p>
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
