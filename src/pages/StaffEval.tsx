// تقييم البائعين المفصّل (للمدير العام فقط): لكل بائع ولكل فرع — الوزن، الفواتير، فواتير ثقيلة
// وخفيفة، سعر الجرام والمصنعية والخصم، القطع المبيعة تحت السعر المعتاد، البيع بلا باركود،
// المرتجعات — وكل رقم مقارن بمتوسط الشركة (أخضر أحسن، أحمر أسوأ). المجاميع من amarsoft_staff_eval.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Loader2, ClipboardList } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { sb, periodDays, daysToRange, type Period } from "@/lib/amarsoft";

type Raw = {
  branch_code: string; branch_name: string; sman: string; salesman_name: string;
  invoices: number; returns: number; return_grams: number; lines: number; pieces: number; grams: number; pure_grams: number;
  light_inv: number; mid_inv: number; heavy_inv: number; max_inv_grams: number;
  amount: number; making: number; discount: number; grams_21: number; untagged_lines: number; low_price_lines: number; active_days: number;
};

/** المقاييس المحسوبة من المجاميع — نفس الدالة للبائع وللفرع وللشركة، فالمقارنة عادلة. */
type M = {
  grams: number; invoices: number; pieces: number; avgInv: number; perDay: number;
  lightPct: number; heavyPct: number; pricePerGram: number; makingPerGram: number; discountPct: number;
  lowPricePct: number; untaggedPct: number; k21Pct: number; returnPct: number; days: number;
  light: number; mid: number; heavy: number; maxInv: number; lowLines: number; returns: number;
};

function sum(rows: Raw[]): Raw {
  const z = { invoices: 0, returns: 0, return_grams: 0, lines: 0, pieces: 0, grams: 0, pure_grams: 0, light_inv: 0, mid_inv: 0, heavy_inv: 0,
    max_inv_grams: 0, amount: 0, making: 0, discount: 0, grams_21: 0, untagged_lines: 0, low_price_lines: 0, active_days: 0 } as Raw;
  for (const r of rows) {
    for (const k of Object.keys(z) as (keyof Raw)[]) {
      if (k === "max_inv_grams") (z as any)[k] = Math.max(Number(z[k]), Number(r[k]));
      else if (typeof (z as any)[k] === "number") (z as any)[k] = Number(z[k]) + Number(r[k] ?? 0);
    }
  }
  return z;
}

function measure(r: Raw): M {
  const n = (v: unknown) => Number(v ?? 0);
  const g = n(r.grams), inv = n(r.invoices), lines = n(r.lines);
  const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);
  return {
    grams: g, invoices: inv, pieces: n(r.pieces), days: n(r.active_days),
    avgInv: inv ? g / inv : 0, perDay: n(r.active_days) ? g / n(r.active_days) : 0,
    light: n(r.light_inv), mid: n(r.mid_inv), heavy: n(r.heavy_inv), maxInv: n(r.max_inv_grams),
    lightPct: pct(n(r.light_inv), inv), heavyPct: pct(n(r.heavy_inv), inv),
    pricePerGram: g ? n(r.amount) / 1000 / g : 0, makingPerGram: g ? n(r.making) / 1000 / g : 0,
    discountPct: pct(n(r.discount), n(r.amount) + n(r.discount)),
    lowLines: n(r.low_price_lines), lowPricePct: pct(n(r.low_price_lines), lines),
    untaggedPct: pct(n(r.untagged_lines), lines), k21Pct: pct(n(r.grams_21), g),
    returns: n(r.returns), returnPct: pct(n(r.returns), inv + n(r.returns)),
  };
}

const PERIODS: { key: Period; label: string }[] = [
  { key: "week", label: "الأسبوع" }, { key: "month", label: "الشهر" }, { key: "year", label: "السنة" },
];
type SortKey = "grams" | "avgInv" | "pricePerGram" | "makingPerGram" | "lowPricePct" | "discountPct";
const SORTS: { key: SortKey; label: string; asc?: boolean }[] = [
  { key: "grams", label: "الوزن" },
  { key: "avgInv", label: "وزن الفاتورة" },
  { key: "pricePerGram", label: "سعر الجرام" },
  { key: "makingPerGram", label: "المصنعية" },
  { key: "lowPricePct", label: "تحت السعر", asc: true },
  { key: "discountPct", label: "الخصم", asc: true },
];

const f = (v: number, d = 0) => v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 });

/** خلية مقياس مع مقارنة بالمتوسط: higherBetter يحدد اللون. */
function Stat({ label, value, avg, unit = "", d = 0, higherBetter = true, hint }: {
  label: string; value: number; avg?: number; unit?: string; d?: number; higherBetter?: boolean; hint?: string;
}) {
  let tone = "", arrow = "";
  if (avg !== undefined && avg > 0 && value > 0) {
    const diff = (value - avg) / avg;
    if (Math.abs(diff) >= 0.05) {
      const good = higherBetter ? diff > 0 : diff < 0;
      tone = good ? "text-green-600" : "text-red-600";
      arrow = diff > 0 ? "▲" : "▼";
    }
  }
  return (
    <div className="rounded-lg bg-muted/40 p-2" title={hint}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`font-bold tabular-nums ${tone}`}>{f(value, d)}{unit && <span className="text-xs font-normal"> {unit}</span>} {arrow && <span className="text-[10px]">{arrow}</span>}</div>
      {avg !== undefined && <div className="text-[10px] text-muted-foreground tabular-nums">المتوسط {f(avg, d)}</div>}
    </div>
  );
}

function MixBar({ m }: { m: M }) {
  const t = m.light + m.mid + m.heavy || 1;
  return (
    <div className="space-y-1">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
        <div className="bg-sky-400" style={{ width: `${(m.light / t) * 100}%` }} />
        <div className="bg-amber-400" style={{ width: `${(m.mid / t) * 100}%` }} />
        <div className="bg-primary" style={{ width: `${(m.heavy / t) * 100}%` }} />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>خفيفة (&lt;5 جم): {m.light}</span><span>متوسطة: {m.mid}</span><span>ثقيلة (20+ جم): {m.heavy}</span>
      </div>
    </div>
  );
}

function Card2({ title, sub, m, avg }: { title: string; sub?: string; m: M; avg: M }) {
  const notes: string[] = [];
  if (avg.lowPricePct > 0 && m.lowPricePct > avg.lowPricePct * 1.5 && m.lowLines >= 2) notes.push(`باع ${m.lowLines} قطعة بسعر جرام تحت المعتاد`);
  if (m.discountPct > avg.discountPct * 1.5 && m.discountPct > 1) notes.push("خصومات أعلى من الباقين");
  if (m.untaggedPct > Math.max(avg.untaggedPct * 1.5, 10)) notes.push("نسبة كبيرة من بيعه بلا باركود (كود عام)");
  if (m.returnPct > Math.max(avg.returnPct * 1.5, 5)) notes.push("مرتجعات أكثر من المعتاد");
  if (m.avgInv > avg.avgInv * 1.3) notes.push("يبيع قطع أثقل من الباقين 👏");
  if (m.pricePerGram > avg.pricePerGram * 1.05) notes.push("يبيع الجرام بسعر أعلى من المتوسط 👏");
  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-bold">{title}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </div>
      <div className="grid grid-cols-3 gap-1.5 text-sm">
        <Stat label="الوزن" value={m.grams} unit="جم" d={1} />
        <Stat label="الفواتير" value={m.invoices} />
        <Stat label="وزن الفاتورة" value={m.avgInv} avg={avg.avgInv} unit="جم" d={1} />
        <Stat label="سعر الجرام" value={m.pricePerGram} avg={avg.pricePerGram} unit="د.ل" hint="قيمة المبيعات ÷ الوزن" />
        <Stat label="المصنعية للجرام" value={m.makingPerGram} avg={avg.makingPerGram} unit="د.ل" />
        <Stat label="الخصم" value={m.discountPct} avg={avg.discountPct} unit="%" d={1} higherBetter={false} />
        <Stat label="تحت السعر المعتاد" value={m.lowPricePct} avg={avg.lowPricePct} unit="%" d={0} higherBetter={false}
          hint="قطع سعر جرامها أقل من 95% من وسيط نفس الصنف في الفرع" />
        <Stat label="بلا باركود" value={m.untaggedPct} avg={avg.untaggedPct} unit="%" d={0} higherBetter={false} />
        <Stat label="وزن لكل يوم بيع" value={m.perDay} avg={avg.perDay} unit="جم" d={1} />
      </div>
      <MixBar m={m} />
      <div className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground tabular-nums">
        <span>{f(m.pieces)} قطعة</span><span>{m.days} يوم بيع</span><span>أثقل فاتورة {f(m.maxInv, 1)} جم</span>
        <span>عيار 21: {f(m.k21Pct)}%</span>{m.returns > 0 && <span className="text-amber-600">{m.returns} مرتجع</span>}
      </div>
      {notes.length > 0 && <ul className="text-xs space-y-0.5">{notes.map((n) => <li key={n}>• {n}</li>)}</ul>}
    </Card>
  );
}

export default function StaffEval() {
  const [period, setPeriod] = useState<Period>("month");
  const [branch, setBranch] = useState<string>("all");
  const [view, setView] = useState<"staff" | "branches">("staff");
  const [sortBy, setSortBy] = useState<SortKey>("grams");

  const q = useQuery({
    queryKey: ["staff-eval", period],
    queryFn: async () => {
      const { from, to } = periodDays(period);
      const { start, end } = daysToRange(from, to);
      const { data, error } = await sb.rpc("amarsoft_staff_eval", { p_start: start, p_end: end, p_branch: null });
      if (error) throw error;
      return (data ?? []) as Raw[];
    },
  });

  const rows = q.data ?? [];
  const company = useMemo(() => measure(sum(rows)), [rows]);
  const branches = useMemo(() => {
    const map = new Map<string, Raw[]>();
    rows.forEach((r) => map.set(r.branch_code, [...(map.get(r.branch_code) ?? []), r]));
    return [...map.entries()].map(([code, rs]) => ({ code, name: rs[0].branch_name, m: measure(sum(rs)), staff: rs.length }));
  }, [rows]);
  const sortFn = (a: M, b: M) => {
    const o = SORTS.find((s) => s.key === sortBy)!;
    return o.asc ? a[sortBy] - b[sortBy] : b[sortBy] - a[sortBy];
  };
  const staff = rows.filter((r) => branch === "all" || r.branch_code === branch)
    .map((r) => ({ r, m: measure(r) })).sort((a, b) => sortFn(a.m, b.m));

  return (
    <div className="max-w-3xl mx-auto space-y-4" dir="rtl">
      <div className="flex items-center gap-2">
        <Link to="/leaderboard"><ArrowRight className="size-5" /></Link>
        <ClipboardList className="size-6 text-primary" />
        <h1 className="text-2xl font-bold">تقييم البائعين والفروع</h1>
      </div>
      <p className="text-xs text-muted-foreground">كل رقم مقارن بمتوسط الشركة في نفس الفترة: الأخضر أحسن من المتوسط، والأحمر أسوأ (فرق 5% أو أكثر).</p>

      <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
        <TabsList className="grid grid-cols-3 w-full">{PERIODS.map((p) => <TabsTrigger key={p.key} value={p.key}>{p.label}</TabsTrigger>)}</TabsList>
      </Tabs>

      <div className="flex gap-2">
        <Button size="sm" variant={view === "staff" ? "default" : "outline"} onClick={() => setView("staff")}>البائعين</Button>
        <Button size="sm" variant={view === "branches" ? "default" : "outline"} onClick={() => setView("branches")}>الفروع</Button>
      </div>

      {view === "staff" && (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
            <Button size="sm" variant={branch === "all" ? "default" : "outline"} className="shrink-0" onClick={() => setBranch("all")}>كل الفروع</Button>
            {branches.map((b) => (
              <Button key={b.code} size="sm" variant={branch === b.code ? "default" : "outline"} className="shrink-0" onClick={() => setBranch(b.code)}>{b.name}</Button>
            ))}
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
            <span className="text-xs text-muted-foreground shrink-0">رتّب بـ:</span>
            {SORTS.map((s) => (
              <Button key={s.key} size="sm" variant={sortBy === s.key ? "default" : "outline"} className="shrink-0 h-8 text-xs" onClick={() => setSortBy(s.key)}>{s.label}</Button>
            ))}
          </div>
        </>
      )}

      {q.isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : q.error ? (
        <Card className="p-6 text-center text-sm text-destructive">تعذّر التحميل: {(q.error as Error).message}</Card>
      ) : !rows.length ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">لا توجد فواتير بأسماء البائعين في هذه الفترة.</Card>
      ) : view === "branches" ? (
        <div className="space-y-2">
          <Card2 title="كل الشركة" m={company} avg={company} />
          {branches.sort((a, b) => b.m.grams - a.m.grams).map((b) => (
            <Card2 key={b.code} title={b.name} sub={`${b.staff} بائع`} m={b.m} avg={company} />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {staff.map(({ r, m }, i) => (
            <Card2 key={`${r.branch_code}-${r.sman}`} title={`${i + 1}. ${r.salesman_name}`} sub={r.branch_name} m={m} avg={company} />
          ))}
        </div>
      )}
    </div>
  );
}
