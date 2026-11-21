// الربح الحقيقي لكل فرع: سعر البيع − قيمة الذهب الخام يوم البيع (تلقائي من سعر الأونصة والدولار الموازي)
// − مصنعية المورّد. بدل خانة «سعر الذهب الخام» اللي كانت تتكتب باليد في صفحة الأرباح القديمة.
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Info, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { sb, daysToRange } from "@/lib/amarsoft";
import MarketRatesCard from "@/components/MarketRatesCard";

type Row = {
  branch_code: string; branch_name: string; karat: string; invoices: number; grams: number; pure_grams: number;
  sales_lyd: number; valued_grams: number; valued_sales_lyd: number; gold_lyd: number; making_cost_lyd: number; costed_grams: number;
};
type Agg = { name: string; invoices: number; grams: number; sales: number; vg: number; vs: number; gold: number; mc: number; cg: number };

const n = (v: unknown) => Number(v ?? 0);
const short = (name: string) => name.replace(/^\d+\s*-\s*/, "");
const f = (v: number | null, d = 0) => (v === null || !Number.isFinite(v) ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: d }));

function agg(name: string, rows: Row[]): Agg {
  return rows.reduce<Agg>((a, r) => ({
    name, invoices: a.invoices + n(r.invoices), grams: a.grams + n(r.grams), sales: a.sales + n(r.sales_lyd),
    vg: a.vg + n(r.valued_grams), vs: a.vs + n(r.valued_sales_lyd), gold: a.gold + n(r.gold_lyd),
    mc: a.mc + n(r.making_cost_lyd), cg: a.cg + n(r.costed_grams),
  }), { name, invoices: 0, grams: 0, sales: 0, vg: 0, vs: 0, gold: 0, mc: 0, cg: 0 });
}

/** الأرقام المشتقة: كلها على الأيام اللي فيها سعر ذهب ودولار (vg/vs). مصنعية المورّد للقطع اللي
 *  تكلفتها معروفة تتعمّم على الباقي بنفس المعدل. */
function derive(a: Agg) {
  const perGram = a.vg ? a.vs / a.vg : a.grams ? a.sales / a.grams : null;
  const goldPerGram = a.vg ? a.gold / a.vg : null;
  const makingPerGram = a.cg ? a.mc / a.cg : 0;
  const profit = a.vg ? a.vs - a.gold - makingPerGram * a.vg : null;
  const profitPerGram = profit !== null && a.vg ? profit / a.vg : null;
  const profitPct = profit !== null && a.vs ? (profit / a.vs) * 100 : null;
  return { perGram, goldPerGram, makingPerGram, profit, profitPerGram, profitPct, coverage: a.grams ? (a.vg / a.grams) * 100 : 0 };
}

export default function ProfitSection({ from, to, karat }: { from: string; to: string; karat: "18" | "21" }) {
  const q = useQuery({
    queryKey: ["amarsoft-profit", from, to, karat],
    enabled: !!from && !!to && from <= to,
    retry: false,
    queryFn: async () => {
      const { start, end } = daysToRange(from, to);
      const { data, error } = await sb.rpc("amarsoft_profit_summary", { p_start: start, p_end: end, p_karat: karat });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const v = useMemo(() => {
    const rows = q.data ?? [];
    const codes = [...new Set(rows.map((r) => r.branch_code))];
    const branches = codes.map((c) => agg(rows.find((r) => r.branch_code === c)!.branch_name, rows.filter((r) => r.branch_code === c)))
      .map((a) => ({ a, d: derive(a) }))
      .sort((x, y) => (y.d.profitPerGram ?? -1e9) - (x.d.profitPerGram ?? -1e9));
    const total = agg("كل الفروع", rows);
    const td = derive(total);
    const list = [...branches.map((x) => ({ ...x, isTotal: false })), ...(branches.length > 1 ? [{ a: total, d: td, isTotal: true }] : [])];
    return { branches, total, td, list };
  }, [q.data]);

  // الدالة مش موجودة بعد في قاعدة البيانات (ملف الـ SQL ما تشغّلش) — PostgREST يرجّع PGRST202.
  const err = q.error as { code?: string; message?: string } | null;
  const missing = !!err && (err.code === "PGRST202" || /could not find the function/i.test(err.message ?? ""));

  return (
    <Card className="p-3 space-y-3">
      <div>
        <h2 className="text-lg font-bold">الربح الحقيقي — عيار {karat}</h2>
        <p className="text-xs text-muted-foreground">سعر البيع ناقص قيمة الذهب الخام يوم البيع، ناقص مصنعية المورّد. سعر الذهب يتحسب وحده — ما تكتبش شي.</p>
      </div>
      <MarketRatesCard />
      {q.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : missing ? (
        <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
          حساب الأرباح التلقائي يحتاج تحديث قاعدة البيانات مرة وحدة: شغّل ملف <b>RUN_ONCE_2026-11-22.sql</b> في Supabase ← SQL Editor.
        </p>
      ) : q.error ? (
        <p className="text-sm text-destructive">تعذّر تحميل الأرباح: {(q.error as Error).message}</p>
      ) : !v.total.grams ? (
        <p className="py-4 text-center text-sm text-muted-foreground">ما فيش بيع عيار {karat} في هذي الفترة.</p>
      ) : (
        <>
          {/* التلفون: بطاقة لكل فرع — الربح للجرام كبير، وتحته المعادلة بالأرقام. */}
          <div className="space-y-2 sm:hidden">
            {v.list.map(({ a, d, isTotal }) => (
              <div key={a.name} className={`rounded-xl border p-3 ${isTotal ? "bg-gold-soft" : "bg-card"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold">{short(a.name)}</p>
                    <p className="text-[11px] text-muted-foreground tabular-nums">{f(a.grams)} جم · {a.invoices} فاتورة</p>
                  </div>
                  <div className="shrink-0 text-left">
                    <p className="text-2xl font-extrabold leading-none text-primary tabular-nums">
                      {f(d.profitPerGram)} <span className="text-[11px] font-normal text-muted-foreground">د.ل/جم</span>
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                      {d.profitPct === null ? "—" : `${f(d.profitPct)}%`} · {d.profit === null ? "—" : `${f(d.profit)} د.ل`}
                    </p>
                  </div>
                </div>
                <p className="mt-2 rounded-lg bg-muted/40 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground tabular-nums">
                  بيع {f(d.perGram)} − ذهب خام {f(d.goldPerGram)} − مصنعية {f(d.makingPerGram)} = <b className="text-foreground">{f(d.profitPerGram)}</b> ربح للجرام
                </p>
              </div>
            ))}
          </div>
          <div className="hidden overflow-x-auto rounded-xl border sm:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs">
                <tr>
                  <th className="sticky right-0 bg-muted px-2 py-2 text-right">الفرع</th>
                  <th className="px-2 py-2 whitespace-nowrap">الوزن</th>
                  <th className="px-2 py-2 whitespace-nowrap">سعر البيع/جم</th>
                  <th className="px-2 py-2 whitespace-nowrap">الذهب الخام/جم</th>
                  <th className="px-2 py-2 whitespace-nowrap">مصنعية المورّد/جم</th>
                  <th className="px-2 py-2 whitespace-nowrap text-primary">الربح/جم</th>
                  <th className="px-2 py-2 whitespace-nowrap">الربح %</th>
                  <th className="px-2 py-2 whitespace-nowrap">صافي الربح</th>
                </tr>
              </thead>
              <tbody>
                {v.list.map(({ a, d, isTotal }) => {
                  return (
                    <tr key={a.name} className={`border-t tabular-nums ${isTotal ? "bg-gold-soft font-bold" : ""}`}>
                      <td className={`sticky right-0 px-2 py-2 whitespace-nowrap ${isTotal ? "bg-gold-soft" : "bg-card"}`}>
                        {short(a.name)}
                        <span className="block text-[10px] font-normal text-muted-foreground">{a.invoices} فاتورة</span>
                      </td>
                      <td className="px-2 py-2 text-center whitespace-nowrap">{f(a.grams, 0)} جم</td>
                      <td className="px-2 py-2 text-center">{f(d.perGram)}</td>
                      <td className="px-2 py-2 text-center text-muted-foreground">{f(d.goldPerGram)}</td>
                      <td className="px-2 py-2 text-center text-muted-foreground">{f(d.makingPerGram)}</td>
                      <td className="px-2 py-2 text-center font-bold text-primary">{f(d.profitPerGram)}</td>
                      <td className="px-2 py-2 text-center">{d.profitPct === null ? "—" : `${f(d.profitPct)}%`}</td>
                      <td className="px-2 py-2 text-center whitespace-nowrap">{d.profit === null ? "—" : `${f(d.profit)} د.ل`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {v.td.coverage < 99 && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              الربح محسوب على {f(v.td.coverage)}% من الوزن — الأيام قبل 13 أغسطس 2026 ما فيهاش سعر دولار موازي مسجّل.
            </p>
          )}
          <div className="flex gap-2 rounded-lg bg-muted/40 p-2.5 text-xs leading-relaxed text-muted-foreground">
            <Info className="size-4 shrink-0 text-primary" />
            <p>
              <b>الربح/جم</b> = سعر البيع للجرام − قيمة الذهب الخام للجرام يوم البيع − مصنعية المورّد للجرام (من تكلفة القطعة في أمارسوفت).
              الفروع مرتّبة من الأعلى ربح للجرام. «الذهب الخام» يتغيّر مع الأونصة والدولار، فلو الربح نقص بينما سعر البيع ثابت
              يعني الذهب غلى وسعر البيع ما اتعدّلش.{" "}
              <Link to="/gold-price?tab=compare" className="font-semibold text-primary underline">قارن سعرك بالمنافسين ←</Link>
            </p>
          </div>
        </>
      )}
    </Card>
  );
}
