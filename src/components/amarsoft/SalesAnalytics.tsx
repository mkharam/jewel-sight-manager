// أرباح مبيعات أمارسوفت: متوسط سعر الغرام، المصنعية المحصّلة وتكلفتها من المورّد، والربح التقديري
// بسعر ذهب خام يكتبه المدير (سعر 650 في أمارسوفت رقم دفتري وليس سعر السوق).
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sb, periodDays, daysToRange, formatLD, formatGrams, type Period } from "@/lib/amarsoft";

type Row = {
  branch_code: string; branch_name: string; karat: string; invoices: number; pieces: number; grams: number; pure_grams: number;
  sales_dirhams: number; metal_dirhams: number; making_dirhams: number; making_cost_dirhams: number; costed_grams: number | null;
};
type Agg = Omit<Row, "branch_code" | "branch_name" | "karat"> & { label: string };

const PERIODS: { key: Period; label: string }[] = [
  { key: "today", label: "اليوم" }, { key: "week", label: "الأسبوع" }, { key: "month", label: "الشهر" }, { key: "year", label: "السنة" },
];
const GOLD_KEY = "amarsoft:goldCostPerPureGram";

function sum(rows: Row[], label: string): Agg {
  const z: Agg = { label, invoices: 0, pieces: 0, grams: 0, pure_grams: 0, sales_dirhams: 0, metal_dirhams: 0, making_dirhams: 0, making_cost_dirhams: 0, costed_grams: 0 };
  for (const r of rows) {
    z.invoices += Number(r.invoices); z.pieces += Number(r.pieces); z.grams += Number(r.grams); z.pure_grams += Number(r.pure_grams);
    z.sales_dirhams += Number(r.sales_dirhams); z.metal_dirhams += Number(r.metal_dirhams); z.making_dirhams += Number(r.making_dirhams);
    z.making_cost_dirhams += Number(r.making_cost_dirhams); z.costed_grams = Number(z.costed_grams) + Number(r.costed_grams ?? 0);
  }
  return z;
}

function readGold() {
  try { return localStorage.getItem(GOLD_KEY) ?? ""; } catch { return ""; }
}

export default function SalesAnalytics() {
  const [period, setPeriod] = useState<Period>("month");
  const [gold, setGold] = useState(readGold);
  const goldCost = Number(gold) || 0;
  const saveGold = (v: string) => { setGold(v); try { localStorage.setItem(GOLD_KEY, v); } catch { /* private mode */ } };

  const { data, isLoading, error } = useQuery({
    queryKey: ["amarsoft-analytics", period],
    queryFn: async () => {
      const { from, to } = periodDays(period);
      const { start, end } = daysToRange(from, to);
      const { data, error } = await sb.rpc("amarsoft_sales_analytics", { p_start: start, p_end: end, p_branch: null });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const { total, byKarat, byBranch } = useMemo(() => {
    const rows = data ?? [];
    const karats = [...new Set(rows.map((r) => r.karat))].sort();
    const branches = [...new Set(rows.map((r) => r.branch_code))].sort();
    return {
      total: sum(rows, "كل الفروع"),
      byKarat: karats.map((k) => sum(rows.filter((r) => r.karat === k), `عيار ${k}`)),
      byBranch: branches.map((b) => sum(rows.filter((r) => r.branch_code === b), rows.find((r) => r.branch_code === b)?.branch_name ?? b)),
    };
  }, [data]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-1.5">
        {PERIODS.map((p) => (
          <Button key={p.key} size="lg" variant={period === p.key ? "default" : "outline"} onClick={() => setPeriod(p.key)} className="text-base">{p.label}</Button>
        ))}
      </div>

      <Card className="p-3 space-y-1.5">
        <label className="text-sm font-bold block">سعر غرام الذهب الخام (عيار 24) لحساب الربح</label>
        <Input value={gold} onChange={(e) => saveGold(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder="مثال: 1700" className="text-lg h-12" dir="ltr" />
        <p className="text-xs text-muted-foreground">الربح = المبيعات − (الوزن الصافي × هذا السعر) − تكلفة المصنعية من المورّد. سعر 650 في أمارسوفت دفتري فلا نعتمد عليه.</p>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : error ? (
        <Card className="p-4 text-sm text-destructive">تعذّر تحميل الأرباح: {(error as Error).message}</Card>
      ) : !total.invoices ? (
        <Card className="p-4 text-sm text-muted-foreground text-center">لا مبيعات في هذه الفترة.</Card>
      ) : (
        <>
          <AggCard a={total} goldCost={goldCost} big />
          <h3 className="text-sm font-bold pt-1">حسب العيار</h3>
          {byKarat.map((a) => <AggCard key={a.label} a={a} goldCost={goldCost} />)}
          <h3 className="text-sm font-bold pt-1">حسب الفرع</h3>
          {byBranch.map((a) => <AggCard key={a.label} a={a} goldCost={goldCost} />)}
        </>
      )}
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-2 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? "font-bold text-primary" : "font-medium"}>{value}</span>
    </div>
  );
}

function AggCard({ a, goldCost, big }: { a: Agg; goldCost: number; big?: boolean }) {
  const perGram = a.grams ? a.sales_dirhams / 1000 / a.grams : 0;
  const makingPerGram = a.grams ? a.making_dirhams / 1000 / a.grams : 0;
  const costPerGram = a.costed_grams ? a.making_cost_dirhams / 1000 / Number(a.costed_grams) : 0;
  const profit = goldCost ? a.sales_dirhams - a.pure_grams * goldCost * 1000 - a.making_cost_dirhams : null;
  const n = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return (
    <Card className={`p-3 text-sm divide-y ${big ? "border-primary/40 bg-gold-soft" : ""}`}>
      <div className="flex justify-between items-baseline pb-1.5">
        <span className="font-bold text-base">{a.label}</span>
        <span className="text-xs text-muted-foreground">{a.invoices} فاتورة · {Number(a.pieces)} قطعة</span>
      </div>
      <Line label="الوزن المباع" value={formatGrams(a.grams)} />
      <Line label="المبيعات" value={formatLD(a.sales_dirhams)} />
      <Line label="متوسط سعر الغرام" value={`${n(perGram)} د.ل`} strong />
      <Line label="المصنعية المحصّلة (حسب أمارسوفت)" value={`${formatLD(a.making_dirhams)} · ${n(makingPerGram)}/جم`} />
      <Line label="تكلفة المصنعية من المورّد" value={`${formatLD(a.making_cost_dirhams)} · ${n(costPerGram)}/جم`} />
      {profit !== null && (
        <Line label="الربح التقديري" value={`${formatLD(profit)} (${a.sales_dirhams ? Math.round((profit / a.sales_dirhams) * 100) : 0}%)`} strong />
      )}
    </Card>
  );
}
