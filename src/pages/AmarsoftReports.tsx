// التقارير: كل فروع أمارسوفت في صفحة وحدة — المبيعات مقارنة بالفترة اللي قبلها، تنبيهات (ممسوح/معدّل،
// فرع ما باعش)، المبيعات يوم بيوم، مقارنة الفروع، العيارات، أحسن البائعين، المخزون، والموردين.
// كل الأرقام من دوال أمارسوفت الموجودة؛ ما فيش حساب جديد هنا غير الجمع والمقارنة.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BarChart3, Loader2, TrendingDown, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { sb, periodDays, daysToRange, formatLD, formatGrams, formatTripoli, tripoliToday, type Period } from "@/lib/amarsoft";

type Overview = {
  branch_code: string; branch_name: string; invoices: number; returns: number; grams: number;
  sales_dirhams: number; making_dirhams: number; stock_pieces: number; stock_grams: number;
  customers: number; deleted: number; edited: number; last_sale: string | null;
};
type Day = { day: string; invoices: number; grams: number; sales_dirhams: number };
type KaratRow = { karat: string | null; grams: number; sales_dirhams: number; invoices: number };
type Leader = { branch_name: string; salesman_name: string | null; sman: string; invoices: number; grams: number; net_dirhams: number | null };
type Supplier = { supplier_code: string; name: string | null; internal: boolean; stale_pcs: number; stock_grams: number };

const PERIODS: { key: Period; label: string }[] = [
  { key: "today", label: "اليوم" }, { key: "yesterday", label: "أمس" }, { key: "week", label: "الأسبوع" },
  { key: "month", label: "الشهر" }, { key: "year", label: "السنة" },
];
const PREV_LABEL: Record<Period, string> = {
  today: "أمس", yesterday: "اليوم اللي قبله", week: "الأسبوع اللي فات", month: "نفس الأيام من الشهر اللي فات", year: "نفس الفترة من السنة اللي فاتت",
};

function shift(ymd: string, days = 0, months = 0, years = 0) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years, d.getUTCMonth() + months, d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
// الفترة اللي قبلها بنفس الطول، باش المقارنة تكون عادلة (الشهر لين اليوم مقابل نفس الأيام من الشهر اللي فات).
function previous(p: Period, from: string, to: string) {
  if (p === "month") return { from: shift(from, 0, -1), to: shift(to, 0, -1) };
  if (p === "year") return { from: shift(from, 0, 0, -1), to: shift(to, 0, 0, -1) };
  const len = p === "week" ? 7 : 1;
  return { from: shift(from, -len), to: shift(to, -len) };
}

const n0 = (v: number | null | undefined) => Number(v ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
const perGram = (d: number, g: number) => (Number(g) ? Number(d) / 1000 / Number(g) : 0);

function Change({ now, before }: { now: number; before: number }) {
  if (!before) return now ? <span className="text-xs text-muted-foreground">جديد</span> : null;
  const p = Math.round(((now - before) / before) * 100);
  const up = p >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-bold ${up ? "text-emerald-600" : "text-destructive"}`}>
      {up ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}{up ? "+" : ""}{p}%
    </span>
  );
}

export default function AmarsoftReports() {
  const [period, setPeriod] = useState<Period>("month");
  const { from, to } = periodDays(period);
  const prev = previous(period, from, to);

  const { data, isLoading } = useQuery({
    queryKey: ["amarsoft-reports", period, from],
    queryFn: async () => {
      const r = daysToRange(from, to), pr = daysToRange(prev.from, prev.to);
      // يوم بيوم: لليوم وأمس والأسبوع نعرض آخر 30 يوم باش يبان الاتجاه.
      const trend = period === "year" || period === "month" ? r : daysToRange(shift(tripoliToday(), -29), tripoliToday());
      const [now, before, days, karats, leaders, suppliers, expenses, sync] = await Promise.all([
        sb.rpc("amarsoft_branch_overview", { p_start: r.start, p_end: r.end }),
        sb.rpc("amarsoft_branch_overview", { p_start: pr.start, p_end: pr.end }),
        sb.rpc("amarsoft_daily", { p_start: trend.start, p_end: trend.end }),
        sb.rpc("amarsoft_sales_analytics", { p_start: r.start, p_end: r.end }),
        sb.rpc("amarsoft_leaderboard_v2", { p_start: r.start, p_end: r.end }),
        sb.rpc("amarsoft_suppliers", { p_start: from, p_end: to }),
        sb.from("expenses").select("amount").gte("expense_date", from).lte("expense_date", to).limit(2000),
        sb.from("amarsoft_sync_log").select("received_at").order("received_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      const err = [now, before, days, karats, leaders, suppliers].find((x) => x.error)?.error;
      if (err) throw err;
      return {
        now: (now.data ?? []) as Overview[], before: (before.data ?? []) as Overview[],
        days: (days.data ?? []) as Day[], karats: (karats.data ?? []) as KaratRow[],
        leaders: (leaders.data ?? []) as Leader[], suppliers: (suppliers.data ?? []) as Supplier[],
        expenses: ((expenses.data ?? []) as { amount: number }[]).reduce((t, e) => t + Number(e.amount), 0),
        lastSync: (sync.data?.received_at as string | undefined) ?? null,
      };
    },
  });

  const v = useMemo(() => {
    if (!data) return null;
    const sum = (rows: Overview[], k: keyof Overview) => rows.reduce((t, o) => t + Number(o[k] ?? 0), 0);
    const tot = (rows: Overview[]) => ({
      sales: sum(rows, "sales_dirhams"), grams: sum(rows, "grams"), invoices: sum(rows, "invoices"),
      making: sum(rows, "making_dirhams"), customers: sum(rows, "customers"), returns: sum(rows, "returns"),
      deleted: sum(rows, "deleted"), edited: sum(rows, "edited"),
    });
    const t = tot(data.now), p = tot(data.before);
    const branches = [...data.now].sort((a, b) => Number(b.sales_dirhams) - Number(a.sales_dirhams))
      .map((o) => ({ ...o, prev: data.before.find((b) => b.branch_code === o.branch_code) }));
    const karats = Object.values(data.karats.reduce<Record<string, KaratRow>>((m, k) => {
      const key = k.karat ?? "—";
      const r = (m[key] ??= { karat: key, grams: 0, sales_dirhams: 0, invoices: 0 });
      r.grams += Number(k.grams); r.sales_dirhams += Number(k.sales_dirhams); r.invoices += Number(k.invoices);
      return m;
    }, {})).sort((a, b) => b.grams - a.grams);
    const leaders = [...data.leaders].sort((a, b) => Number(b.net_dirhams ?? 0) - Number(a.net_dirhams ?? 0)).slice(0, 5);
    const stale = data.suppliers.filter((s) => !s.internal && Number(s.stale_pcs) > 0)
      .sort((a, b) => Number(b.stale_pcs) - Number(a.stale_pcs)).slice(0, 3);
    const stock = { pcs: sum(data.now, "stock_pieces"), grams: sum(data.now, "stock_grams") };
    // فرع ما باعش في الفترة وهو عادة يبيع (باع في الفترة اللي قبلها).
    const silent = branches.filter((b) => !Number(b.invoices) && Number(b.prev?.invoices ?? 0) > 0);
    return { t, p, branches, karats, leaders, stale, stock, silent };
  }, [data]);

  const maxDay = Math.max(1, ...(data?.days ?? []).map((d) => Number(d.sales_dirhams)));
  const best = Math.max(1, ...(v?.branches ?? []).map((b) => Number(b.sales_dirhams)));

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><BarChart3 className="size-7 text-primary" />التقارير</h1>
        <p className="text-sm text-muted-foreground">كل الفروع من أمارسوفت · آخر تحديث: {formatTripoli(data?.lastSync)}</p>
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {PERIODS.map((p) => (
          <Button key={p.key} size="lg" variant={period === p.key ? "default" : "outline"} onClick={() => setPeriod(p.key)} className="text-sm px-1">{p.label}</Button>
        ))}
      </div>

      {isLoading || !v || !data ? (
        <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : (
        <>
          {/* الملخص */}
          <Card className="p-4 bg-gold-soft border-primary/30 space-y-3">
            <div className="text-center">
              <div className="text-xs text-muted-foreground">المبيعات</div>
              <div className="text-3xl font-bold">{formatLD(v.t.sales)}</div>
              <div className="text-xs text-muted-foreground">
                <Change now={v.t.sales} before={v.p.sales} /> مقارنة بـ{PREV_LABEL[period]} ({formatLD(v.p.sales)})
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div><div className="text-xs text-muted-foreground">الفواتير</div><div className="font-bold">{n0(v.t.invoices)}</div><Change now={v.t.invoices} before={v.p.invoices} /></div>
              <div><div className="text-xs text-muted-foreground">الوزن</div><div className="font-bold">{formatGrams(Math.round(v.t.grams))}</div><Change now={v.t.grams} before={v.p.grams} /></div>
              <div><div className="text-xs text-muted-foreground">سعر الغرام</div><div className="font-bold">{n0(perGram(v.t.sales, v.t.grams))} د.ل</div><Change now={perGram(v.t.sales, v.t.grams)} before={perGram(v.p.sales, v.p.grams)} /></div>
              <div><div className="text-xs text-muted-foreground">متوسط الفاتورة</div><div className="font-bold">{v.t.invoices ? formatLD(v.t.sales / v.t.invoices) : "—"}</div></div>
              <div><div className="text-xs text-muted-foreground">المصنعية المحصّلة</div><div className="font-bold">{formatLD(v.t.making)}</div></div>
              <div><div className="text-xs text-muted-foreground">زبائن</div><div className="font-bold">{n0(v.t.customers)}</div></div>
            </div>
            {!!data.expenses && (
              <div className="text-center text-sm border-t border-primary/20 pt-2">
                مصاريف مسجّلة في التطبيق للفترة: <b>{n0(data.expenses)} د.ل</b>
              </div>
            )}
          </Card>

          {/* تنبيهات */}
          {(v.t.deleted > 0 || v.t.edited > 0 || v.t.returns > 0 || v.silent.length > 0) && (
            <Card className="p-3 border-destructive/40 space-y-1.5">
              <h2 className="font-bold flex items-center gap-1.5"><AlertTriangle className="size-5 text-destructive" />انتبه</h2>
              {v.t.deleted > 0 && <Link to="/pos-sales?tab=log" className="block text-destructive font-bold">{v.t.deleted} فاتورة ممسوحة ←</Link>}
              {v.t.edited > 0 && <Link to="/pos-sales?tab=log" className="block">{v.t.edited} فاتورة تعدّلت بعد ما تسجلت ←</Link>}
              {v.t.returns > 0 && <div>{v.t.returns} فاتورة مرتجع</div>}
              {v.silent.map((b) => (
                <Link key={b.branch_code} to={`/branches/${b.branch_code}`} className="block">
                  {b.branch_name} ما باعش شي في الفترة (آخر بيع {formatTripoli(b.last_sale)}) ←
                </Link>
              ))}
            </Card>
          )}

          {/* الفروع */}
          <Card className="p-3">
            <div className="flex justify-between items-center mb-1">
              <h2 className="text-lg font-bold">الفروع</h2>
              <Link to="/branches" className="text-sm font-semibold text-primary">التفاصيل ←</Link>
            </div>
            {v.branches.map((b) => (
              <Link key={b.branch_code} to={`/branches/${b.branch_code}`} className="block py-2.5 border-b last:border-0 active:bg-muted/40">
                <div className="flex justify-between items-baseline gap-2">
                  <span className="font-bold truncate">{b.branch_name}</span>
                  <span className="shrink-0 font-bold text-primary">{formatLD(b.sales_dirhams)} <Change now={Number(b.sales_dirhams)} before={Number(b.prev?.sales_dirhams ?? 0)} /></span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden my-1">
                  <div className="h-full bg-primary" style={{ width: `${Math.round((Number(b.sales_dirhams) / best) * 100)}%` }} />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{n0(b.invoices)} فاتورة · {formatGrams(Math.round(Number(b.grams)))} · {n0(perGram(b.sales_dirhams, b.grams))} د.ل/جم</span>
                  <span>{v.t.sales ? Math.round((Number(b.sales_dirhams) / v.t.sales) * 100) : 0}% من الكل</span>
                </div>
              </Link>
            ))}
          </Card>

          {/* يوم بيوم */}
          {!!data.days.length && (
            <Card className="p-3">
              <h2 className="text-lg font-bold mb-2">المبيعات يوم بيوم{period === "year" ? "" : period === "month" ? "" : " (آخر 30 يوم)"}</h2>
              <div className="flex items-end gap-[2px] h-28" dir="ltr">
                {data.days.map((d) => (
                  <div key={d.day} className="flex-1 bg-primary/80 rounded-t-sm min-h-[2px]" title={`${d.day}: ${formatLD(d.sales_dirhams)} · ${d.invoices} فاتورة`}
                    style={{ height: `${Math.round((Number(d.sales_dirhams) / maxDay) * 100)}%` }} />
                ))}
              </div>
              <div className="flex justify-between text-[11px] text-muted-foreground mt-1" dir="ltr">
                <span>{data.days[0].day}</span><span>{data.days[data.days.length - 1].day}</span>
              </div>
              {(() => {
                const top = [...data.days].sort((a, b) => Number(b.sales_dirhams) - Number(a.sales_dirhams))[0];
                return top ? <p className="text-xs text-muted-foreground mt-1">أحسن يوم: {top.day} — {formatLD(top.sales_dirhams)} ({top.invoices} فاتورة)</p> : null;
              })()}
            </Card>
          )}

          {/* العيارات */}
          {!!v.karats.length && (
            <Card className="p-3">
              <h2 className="text-lg font-bold mb-1">حسب العيار</h2>
              {v.karats.map((k) => (
                <div key={k.karat} className="flex justify-between py-1.5 border-b last:border-0 text-sm">
                  <span className="font-bold">عيار {k.karat}</span>
                  <span>{formatGrams(Math.round(k.grams))} · {formatLD(k.sales_dirhams)} · <span className="text-muted-foreground">{n0(perGram(k.sales_dirhams, k.grams))} د.ل/جم</span></span>
                </div>
              ))}
            </Card>
          )}

          {/* البائعين */}
          {!!v.leaders.length && (
            <Card className="p-3">
              <div className="flex justify-between items-center mb-1">
                <h2 className="text-lg font-bold">أحسن البائعين</h2>
                <Link to="/leaderboard" className="text-sm font-semibold text-primary">الكل ←</Link>
              </div>
              {v.leaders.map((l, i) => (
                <div key={`${l.branch_name}-${l.sman}`} className="flex justify-between items-center py-1.5 border-b last:border-0 text-sm">
                  <span className="min-w-0 truncate"><b>{i + 1}. {l.salesman_name ?? l.sman}</b> <span className="text-muted-foreground">· {l.branch_name}</span></span>
                  <span className="shrink-0">{formatLD(l.net_dirhams)} · {n0(l.invoices)} ف</span>
                </div>
              ))}
            </Card>
          )}

          {/* المخزون والموردين */}
          <Card className="p-3 space-y-2">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold">المخزون الآن</h2>
              <Link to="/pos-stock" className="text-sm font-semibold text-primary">المخزون ←</Link>
            </div>
            <div className="text-xl font-bold">{n0(v.stock.pcs)} قطعة · {formatGrams(Math.round(v.stock.grams))}</div>
            {v.branches.map((b) => (
              <div key={b.branch_code} className="flex justify-between text-sm">
                <span>{b.branch_name}</span>
                <span className="text-muted-foreground">{n0(b.stock_pieces)} قطعة · {formatGrams(Math.round(Number(b.stock_grams)))}</span>
              </div>
            ))}
            {!!v.stale.length && (
              <Link to="/suppliers" className="block rounded-lg bg-destructive/10 p-2.5 text-sm mt-2">
                <div className="font-bold text-destructive mb-0.5">بضاعة قاعدة أكثر من 6 أشهر ←</div>
                {v.stale.map((s) => <div key={s.supplier_code}>{s.name ?? s.supplier_code}: {n0(s.stale_pcs)} قطعة</div>)}
              </Link>
            )}
          </Card>

          <Link to="/reports/app" className="block text-center text-sm text-muted-foreground underline py-2">
            تقارير التطبيق القديمة (المصاريف، الأسعار، التحويلات، الصيانة)
          </Link>
        </>
      )}
    </div>
  );
}
