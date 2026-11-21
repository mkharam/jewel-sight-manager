// «السوق اليوم»: سعر الأونصة والدولار (موازي ورسمي) وكم تغيّروا، قيمة جرام الذهب الخام لكل عيار،
// سعر الكسر في سوق طرابلس (تلقائي من الأخبار)، حركة آخر شهر/3 شهور، وحاسبة.
import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDown, ArrowUp, Info, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { addDays, formatTripoli } from "@/lib/amarsoft";
import {
  PURITY, fmt, signed, isMissingInDb, kasrOf, latestKasr, tripoliDay, useKasr, useRateSeries, type Karat, type RateDay,
} from "@/lib/goldMarket";
import GoldCalculator from "./GoldCalculator";

/** التغيّر عن آخر سعر مختلف في آخر 7 أيام (الأونصة ما تتحركش في العطلة، والدولار مرات يثبت يومين). */
function changeOf(series: RateDay[], pick: (x: RateDay) => number | null, d = 0) {
  const last = series[series.length - 1];
  const now = last ? pick(last) : null;
  if (!last || now === null) return null;
  for (let i = series.length - 2; i >= 0 && series[i].day >= addDays(last.day, -7); i--) {
    const was = pick(series[i]);
    // فرق أصغر من اللي يبان في الرقم المعروض = نفس السعر.
    if (was !== null && Math.abs(was - now) >= 10 ** -d / 2) return { delta: now - was, day: series[i].day };
  }
  return null;
}

function Change({ c, d = 0 }: { c: { delta: number; day: string } | null; d?: number }) {
  if (!c) return <span className="text-[11px] text-muted-foreground">بدون تغيير هالأسبوع</span>;
  const up = c.delta > 0;
  // اللون يوضّح الاتجاه بس (طالع/نازل)، مش «زين ولا شين».
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums", up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
      {up ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}{fmt(Math.abs(c.delta), d)}
      <span className="font-normal text-muted-foreground">عن {c.day.slice(5).replace("-", "/")}</span>
    </span>
  );
}

export default function MarketToday() {
  const series = useRateSeries(100);
  const kasr = useKasr(100);
  const [range, setRange] = useState<30 | 90>(30);
  const [chartKarat, setChartKarat] = useState<"18" | "21">("18");

  const s = useMemo(() => series.data ?? [], [series.data]);
  const today = s.length ? s[s.length - 1] : null;

  const chart = useMemo(() => {
    const lastOfDay = new Map<string, number>();
    for (const r of kasr.data ?? []) {
      const d = tripoliDay(r.observed_at), v = kasrOf(r, chartKarat);
      if (v !== null && !lastOfDay.has(d)) lastOfDay.set(d, v); // الأحدث أول — أول قيمة لليوم هي آخر سعر فيه
    }
    return s.slice(-range).map((x) => ({
      day: x.day.slice(5).replace("-", "/"),
      raw: x.g24 === null ? null : Math.round(x.g24 * PURITY[chartKarat]),
      kasr: lastOfDay.get(x.day) ?? null,
    }));
  }, [s, kasr.data, range, chartKarat]);

  if (series.isLoading) return <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>;
  if (!today) return <p className="py-8 text-center text-sm text-muted-foreground">ما فيش أسعار مسجّلة بعد.</p>;

  const kasrMissing = !!kasr.error && isMissingInDb(kasr.error);
  const rows = (["18", "21", "24"] as Karat[]).map((k) => ({
    k,
    raw: today.g24 === null ? null : today.g24 * PURITY[k],
    official: today.xau && today.official ? (today.xau / 31.1035) * today.official * PURITY[k] : null,
    kasr: latestKasr(kasr.data, k),
  }));
  const k18 = rows[0];
  const gap = k18.kasr && k18.raw ? k18.kasr.value - k18.raw : null;

  return (
    <div className="mx-auto max-w-5xl space-y-3">
      <Card className="space-y-3 p-3">
        <div>
          <h2 className="text-lg font-bold">سعر الذهب والدولار اليوم</h2>
          <p className="text-xs text-muted-foreground">يتحدّث وحده كل ساعة — {today.day}</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl border p-2">
            <div className="text-[11px] text-muted-foreground">أونصة الذهب</div>
            <div className="text-lg font-extrabold tabular-nums">${fmt(today.xau)}</div>
            <Change c={changeOf(s, (x) => x.xau)} />
          </div>
          <div className="rounded-xl border p-2">
            <div className="text-[11px] text-muted-foreground">الدولار الموازي</div>
            <div className="text-lg font-extrabold tabular-nums">{fmt(today.usd, 2)}</div>
            <Change c={changeOf(s, (x) => x.usd, 2)} d={2} />
          </div>
          <div className="rounded-xl border p-2">
            <div className="text-[11px] text-muted-foreground">الدولار الرسمي</div>
            <div className="text-lg font-extrabold tabular-nums">{fmt(today.official, 2)}</div>
            <Change c={changeOf(s, (x) => x.official, 2)} d={2} />
          </div>
        </div>
      </Card>

      <Card className="space-y-2 p-3">
        <h2 className="text-lg font-bold">جرام الذهب اليوم بالدينار</h2>
        <div className="overflow-hidden rounded-xl border">
          <table className="w-full text-center text-sm tabular-nums">
            <thead className="bg-muted/50 text-[11px] text-muted-foreground">
              <tr>
                <th className="px-1.5 py-2 text-right">العيار</th>
                <th className="px-1.5 py-2 text-primary">خام (موازي)</th>
                <th className="px-1.5 py-2">كسر طرابلس</th>
                <th className="px-1.5 py-2">خام (رسمي)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.k} className="border-t">
                  <td className="px-1.5 py-2.5 text-right font-bold">{r.k}</td>
                  <td className="px-1.5 py-2.5 text-base font-extrabold text-primary">{fmt(r.raw)}</td>
                  <td className="px-1.5 py-2.5 font-semibold">{r.kasr ? fmt(r.kasr.value) : "—"}</td>
                  <td className="px-1.5 py-2.5 text-muted-foreground">{fmt(r.official)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex gap-2 rounded-lg bg-muted/40 p-2.5 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="space-y-1">
            <p><b className="text-foreground">خام (موازي)</b>: قيمة الذهب الصافي بدولار السوق = الأونصة ÷ 31.1 × الدولار × العيار. هذا الأساس اللي نحسبو عليه الربح.</p>
            <p>
              <b className="text-foreground">كسر طرابلس</b>: اللي يدفعوه التجار في جرام الذهب المستعمل (كاش)، يتجاب وحده من أخبار السوق.
              {k18.kasr && <> آخر سعر: {formatTripoli(k18.kasr.at)}.</>}
              {gap !== null && k18.raw ? <> الكسر {gap < 0 ? "أقل" : "أعلى"} من الخام بـ {fmt(Math.abs(gap))} د.ل ({fmt(Math.abs(gap / k18.raw) * 100, 1)}%).</> : null}
            </p>
            {kasrMissing && <p className="text-amber-700 dark:text-amber-400">سعر الكسر يبدا يظهر بعد ما تشغّل ملف التحديث RUN_ONCE_2026-11-22.sql.</p>}
            <p><b className="text-foreground">خام (رسمي)</b>: لو حسبناه بدولار المصرف — للمقارنة بس.</p>
          </div>
        </div>
      </Card>

      <Card className="space-y-2 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">حركة جرام {chartKarat}</h2>
          <div className="flex gap-1">
            {(["18", "21"] as const).map((k) => (
              <button key={k} onClick={() => setChartKarat(k)}
                className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold", chartKarat === k ? "border-primary bg-primary text-primary-foreground" : "bg-card")}>
                عيار {k}
              </button>
            ))}
            {([30, 90] as const).map((r) => (
              <button key={r} onClick={() => setRange(r)}
                className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold", range === r ? "border-primary bg-primary text-primary-foreground" : "bg-card")}>
                {r === 30 ? "شهر" : "3 شهور"}
              </button>
            ))}
          </div>
        </div>
        <div className="h-56" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chart} margin={{ top: 5, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} minTickGap={18} />
              <YAxis tick={{ fontSize: 10 }} domain={["dataMin - 15", "dataMax + 15"]} width={44} />
              <Tooltip formatter={(v: number, name: string) => [`${fmt(v)} د.ل`, name]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="raw" name="خام (موازي)" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} connectNulls />
              <Line type="monotone" dataKey="kasr" name="كسر طرابلس" stroke="#d97706" strokeWidth={2} dot={{ r: 2 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[11px] text-muted-foreground">
          الذهب يطلع وينزل مع الأونصة ومع الدولار الموازي. تغيّر الجرام {chartKarat} في الفترة:{" "}
          {(() => {
            const vals = chart.filter((c) => c.raw !== null);
            if (vals.length < 2) return "—";
            const a = vals[0].raw!, b = vals[vals.length - 1].raw!;
            return `${signed(b - a)} د.ل (${signed(((b - a) / a) * 100, 1)}%)`;
          })()}
        </p>
      </Card>

      <GoldCalculator xau={today.xau} usd={today.usd} official={today.official} />
    </div>
  );
}
