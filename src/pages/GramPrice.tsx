// سعر الغرام في الفروع: مش المتوسط بس — بكم يتباع الغرام عادة (الوسط)، وبين قداش وقداش أغلب البيع،
// وكيف تبدّل شهر بشهر (ولا أسبوع بأسبوع)، وكم غرام انباع في كل سعر، وأرخص البيعات باش تتراجع.
// كل الأرقام من سطور فواتير أمارسوفت: سعر السطر = مبلغه ÷ وزنه.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarRange, Coins, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sb, formatLD, formatGrams, tripoliToday } from "@/lib/amarsoft";

type Row = { branch_code: string; branch_name: string; lines: number; grams: number; sales_dirhams: number; avg: number; p10: number; median: number; p90: number };
type Total = Row & { invoices: number; min: number; max: number; p25: number; p75: number };
type Band = { branch_code: string; band: number; lines: number; grams: number };
type Low = { branch_code: string; branch_name: string; invoice_no: string; invoice_date: string; descr: string | null; customer: string | null; grams: number; rate: number; amount: number };
type Report = { series: (Row & { bucket: string })[]; totals: Total[]; bands: Band[]; lowest: Low[] };

const COLORS = ["#C9A227", "#2563eb", "#16a34a", "#dc2626", "#7c3aed", "#0891b2"];
const RANGES = [{ key: 90, label: "3 أشهر" }, { key: 180, label: "6 أشهر" }, { key: 365, label: "سنة" }, { key: 0, label: "من… لـ…" }] as const;
const n0 = (v: number | null | undefined) => Number(v ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
const short = (name: string) => name.replace(/^\d+\s*-\s*/, "");

function back(days: number) {
  const d = new Date(`${tripoliToday()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
function bucketLabel(ymd: string, bucket: "month" | "week") {
  const [y, m, d] = ymd.split("-").map(Number);
  return bucket === "month" ? `${MONTHS[m - 1]} ${String(y).slice(2)}` : `${d}/${m}`;
}

export default function GramPrice() {
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>(180);
  const [custom, setCustom] = useState({ from: back(90), to: tripoliToday() });
  const [bucket, setBucket] = useState<"month" | "week">("month");
  const [karat, setKarat] = useState<"18" | "21">("18");
  const from = range ? back(range) : custom.from;
  const to = range ? tripoliToday() : custom.to;

  const { data, isLoading } = useQuery({
    queryKey: ["gram-report", from, to, bucket, karat],
    enabled: !!from && !!to && from <= to,
    queryFn: async () => {
      const { data, error } = await sb.rpc("amarsoft_gram_report", { p_start: from, p_end: to, p_bucket: bucket, p_karat: karat });
      if (error) throw error;
      return data as Report;
    },
  });

  const v = useMemo(() => {
    if (!data) return null;
    const branches = [...data.totals].sort((a, b) => b.median - a.median);
    const color = new Map(data.totals.map((t, i) => [t.branch_code, COLORS[i % COLORS.length]]));
    // سطر لكل فترة، وعمود لكل فرع (الوسط) — شكل الرسم.
    const byBucket = new Map<string, Record<string, number | string>>();
    for (const s of data.series) {
      const row = byBucket.get(s.bucket) ?? { bucket: bucketLabel(s.bucket, bucket) };
      row[s.branch_code] = s.median;
      byBucket.set(s.bucket, row);
    }
    const chart = [...byBucket.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, r]) => r);
    // جدول الأسعار: شرائح 100 د.ل، والنسبة من وزن كل فرع.
    const bandKeys = [...new Set(data.bands.map((b) => b.band))].sort((a, b) => a - b);
    const gramsOf = new Map(data.totals.map((t) => [t.branch_code, Number(t.grams)]));
    const lo = Math.min(...data.totals.map((t) => t.p10)), hi = Math.max(...data.totals.map((t) => t.p90));
    return { branches, color, chart, bandKeys, gramsOf, lo, hi };
  }, [data, bucket]);

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Coins className="size-7 text-primary" />سعر الغرام في الفروع</h1>
        <p className="text-sm text-muted-foreground">بكم يبيع كل فرع الغرام فعلاً، من فواتير أمارسوفت.</p>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {RANGES.map((r) => (
          <Button key={r.key} size="lg" variant={range === r.key ? "default" : "outline"} onClick={() => setRange(r.key)} className="px-1 text-sm gap-1">
            {r.key === 0 && <CalendarRange className="size-4" />}{r.label}
          </Button>
        ))}
      </div>
      {range === 0 && (
        <Card className="p-3 grid grid-cols-2 gap-2">
          <label className="text-sm font-semibold">من يوم<Input type="date" value={custom.from} max={tripoliToday()} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className="h-11 mt-1" /></label>
          <label className="text-sm font-semibold">لين يوم<Input type="date" value={custom.to} max={tripoliToday()} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className="h-11 mt-1" /></label>
        </Card>
      )}
      <div className="grid grid-cols-4 gap-1.5">
        <Button variant={karat === "18" ? "secondary" : "ghost"} onClick={() => setKarat("18")}>عيار 18</Button>
        <Button variant={karat === "21" ? "secondary" : "ghost"} onClick={() => setKarat("21")}>عيار 21</Button>
        <Button variant={bucket === "month" ? "secondary" : "ghost"} onClick={() => setBucket("month")}>شهر بشهر</Button>
        <Button variant={bucket === "week" ? "secondary" : "ghost"} onClick={() => setBucket("week")}>أسبوع بأسبوع</Button>
      </div>

      {isLoading || !v || !data ? (
        <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : !data.totals.length ? (
        <Card className="p-6 text-center text-muted-foreground">ما فيش بيع عيار {karat} في هذي الفترة.</Card>
      ) : (
        <>
          {/* الفروع */}
          <Card className="p-3 space-y-3">
            <h2 className="text-lg font-bold">كل فرع بكم يبيع الغرام</h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              كل فاتورة تنحسب بسعرها الكلي (مبلغها ÷ وزنها)، مش كل قطعة وحدها — لأن السعر يتفق عليه للفاتورة كاملة.
              <b> عادة</b> = السعر اللي نص الفواتير فوقه ونصها تحته (ما يتأثرش بفاتورة غريبة). <b>أغلب البيع بين</b> = 8 فواتير من كل 10.
              الخط الذهبي = من أرخص لأغلى، والنقطة = «عادة».
            </p>
            {v.branches.map((t) => {
              const span = Math.max(1, v.hi - v.lo);
              const pos = (x: number) => `${Math.min(100, Math.max(0, ((x - v.lo) / span) * 100))}%`;
              return (
                <div key={t.branch_code} className="space-y-1 py-1 border-b last:border-0">
                  <div className="flex justify-between items-baseline gap-2">
                    <span className="font-bold flex items-center gap-1.5"><span className="size-3 rounded-full" style={{ background: v.color.get(t.branch_code) }} />{t.branch_name}</span>
                    <span className="text-left"><span className="text-xs text-muted-foreground">عادة </span><span className="text-2xl font-bold">{n0(t.median)}</span><span className="text-xs"> د.ل</span></span>
                  </div>
                  <div className="relative h-3 rounded-full bg-muted" dir="ltr">
                    <div className="absolute h-full rounded-full bg-primary/40" style={{ left: pos(t.p10), right: `calc(100% - ${pos(t.p90)})` }} />
                    <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 size-4 rounded-full bg-primary border-2 border-background" style={{ left: pos(t.median) }} />
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 text-xs text-muted-foreground">
                    <span>أغلب البيع بين <b className="text-foreground">{n0(t.p10)}</b> و <b className="text-foreground">{n0(t.p90)}</b></span>
                    <span className="text-left">المتوسط {n0(t.avg)}</span>
                    <span>{formatGrams(Math.round(t.grams))} · {n0(t.invoices)} فاتورة</span>
                    <span className="text-left">أرخص {n0(t.min)} · أغلى {n0(t.max)}</span>
                  </div>
                </div>
              );
            })}
          </Card>

          {/* الرسم */}
          {v.chart.length > 1 && (
            <Card className="p-3">
              <h2 className="text-lg font-bold">كيف تبدّل {bucket === "month" ? "شهر بشهر" : "أسبوع بأسبوع"}</h2>
              <p className="text-xs text-muted-foreground mb-2">كل خط فرع، والنقطة = بكم تباع الغرام عادة في {bucket === "month" ? "الشهر" : "الأسبوع"} هذا. الخط اللي يطلع = الفرع يبيع أغلى.</p>
              <div className="h-64" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={v.chart} margin={{ top: 5, right: 8, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                    <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11 }} width={48} />
                    <Tooltip formatter={(val: number, key: string) => [`${n0(val)} د.ل`, short(data.totals.find((t) => t.branch_code === key)?.branch_name ?? key)]} />
                    <Legend formatter={(key: string) => short(data.totals.find((t) => t.branch_code === key)?.branch_name ?? key)} />
                    {data.totals.map((t) => (
                      <Line key={t.branch_code} type="monotone" dataKey={t.branch_code} stroke={v.color.get(t.branch_code)} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          {/* الجدول فترة بفترة */}
          <Card className="p-3">
            <h2 className="text-lg font-bold">الأرقام {bucket === "month" ? "شهر بشهر" : "أسبوع بأسبوع"}</h2>
            <p className="text-xs text-muted-foreground mb-2">في كل خانة: بكم تباع الغرام عادة، وتحته كم غرام انباع.</p>
            <div className="overflow-x-auto -mx-3 px-3">
              <table className="w-full text-sm border-collapse min-w-[420px]">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th className="text-right py-1.5 font-normal sticky right-0 bg-card" />
                    {data.totals.map((t) => <th key={t.branch_code} className="py-1.5 font-bold" style={{ color: v.color.get(t.branch_code) }}>{short(t.branch_name)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {[...new Set(data.series.map((s) => s.bucket))].sort().reverse().map((b) => (
                    <tr key={b} className="border-t">
                      <td className="py-1.5 pl-2 whitespace-nowrap text-muted-foreground sticky right-0 bg-card">{bucketLabel(b, bucket)}</td>
                      {data.totals.map((t) => {
                        const s = data.series.find((x) => x.bucket === b && x.branch_code === t.branch_code);
                        return (
                          <td key={t.branch_code} className="py-1.5 text-center whitespace-nowrap">
                            {s ? <><div className="font-bold">{n0(s.median)}</div><div className="text-[11px] text-muted-foreground">{n0(s.grams)} جم</div></> : <span className="text-muted-foreground">—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* الشرائح */}
          <Card className="p-3">
            <h2 className="text-lg font-bold">كم غرام انباع في كل سعر</h2>
            <p className="text-xs text-muted-foreground mb-2">من كل 100 غرام باعها الفرع، كم غرام تباع بالسعر هذا. الخانة الأغمق = أكثر.</p>
            <div className="overflow-x-auto -mx-3 px-3">
              <table className="w-full text-sm border-collapse min-w-[420px]">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th className="text-right py-1.5 font-normal">الغرام بـ</th>
                    {data.totals.map((t) => <th key={t.branch_code} className="py-1.5 font-bold">{short(t.branch_name)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {[...v.bandKeys].reverse().map((band) => (
                    <tr key={band} className="border-t">
                      <td className="py-1 pl-2 whitespace-nowrap text-muted-foreground" dir="ltr">{n0(band)}–{n0(band + 99)}</td>
                      {data.totals.map((t) => {
                        const g = Number(data.bands.find((x) => x.band === band && x.branch_code === t.branch_code)?.grams ?? 0);
                        const p = v.gramsOf.get(t.branch_code) ? Math.round((g / v.gramsOf.get(t.branch_code)!) * 100) : 0;
                        return (
                          <td key={t.branch_code} className="py-1 text-center" style={{ background: p ? `rgba(201,162,39,${Math.min(0.85, 0.08 + p / 50)})` : undefined }}>
                            {p ? `${p}%` : ""}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* أرخص البيعات */}
          {!!data.lowest.length && (
            <Card className="p-3">
              <h2 className="text-lg font-bold">أرخص البيعات — راجعهم</h2>
              <p className="text-xs text-muted-foreground mb-1">ممكن تكون بيع للسبك ولا غلط في الإدخال. اضغط تفتح الفاتورة.</p>
              {data.lowest.map((l) => (
                <Link key={`${l.branch_code}-${l.invoice_no}-${l.grams}`} to={`/pos-sales?q=${encodeURIComponent(l.invoice_no)}&branch=${l.branch_code}`}
                  className="flex justify-between items-center gap-2 py-2 border-b last:border-0 text-sm active:bg-muted/40">
                  <span className="min-w-0">
                    <span className="block font-bold truncate">{l.descr ?? "—"} · {formatGrams(l.grams)}</span>
                    <span className="block text-xs text-muted-foreground truncate">{short(l.branch_name)} · فاتورة {l.invoice_no} · {l.invoice_date}{l.customer ? ` · ${l.customer}` : ""}</span>
                  </span>
                  <span className="shrink-0 text-left"><span className="block font-bold text-destructive">{n0(l.rate)} د.ل/جم</span><span className="block text-xs text-muted-foreground">{formatLD(l.amount)}</span></span>
                </Link>
              ))}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
