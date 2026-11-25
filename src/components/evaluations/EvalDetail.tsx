// تفاصيل أي حاجة تنضغط في لوحة التقييم: الشخص (رزنامة أيامه، تقييمه لنفسه مقابل غيره، كل بند،
// الملاحظات، الغياب، وشهر بشهر)، الفرع، البند، والقوائم (مين اتقيّم ومين لا، يحتاج متابعة، قيّموا نفسهم 5).
import { useState, type ReactNode } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronLeft } from "lucide-react";
import { Card } from "@/components/ui/card";
import { SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  ALL_CRITERIA, EMPLOYEE_CRITERIA, GM_CRITERIA, MANAGER_CRITERIA, KIND_LABEL, dayLabel, grade, monthLabel, shiftMonth,
  type EvalStaff, type Evaluation,
} from "@/lib/evaluation";
import { avg, f1, isAll5, per, wk, ratersWord, signed1, type Board, type Branch, type Person } from "@/lib/evalBoard";
import { Badges, Bar, DAY_CLS, DutyBadge, EvalCard, FlagBanner, MonthGrid, roleLabel, whenLabel, type Detail, type ListKind, type OpenFn } from "./bits";

export function EvalDetail({ d, b, staff, open }: { d: Detail; b: Board; staff: EvalStaff[]; open: OpenFn }) {
  const nameOf = (id: string) => staff.find((s) => s.id === id)?.name ?? "—";
  if (d.t === "person") {
    const p = b.byId.get(d.id);
    return p ? <PersonDetail p={p} b={b} open={open} nameOf={nameOf} /> : <Gone />;
  }
  if (d.t === "branch") {
    const br = b.branches.find((x) => x.name === d.name);
    return br ? <BranchDetail br={br} b={b} open={open} /> : <Gone />;
  }
  if (d.t === "crit") return <CritDetail k={d.key} b={b} open={open} />;
  if (d.t === "branches") return <BranchesDetail b={b} open={open} />;
  return <ListDetail which={d.which} b={b} open={open} />;
}

const Gone = () => <p className="py-8 text-center text-muted-foreground">ما عادش موجود في هذا الشهر.</p>;

function Title({ title, sub }: { title: string; sub?: string }) {
  return (
    <SheetHeader className="pr-7 text-right">
      <SheetTitle className="text-xl">{title}</SheetTitle>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </SheetHeader>
  );
}

/** سطر شخص يتضغط ويفتح تفاصيله (في القوائم والفروع والبنود). */
function PersonRow({ p, open, right, sub }: { p: Person; open: OpenFn; right?: ReactNode; sub?: ReactNode }) {
  return (
    <button type="button" onClick={() => open({ t: "person", id: p.id })}
      className="flex w-full items-center justify-between gap-2 border-b py-2 text-right last:border-0 active:bg-muted/40">
      <span className="min-w-0">
        <span className="block font-semibold">{p.name} <span className="text-[11px] font-normal text-muted-foreground">· {roleLabel(p.role)} · {p.branch_name ?? "—"}</span></span>
        {sub != null && sub !== "" && <span className="block text-[11px] text-muted-foreground">{sub}</span>}
        <Badges p={p} />
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {right ?? <span className={`text-lg font-bold ${grade(p.final).text}`}>{f1(p.final)}</span>}
        <ChevronLeft className="size-4 text-muted-foreground" />
      </span>
    </button>
  );
}

const ratersCount = (p: Person) => new Set(p.others.map((e) => e.evaluator_id)).size;
const howRated = (p: Person) => p.role === "manager"
  ? `موظفينه قيّموه ${ratersCount(p)} من ${p.team.length}${p.duty?.closed ? ` · قيّم كل موظفينه ${p.duty.full} يوم من ${p.duty.closed}` : ""}`
  : `اتقيّم ${p.presentDays} يوم${p.absences.length ? ` · غاب ${p.absences.length}` : ""}${p.missedDays ? ` · ما اتقيّمش ${p.missedDays} يوم` : ""}`;

// ===================== الشخص =====================
function PersonDetail({ p, b, open, nameOf }: { p: Person; b: Board; open: OpenFn; nameOf: (id: string) => string }) {
  const who = ratersWord(p);
  const criteria = p.role === "manager" ? MANAGER_CRITERIA : EMPLOYEE_CRITERIA;
  const crit = (k: string, es: Evaluation[]) => avg(es.map((e) => e.scores?.[k]));
  const gap = p.self != null && p.final != null ? p.self - p.final : null;
  const gmEvals = p.evals.filter((e) => e.kind === "by_gm");
  const notes = p.evals.filter((e) => e.strengths || e.improvements || e.notes)
    .sort((x, y) => per(y).localeCompare(per(x))).slice(0, 20);
  const history = Array.from({ length: 6 }, (_, i) => shiftMonth(b.month, i - 5))
    .map((m) => ({ month: monthLabel(m).split(" ")[0], ...b.scoreOf(p, m) }));
  const g = grade(p.final);
  return (
    <div className="space-y-4">
      <Title title={p.name} sub={`${roleLabel(p.role)} · ${p.branch_name ?? "—"} · ${monthLabel(b.month)}`} />
      {p.phone && <FlagBanner flag={p.phone} />}
      {p.flag && <FlagBanner flag={p.flag} />}
      {p.final == null && p.whyNot && !p.flag && <p className="rounded-lg bg-muted p-2 text-sm">ما عندهش درجة لين توا: {p.whyNot}.</p>}

      <div className="grid grid-cols-3 gap-2 text-center">
        <Card className="p-2">
          <div className="text-[11px] text-muted-foreground">الدرجة (من {who})</div>
          <div className={`text-2xl font-bold ${g.text}`}>{f1(p.final)}</div>
          <div className="text-[11px]">{g.label}</div>
        </Card>
        <Card className="p-2">
          <div className="text-[11px] text-muted-foreground">قيّم نفسه</div>
          <div className={`text-2xl font-bold ${p.selfAll5 ? "text-red-600" : ""}`}>{f1(p.self)}</div>
          <div className="text-[11px] text-muted-foreground">{p.selfAll5 ? "5 في كل البنود" : "ما يحسبش"}</div>
        </Card>
        <Card className="p-2">
          <div className="text-[11px] text-muted-foreground">الفرق</div>
          <div dir="ltr" className={`text-2xl font-bold ${gap == null ? "" : gap >= 1 ? "text-red-600" : gap >= 0.5 ? "text-amber-600" : ""}`}>{gap == null ? "—" : signed1(gap)}</div>
          <div className="text-[11px] text-muted-foreground">نفسه − غيره</div>
        </Card>
      </div>
      <p className="text-xs text-muted-foreground">{howRated(p)}{p.prev != null ? ` · الشهر اللي فات ${f1(p.prev)}` : ""}</p>

      {p.role === "manager" ? <ManagerBlocks p={p} b={b} nameOf={nameOf} /> : <EmployeeDays p={p} b={b} nameOf={nameOf} />}
      <SelfBlock p={p} b={b} nameOf={nameOf} />

      <Card className="p-3">
        <h3 className="mb-2 font-bold">البنود — {who} مقابل نفسه</h3>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1.5 text-sm">
          <span className="text-[11px] text-muted-foreground">البند</span>
          <span className="text-center text-[11px] text-muted-foreground">{who}</span>
          <span className="text-center text-[11px] text-muted-foreground">نفسه</span>
          {criteria.map((c) => {
            const o = crit(c.key, p.others), s = crit(c.key, p.selfs);
            const big = o != null && s != null && s - o >= 1.5;
            return [
              <button key={c.key} type="button" onClick={() => open({ t: "crit", key: c.key })}
                className={`truncate text-right active:underline ${big ? "font-semibold text-red-600" : ""}`}>{c.label}</button>,
              <span key={c.key + "o"} className={`text-center font-bold ${grade(o).text}`}>{f1(o)}</span>,
              <span key={c.key + "s"} className={`text-center ${big ? "font-bold text-red-600" : "text-muted-foreground"}`}>{f1(s)}</span>,
            ];
          })}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">بالأحمر: بند قيّم فيه نفسه أعلى من {who} بنقطة ونص أو أكثر. اضغط على البند تشوف الكل فيه.</p>
      </Card>

      {gmEvals.length > 0 && (
        <Card className="p-3">
          <h3 className="mb-2 font-bold">بنود المدير العام</h3>
          {GM_CRITERIA.map((c) => {
            const val = crit(c.key, gmEvals);
            return (
              <div key={c.key} className="mb-1.5">
                <div className="flex justify-between text-sm"><span>{c.label}</span><span className={`font-bold ${grade(val).text}`}>{f1(val)}</span></div>
                <Bar v={val} />
              </div>
            );
          })}
        </Card>
      )}

      {p.absences.length > 0 && (
        <Card className="space-y-1.5 p-3">
          <h3 className="font-bold">الغياب ({p.absences.length} يوم)</h3>
          {p.absences.map((e) => (
            <div key={e.id} className="flex items-start justify-between gap-2 border-b pb-1.5 text-sm last:border-0">
              <span className="text-muted-foreground">{whenLabel(e, b.today)}</span>
              <span className="text-left font-semibold">{e.absence_reason ?? "—"}</span>
            </div>
          ))}
        </Card>
      )}

      {notes.length > 0 && (
        <Card className="space-y-3 p-3">
          <h3 className="font-bold">الملاحظات</h3>
          {notes.map((e) => (
            <div key={e.id} className="border-b pb-2 text-sm last:border-0">
              <p className="text-xs text-muted-foreground">
                {KIND_LABEL[e.kind]}{e.kind !== "self" ? ` · من ${nameOf(e.evaluator_id)}` : ""} · {whenLabel(e, b.today)} · {e.absent ? "غايب" : f1(e.overall)}
                {e.source === "recorder" ? " · سجّلها المسؤول" : ""}
              </p>
              {e.strengths && <p><b className="text-emerald-600">قوة: </b>{e.strengths}</p>}
              {e.improvements && <p><b className="text-amber-600">يتحسّن: </b>{e.improvements}</p>}
              {e.notes && <p className="text-muted-foreground">{e.notes}</p>}
            </div>
          ))}
        </Card>
      )}

      {history.filter((h) => h.final != null || h.self != null).length > 1 && (
        <Card className="p-3">
          <h3 className="mb-2 font-bold">شهر بشهر</h3>
          <div className="h-40" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(val: number, k: string) => [f1(val), k === "self" ? "نفسه" : who]} />
                <Line type="monotone" dataKey="final" stroke="#C9A227" strokeWidth={3} dot={{ r: 3 }} connectNulls />
                <Line type="monotone" dataKey="self" stroke="#94a3b8" strokeWidth={2} strokeDasharray="4 4" dot={{ r: 2 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-muted-foreground">الذهبي: تقييم {who} (الدرجة) · المقطّع: تقييمه لنفسه</p>
        </Card>
      )}
    </div>
  );
}

/** الموظف: رزنامة الشهر — كل يوم بدرجة مشرفه، ولا غايب، ولا ما اتقيّمش. الضغط على اليوم يوري التقييم كامل. */
function EmployeeDays({ p, b, nameOf }: { p: Person; b: Board; nameOf: (id: string) => string }) {
  const byDay = new Map<string, Evaluation[]>();
  for (const e of p.evals.filter((x) => x.kind === "by_manager")) byDay.set(per(e), [...(byDay.get(per(e)) ?? []), e]);
  const last = b.elapsed ? b.allDays[b.elapsed - 1] : null;
  const [sel, setSel] = useState<string | null>(() => [...byDay.keys()].sort().pop() ?? null);
  const cell = (d: string) => {
    const es = byDay.get(d) ?? [];
    const ok = es.filter((e) => !e.absent);
    if (ok.length) return { cls: DAY_CLS.ok, text: f1(avg(ok.map((e) => e.overall))), clickable: true };
    if (es.length) return { cls: DAY_CLS.absent, text: "غايب", clickable: true };
    if (d === b.today && p.manager) return { cls: DAY_CLS.today, text: "⏳", clickable: false };
    if (last && d <= last && p.manager) return { cls: DAY_CLS.miss, text: "✗", clickable: false };
    return { cls: DAY_CLS.future, text: "", clickable: false };
  };
  return (
    <Card className="space-y-2 p-3">
      <h3 className="font-bold">أيامه في {monthLabel(b.month)}</h3>
      <p className="text-xs text-muted-foreground">
        {p.manager ? (
          <>تقييم {p.manager.name} اليومي: اتقيّم <b>{p.presentDays}</b> يوم
            {p.absences.length ? <> · غاب <b className="text-red-600">{p.absences.length}</b></> : null}
            {p.missedDays ? <> · ما اتقيّمش <b className="text-red-600">{p.missedDays}</b></> : null} — من {b.elapsed} يوم فاتو. اضغط على أي يوم تشوف تقييمه.</>
        ) : "ما فيش مشرف في فرعه يقيّمه كل يوم."}
      </p>
      <MonthGrid b={b} cell={cell} sel={sel} onSel={setSel} />
      <p className="flex flex-wrap gap-x-3 text-[10px] text-muted-foreground"><span>🟩 اتقيّم (بدرجته)</span><span>🟥 غايب</span><span>✗ ما اتقيّمش</span><span>⏳ اليوم (لسه مفتوح)</span></p>
      {sel && (byDay.get(sel) ?? []).map((e) => <EvalCard key={e.id} e={e} b={b} nameOf={nameOf} />)}
    </Card>
  );
}

/** المشرف: مين من موظفينه قيّمه (في كل نص)، ورزنامة تقييمه اليومي ليهم. */
function ManagerBlocks({ p, b, nameOf }: { p: Person; b: Board; nameOf: (id: string) => string }) {
  const [exp, setExp] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const n = p.team.length;
  const ofm = p.evals.filter((e) => e.kind === "of_manager");
  const byDay = new Map<string, Evaluation[]>();
  for (const e of p.given) byDay.set(per(e), [...(byDay.get(per(e)) ?? []), e]);
  const last = b.elapsed ? b.allDays[b.elapsed - 1] : null;
  const toggle = (id: string) => setExp(exp === id ? null : id);
  const cell = (d: string) => {
    const k = new Set((byDay.get(d) ?? []).map((e) => e.subject_id)).size;
    const past = !!last && d <= last;
    if (!n || (!past && !k)) return { cls: DAY_CLS.future, text: "", clickable: false };
    return { cls: k >= n ? DAY_CLS.ok : k > 0 ? DAY_CLS.part : d === b.today ? DAY_CLS.today : DAY_CLS.miss, text: `${k}/${n}`, clickable: true };
  };
  return (
    <>
      <Card className="space-y-2 p-3">
        <h3 className="font-bold">موظفينه قيّموه</h3>
        {!n && <p className="text-sm text-muted-foreground">ما عندهش موظفين في فرعه.</p>}
        {n > 0 && b.weeks.map((h) => {
          if (!h.started) return <p key={h.key} className="text-xs text-muted-foreground">{h.label}: ⏳ ما جاش</p>;
          const es = ofm.filter((e) => wk(e) === h.key);
          const rows = [
            ...p.team.map((t) => ({ id: t.id, name: t.name, e: es.find((x) => x.evaluator_id === t.id) })),
            ...es.filter((e) => !p.team.some((t) => t.id === e.evaluator_id)).map((e) => ({ id: e.evaluator_id, name: nameOf(e.evaluator_id), e })),
          ];
          return (
            <div key={h.key} className="space-y-0.5">
              <p className="text-xs font-semibold text-muted-foreground">
                {h.label}: قيّموه {es.length} من {n}{es.length ? ` · المتوسط ${f1(avg(es.map((e) => e.overall)))}` : ""}
              </p>
              {rows.map(({ id, name, e }) => e ? (
                <div key={id}>
                  <button type="button" onClick={() => toggle(e.id)} className="flex w-full items-center justify-between py-1 text-right text-sm active:bg-muted/40">
                    <span>✅ {name}{b.samePhoneIds.has(e.id) && <span className="mr-1 text-[11px] font-bold text-red-600">📱 من تليفون {p.name}</span>}</span>
                    <span className={`font-bold ${grade(e.overall).text}`}>{f1(e.overall)}</span>
                  </button>
                  {exp === e.id && <EvalCard e={e} b={b} nameOf={nameOf} />}
                </div>
              ) : (
                <div key={id} className="flex items-center justify-between py-1 text-sm text-muted-foreground">
                  <span>❌ {name}</span><span className="text-xs">ما قيّمهوش</span>
                </div>
              ))}
            </div>
          );
        })}
      </Card>

      {n > 0 && (
        <Card className="space-y-2 p-3">
          <h3 className="flex flex-wrap items-center justify-between gap-1 font-bold">تقييمه اليومي لموظفينه <DutyBadge duty={p.duty} /></h3>
          {p.duty && <p className="text-sm">{p.duty.text}{p.duty.today != null ? ` اليوم لين توا: ${p.duty.today} من ${n}.` : ""}</p>}
          {p.duty && p.duty.closed > 0 && (
            <div className="flex flex-wrap gap-1.5 text-xs">
              {p.duty.perStaff.map((x) => (
                <span key={x.id} className={`rounded-full border px-2 py-0.5 ${x.days < p.duty!.closed * 0.75 ? "border-red-300 text-red-700 dark:border-red-800 dark:text-red-300" : "text-muted-foreground"}`}>
                  {x.name}: {x.days}/{p.duty!.closed}
                </span>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">كل مربّع: كم واحد من {n} قيّمهم (ولا سجّلهم غايب) ذاك اليوم — اضغط على اليوم للتفاصيل.</p>
          <MonthGrid b={b} cell={cell} sel={sel} onSel={setSel} />
          {sel && (
            <div className="space-y-1">
              <p className="text-xs font-semibold">{dayLabel(sel, b.today)}</p>
              {p.team.map((t) => {
                const es = (byDay.get(sel) ?? []).filter((e) => e.subject_id === t.id);
                const ok = es.find((e) => !e.absent);
                const e0 = ok ?? es[0];
                return (
                  <div key={t.id}>
                    <button type="button" disabled={!e0} onClick={() => e0 && toggle(e0.id)} className="flex w-full items-center justify-between py-1 text-right text-sm">
                      <span>{ok ? "✅" : es.length ? "🚫" : "❌"} {t.name}</span>
                      <span className={`text-xs font-bold ${ok ? grade(ok.overall).text : es.length ? "text-red-600" : "text-muted-foreground"}`}>
                        {ok ? f1(ok.overall) : es.length ? `غايب — ${es[0].absence_reason ?? ""}` : "ما قيّمهوش"}
                      </span>
                    </button>
                    {e0 && exp === e0.id && <EvalCard e={e0} b={b} nameOf={nameOf} />}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}
    </>
  );
}

/** تقييمه لنفسه في كل نص (5 كاملة؟)، وللموظف: قيّم مشرفه ولا لا. */
function SelfBlock({ p, b, nameOf }: { p: Person; b: Board; nameOf: (id: string) => string }) {
  const [exp, setExp] = useState<string | null>(null);
  const toMgr = p.manager ? b.monthEvals.filter((e) => e.kind === "of_manager" && e.evaluator_id === p.id) : [];
  const started = b.halves.filter((h) => h.started);
  return (
    <Card className="space-y-1.5 p-3">
      <h3 className="font-bold">تقييمه لنفسه <span className="text-xs font-normal text-muted-foreground">— لوحده، ما يدخلش في الدرجة</span></h3>
      {b.halves.map((h) => {
        if (!h.started) return <p key={h.key} className="text-sm text-muted-foreground">النص {h.label}: ⏳ ما بداش</p>;
        const e = p.selfs.find((x) => per(x) === h.key);
        if (!e) return <p key={h.key} className="text-sm text-red-600">النص {h.label}: ❌ ما قيّمش نفسه</p>;
        return (
          <div key={h.key}>
            <button type="button" onClick={() => setExp(exp === e.id ? null : e.id)} className="flex w-full items-center justify-between gap-2 py-1 text-right text-sm active:bg-muted/40">
              <span>
                النص {h.label}: ✅
                {isAll5(e) && <span className="mr-1 rounded-full bg-red-100 px-1.5 text-[10px] font-bold text-red-700 dark:bg-red-950/50 dark:text-red-300">5 في كل البنود</span>}
              </span>
              <span className={`font-bold ${isAll5(e) ? "text-red-600" : ""}`}>{f1(e.overall)}</span>
            </button>
            {exp === e.id && <EvalCard e={e} b={b} nameOf={nameOf} />}
          </div>
        );
      })}
      {p.manager && b.weeks.some((h) => h.started) && (
        <p className="border-t pt-1.5 text-xs text-muted-foreground">
          قيّم مشرفه ({p.manager.name}): {b.weeks.filter((h) => h.started).map((h) => {
            const e = toMgr.find((x) => wk(x) === h.key);
            return `${h.label} ${e ? (b.samePhoneIds.has(e.id) ? "✅ 📱 من تليفون المشرف" : "✅") : "❌"}`;
          }).join(" · ")}
        </p>
      )}
    </Card>
  );
}

// ===================== الفرع =====================
function BranchDetail({ br, b, open }: { br: Branch; b: Board; open: OpenFn }) {
  const crit: Record<string, number[]> = {};
  for (const p of br.people) for (const e of p.others) for (const [k, v] of Object.entries(e.scores ?? {})) (crit[k] ??= []).push(Number(v));
  const weakest = Object.entries(crit).map(([k, xs]) => ({ k, v: avg(xs)! })).sort((x, y) => x.v - y.v).slice(0, 3);
  const g = grade(br.avg);
  const self = avg(br.people.map((p) => p.self));
  return (
    <div className="space-y-4">
      <Title title={br.name} sub={monthLabel(b.month)} />
      <div className="grid grid-cols-3 gap-2 text-center">
        <Card className="p-2"><div className="text-[11px] text-muted-foreground">متوسط الفرع</div><div className={`text-2xl font-bold ${g.text}`}>{f1(br.avg)}</div><div className="text-[11px]">{g.label}</div></Card>
        <Card className="p-2"><div className="text-[11px] text-muted-foreground">اتقيّموا</div><div className="text-2xl font-bold">{br.rated}/{br.people.length}</div></Card>
        <Card className="p-2"><div className="text-[11px] text-muted-foreground">قيّموا نفسهم</div><div className="text-2xl font-bold text-muted-foreground">{f1(self)}</div><div className="text-[11px] text-muted-foreground">للمقارنة</div></Card>
      </div>
      {br.managers.length > 0 && (
        <Card className="p-3">
          <h3 className="mb-1 font-bold">المشرف</h3>
          {br.managers.map((m) => <PersonRow key={m.id} p={m} open={open} sub={howRated(m)} />)}
        </Card>
      )}
      {br.staff.length > 0 && (
        <Card className="p-3">
          <h3 className="mb-1 font-bold">الموظفين</h3>
          {[...br.staff].sort((x, y) => (y.final ?? -1) - (x.final ?? -1)).map((p) => (
            <PersonRow key={p.id} p={p} open={open} sub={p.final == null ? <span className="text-red-600">{p.whyNot}</span> : howRated(p)} />
          ))}
        </Card>
      )}
      {weakest.length > 0 && (
        <Card className="p-3">
          <h3 className="mb-1 font-bold">أضعف البنود في الفرع</h3>
          {weakest.map(({ k, v }) => (
            <button key={k} type="button" onClick={() => open({ t: "crit", key: k })} className="mb-1 block w-full rounded-md p-1 text-right active:bg-muted/40">
              <span className="flex justify-between gap-2 text-sm"><span className="truncate">{ALL_CRITERIA[k] ?? k}</span><span className={`font-bold ${grade(v).text}`}>{f1(v)}</span></span>
              <Bar v={v} />
            </button>
          ))}
        </Card>
      )}
    </div>
  );
}

// ===================== البند =====================
function CritDetail({ k, b, open }: { k: string; b: Board; open: OpenFn }) {
  const label = ALL_CRITERIA[k] ?? k;
  const c = b.criteria.find((x) => x.key === k);
  const rows = b.people
    .map((p) => ({ p, o: avg(p.others.map((e) => e.scores?.[k])), s: avg(p.selfs.map((e) => e.scores?.[k])) }))
    .filter((r) => r.o != null || r.s != null)
    .sort((x, y) => (x.o ?? 9) - (y.o ?? 9) || x.p.name.localeCompare(y.p.name, "ar"));
  return (
    <div className="space-y-4">
      <Title title={label} sub={`${monthLabel(b.month)} · من تقييمهم لبعض${c ? ` · ${c.n} درجة` : ""}`} />
      <Card className="p-3 text-center">
        <div className="text-[11px] text-muted-foreground">متوسط البند</div>
        <div className={`text-3xl font-bold ${grade(c?.avg).text}`}>{f1(c?.avg)}</div>
        <div className="text-xs">{grade(c?.avg).label}</div>
      </Card>
      <Card className="p-3">
        <h3 className="mb-1 font-bold">كل واحد في هذا البند — الأضعف أول</h3>
        {!rows.length ? <p className="text-sm text-muted-foreground">—</p> : rows.map(({ p, o, s }) => (
          <PersonRow key={p.id} p={p} open={open}
            sub={<span className="flex items-center gap-2"><Bar v={o} className="h-1.5 w-24" /><span>نفسه {f1(s)}{o != null && s != null && s - o >= 1.5 ? " ⚠️" : ""}</span></span>}
            right={<span className={`text-lg font-bold ${grade(o).text}`}>{f1(o)}</span>} />
        ))}
        <p className="mt-2 text-[11px] text-muted-foreground">الرقم الكبير من مشرفه (ولا موظفينه للمشرف)، و«نفسه» تقييمه لنفسه في نفس البند.</p>
      </Card>
    </div>
  );
}

// ===================== القوائم =====================
function weakest2(p: Person) {
  const crit: Record<string, number[]> = {};
  for (const e of p.others) for (const [k, v] of Object.entries(e.scores ?? {})) (crit[k] ??= []).push(Number(v));
  return Object.entries(crit).map(([k, xs]) => ({ k, v: avg(xs)! })).sort((x, y) => x.v - y.v).slice(0, 2)
    .map(({ k, v }) => `${ALL_CRITERIA[k] ?? k} ${f1(v)}`).join(" · ");
}

const SelfVsOthers = ({ p }: { p: Person }) => (
  <span className="text-left leading-tight">
    <span className={`block text-lg font-bold ${grade(p.final).text}`}>{f1(p.final)}</span>
    <span className={`block text-[10px] ${p.selfAll5 ? "font-bold text-red-600" : "text-muted-foreground"}`}>نفسه {f1(p.self)}</span>
  </span>
);

function ListDetail({ which, b, open }: { which: ListKind; b: Board; open: OpenFn }) {
  if (which === "rated") {
    return (
      <div className="space-y-4">
        <Title title="مين اتقيّم ومين لا" sub={`${monthLabel(b.month)} · من تقييمهم لبعض (التقييم الذاتي ما يحسبش)`} />
        <Card className="p-3">
          <h3 className="mb-1 font-bold text-red-600">ما اتقيّموش ({b.unrated.length})</h3>
          {!b.unrated.length ? <p className="text-sm text-emerald-600">الكل اتقيّم ✅</p>
            : b.unrated.map((p) => <PersonRow key={p.id} p={p} open={open} sub={<span className="text-red-600">{p.whyNot}</span>} right={<span className="text-muted-foreground">—</span>} />)}
        </Card>
        <Card className="p-3">
          <h3 className="mb-1 font-bold text-emerald-600">اتقيّموا ({b.rated.length})</h3>
          {!b.rated.length ? <p className="text-sm text-muted-foreground">—</p> : b.rated.map((p) => <PersonRow key={p.id} p={p} open={open} sub={howRated(p)} />)}
        </Card>
      </div>
    );
  }
  if (which === "low") {
    return (
      <div className="space-y-4">
        <Title title="يحتاج متابعة" sub={`${monthLabel(b.month)} · درجته من غيره أقل من 3`} />
        <Card className="p-3">
          {!b.low.length ? <p className="text-sm text-emerald-600">ما حد تحت 3 ✅</p>
            : b.low.map((p) => <PersonRow key={p.id} p={p} open={open} sub={`أضعف: ${weakest2(p) || "—"}`} />)}
        </Card>
      </div>
    );
  }
  if (which === "flagged") {
    const gapOnly = b.flagged.filter((p) => !p.selfAll5);
    return (
      <div className="space-y-4">
        <Title title="قيّموا نفسهم أعلى من اللي يستاهلوه؟" sub={`${monthLabel(b.month)} · التقييم الذاتي ما يدخلش في الترتيب`} />
        <Card className="p-3">
          <h3 className="mb-1 font-bold">قيّموا نفسهم 5 في كل البنود ({b.all5.length})</h3>
          {!b.all5.length ? <p className="text-sm text-muted-foreground">ما حد ✅</p>
            : b.all5.map((p) => <PersonRow key={p.id} p={p} open={open} sub={p.flag?.text} right={<SelfVsOthers p={p} />} />)}
        </Card>
        <Card className="p-3">
          <h3 className="mb-1 font-bold">قيّموا نفسهم أعلى من غيرهم بنقطة أو أكثر ({gapOnly.length})</h3>
          {!gapOnly.length ? <p className="text-sm text-muted-foreground">ما حد ✅</p>
            : gapOnly.map((p) => <PersonRow key={p.id} p={p} open={open} sub={p.flag?.text} right={<SelfVsOthers p={p} />} />)}
        </Card>
      </div>
    );
  }
  // noself
  const started = b.halves.filter((h) => h.started);
  return (
    <div className="space-y-4">
      <Title title="مين ما قيّمش نفسه" sub={`${monthLabel(b.month)} · التقييم الذاتي مرتين في الشهر`} />
      {!started.length && <p className="text-sm text-muted-foreground">الشهر ما بداش.</p>}
      {started.map((h) => {
        const miss = b.people.filter((p) => !p.selfs.some((e) => per(e) === h.key));
        return (
          <Card key={h.key} className="p-3">
            <h3 className="mb-1 font-bold">النص {h.label} — ناقص {miss.length} من {b.people.length}</h3>
            {!miss.length ? <p className="text-sm text-emerald-600">الكل قيّم نفسه ✅</p>
              : miss.map((p) => <PersonRow key={p.id} p={p} open={open} sub={howRated(p)} />)}
          </Card>
        );
      })}
    </div>
  );
}

function BranchesDetail({ b, open }: { b: Board; open: OpenFn }) {
  const self = avg(b.people.map((p) => p.self));
  return (
    <div className="space-y-4">
      <Title title="المتوسط العام" sub={`${monthLabel(b.month)} · من تقييمهم لبعض`} />
      <div className="grid grid-cols-2 gap-2 text-center">
        <Card className="p-2"><div className="text-[11px] text-muted-foreground">تقييمهم لبعض</div><div className={`text-3xl font-bold ${grade(b.overall).text}`}>{f1(b.overall)}</div><div className="text-xs">{grade(b.overall).label}</div></Card>
        <Card className="p-2"><div className="text-[11px] text-muted-foreground">تقييمهم لنفسهم</div><div className="text-3xl font-bold text-muted-foreground">{f1(self)}</div><div className="text-xs text-muted-foreground">للمقارنة بس</div></Card>
      </div>
      <Card className="p-3">
        <h3 className="mb-1 font-bold">الفروع</h3>
        {b.branches.map((br) => (
          <button key={br.name} type="button" onClick={() => open({ t: "branch", name: br.name })} className="mb-1.5 block w-full rounded-md p-1 text-right active:bg-muted/40">
            <span className="flex justify-between text-sm"><span>{br.name}</span><span className={`font-bold ${grade(br.avg).text}`}>{f1(br.avg)}</span></span>
            <Bar v={br.avg} className="h-2" />
            <span className="text-[11px] text-muted-foreground">اتقيّموا {br.rated} من {br.people.length}</span>
          </button>
        ))}
      </Card>
      {b.rated.length > 0 && (
        <Card className="p-3">
          <h3 className="mb-1 font-bold">الأحسن</h3>
          {b.rated.slice(0, 3).map((p) => <PersonRow key={p.id} p={p} open={open} sub={howRated(p)} />)}
        </Card>
      )}
    </div>
  );
}
