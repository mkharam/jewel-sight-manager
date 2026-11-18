// تقييم البائعين المفصّل (للمدير العام فقط): لكل بائع ولكل فرع — الوزن، الفواتير، فواتير ثقيلة
// وخفيفة، سعر الجرام والمصنعية والخصم، القطع المبيعة تحت السعر المعتاد، البيع بلا باركود،
// المرتجعات — وكل رقم مقارن بمتوسط الشركة (أخضر أحسن، أحمر أسوأ). المجاميع من amarsoft_staff_eval.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Loader2, ClipboardList, SlidersHorizontal } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { sb, periodDays, daysToRange, addDays, type Period } from "@/lib/amarsoft";

type Raw = {
  branch_code: string; branch_name: string; sman: string; salesman_name: string;
  invoices: number; returns: number; return_grams: number; lines: number; pieces: number; grams: number; pure_grams: number;
  light_inv: number; mid_inv: number; heavy_inv: number; max_inv_grams: number;
  amount: number; making: number; discount: number; grams_21: number; untagged_lines: number; low_price_lines: number; active_days: number;
};

type Extra = {
  branch_code: string; sman: string; price_index: number | null; typed_grams: number;
  phone_invoices: number; new_customers: number; repeat_customers: number;
  avg_age_days: number | null; old_pieces: number; aged_lines: number;
};

/** دمج المقاييس الإضافية (لفرع أو للشركة: متوسط موزون بالوزن/العدد). */
function sumExtra(rows: Extra[]): Extra {
  const n = (v: unknown) => Number(v ?? 0);
  const tg = rows.reduce((a, r) => a + n(r.typed_grams), 0);
  const al = rows.reduce((a, r) => a + n(r.aged_lines), 0);
  return {
    branch_code: "", sman: "",
    price_index: tg ? rows.reduce((a, r) => a + n(r.price_index) * n(r.typed_grams), 0) / tg : null,
    typed_grams: tg,
    phone_invoices: rows.reduce((a, r) => a + n(r.phone_invoices), 0),
    new_customers: rows.reduce((a, r) => a + n(r.new_customers), 0),
    repeat_customers: rows.reduce((a, r) => a + n(r.repeat_customers), 0),
    avg_age_days: al ? rows.reduce((a, r) => a + n(r.avg_age_days) * n(r.aged_lines), 0) / al : null,
    old_pieces: rows.reduce((a, r) => a + n(r.old_pieces), 0),
    aged_lines: al,
  };
}

/** المقاييس المحسوبة من المجاميع — نفس الدالة للبائع وللفرع وللشركة، فالمقارنة عادلة. */
type M = {
  grams: number; invoices: number; pieces: number; avgInv: number; perDay: number;
  lightPct: number; heavyPct: number; pricePerGram: number; makingPerGram: number; discountPct: number;
  lowPricePct: number; untaggedPct: number; k21Pct: number; returnPct: number; days: number;
  light: number; mid: number; heavy: number; maxInv: number; lowLines: number; returns: number;
  priceIndex: number; phonePct: number; newCust: number; repeatCust: number; avgAge: number; oldPct: number; oldPieces: number;
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

function measure(r: Raw, x?: Extra): M {
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
    priceIndex: n(x?.price_index), phonePct: pct(n(x?.phone_invoices), inv),
    newCust: n(x?.new_customers), repeatCust: n(x?.repeat_customers),
    avgAge: n(x?.avg_age_days), oldPieces: n(x?.old_pieces), oldPct: pct(n(x?.old_pieces), n(x?.aged_lines)),
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

// ===== نقاط التقييم من 100 =====
// كل مقياس يُقارن بمتوسط الشركة: المتوسط = 50، ضعف المتوسط (أو نصفه للمقاييس اللي الأقل فيها أحسن) = 100.
type ScoreKey = "grams" | "priceIndex" | "avgInv" | "discountPct" | "lowPricePct" | "returnPct" | "untaggedPct" | "phonePct" | "oldPct";
const SCORE_PARTS: { key: ScoreKey; label: string; lowerBetter?: boolean; def: number }[] = [
  { key: "grams", label: "الوزن المباع", def: 30 },
  { key: "priceIndex", label: "سعر الجرام (لنفس الصنف)", def: 20 },
  { key: "avgInv", label: "وزن الفاتورة", def: 10 },
  { key: "discountPct", label: "قلة الخصم", lowerBetter: true, def: 10 },
  { key: "lowPricePct", label: "قلة البيع تحت السعر", lowerBetter: true, def: 10 },
  { key: "phonePct", label: "تسجيل رقم الزبون", def: 10 },
  { key: "returnPct", label: "قلة المرتجعات", lowerBetter: true, def: 5 },
  { key: "untaggedPct", label: "قلة البيع بلا باركود", lowerBetter: true, def: 5 },
  { key: "oldPct", label: "بيع البضاعة الراكدة", def: 0 },
];
const WEIGHTS_KEY = "staffEval.weights";
const loadWeights = (): Record<ScoreKey, number> => {
  const d = Object.fromEntries(SCORE_PARTS.map((p) => [p.key, p.def])) as Record<ScoreKey, number>;
  try { return { ...d, ...JSON.parse(localStorage.getItem(WEIGHTS_KEY) ?? "{}") }; } catch { return d; }
};
function scoreOf(m: M, avg: M, w: Record<ScoreKey, number>): number {
  let total = 0, wsum = 0;
  for (const p of SCORE_PARTS) {
    const wt = w[p.key] ?? 0;
    if (!wt) continue;
    const v = m[p.key], a = avg[p.key];
    let s: number;
    if (p.key === "priceIndex") s = v ? Math.max(0, Math.min(100, 50 + (v - 100) * 2.5)) : 50; // كل 1% فوق متوسط الفرع = 2.5 نقطة
    else if (!a) s = 50;
    else if (p.lowerBetter) s = Math.max(0, Math.min(100, 100 - (v / a) * 50));
    else s = Math.max(0, Math.min(100, (v / a) * 50));
    total += s * wt; wsum += wt;
  }
  return wsum ? Math.round(total / wsum) : 0;
}

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

function Card2({ title, sub, m, avg, score, prev, prevScore }: { title: string; sub?: string; m: M; avg: M; score?: number; prev?: M; prevScore?: number }) {
  const notes: string[] = [];
  if (m.priceIndex && m.priceIndex < 92) notes.push(`يبيع نفس الأصناف أرخص من فرعه بـ${f(100 - m.priceIndex)}%`);
  if (m.priceIndex > 108) notes.push(`يبيع نفس الأصناف أغلى من فرعه بـ${f(m.priceIndex - 100)}% 👏`);
  if (m.invoices >= 5 && m.phonePct < Math.min(avg.phonePct * 0.5, 15)) notes.push("نادراً ما يسجل رقم الزبون في الفاتورة");
  if (m.oldPieces >= 3 && m.oldPct > avg.oldPct * 1.3) notes.push(`باع ${m.oldPieces} قطع راكدة (أكثر من 6 شهور في المخزون) 👏`);
  if (avg.lowPricePct > 0 && m.lowPricePct > avg.lowPricePct * 1.5 && m.lowLines >= 2) notes.push(`باع ${m.lowLines} قطعة بسعر جرام تحت المعتاد`);
  if (m.discountPct > avg.discountPct * 1.5 && m.discountPct > 1) notes.push("خصومات أعلى من الباقين");
  if (m.untaggedPct > Math.max(avg.untaggedPct * 1.5, 10)) notes.push("نسبة كبيرة من بيعه بلا باركود (كود عام)");
  if (m.returnPct > Math.max(avg.returnPct * 1.5, 5)) notes.push("مرتجعات أكثر من المعتاد");
  if (m.avgInv > avg.avgInv * 1.3) notes.push("يبيع قطع أثقل من الباقين 👏");
  if (m.pricePerGram > avg.pricePerGram * 1.05) notes.push("يبيع الجرام بسعر أعلى من المتوسط 👏");
  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-bold">{title}</div>
          {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
        </div>
        {score !== undefined && (
          <div className="text-center">
            <div className={`text-2xl font-black tabular-nums ${score >= 60 ? "text-green-600" : score < 40 ? "text-red-600" : ""}`}>{score}</div>
            <div className="text-[10px] text-muted-foreground">من 100
              {prevScore !== undefined && prevScore > 0 && (
                <span className={score > prevScore ? "text-green-600" : score < prevScore ? "text-red-600" : ""}> ({score >= prevScore ? "+" : ""}{score - prevScore})</span>
              )}
            </div>
          </div>
        )}
      </div>
      {prev && prev.grams > 0 && (
        <div className="text-[11px] text-muted-foreground">
          الفترة اللي قبلها: {f(prev.grams, 1)} جم، {f(prev.invoices)} فاتورة —{" "}
          <span className={m.grams >= prev.grams ? "text-green-600" : "text-red-600"}>
            الوزن {m.grams >= prev.grams ? "زاد" : "نقص"} {f(Math.abs(((m.grams - prev.grams) / prev.grams) * 100))}%
          </span>
        </div>
      )}
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
        <Stat label="مؤشر السعر للصنف" value={m.priceIndex} avg={100} d={0}
          hint="سعر جرامه مقارنة بمتوسط فرعه لنفس نوع القطعة: 100 = نفس المتوسط، 110 = أغلى بـ10%" />
        <Stat label="فواتير برقم الزبون" value={m.phonePct} avg={avg.phonePct} unit="%" d={0} />
        <Stat label="زبائن جدد" value={m.newCust} d={0} hint="أول شراء لهم في الفترة (حسب رقم الهاتف في الفاتورة)" />
        <Stat label="عمر القطعة المباعة" value={m.avgAge} avg={avg.avgAge} unit="يوم" d={0}
          hint="متوسط الأيام في المخزون قبل البيع — الأعلى يعني يصرّف البضاعة القديمة" />
        <Stat label="قطع راكدة مباعة" value={m.oldPieces} d={0} hint="قطع قعدت أكثر من 180 يوم قبل ما تنباع" />
        <Stat label="زبائن رجعوا" value={m.repeatCust} d={0} />
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
  const [view, setView] = useState<"staff" | "branches" | "hours">("staff");
  const [sortBy, setSortBy] = useState<SortKey | "score">("score");
  const [weights, setWeights] = useState<Record<ScoreKey, number>>(loadWeights);
  const [editWeights, setEditWeights] = useState(false);
  const saveWeights = (w: Record<ScoreKey, number>) => { setWeights(w); try { localStorage.setItem(WEIGHTS_KEY, JSON.stringify(w)); } catch { /* ignore */ } };

  // الفترة الحالية والتي قبلها بنفس الطول (للمقارنة).
  const ranges = useMemo(() => {
    const { from, to } = periodDays(period);
    const len = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1;
    return { cur: daysToRange(from, to), prev: daysToRange(addDays(from, -len), addDays(from, -1)) };
  }, [period]);
  const fetchAll = async (r: { start: string; end: string }) => {
    const [a, b] = await Promise.all([
      sb.rpc("amarsoft_staff_eval", { p_start: r.start, p_end: r.end, p_branch: null }),
      sb.rpc("amarsoft_staff_eval_extra", { p_start: r.start, p_end: r.end, p_branch: null }),
    ]);
    if (a.error) throw a.error;
    return { rows: (a.data ?? []) as Raw[], extra: (b.data ?? []) as Extra[] };
  };
  const q = useQuery({ queryKey: ["staff-eval", period], queryFn: () => fetchAll(ranges.cur) });
  const qPrev = useQuery({ queryKey: ["staff-eval-prev", period], queryFn: () => fetchAll(ranges.prev) });
  const heat = useQuery({
    queryKey: ["sales-heatmap", period, branch],
    enabled: view === "hours",
    queryFn: async () => {
      const { data, error } = await sb.rpc("amarsoft_sales_heatmap", { p_start: ranges.cur.start, p_end: ranges.cur.end, p_branch: branch === "all" ? null : branch });
      if (error) throw error;
      return (data ?? []) as { dow: number; hour: number; invoices: number; grams: number }[];
    },
  });

  const rows = q.data?.rows ?? [];
  const extra = q.data?.extra ?? [];
  const keyOf = (r: { branch_code: string; sman: string }) => `${r.branch_code}|${r.sman}`;
  const extraBy = useMemo(() => new Map(extra.map((x) => [keyOf(x), x])), [extra]);
  const company = useMemo(() => measure(sum(rows), sumExtra(extra)), [rows, extra]);

  const prevRows = qPrev.data?.rows ?? [];
  const prevExtra = qPrev.data?.extra ?? [];
  const prevCompany = useMemo(() => measure(sum(prevRows), sumExtra(prevExtra)), [prevRows, prevExtra]);
  const prevBy = useMemo(() => {
    const ex = new Map(prevExtra.map((x) => [keyOf(x), x]));
    return new Map(prevRows.map((r) => {
      const m = measure(r, ex.get(keyOf(r)));
      return [keyOf(r), { m, score: scoreOf(m, prevCompany, weights) }];
    }));
  }, [prevRows, prevExtra, prevCompany, weights]);

  const branches = useMemo(() => {
    const map = new Map<string, Raw[]>();
    rows.forEach((r) => map.set(r.branch_code, [...(map.get(r.branch_code) ?? []), r]));
    return [...map.entries()].map(([code, rs]) => {
      const m = measure(sum(rs), sumExtra(extra.filter((x) => x.branch_code === code)));
      const pr = prevRows.filter((r) => r.branch_code === code);
      const pm = pr.length ? measure(sum(pr), sumExtra(prevExtra.filter((x) => x.branch_code === code))) : undefined;
      return { code, name: rs[0].branch_name, m, staff: rs.length, score: scoreOf(m, company, weights), prev: pm, prevScore: pm ? scoreOf(pm, prevCompany, weights) : undefined };
    });
  }, [rows, extra, prevRows, prevExtra, company, prevCompany, weights]);

  const staff = rows.filter((r) => branch === "all" || r.branch_code === branch)
    .map((r) => {
      const m = measure(r, extraBy.get(keyOf(r)));
      const p = prevBy.get(keyOf(r));
      return { r, m, score: scoreOf(m, company, weights), prev: p?.m, prevScore: p?.score };
    })
    .sort((a, b) => {
      if (sortBy === "score") return b.score - a.score;
      const o = SORTS.find((x) => x.key === sortBy)!;
      return o.asc ? a.m[sortBy] - b.m[sortBy] : b.m[sortBy] - a.m[sortBy];
    });

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
        <Button size="sm" variant={view === "hours" ? "default" : "outline"} onClick={() => setView("hours")}>أوقات البيع</Button>
        <span className="flex-1" />
        <Button size="sm" variant={editWeights ? "default" : "ghost"} onClick={() => setEditWeights(!editWeights)}>
          <SlidersHorizontal className="size-4 ml-1" /> أوزان النقاط
        </Button>
      </div>

      {editWeights && (
        <Card className="p-3 space-y-2">
          <p className="text-xs text-muted-foreground">قدّاش يأثر كل مقياس في نقاط التقييم (من 0 إلى 50). المتوسط = 50 نقطة، والأحسن من المتوسط فوقها.</p>
          {SCORE_PARTS.map((p) => (
            <label key={p.key} className="flex items-center gap-2 text-sm">
              <span className="w-40 shrink-0">{p.label}</span>
              <input type="range" min={0} max={50} step={5} value={weights[p.key] ?? 0} className="flex-1 accent-primary"
                onChange={(e) => saveWeights({ ...weights, [p.key]: Number(e.target.value) })} />
              <span className="w-8 text-center tabular-nums">{weights[p.key] ?? 0}</span>
            </label>
          ))}
          <Button size="sm" variant="outline" onClick={() => saveWeights(Object.fromEntries(SCORE_PARTS.map((p) => [p.key, p.def])) as Record<ScoreKey, number>)}>الافتراضي</Button>
        </Card>
      )}

      {(view === "staff" || view === "hours") && (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
            <Button size="sm" variant={branch === "all" ? "default" : "outline"} className="shrink-0" onClick={() => setBranch("all")}>كل الفروع</Button>
            {branches.map((b) => (
              <Button key={b.code} size="sm" variant={branch === b.code ? "default" : "outline"} className="shrink-0" onClick={() => setBranch(b.code)}>{b.name}</Button>
            ))}
          </div>
          {view === "staff" && <div className="flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
            <span className="text-xs text-muted-foreground shrink-0">رتّب بـ:</span>
            <Button size="sm" variant={sortBy === "score" ? "default" : "outline"} className="shrink-0 h-8 text-xs" onClick={() => setSortBy("score")}>النقاط</Button>
            {SORTS.map((s) => (
              <Button key={s.key} size="sm" variant={sortBy === s.key ? "default" : "outline"} className="shrink-0 h-8 text-xs" onClick={() => setSortBy(s.key)}>{s.label}</Button>
            ))}
          </div>}
        </>
      )}

      {q.isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : q.error ? (
        <Card className="p-6 text-center text-sm text-destructive">تعذّر التحميل: {(q.error as Error).message}</Card>
      ) : !rows.length ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">لا توجد فواتير بأسماء البائعين في هذه الفترة.</Card>
      ) : view === "hours" ? (
        <Heatmap data={heat.data} loading={heat.isLoading} />
      ) : view === "branches" ? (
        <div className="space-y-2">
          <Card2 title="كل الشركة" m={company} avg={company} prev={prevCompany} />
          {[...branches].sort((a, b) => b.score - a.score).map((b) => (
            <Card2 key={b.code} title={b.name} sub={`${b.staff} بائع`} m={b.m} avg={company} score={b.score} prev={b.prev} prevScore={b.prevScore} />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {staff.map(({ r, m, score, prev, prevScore }, i) => (
            <Card2 key={`${r.branch_code}-${r.sman}`} title={`${i + 1}. ${r.salesman_name}`} sub={r.branch_name} m={m} avg={company}
              score={score} prev={prev} prevScore={prevScore} />
          ))}
        </div>
      )}
    </div>
  );
}

const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
/** خريطة حرارية: كل خانة يوم × ساعة، لونها بعدد الفواتير — يوريك أوقات الذروة لكل فرع. */
function Heatmap({ data, loading }: { data?: { dow: number; hour: number; invoices: number; grams: number }[]; loading: boolean }) {
  if (loading) return <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>;
  const rows = data ?? [];
  if (!rows.length) return <Card className="p-6 text-center text-sm text-muted-foreground">لا توجد مبيعات في الفترة.</Card>;
  const hours = Array.from(new Set(rows.map((r) => r.hour))).sort((a, b) => ((a + 18) % 24) - ((b + 18) % 24)); // من الصباح لبعد نص الليل
  const max = Math.max(...rows.map((r) => Number(r.invoices)));
  const cell = (d: number, h: number) => rows.find((r) => r.dow === d && r.hour === h);
  const order = [6, 0, 1, 2, 3, 4, 5]; // السبت أولاً
  const byDay = order.map((d) => ({ d, n: rows.filter((r) => r.dow === d).reduce((a, r) => a + Number(r.invoices), 0) }));
  const byHour = hours.map((h) => ({ h, n: rows.filter((r) => r.hour === h).reduce((a, r) => a + Number(r.invoices), 0) }));
  const topDay = [...byDay].sort((a, b) => b.n - a.n)[0];
  const topHours = [...byHour].sort((a, b) => b.n - a.n).slice(0, 3).map((x) => x.h).sort((a, b) => a - b);
  const hl = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? "ص" : "م"}`;
  return (
    <Card className="p-3 space-y-3">
      <p className="text-sm">أكثر يوم بيع: <b>{DAYS[topDay.d]}</b> — وأكثر الساعات: <b>{topHours.map(hl).join("، ")}</b></p>
      <div className="overflow-x-auto">
        <table className="text-[10px] tabular-nums border-separate border-spacing-0.5">
          <thead><tr><th />{hours.map((h) => <th key={h} className="font-normal text-muted-foreground px-0.5">{hl(h)}</th>)}</tr></thead>
          <tbody>
            {order.map((d) => (
              <tr key={d}>
                <td className="pl-1 whitespace-nowrap text-muted-foreground">{DAYS[d]}</td>
                {hours.map((h) => {
                  const c = cell(d, h); const n = Number(c?.invoices ?? 0);
                  return (
                    <td key={h} title={c ? `${n} فاتورة · ${c.grams} جم` : ""}
                      className="size-7 rounded text-center" style={{ background: n ? `hsl(43 80% ${92 - (n / max) * 55}%)` : "hsl(var(--muted))", color: n / max > 0.6 ? "white" : undefined }}>
                      {n || ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">الرقم = عدد الفواتير. الساعات حسب وقت تسجيل الفاتورة في أمارسوفت (توقيت ليبيا).</p>
    </Card>
  );
}
