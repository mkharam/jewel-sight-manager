// «المقارنة»: كل الفروع جنب بعض، وتحتها موظفين كل فرع مع بعض — المبيعات من أمارسوفت، والربح فوق
// الذهب، وتسجيل اسم ورقم الزبون، وتقييم الموظفين (من تقييمهم لبعض) في سطر واحد لكل موظف.
// الضغط على فرع في الجدول ينزل لموظفينه، والضغط على موظف يفتح تفاصيله تحت سطره.
// الحساب نفسه في teamBlocks.ts (تستعمله صفحة الفرع برضو).
import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { periodDays, type Period } from "@/lib/amarsoft";
import { grade, monthLabel } from "@/lib/evaluation";
import { f1 } from "@/lib/evalBoard";
import { isShared } from "@/lib/teamMatch";
import { Badges, roleLabel } from "@/components/evaluations/bits";
import { abovePct, avgInv, custPct, int, useTeamBlocks, type Block, type Line } from "@/components/team/teamBlocks";

const PERIODS: { key: Period; label: string }[] = [{ key: "week", label: "الأسبوع" }, { key: "month", label: "الشهر" }, { key: "year", label: "السنة" }];

export default function TeamCompare() {
  const [period, setPeriod] = useState<Period>("month");
  const [open, setOpen] = useState<string | null>(null);
  const { from, to } = periodDays(period);
  const { blocks, month, ...q } = useTeamBlocks(from, to);

  const scrollTo = (code: string) => document.getElementById(`br-${code}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
        {PERIODS.map((p) => (
          <button key={p.key} type="button" onClick={() => setPeriod(p.key)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${period === p.key ? "border-primary bg-primary text-primary-foreground" : "bg-card"}`}>
            {p.label}
          </button>
        ))}
        <span className="mr-auto shrink-0 text-[11px] text-muted-foreground">التقييم: {monthLabel(month)}</span>
      </div>

      {q.isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : q.isError ? (
        <Card className="p-4 text-center text-sm text-destructive">تعذّر جلب الأرقام من أمارسوفت — جرّب بعد شوي.</Card>
      ) : (
        <>
          <BranchMatrix blocks={blocks} onPick={scrollTo} />
          {blocks.map((b) => (
            <section key={b.code} id={`br-${b.code}`} className="scroll-mt-24">
              <BranchCard b={b} open={open} setOpen={setOpen} />
            </section>
          ))}
        </>
      )}
    </div>
  );
}

type Metric = { key: string; label: string; get: (b: Block) => number | null; fmt: (v: number, b: Block) => string; lowerBetter?: boolean; neutral?: boolean };
const METRICS: Metric[] = [
  { key: "lyd", label: "المبيعات (ألف د.ل)", get: (b) => b.sales.lyd / 1000, fmt: (v) => int(v) },
  { key: "grams", label: "الوزن (جم)", get: (b) => b.sales.grams, fmt: (v) => int(v) },
  { key: "inv", label: "الفواتير", get: (b) => b.sales.invoices, fmt: (v) => int(v) },
  { key: "avg", label: "وزن الفاتورة", get: (b) => avgInv(b.sales), fmt: (v) => v.toFixed(1) },
  { key: "above", label: "فوق الذهب", get: (b) => abovePct(b.sales), fmt: (v) => `${Math.round(v)}%` },
  { key: "cust", label: "اسم ورقم الزبون", get: (b) => custPct(b.sales), fmt: (v) => `${Math.round(v)}%` },
  { key: "eval", label: "تقييم الموظفين", get: (b) => b.evalAvg, fmt: (v) => f1(v) },
  { key: "duty", label: "المشرف قيّم كاملين", get: (b) => (b.duty && b.duty.closed ? (b.duty.full / b.duty.closed) * 100 : null), fmt: (_v, b) => `${b.duty!.full}/${b.duty!.closed}` },
  { key: "people", label: "الموظفين", get: (b) => b.people, fmt: (v) => int(v), neutral: true },
];

/** الفروع جنب بعض: كل سطر مقياس، وكل عمود فرع — الأحسن أخضر والأضعف أحمر. */
function BranchMatrix({ blocks, onPick }: { blocks: Block[]; onPick: (code: string) => void }) {
  if (!blocks.length) return <Card className="p-4 text-center text-sm text-muted-foreground">ما فيش أرقام في هذي الفترة.</Card>;
  return (
    <Card className="overflow-hidden p-0">
      <p className="px-3 pt-2.5 text-sm font-bold">الفروع جنب بعض</p>
      <p className="px-3 pb-1.5 text-[11px] text-muted-foreground">الأخضر الأحسن والأحمر الأضعف في كل سطر. اضغط على فرع تنزل لموظفينه.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] tabular-nums">
          <thead>
            <tr className="border-t bg-muted/50">
              <th className="sticky right-0 z-10 bg-muted px-2 py-1.5 text-right font-semibold" />
              {blocks.map((b) => (
                <th key={b.code} className="px-1 py-1 text-center font-semibold">
                  <button type="button" onClick={() => onPick(b.code)} className="leading-tight text-primary underline-offset-2 active:underline">
                    <span className="block text-[9px] text-muted-foreground">{b.code}</span>
                    <span className="block whitespace-nowrap">{b.short}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {METRICS.map((m) => {
              const vals = blocks.map((b) => m.get(b));
              const valid = vals.filter((v): v is number => v != null);
              const hi = valid.length > 1 && !m.neutral ? Math.max(...valid) : null;
              const lo = valid.length > 1 && !m.neutral ? Math.min(...valid) : null;
              return (
                <tr key={m.key} className="border-t">
                  <td className="sticky right-0 z-10 whitespace-nowrap bg-card px-2 py-1.5 font-medium">{m.label}</td>
                  {blocks.map((b, i) => {
                    const v = vals[i];
                    const best = v != null && hi !== lo && v === (m.lowerBetter ? lo : hi);
                    const worst = v != null && hi !== lo && v === (m.lowerBetter ? hi : lo);
                    return (
                      <td key={b.code} className={`px-1 py-1.5 text-center font-semibold ${best ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : worst ? "bg-red-500/10 text-red-700 dark:text-red-300" : ""}`}>
                        {v == null ? <span className="text-muted-foreground">—</span> : m.fmt(v, b)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** فرع وموظفينه: سطر لكل واحد فيه الوزن، فوق الذهب، تسجيل الزبون، والتقييم — والضغط يفتح التفاصيل. */
export function BranchCard({ b, open, setOpen, title }: {
  b: Block; open: string | null; setOpen: (k: string | null) => void; title?: string;
}) {
  return (
    <Card className="space-y-1.5 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <h3 className="font-bold">{title ?? b.name}</h3>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {int(b.sales.grams)} جم · {int(b.sales.invoices)} فاتورة{b.evalAvg != null ? ` · التقييم ${f1(b.evalAvg)}` : ""}
        </span>
      </div>
      <table className="w-full text-xs tabular-nums">
        <thead>
          <tr className="text-[10px] text-muted-foreground">
            <th className="py-1 text-right font-normal">الاسم</th>
            <th className="px-1 font-normal">الوزن</th>
            <th className="px-1 font-normal">فوق الذهب</th>
            <th className="px-1 font-normal">الزبون</th>
            <th className="px-1 font-normal">التقييم</th>
          </tr>
        </thead>
        <tbody>
          {b.lines.map((l) => {
            const ev = l.person?.final ?? null;
            const isOpen = open === l.key;
            return (
              <Fragment key={l.key}>
                <tr onClick={() => setOpen(isOpen ? null : l.key)} className={`cursor-pointer border-t active:bg-muted/40 ${l.role === "seller" ? "text-muted-foreground" : ""} ${isOpen ? "bg-muted/40" : ""}`}>
                  <td className="py-1.5">
                    <span className="font-semibold">{l.name}</span>
                    <span className="block text-[10px] text-muted-foreground">
                      {l.role === "seller" ? (isShared(l.name) ? "بيعة مشتركة" : "في أمارسوفت بس") : roleLabel(l.role)}
                      {l.person && !l.sales ? " · ما لقيتش رقمه في أمارسوفت" : ""}
                    </span>
                    {l.person && <Badges p={l.person} />}
                  </td>
                  <td className="px-1 text-center">{l.sales ? int(l.sales.grams) : "—"}</td>
                  <td className="px-1 text-center">{l.sales && abovePct(l.sales) != null ? `${Math.round(abovePct(l.sales)!)}%` : "—"}</td>
                  <td className={`px-1 text-center ${custTone(custPct(l.sales))}`}>{custPct(l.sales) == null ? "—" : `${Math.round(custPct(l.sales)!)}%`}</td>
                  <td className={`px-1 text-center font-bold ${grade(ev).text}`}>{l.person ? f1(ev) : ""}</td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={5} className="pb-2">
                      <LineDetail l={l} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

const custTone = (v: number | null) => (v == null ? "" : v >= 80 ? "text-emerald-600" : v >= 40 ? "text-amber-600" : "text-red-600");

function LineDetail({ l }: { l: Line }) {
  const p = l.person;
  const s = l.sales;
  const cells: [string, string][] = [
    ...(s ? ([
      ["المبيعات", `${int(s.lyd)} د.ل`], ["الفواتير", int(s.invoices)], ["وزن الفاتورة", avgInv(s) == null ? "—" : `${avgInv(s)!.toFixed(1)} جم`],
      ["فوق الذهب", abovePct(s) == null ? "—" : `${Math.round(abovePct(s)!)}%`], ["اسم ورقم الزبون", custPct(s) == null ? "—" : `${Math.round(custPct(s)!)}%`],
    ] as [string, string][]) : []),
    ...(p ? ([
      ["التقييم (من غيره)", f1(p.final)], ["قيّم نفسه", f1(p.self)],
      ...(p.role === "manager" ? [] : ([["أيام اتقيّم", `${p.presentDays}`], ["غاب", `${p.absences.length} يوم`]] as [string, string][])),
    ] as [string, string][]) : []),
  ];
  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-2">
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-3">
        {cells.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2"><span className="text-muted-foreground">{k}</span><b className="tabular-nums">{v}</b></div>
        ))}
      </div>
      {p?.duty && <p className="text-xs">{p.duty.text}</p>}
      {p?.phone && <p className="text-xs font-semibold text-red-600">📱 {p.phone.text}</p>}
      {p?.flag && <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">⚠️ {p.flag.text}</p>}
      {p && !s && <p className="text-[11px] text-muted-foreground">ما لقيتش اسمه بين بائعين أمارسوفت في فرعه — لو يبيع باسم ثاني، اربط حسابه في أمارسوفت.</p>}
      <div className="flex flex-wrap gap-3 text-xs font-semibold">
        {p && <Link to="/team?tab=evaluations" className="text-primary underline">تفاصيل التقييم</Link>}
        {s && <Link to="/team?tab=numbers" className="text-primary underline">أرقام البائع كاملة</Link>}
      </div>
    </div>
  );
}
