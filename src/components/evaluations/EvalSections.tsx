// أقسام لوحة التقييم: الأرقام، النتيجة، مين اتقيّم ومين لا، التقييم الذاتي، الفروع، البنود، شهر بشهر.
// كل رقم وسطر يتضغط ويفتح تفاصيله.
import { useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ChevronLeft, Copy, MessageCircle, Plus, ShieldAlert, Star, TrendingDown, TrendingUp, Users, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { GM_EVAL_ENABLED, dayLabel, grade, monthLabel } from "@/lib/evaluation";
import { avg, f1, per, wk, signed1, summaryText, type Board, type Person } from "@/lib/evalBoard";
import { Badges, Bar, DAY_CLS, FlagBadge, roleLabel, weekdayOf, type Detail, type OpenFn } from "./bits";

/** الأرقام الكبيرة — كل وحدة تفتح قائمتها. */
export function Kpis({ b, open }: { b: Board; open: OpenFn }) {
  const red = b.all5.filter((p) => p.flag?.level === "red").length;
  const tiles: { icon: LucideIcon; label: string; value: string; sub: string; tone: string; go: Detail }[] = [
    { icon: Users, label: "اتقيّموا", value: `${b.rated.length} / ${b.people.length}`,
      sub: b.unrated.length ? `${b.unrated.length} ما اتقيّموش لين توا` : "الكل اتقيّم ✅", tone: "", go: { t: "list", which: "rated" } },
    { icon: Star, label: "المتوسط العام", value: f1(b.overall), sub: grade(b.overall).label, tone: grade(b.overall).text, go: { t: "branches" } },
    { icon: AlertTriangle, label: "يحتاج متابعة", value: String(b.low.length), sub: "درجته أقل من 3",
      tone: b.low.length ? "text-red-600" : "", go: { t: "list", which: "low" } },
    { icon: ShieldAlert, label: "قيّموا نفسهم 5", value: String(b.all5.length),
      sub: red ? `${red} منهم غيرهم عطاهم أقل` : "5 في كل البنود", tone: b.all5.length ? "text-amber-600" : "", go: { t: "list", which: "flagged" } },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {tiles.map(({ icon: Icon, label, value, sub, tone, go }) => (
        <button key={label} type="button" onClick={() => open(go)}
          className="rounded-lg border bg-card p-3 text-right shadow-sm transition-colors hover:bg-muted/30 active:bg-muted/50">
          <span className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><Icon className="size-3.5" />{label}</span><ChevronLeft className="size-3.5" />
          </span>
          <span className={`block truncate text-xl font-bold ${tone}`}>{value}</span>
          <span className="block text-[11px] text-muted-foreground">{sub}</span>
        </button>
      ))}
    </div>
  );
}

/** النتيجة: الترتيب من تقييمهم لبعض بس، وتحته اللي ما اتقيّموش من غيرهم وليش. */
export function ResultCard({ b, open }: { b: Board; open: OpenFn }) {
  const text = summaryText(b);
  return (
    <Card className="p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold">النتيجة — {monthLabel(b.month)}</h2>
        {b.rated.length > 0 && (
          <span className="flex gap-1">
            <Button size="sm" variant="outline" className="h-8 px-2" aria-label="نسخ النتيجة"
              onClick={() => { void navigator.clipboard.writeText(text); toast.success("انسخت النتيجة"); }}><Copy className="size-4" /></Button>
            <Button asChild size="sm" variant="outline" className="h-8 px-2">
              <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" aria-label="واتساب"><MessageCircle className="size-4" /></a>
            </Button>
          </span>
        )}
      </div>
      <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
        من تقييمهم <b>لبعض</b> بس{GM_EVAL_ENABLED ? " (ومن المدير العام)" : ""} — تقييم الواحد لنفسه <b>ما يدخلش</b>، تلقاه لوحده تحت في «التقييم الذاتي». اضغط على أي اسم للتفاصيل.
      </p>
      {!b.rated.length
        ? <p className="py-6 text-center text-muted-foreground">ما حد اتقيّم من غيره في هذا الشهر لين توا.</p>
        : b.rated.map((p, i) => <RankRow key={p.id} p={p} i={i} open={open} />)}
      {b.unrated.length > 0 && (
        <div className="mt-3 rounded-lg border border-dashed p-2">
          <p className="mb-1 text-sm font-bold">ما اتقيّموش من غيرهم ({b.unrated.length}) — برّا الترتيب</p>
          {b.unrated.map((p) => (
            <button key={p.id} type="button" onClick={() => open({ t: "person", id: p.id })}
              className="flex w-full items-start justify-between gap-2 border-b py-1.5 text-right last:border-0 active:bg-muted/40">
              <span className="min-w-0">
                <span className="block font-semibold">{p.name} <span className="text-[11px] font-normal text-muted-foreground">· {roleLabel(p.role)} · {p.branch_name ?? "—"}</span></span>
                <span className="block text-[11px] text-red-600">{p.whyNot}</span>
                <Badges p={p} />
              </span>
              <ChevronLeft className="mt-1 size-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

function RankRow({ p, i, open }: { p: Person; i: number; open: OpenFn }) {
  const g = grade(p.final);
  const d = p.prev != null && p.final != null ? p.final - p.prev : null;
  const how = p.role === "manager"
    ? `قيّموه ${new Set(p.others.map((e) => e.evaluator_id)).size} من ${p.team.length}`
    : `اتقيّم ${p.presentDays} يوم`;
  return (
    <button type="button" onClick={() => open({ t: "person", id: p.id })} className="w-full border-b py-2 text-right last:border-0 active:bg-muted/40">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${i < 3 ? "bg-gold-gradient text-primary-foreground" : "bg-muted"}`}>{i + 1}</span>
          <span className="min-w-0">
            <span className="block truncate font-bold">{p.name}</span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {roleLabel(p.role)} · {p.branch_name ?? "—"} · {how}{p.absences.length ? ` · غاب ${p.absences.length}` : ""}
            </span>
          </span>
        </span>
        <span className="shrink-0 text-left">
          <span className={`block text-xl font-bold ${g.text}`}>{f1(p.final)}</span>
          <span className="flex items-center justify-end gap-0.5 text-[11px]">
            {d != null && Math.abs(d) >= 0.1 && (d > 0
              ? <span className="flex items-center text-emerald-600"><TrendingUp className="size-3" />{f1(d)}</span>
              : <span className="flex items-center text-red-600"><TrendingDown className="size-3" />{f1(-d)}</span>)}
            <span className="mr-1 text-muted-foreground">{g.label}</span>
          </span>
        </span>
      </div>
      <Badges p={p} />
      <Bar v={p.final} className="mt-1.5 h-1.5" />
    </button>
  );
}

/**
 * مين اتقيّم ومين لا: شريط الأيام (كل يوم بلونه: الكل / بعضهم / ما حد)، واليوم المختار يوري كل فرع —
 * كل موظف ✅ بدرجته ولا 🚫 غايب ولا ❌ ما اتقيّمش، والمشرف كم واحد قيّم. تحت «الشهر» العدد الكامل.
 */
export function WhoEvaluated({ b, open, onRecord }: { b: Board; open: OpenFn; onRecord: () => void }) {
  const [day, setDay] = useState<string | null>(() => (b.dayStats.length ? b.dayStats[b.dayStats.length - 1].day : null));
  const dayEvals = b.monthEvals.filter((e) => e.kind === "by_manager" && day != null && per(e) === day);
  const stat = b.dayStats.find((x) => x.day === day);
  const statusOf = (p: Person) => {
    const es = dayEvals.filter((e) => e.subject_id === p.id);
    const ok = es.filter((e) => !e.absent);
    if (ok.length) return { s: "ok" as const, v: avg(ok.map((e) => e.overall)), reason: null };
    if (es.length) return { s: "absent" as const, v: null, reason: es[0].absence_reason ?? null };
    return { s: "none" as const, v: null, reason: null };
  };
  const missing = b.people.filter((p) => p.role !== "manager" && p.manager && statusOf(p).s === "none");
  const isToday = day === b.today;
  /** صف ناقص: أحمر لو اليوم خلص، أصفر لو هو اليوم (لسه مفتوح). */
  const tint = (bad: boolean) => (!bad ? "" : isToday ? "bg-amber-50/60 dark:bg-amber-950/20" : "bg-red-50/60 dark:bg-red-950/20");
  const ratio = (n: number) => {
    const r = b.elapsed ? n / b.elapsed : 0;
    return r >= 0.85 ? "text-emerald-600" : r >= 0.5 ? "text-amber-600" : "text-red-600";
  };

  return (
    <Card className="space-y-3 p-3">
      <h2 className="text-lg font-bold">مين اتقيّم ومين لا — {monthLabel(b.month)}</h2>
      {b.dayStats.length > 0 ? (
        <>
          <p className="text-xs text-muted-foreground">كل مربّع يوم: كم موظف اتقيّم من مشرفه (ولا اتسجّل غايب) من اللي لازم. 🟩 الكل · 🟨 بعضهم · 🟥 ما حد · المقطّع: اليوم (لسه مفتوح). اضغط على اليوم.</p>
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {[...b.dayStats].reverse().map((x) => {
              const cls = !x.expected ? DAY_CLS.future : x.done >= x.expected ? DAY_CLS.ok
                : x.day === b.today ? (x.done ? DAY_CLS.part : DAY_CLS.today) : x.done > 0 ? DAY_CLS.part : DAY_CLS.miss;
              return (
                <button key={x.day} type="button" onClick={() => setDay(x.day)}
                  className={`flex w-12 shrink-0 flex-col items-center rounded-md border py-1 text-[10px] leading-tight ${cls} ${day === x.day ? "ring-2 ring-primary" : ""}`}>
                  <span>{weekdayOf(x.day)}</span>
                  <span className="text-sm font-bold">{Number(x.day.slice(8))}</span>
                  <span className="tabular-nums">{x.done}/{x.expected}</span>
                </button>
              );
            })}
          </div>
          {day && stat && (
            <div className={`rounded-lg p-2 text-sm ${!missing.length ? "bg-emerald-500/10" : isToday ? "bg-amber-500/10" : "bg-red-500/10"}`}>
              <b>{dayLabel(day, b.today)}:</b> اتقيّم {stat.done - stat.absent}{stat.absent ? ` · غايب ${stat.absent}` : ""} — من {stat.expected}
              {missing.length
                ? <span className={`block font-semibold ${isToday ? "text-amber-700 dark:text-amber-300" : "text-red-700 dark:text-red-300"}`}>{isToday ? "لين توا ما اتقيّموش" : "ما اتقيّموش"}: {missing.map((p) => p.name).join("، ")}</span>
                : <span className="block font-semibold text-emerald-700 dark:text-emerald-300">الكل اتقيّم ✅</span>}
            </div>
          )}
        </>
      ) : <p className="text-sm text-muted-foreground">الشهر هذا ما بداش.</p>}

      {b.branches.map((br) => (
        <div key={br.name} className="overflow-x-auto">
          <button type="button" onClick={() => open({ t: "branch", name: br.name })}
            className="mb-1 flex w-full flex-wrap items-baseline justify-between gap-x-2 text-right active:bg-muted/40">
            <span className="text-sm font-bold text-primary">{br.name}</span>
            <span className="text-[11px] text-muted-foreground">
              {br.managers.length ? br.managers.map((m) => (m.duty?.closed ? `${m.name} قيّم كل موظفينه ${m.duty.full}/${m.duty.closed} يوم` : m.name)).join(" · ") : "ما فيش مشرف"}
            </span>
          </button>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-muted-foreground">
                <th className="py-1 text-right font-normal">الاسم</th>
                <th className="px-1 font-normal">{day ? dayLabel(day, b.today) : "اليوم"}</th>
                <th className="px-1 font-normal">الشهر</th>
              </tr>
            </thead>
            <tbody>
              {br.managers.map((m) => {
                const n = m.team.length;
                const k = new Set(dayEvals.filter((e) => e.evaluator_id === m.id).map((e) => e.subject_id)).size;
                const bad = day != null && n > 0 && k < n;
                return (
                  <tr key={m.id} onClick={() => open({ t: "person", id: m.id })} className={`cursor-pointer border-t active:bg-muted/40 ${tint(bad)}`}>
                    <td className="py-1.5">
                      <span className="font-semibold">{m.name}</span><span className="block text-[11px] text-muted-foreground">مشرف</span>
                      {m.phone && <FlagBadge flag={m.phone} />}
                    </td>
                    <td className="text-center">
                      {!n || !day ? <span className="text-muted-foreground">—</span>
                        : <span className={`font-bold tabular-nums ${k >= n ? "text-emerald-600" : k || isToday ? "text-amber-600" : "text-red-600"}`}>قيّم {k}/{n}</span>}
                    </td>
                    <td className="text-center leading-tight">
                      {m.duty && m.duty.closed > 0 ? (
                        <>
                          <span className={`block font-bold tabular-nums ${m.duty.level === "red" ? "text-red-600" : m.duty.level === "amber" ? "text-amber-600" : "text-emerald-600"}`}>كاملين {m.duty.full}/{m.duty.closed}</span>
                          {m.duty.skipped > 0 && <span className="block text-[10px] text-red-600">فوّت {m.duty.skipped} يوم</span>}
                        </>
                      ) : <span className="block text-muted-foreground">—</span>}
                      {n > 0 && b.weeks.some((h) => h.started) && (
                        <span className="block text-[10px] text-muted-foreground">
                          موظفينه قيّموه كل أسبوع: {b.weeks.filter((h) => h.started).map((h) => `${new Set(m.others.filter((e) => e.kind === "of_manager" && wk(e) === h.key).map((e) => e.evaluator_id)).size}/${n}`).join(" · ")}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {br.staff.map((p) => {
                const st = statusOf(p);
                const bad = day != null && !!p.manager && st.s === "none";
                return (
                  <tr key={p.id} onClick={() => open({ t: "person", id: p.id })} className={`cursor-pointer border-t active:bg-muted/40 ${tint(bad)}`}>
                    <td className="py-1.5"><span className="font-semibold">{p.name}</span>{p.flag && <span className="block"><FlagBadge flag={p.flag} /></span>}</td>
                    <td className="text-center leading-tight">
                      {!p.manager || !day ? <span className="text-muted-foreground">—</span>
                        : st.s === "ok" ? <span className={`font-bold ${grade(st.v).text}`}>✅ {f1(st.v)}</span>
                        : st.s === "absent" ? <span className="font-bold text-red-600">🚫 غايب{st.reason && <span className="block text-[10px] font-normal">{st.reason}</span>}</span>
                        : isToday ? <span className="font-bold text-amber-600">⏳ لين توا</span>
                        : <span className="font-bold text-red-600">❌ لا</span>}
                    </td>
                    <td className="text-center leading-tight">
                      {!p.manager ? <span className="text-[11px] text-muted-foreground">ما فيش مشرف</span> : (
                        <>
                          <span className={`block font-bold tabular-nums ${ratio(p.presentDays + p.absences.length)}`}>{p.presentDays}/{b.elapsed} يوم</span>
                          {p.absences.length > 0 && <span className="block text-[10px] text-red-600">غاب {p.absences.length}</span>}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
      {missing.length > 0 && (
        <Button size="sm" variant="outline" onClick={onRecord}><Plus className="size-4" />سجّل تقييم عن واحد ناقص</Button>
      )}
    </Card>
  );
}

/** التقييم الذاتي لوحده: نفسه مقابل غيره، والفرق، وعلامة على اللي عطى نفسه 5 كاملة. */
export function SelfCompare({ b, open }: { b: Board; open: OpenFn }) {
  const started = b.halves.filter((h) => h.started);
  const did = (p: Person, key: string) => p.selfs.some((e) => per(e) === key);
  const gapOf = (p: Person) => (p.self != null && p.final != null ? p.self - p.final : null);
  const rank = (p: Person) => (p.flag?.level === "red" ? 0 : p.flag ? 1 : p.self != null ? 2 : 3);
  const rows = [...b.people].sort((x, y) => rank(x) - rank(y) || (gapOf(y) ?? -9) - (gapOf(x) ?? -9) || x.name.localeCompare(y.name, "ar"));
  const noself = b.people.filter((p) => started.some((h) => !did(p, h.key)));
  return (
    <Card className="space-y-2 p-3">
      <h2 className="text-lg font-bold">التقييم الذاتي — لوحده للمقارنة</h2>
      <p className="text-xs leading-relaxed text-muted-foreground">
        كيف قيّم كل واحد نفسه مقابل تقييم غيره ليه (المشرف للموظف، والموظفين للمشرف). <b>ما يدخلش في الدرجة ولا الترتيب.</b>{" "}
        <span className="font-semibold text-red-600">⚠️ أحمر</span>: قيّم نفسه 5 في كل البنود وغيره عطاه أقل بوضوح ·{" "}
        <span className="font-semibold text-amber-600">⚠️ أصفر</span>: قيّم نفسه 5 كاملة، ولا أعلى من غيره بنقطة أو أكثر.
      </p>
      {started.length > 0 && (
        <button type="button" onClick={() => open({ t: "list", which: "noself" })}
          className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-muted/50 p-2 text-right text-xs active:bg-muted">
          {started.map((h) => <span key={h.key}>النص {h.label}: قيّموا نفسهم <b>{b.people.filter((p) => did(p, h.key)).length}/{b.people.length}</b></span>)}
          {noself.length > 0 && <span className="font-semibold text-red-600">ناقص {noself.length} — اضغط تشوفهم</span>}
        </button>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] text-muted-foreground">
            <th className="py-1 text-right font-normal">الاسم</th>
            <th className="px-1 font-normal">نفسه</th>
            <th className="px-1 font-normal">من غيره</th>
            <th className="px-1 font-normal">الفرق</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const gap = gapOf(p);
            return (
              <tr key={p.id} onClick={() => open({ t: "person", id: p.id })}
                className={`cursor-pointer border-t active:bg-muted/40 ${p.flag?.level === "red" ? "bg-red-50/70 dark:bg-red-950/20" : ""}`}>
                <td className="py-1.5">
                  <span className="block font-semibold">{p.name}</span>
                  <span className="block text-[10px] text-muted-foreground">
                    {roleLabel(p.role)}{started.length ? ` · ${started.map((h) => `${h.label} ${did(p, h.key) ? "✅" : "❌"}`).join(" · ")}` : ""}
                  </span>
                  {p.flag && <FlagBadge flag={p.flag} />}
                </td>
                <td className="text-center">
                  <span className={`font-bold ${p.selfAll5 ? "text-red-600" : ""}`}>{f1(p.self)}</span>
                  {p.selfAll5 && <span className="block text-[9px] font-bold text-red-600">5 كاملة</span>}
                </td>
                <td className="text-center"><span className={`font-bold ${grade(p.final).text}`}>{f1(p.final)}</span></td>
                <td className={`text-center font-bold tabular-nums ${gap == null ? "text-muted-foreground" : gap >= 1 ? "text-red-600" : gap >= 0.5 ? "text-amber-600" : gap <= -0.5 ? "text-emerald-600" : "text-muted-foreground"}`}>
                  {gap == null ? "—" : <span dir="ltr">{signed1(gap)}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-[11px] text-muted-foreground">الفرق = تقييمه لنفسه ناقص تقييم غيره ليه: موجب كبير = يشوف روحه أحسن من اللي يشوفوه · سالب = متواضع.</p>
    </Card>
  );
}

export function BranchesCard({ b, open }: { b: Board; open: OpenFn }) {
  return (
    <Card className="p-3">
      <h2 className="mb-2 font-bold">الفروع</h2>
      {!b.branches.length ? <p className="text-sm text-muted-foreground">—</p> : b.branches.map((br) => (
        <button key={br.name} type="button" onClick={() => open({ t: "branch", name: br.name })} className="mb-1 block w-full rounded-md p-1 text-right active:bg-muted/40">
          <span className="flex justify-between text-sm"><span>{br.name}</span><span className={`font-bold ${grade(br.avg).text}`}>{f1(br.avg)}</span></span>
          <Bar v={br.avg} className="h-2" />
          <span className="block text-[11px] text-muted-foreground">
            اتقيّموا {br.rated} من {br.people.length}{br.managers.map((m) => (m.duty?.closed ? ` · ${m.name} قيّم كل موظفينه ${m.duty.full}/${m.duty.closed} يوم` : "")).join("")}
          </span>
        </button>
      ))}
    </Card>
  );
}

export function CriteriaCard({ b, open }: { b: Board; open: OpenFn }) {
  return (
    <Card className="p-3">
      <h2 className="mb-1 font-bold">البنود — الأضعف أول</h2>
      <p className="mb-2 text-[11px] text-muted-foreground">من تقييمهم لبعض بس. وين الفريق يحتاج تدريب ولا متابعة — اضغط على البند تشوف مين أضعف فيه.</p>
      {!b.criteria.length ? <p className="text-sm text-muted-foreground">—</p> : b.criteria.map((c) => (
        <button key={c.key} type="button" onClick={() => open({ t: "crit", key: c.key })} className="mb-1 block w-full rounded-md p-1 text-right active:bg-muted/40">
          <span className="flex justify-between gap-2 text-xs"><span className="truncate">{c.label}</span><span className={`font-bold ${grade(c.avg).text}`}>{f1(c.avg)}</span></span>
          <Bar v={c.avg} />
        </button>
      ))}
    </Card>
  );
}

export function TrendCard({ b }: { b: Board }) {
  if (b.trend.filter((t) => t.avg != null || t.self != null).length < 2) return null;
  return (
    <Card className="p-3">
      <h2 className="mb-2 font-bold">المتوسط العام شهر بشهر</h2>
      <div className="h-48" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={b.trend} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(val: number, k: string) => [f1(val), k === "self" ? "تقييمهم لنفسهم" : "تقييمهم لبعض"]} />
            <Line type="monotone" dataKey="avg" stroke="#C9A227" strokeWidth={3} dot={{ r: 4 }} connectNulls />
            <Line type="monotone" dataKey="self" stroke="#94a3b8" strokeWidth={2} strokeDasharray="4 4" dot={{ r: 2 }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[11px] text-muted-foreground">الذهبي: تقييمهم لبعض (الدرجة) · المقطّع: تقييمهم لنفسهم</p>
    </Card>
  );
}
