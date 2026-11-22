// «سعري والسوق» (للمدير العام): سعرك غالي ولا لا؟ وكم ربحك؟ كل الأسعار تتحوّل لـ«سعر اليوم»:
// قيمة الذهب الخام اليوم + كم كان فوق الخام يومها — فسعر منافس من أسبوعين وفواتير الشهر كله يتقارنو
// صح حتى لو الذهب طلع ولا نزل في النص.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Scale } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useGoldPrices } from "@/hooks/useGoldPrices";
import { addDays, daysToRange, sb, tripoliToday } from "@/lib/amarsoft";
import {
  competitorSummary, fmt, isMissingInDb, kharjiField, latestKasr, latestQuote, rawAt, signed, tripoliDay,
  useCompetitorPrices, useMarketQuotes, useRateSeries,
} from "@/lib/goldMarket";

type ProfitRow = {
  branch_code: string; branch_name: string; invoices: number; grams: number; valued_grams: number;
  valued_sales_lyd: number; gold_lyd: number; making_cost_lyd: number; costed_grams: number;
};
type Agg = { name: string; invoices: number; grams: number; vg: number; vs: number; gold: number; mc: number; cg: number };
const num = (v: unknown) => Number(v ?? 0);
const short = (s: string) => s.replace(/^\d+\s*-\s*/, "");

function agg(name: string, rows: ProfitRow[]): Agg {
  return rows.reduce<Agg>((a, r) => ({
    name, invoices: a.invoices + num(r.invoices), grams: a.grams + num(r.grams), vg: a.vg + num(r.valued_grams),
    vs: a.vs + num(r.valued_sales_lyd), gold: a.gold + num(r.gold_lyd), mc: a.mc + num(r.making_cost_lyd), cg: a.cg + num(r.costed_grams),
  }), { name, invoices: 0, grams: 0, vg: 0, vs: 0, gold: 0, mc: 0, cg: 0 });
}
/** فوق الخام للجرام (حسب يوم كل بيعة)، ومصنعية المورّد للجرام. */
const marginOf = (a: Agg) => (a.vg ? (a.vs - a.gold) / a.vg : null);
const makingOf = (a: Agg) => (a.cg ? a.mc / a.cg : 0);

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" onClick={onClick}
      className={cn("rounded-full border px-3 py-1.5 text-sm font-semibold", active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card")}>
      {children}
    </button>
  );
}

export default function PriceCompare() {
  const [karat, setKarat] = useState<"18" | "21">("18");
  const [period, setPeriod] = useState<7 | 30>(7);
  const today = tripoliToday();
  const series = useRateSeries(120);
  const kasr = useMarketQuotes(14);
  const comp = useCompetitorPrices(90);
  const { data: declared } = useGoldPrices();

  const profit = useQuery({
    queryKey: ["price-compare-profit", karat, period, today],
    retry: false,
    queryFn: async () => {
      const { start, end } = daysToRange(addDays(today, -(period - 1)), today);
      const { data, error } = await sb.rpc("amarsoft_profit_summary", { p_start: start, p_end: end, p_karat: karat });
      if (error) throw error;
      return (data ?? []) as ProfitRow[];
    },
  });

  const v = useMemo(() => {
    const rawToday = series.data ? rawAt(series.data, today, karat) : null;
    const cs = competitorSummary(comp.data, series.data, karat, rawToday);
    const rows = profit.data ?? [];
    const total = agg("كل الفروع", rows);
    const branches = [...new Set(rows.map((r) => r.branch_code))]
      .map((c) => agg(short(rows.find((r) => r.branch_code === c)!.branch_name), rows.filter((r) => r.branch_code === c)))
      .filter((a) => a.vg > 0)
      .sort((a, b) => (marginOf(b) ?? 0) - (marginOf(a) ?? 0));
    const oursMargin = marginOf(total);
    const oursEq = rawToday !== null && oursMargin !== null ? rawToday + oursMargin : null;
    const mine = declared?.get(`${karat}K`) ?? null;
    const k = latestKasr(kasr.data, karat);
    // الذهب الخارجي في السوق (من «بكم»): محوّل لسعر اليوم بنفس الطريقة — كم كان فوق الخام يوم تسجيله.
    const kh = latestQuote(kasr.data, kharjiField(karat));
    const khRawThen = kh && series.data ? rawAt(series.data, tripoliDay(kh.at), karat) : null;
    const kharjiEq = kh ? (khRawThen !== null && rawToday !== null ? rawToday + (kh.value - khRawThen) : kh.value) : null;
    const ladder = [
      { key: "kasr", label: "كسر طرابلس", hint: "اللي يدفعوه التجار في المستعمل", value: k?.value ?? null, ours: false },
      { key: "raw", label: "الذهب الخام", hint: "الأونصة × الدولار الموازي", value: rawToday, ours: false },
      { key: "kharji", label: "ذهب خارجي في السوق (بكم)", hint: kh ? `مسجّل ${tripoliDay(kh.at)}، ${fmt(kh.value)} يومها` : "", value: kharjiEq, ours: false },
      { key: "comp", label: `المنافسين (${cs.count} سعر)`, hint: cs.todayMin !== null ? `من ${fmt(cs.todayMin)} لـ ${fmt(cs.todayMax)}` : "", value: cs.todayAvg, ours: false },
      { key: "ours", label: `سعرك الفعلي (فواتير ${period === 7 ? "آخر 7 أيام" : "آخر 30 يوم"})`, hint: `${fmt(total.grams)} جم · ${total.invoices} فاتورة`, value: oursEq, ours: true },
      { key: "declared", label: "سعرك المعلن (تسعير المحل)", hint: mine ? `محدّث ${mine.effective_date}` : "", value: mine?.price_per_gram ?? null, ours: true },
    ].filter((x): x is typeof x & { value: number } => x.value !== null && Number.isFinite(x.value)).sort((a, b) => a.value - b.value);
    return { rawToday, cs, total, branches, oursMargin, oursEq, making: makingOf(total), mine, ladder, kharjiEq };
  }, [series.data, comp.data, profit.data, declared, kasr.data, karat, period, today]);

  const profitMissing = !!profit.error && isMissingInDb(profit.error);
  const lo = v.ladder.length ? v.ladder[0].value : 0, hi = v.ladder.length ? v.ladder[v.ladder.length - 1].value : 1;
  // سعرك الفعلي مقارنة بمرجع: أغلى / أرخص / قريب (فرق أقل من 2%).
  const verdicts = ([["سعر الذهب الخارجي في السوق", v.kharjiEq], ["المنافسين المسجّلين", v.cs.todayAvg]] as const)
    .filter(([, ref]) => v.oursEq !== null && ref !== null)
    .map(([label, ref]) => {
      const diff = v.oursEq! - ref!, pct = (diff / ref!) * 100;
      return {
        label, tone: Math.abs(pct) < 2 ? "same" : diff > 0 ? "up" : "down",
        text: Math.abs(pct) < 2 ? `سعرك قريب من ${label} (الفرق ${fmt(Math.abs(diff))} د.ل للجرام).`
          : diff > 0 ? `سعرك أغلى من ${label} بـ ${fmt(diff)} د.ل للجرام (${fmt(pct, 1)}%).`
          : `سعرك أرخص من ${label} بـ ${fmt(-diff)} د.ل للجرام (${fmt(-pct, 1)}%).`,
      };
    });

  return (
    <div className="mx-auto max-w-5xl space-y-3">
      <Card className="space-y-3 p-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold"><Scale className="size-5 text-primary" />سعري مقارنة بالسوق</h2>
          <p className="text-xs text-muted-foreground">كل الأسعار محوّلة لسعر اليوم: الذهب الخام اليوم + كم كانت فوق الخام يومها.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip active={karat === "18"} onClick={() => setKarat("18")}>عيار 18</Chip>
          <Chip active={karat === "21"} onClick={() => setKarat("21")}>عيار 21</Chip>
          <span className="mx-1 w-px self-stretch bg-border" />
          <Chip active={period === 7} onClick={() => setPeriod(7)}>آخر أسبوع</Chip>
          <Chip active={period === 30} onClick={() => setPeriod(30)}>آخر شهر</Chip>
        </div>

        {series.isLoading || profit.isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="size-6 animate-spin text-primary" /></div>
        ) : (
          <div className="space-y-2">
            {v.ladder.map((x) => (
              <div key={x.key} className={cn("rounded-xl border p-2.5", x.ours && "border-primary/60 bg-primary/5")}>
                <div className="flex items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <p className={cn("text-sm", x.ours ? "font-bold" : "font-semibold")}>{x.label}</p>
                    {x.hint && <p className="text-[11px] text-muted-foreground">{x.hint}</p>}
                  </div>
                  <div className="shrink-0 text-left">
                    <p className="text-lg font-extrabold tabular-nums">{fmt(x.value)} <span className="text-[10px] font-normal">د.ل</span></p>
                    {x.key !== "raw" && v.rawToday !== null && (
                      <p className="text-[11px] tabular-nums text-muted-foreground">{signed(x.value - v.rawToday)} فوق الخام</p>
                    )}
                  </div>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-muted">
                  <div className={cn("h-full rounded-full", x.ours ? "bg-primary" : x.key === "comp" ? "bg-amber-500" : "bg-muted-foreground/40")}
                    style={{ width: `${hi > lo ? 6 + ((x.value - lo) / (hi - lo)) * 94 : 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="space-y-2 p-3">
        <h3 className="font-bold">الخلاصة</h3>
        {profitMissing ? (
          <p className="rounded-lg bg-amber-500/10 p-2.5 text-sm text-amber-800 dark:text-amber-300">
            سعرك الفعلي وربحك يحتاجو تحديث قاعدة البيانات مرة وحدة: شغّل ملف <b>RUN_ONCE_2026-11-22.sql</b> في Supabase ← SQL Editor.
          </p>
        ) : null}
        <ul className="space-y-1.5 text-sm leading-relaxed">
          {verdicts.map((x) => (
            <li key={x.label} className={cn("rounded-lg p-2.5 font-semibold",
              x.tone === "same" ? "bg-muted/50" : x.tone === "up" ? "bg-amber-500/10 text-amber-900 dark:text-amber-200" : "bg-sky-500/10 text-sky-900 dark:text-sky-200")}>
              {x.text}
            </li>
          ))}
          {v.cs.count === 0 && (
            <li className="rounded-lg bg-muted/50 p-2.5">
              ما فيش أسعار منافسين مسجّلة لعيار {karat} — سجّلهم في خانة <Link to="/gold-price?tab=rivals" className="font-semibold text-primary underline">المنافسين</Link> باش نقارنو بمحلات معيّنة.
            </li>
          )}
          {v.oursMargin !== null && (
            <>
              <li>• إنت تبيع فوق الذهب الخام بـ <b>{fmt(v.oursMargin)} د.ل</b> للجرام{v.oursEq ? ` (${fmt((v.oursMargin / v.oursEq) * 100, 1)}% من سعر البيع)` : ""}.</li>
              <li>• بعد مصنعية المورّد ({fmt(v.making)} د.ل للجرام) يبقى <b className="text-primary">صافي ربحك {fmt(v.oursMargin - v.making)} د.ل للجرام</b>.</li>
            </>
          )}
          {v.cs.avgMargin !== null && <li>• المنافسين يبيعو فوق الخام بحوالي <b>{fmt(v.cs.avgMargin)} د.ل</b> للجرام (من {v.cs.count} سعر مسجّل).</li>}
          {v.mine && v.rawToday !== null && (
            <li>• سعرك المعلن {fmt(v.mine.price_per_gram)} = فوق الخام بـ {fmt(v.mine.price_per_gram - v.rawToday)} د.ل
              {v.oursEq !== null ? `، وسعرك الفعلي في الفواتير ${v.mine.price_per_gram > v.oursEq ? "أقل" : "أعلى"} منه بـ ${fmt(Math.abs(v.mine.price_per_gram - v.oursEq))}` : ""}.
            </li>
          )}
        </ul>
      </Card>

      {v.branches.length > 1 && v.rawToday !== null && (
        <Card className="space-y-2 p-3">
          <h3 className="font-bold">كل فرع</h3>
          <div className="space-y-1.5">
            {v.branches.map((b) => {
              const m = marginOf(b)!, eq = v.rawToday! + m;
              // المرجع: سعر الذهب الخارجي في السوق لو مسجّل، وإلا متوسط المنافسين.
              const ref = v.kharjiEq ?? v.cs.todayAvg;
              const d = ref !== null ? eq - ref : null;
              return (
                <div key={b.name} className="rounded-lg border p-2.5 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-bold">{b.name} <span className="text-[11px] font-normal text-muted-foreground tabular-nums">{fmt(b.grams)} جم · {b.invoices} فاتورة</span></p>
                    <p className="shrink-0 font-extrabold tabular-nums">{fmt(eq)} <span className="text-[10px] font-normal">د.ل اليوم</span></p>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                    {signed(m)} فوق الخام · صافي ربح {fmt(m - makingOf(b))} للجرام
                    {d !== null ? <> · <b className={d >= 0 ? "text-amber-700 dark:text-amber-400" : "text-sky-700 dark:text-sky-400"}>{d >= 0 ? "أغلى" : "أرخص"} من {v.kharjiEq !== null ? "السوق" : "المنافسين"} بـ {fmt(Math.abs(d))}</b></> : ""}
                  </p>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <p className="px-1 text-xs text-muted-foreground">
        تفاصيل الأرباح لكل فرع ولأي فترة: <Link to="/amarsoft?tab=gram" className="font-semibold text-primary underline">الأسعار والأرباح</Link>.
      </p>
    </div>
  );
}
