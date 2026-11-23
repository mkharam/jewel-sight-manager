// «المقارنة»: كل الفروع جنب بعض، وتحتها موظفين كل فرع مع بعض — المبيعات من أمارسوفت، والربح فوق
// الذهب، وتسجيل اسم ورقم الزبون، وتقييم الموظفين (من تقييمهم لبعض) في سطر واحد لكل موظف.
// الضغط على فرع في الجدول ينزل لموظفينه، والضغط على موظف يفتح تفاصيله تحت سطره.
// موظف التقييم يتربط ببائع أمارسوفت بحسابه في التطبيق ولا باسمه في نفس الفرع (راجع lib/teamMatch).
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { sb, periodDays, daysToRange, type Period } from "@/lib/amarsoft";
import { businessToday } from "@/lib/dates";
import { db, grade, monthLabel, monthStart, type EvalStaff, type Evaluation } from "@/lib/evaluation";
import { buildBoard, f1, type Duty, type Person } from "@/lib/evalBoard";
import { isShared, matchPeople } from "@/lib/teamMatch";
import { Badges, roleLabel } from "@/components/evaluations/bits";

type EvalRow = { branch_code: string; branch_name: string; sman: string; salesman_name: string; invoices: number; grams: number; amount: number };
type GoldRow = { branch_code: string; sman: string; valued_grams: number; amount_lyd: number; gold_lyd: number };
type CapRow = { branch_code: string; sman: string; invoices: number; with_both: number };
type Seller = { branch_code: string; sman: string; name: string; profile_id: string | null };

type Sales = { grams: number; invoices: number; lyd: number; goldLyd: number; valuedLyd: number; capInv: number; capBoth: number };
const noSales = (): Sales => ({ grams: 0, invoices: 0, lyd: 0, goldLyd: 0, valuedLyd: 0, capInv: 0, capBoth: 0 });
const plus = (a: Sales, b: Sales): Sales => ({
  grams: a.grams + b.grams, invoices: a.invoices + b.invoices, lyd: a.lyd + b.lyd, goldLyd: a.goldLyd + b.goldLyd,
  valuedLyd: a.valuedLyd + b.valuedLyd, capInv: a.capInv + b.capInv, capBoth: a.capBoth + b.capBoth,
});
const abovePct = (s: Sales | null) => (s && s.goldLyd > 0 ? (s.valuedLyd / s.goldLyd - 1) * 100 : null);
const custPct = (s: Sales | null) => (s && s.capInv > 0 ? (s.capBoth / s.capInv) * 100 : null);
const avgInv = (s: Sales | null) => (s && s.invoices > 0 ? s.grams / s.invoices : null);
const num = (v: unknown) => Number(v ?? 0);
const int = (v: number | null) => (v == null ? "—" : Math.round(v).toLocaleString("en-US"));

type Line = { key: string; name: string; role: "manager" | "employee" | "seller"; sales: Sales | null; person: Person | null };
type Block = { code: string; name: string; short: string; lines: Line[]; sales: Sales; evalAvg: number | null; duty: Duty | null; people: number };

const PERIODS: { key: Period; label: string }[] = [{ key: "week", label: "الأسبوع" }, { key: "month", label: "الشهر" }, { key: "year", label: "السنة" }];

/** «01 - حي الأندلس» ← «الأندلس». */
const shortName = (name: string) => (name.split(" - ")[1] ?? name).replace(/^حي\s+/, "");

export default function TeamCompare() {
  const [period, setPeriod] = useState<Period>("month");
  const [open, setOpen] = useState<string | null>(null);
  const today = businessToday();
  const month = monthStart(today);

  const q = useQuery({
    queryKey: ["team-compare", period, month],
    queryFn: async () => {
      const { from, to } = periodDays(period);
      const r = daysToRange(from, to);
      const [ev, gold, cap, smen, br, staff, evals] = await Promise.all([
        sb.rpc("amarsoft_staff_eval", { p_start: r.start, p_end: r.end, p_branch: null }),
        sb.rpc("amarsoft_staff_eval_gold", { p_start: r.start, p_end: r.end, p_branch: null }),
        sb.rpc("amarsoft_customer_capture", { p_start: r.start, p_end: r.end }),
        sb.from("amarsoft_salesmen").select("branch_code,sman,name,profile_id"),
        sb.from("branches").select("id,code,name").eq("is_active", true),
        db.from("eval_staff").select("*, branch:branches(name)").order("name"),
        db.from("staff_evaluations").select("*").eq("month", month),
      ]);
      if (ev.error) throw ev.error;
      return {
        rows: (ev.data ?? []) as EvalRow[],
        gold: (gold.error ? [] : gold.data ?? []) as GoldRow[],
        cap: (cap.error ? [] : cap.data ?? []) as CapRow[],
        sellers: (smen.error ? [] : smen.data ?? []) as Seller[],
        branches: (br.data ?? []) as { id: string; code: string; name: string }[],
        staff: ((staff.data ?? []) as (EvalStaff & { branch: { name: string } | null })[]).map((s) => ({ ...s, branch_name: s.branch?.name ?? null })),
        evals: (evals.data ?? []) as Evaluation[],
      };
    },
  });

  const blocks = useMemo<Block[]>(() => {
    const d = q.data;
    if (!d) return [];
    const codeOf = new Map(d.branches.map((b) => [b.id, b.code]));
    const nameOf = new Map(d.branches.map((b) => [b.code, b.name]));
    const k = (b: string, s: string) => `${b}|${s}`;

    // المبيعات لكل بائع (فرع|رقم)
    const sales = new Map<string, Sales>();
    const sellerName = new Map<string, string>();
    for (const r of d.rows) {
      const key = k(r.branch_code, r.sman);
      sellerName.set(key, r.salesman_name);
      if (!nameOf.has(r.branch_code)) nameOf.set(r.branch_code, r.branch_name);
      sales.set(key, plus(sales.get(key) ?? noSales(), { ...noSales(), grams: num(r.grams), invoices: num(r.invoices), lyd: num(r.amount) / 1000 }));
    }
    for (const g of d.gold) {
      const key = k(g.branch_code, g.sman);
      sales.set(key, plus(sales.get(key) ?? noSales(), { ...noSales(), goldLyd: num(g.gold_lyd), valuedLyd: num(g.amount_lyd) }));
    }
    for (const c of d.cap) {
      const key = k(c.branch_code, c.sman);
      sales.set(key, plus(sales.get(key) ?? noSales(), { ...noSales(), capInv: num(c.invoices), capBoth: num(c.with_both) }));
    }

    // التقييم (الشهر الحالي، من تقييمهم لبعض)
    const board = buildBoard(d.staff, d.evals, month, today);
    const people = board.people.map((p) => ({ id: p.id, name: p.name, branch_code: p.branch_id ? codeOf.get(p.branch_id) ?? null : null, profile_id: p.profile_id ?? null }));
    const sellers = [...new Set([...sales.keys(), ...d.sellers.map((s) => k(s.branch_code, s.sman))])].map((key) => {
      const [branch_code, sman] = key.split("|");
      const row = d.sellers.find((s) => s.branch_code === branch_code && s.sman === sman);
      return { branch_code, sman, name: sellerName.get(key) ?? row?.name ?? sman, profile_id: row?.profile_id ?? null };
    });
    const link = matchPeople(people, sellers);
    const linked = new Set(link.values());

    const codes = [...new Set([...d.branches.map((b) => b.code), ...[...sales.keys()].map((x) => x.split("|")[0])])].sort();
    return codes.map((code) => {
      const lines: Line[] = [];
      for (const p of board.people) {
        if ((p.branch_id ? codeOf.get(p.branch_id) : null) !== code) continue;
        const sk = link.get(p.id);
        lines.push({ key: `p:${p.id}`, name: p.name, role: p.role === "manager" ? "manager" : "employee", sales: sk ? sales.get(sk) ?? noSales() : null, person: p });
      }
      for (const s of sellers) {
        const key = k(s.branch_code, s.sman);
        const sl = sales.get(key);
        if (s.branch_code !== code || linked.has(key) || !sl || (!sl.grams && !sl.invoices)) continue;
        lines.push({ key: `s:${key}`, name: s.name, role: "seller", sales: sl, person: null });
      }
      const rank = (l: Line) => (l.role === "manager" ? 0 : l.role === "employee" ? 1 : 2);
      lines.sort((a, b) => rank(a) - rank(b) || (b.sales?.grams ?? -1) - (a.sales?.grams ?? -1));
      const total = [...sales.entries()].filter(([key]) => key.startsWith(`${code}|`)).reduce((a, [, v]) => plus(a, v), noSales());
      const finals = lines.map((l) => l.person?.final).filter((v): v is number => v != null);
      const mgr = lines.find((l) => l.role === "manager")?.person ?? null;
      const name = nameOf.get(code) ?? code;
      return {
        code, name, short: shortName(name), lines, sales: total,
        evalAvg: finals.length ? finals.reduce((a, b) => a + b, 0) / finals.length : null,
        duty: mgr?.duty ?? null, people: lines.filter((l) => l.person).length,
      };
    }).filter((b) => b.lines.length || b.sales.invoices);
  }, [q.data, month, today]);

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
function BranchCard({ b, open, setOpen }: { b: Block; open: string | null; setOpen: (k: string | null) => void }) {
  return (
    <Card className="space-y-1.5 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <h3 className="font-bold">{b.name}</h3>
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
