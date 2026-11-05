// الفروع: شن دار كل فرع (مبيعات، وزن، سعر الغرام، مصنعية، مخزون، ممسوح ومعدّل)، وصفحة لكل فرع.
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Building2, CalendarDays, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import InvoiceChanges from "@/components/amarsoft/InvoiceChanges";
import { sb, periodDays, daysToRange, formatLD, formatGrams, formatTripoli, tripoliToday, type Period } from "@/lib/amarsoft";

type Overview = {
  branch_code: string; branch_id: string; branch_name: string; invoices: number; returns: number; tagged: number;
  grams: number; pure_grams: number; sales_dirhams: number; making_dirhams: number; making_cost_dirhams: number;
  stock_pieces: number; stock_grams: number; salesmen: number; customers: number; deleted: number; edited: number; last_sale: string | null;
};
type Day = { day: string; invoices: number; grams: number; sales_dirhams: number };
type Leader = { sman: string; salesman_name: string | null; invoices: number; grams: number; net_dirhams: number | null };
type StockRow = { branch_code: string; karat: string | null; pieces: number; grams: number };

// الفترة: وحدة من الجاهزين، ولا يوم معيّن يختاره المدير ("day:YYYY-MM-DD").
type Sel = Period | `day:${string}`;
const PERIODS: { key: Period; label: string }[] = [
  { key: "today", label: "اليوم" }, { key: "week", label: "الأسبوع" }, { key: "month", label: "الشهر" }, { key: "year", label: "السنة" },
];

function shiftDay(ymd: string, n: number) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dayOf = (s: Sel) => (s.startsWith("day:") ? s.slice(4) : null);
function bounds(s: Sel) {
  const d = dayOf(s);
  return d ? { from: d, to: d } : periodDays(s as Period);
}
function range(s: Sel) {
  const { from, to } = bounds(s);
  return daysToRange(from, to);
}
const dayTitle = (ymd: string) => new Intl.DateTimeFormat("ar-LY", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`));

function useOverview(period: Sel) {
  return useQuery({
    queryKey: ["amarsoft-branch-overview", period],
    queryFn: async () => {
      const { start, end } = range(period);
      const { data, error } = await sb.rpc("amarsoft_branch_overview", { p_start: start, p_end: end });
      if (error) throw error;
      return (data ?? []) as Overview[];
    },
  });
}

function PeriodTabs({ period, setPeriod }: { period: Sel; setPeriod: (p: Sel) => void }) {
  const day = dayOf(period);
  const today = tripoliToday();
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-5 gap-1.5">
        {PERIODS.map((p) => (
          <Button key={p.key} size="lg" variant={period === p.key ? "default" : "outline"} onClick={() => setPeriod(p.key)} className="text-base px-1">{p.label}</Button>
        ))}
        <Button size="lg" variant={day ? "default" : "outline"} onClick={() => setPeriod(`day:${day ?? shiftDay(today, -1)}`)} className="text-base px-1 gap-1">
          <CalendarDays className="size-4" />يوم…
        </Button>
      </div>
      {day && (
        <Card className="p-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Button size="icon" variant="outline" className="h-11 w-11 shrink-0" onClick={() => setPeriod(`day:${shiftDay(day, -1)}`)} aria-label="اليوم اللي قبل"><ChevronRight className="size-5" /></Button>
            <Input type="date" value={day} max={today} onChange={(e) => e.target.value && setPeriod(`day:${e.target.value}`)} className="h-11 text-base text-center" />
            <Button size="icon" variant="outline" className="h-11 w-11 shrink-0" disabled={day >= today} onClick={() => setPeriod(`day:${shiftDay(day, 1)}`)} aria-label="اليوم اللي بعد"><ChevronLeft className="size-5" /></Button>
          </div>
          <p className="text-center text-sm font-semibold">{dayTitle(day)}</p>
        </Card>
      )}
    </div>
  );
}

const perGram = (o: Pick<Overview, "sales_dirhams" | "grams">) => (Number(o.grams) ? o.sales_dirhams / 1000 / Number(o.grams) : 0);
const n0 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });

export default function Branches() {
  const { code } = useParams<{ code?: string }>();
  return code ? <BranchDetail code={code} /> : <BranchList />;
}

function BranchList() {
  const [period, setPeriod] = useState<Sel>("month");
  const { data, isLoading } = useOverview(period);
  const total = useMemo(() => (data ?? []).reduce((t, o) => ({
    sales: t.sales + Number(o.sales_dirhams), grams: t.grams + Number(o.grams), invoices: t.invoices + Number(o.invoices),
  }), { sales: 0, grams: 0, invoices: 0 }), [data]);
  const best = Math.max(1, ...(data ?? []).map((o) => Number(o.sales_dirhams)));

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold flex items-center gap-2"><Building2 className="size-7 text-primary" />الفروع</h1>
      <PeriodTabs period={period} setPeriod={setPeriod} />
      <Card className="p-4 bg-gold-soft border-primary/30 grid grid-cols-3 text-center gap-2">
        <div><div className="text-xs text-muted-foreground">المبيعات</div><div className="font-bold text-lg">{formatLD(total.sales)}</div></div>
        <div><div className="text-xs text-muted-foreground">الوزن</div><div className="font-bold text-lg">{formatGrams(total.grams)}</div></div>
        <div><div className="text-xs text-muted-foreground">الفواتير</div><div className="font-bold text-lg">{total.invoices}</div></div>
      </Card>
      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : (
        <div className="space-y-3">
          {(data ?? []).map((o) => (
            <Link key={o.branch_code} to={`/branches/${o.branch_code}`} className="block">
              <Card className="p-4 space-y-2 active:bg-muted/40">
                <div className="flex justify-between items-baseline">
                  <span className="text-xl font-bold">{o.branch_name}</span>
                  <span className="text-lg font-bold text-primary">{formatLD(o.sales_dirhams)}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${Math.round((Number(o.sales_dirhams) / best) * 100)}%` }} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <span>{o.invoices} فاتورة</span>
                  <span>{formatGrams(o.grams)}</span>
                  <span>{n0(perGram(o))} د.ل/جم</span>
                  <span className="text-muted-foreground">مخزون {n0(Number(o.stock_pieces))} قطعة</span>
                  <span className="text-muted-foreground">{o.salesmen ? `${o.tagged}/${o.invoices} بالبائع` : "بدون بائعين"}</span>
                  <span className={Number(o.deleted) ? "text-destructive font-bold" : "text-muted-foreground"}>ممسوحة {o.deleted}</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "bad" | "good" }) {
  return (
    <Card className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold mt-0.5 ${tone === "bad" ? "text-destructive" : tone === "good" ? "text-primary" : ""}`}>{value}</div>
    </Card>
  );
}

function BranchDetail({ code }: { code: string }) {
  const [period, setPeriod] = useState<Sel>("month");
  const overview = useOverview(period);
  const o = overview.data?.find((x) => x.branch_code === code);

  const extra = useQuery({
    queryKey: ["amarsoft-branch-detail", code, period],
    queryFn: async () => {
      const { start, end } = range(period);
      // يوم بيوم: السنة كاملة للسنة، والا آخر 30 يوم لين نهاية الفترة (ليوم معيّن: الشهر اللي قبله).
      const { to } = bounds(period);
      const daily = daysToRange(shiftDay(to, -29), to);
      const [days, leaders, stock] = await Promise.all([
        sb.rpc("amarsoft_daily", { p_start: period === "year" ? start : daily.start, p_end: daily.end, p_branch: code }),
        sb.rpc("amarsoft_leaderboard_v2", { p_start: start, p_end: end, p_branch: code }),
        sb.rpc("amarsoft_stock_summary"),
      ]);
      return {
        days: (days.data ?? []) as Day[],
        leaders: ((leaders.data ?? []) as Leader[]).sort((a, b) => Number(b.grams) - Number(a.grams)),
        stock: ((stock.data ?? []) as StockRow[]).filter((s) => s.branch_code === code),
      };
    },
  });
  const maxDay = Math.max(1, ...(extra.data?.days ?? []).map((d) => Number(d.sales_dirhams)));

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <Link to="/branches" className="inline-flex items-center gap-1 text-sm text-primary"><ArrowRight className="size-4" /> كل الفروع</Link>
      <div>
        <h1 className="text-2xl font-bold">{o?.branch_name ?? code}</h1>
        {o?.last_sale && <p className="text-xs text-muted-foreground">آخر بيعة: {formatTripoli(o.last_sale)}</p>}
      </div>
      <PeriodTabs period={period} setPeriod={setPeriod} />

      {!o ? (
        <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="المبيعات" value={formatLD(o.sales_dirhams)} tone="good" />
            <Stat label="الوزن المباع" value={formatGrams(o.grams)} />
            <Stat label="الفواتير" value={`${o.invoices}${o.returns ? ` (+${o.returns} مرتجع)` : ""}`} />
            <Stat label="متوسط سعر الغرام" value={`${n0(perGram(o))} د.ل`} />
            <Stat label="المصنعية المحصّلة" value={formatLD(o.making_dirhams)} />
            <Stat label="تكلفة المصنعية (المورّد)" value={formatLD(o.making_cost_dirhams)} />
            <Stat label="المخزون الآن" value={`${n0(Number(o.stock_pieces))} قطعة · ${formatGrams(o.stock_grams)}`} />
            <Stat label="زبائن اشتروا" value={n0(Number(o.customers))} />
            <Stat label="ممسوحة" value={o.deleted} tone={Number(o.deleted) ? "bad" : undefined} />
            <Stat label="فُتحت للتعديل" value={o.edited} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button asChild size="lg" variant="outline" className="h-14 text-base"><Link to={`/pos-sales?branch=${code}`}>فواتير الفرع</Link></Button>
            <Button asChild size="lg" variant="outline" className="h-14 text-base"><Link to={`/pos-stock?branch=${code}`}>مخزون الفرع</Link></Button>
          </div>

          {!!extra.data?.days.length && (
            <Card className="p-3">
              <h2 className="font-bold mb-2">المبيعات يوماً بيوم</h2>
              <div className="space-y-1">
                {[...extra.data.days].reverse().slice(0, 31).map((d) => (
                  <div key={d.day} className="flex items-center gap-2 text-xs">
                    <span className="w-16 shrink-0 text-muted-foreground" dir="ltr">{d.day.slice(5)}</span>
                    <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
                      <div className="h-full bg-primary/80" style={{ width: `${Math.round((Number(d.sales_dirhams) / maxDay) * 100)}%` }} />
                    </div>
                    <span className="w-24 shrink-0 text-left">{formatLD(d.sales_dirhams)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card className="p-3">
            <h2 className="font-bold mb-2">الموظفون</h2>
            {!extra.data?.leaders.length ? (
              <p className="text-sm text-muted-foreground">{Number(o.salesmen) ? "لا مبيعات بأسماء البائعين في هذه الفترة." : "لا يوجد بائعون في أمارسوفت لهذا الفرع — أضفهم في «الناقلين»."}</p>
            ) : extra.data.leaders.map((l, i) => (
              <div key={l.sman} className="flex justify-between py-1.5 text-sm border-b last:border-0">
                <span>{i + 1}. {l.salesman_name ?? l.sman}</span>
                <span>{formatGrams(l.grams)} · {l.invoices} فاتورة{l.net_dirhams != null ? ` · ${formatLD(l.net_dirhams)}` : ""}</span>
              </div>
            ))}
          </Card>

          {!!extra.data?.stock.length && (
            <Card className="p-3">
              <h2 className="font-bold mb-2">المخزون حسب العيار</h2>
              {extra.data.stock.map((s) => (
                <div key={s.karat ?? "?"} className="flex justify-between py-1 text-sm">
                  <span>عيار {s.karat ?? "?"}</span><span>{n0(Number(s.pieces))} قطعة · {formatGrams(s.grams)}</span>
                </div>
              ))}
            </Card>
          )}

          <div>
            <h2 className="font-bold mb-2">الممسوح والمعدّل</h2>
            <InvoiceChanges branch={code} compact />
          </div>
        </>
      )}
    </div>
  );
}
