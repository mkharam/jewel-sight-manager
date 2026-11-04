// لوحة العملاء: أكثر زبون تردد، أكثر زبون شرى، أكثر وزن، زبائن جدد ورجعوا، زبائن مهمين غابوا،
// وأعياد الميلاد — من مبيعات أمارسوفت. الأسماء الداخلية (ذهب مسبوك، بضاعة...) مستبعدة.
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Phone } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { sb, formatLD, formatGrams, tripoliToday } from "@/lib/amarsoft";

type Row = {
  customer_key: string; customer_id: string | null; name: string | null; phone: string | null; branches: string | null;
  visits: number; invoices: number; sales_dirhams: number; grams: number;
  life_visits: number; life_invoices: number; life_sales_dirhams: number; life_grams: number;
  first_at: string; last_at: string; fav_type: string | null; fav_karat: string | null; dob: string | null;
  identified: boolean; excluded: boolean;
};

const PERIODS = [
  { key: 30, label: "الشهر" }, { key: 90, label: "3 أشهر" }, { key: 365, label: "السنة" }, { key: 0, label: "الكل" },
] as const;

function startOf(days: number) {
  if (!days) return "2000-01-01T00:00:00+02:00";
  const d = new Date(`${tripoliToday()}T00:00:00+02:00`);
  d.setDate(d.getDate() - days);
  return d.toISOString();
}
const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
function ago(iso: string) {
  const d = daysSince(iso);
  return d <= 0 ? "اليوم" : d === 1 ? "أمس" : d < 30 ? `من ${d} يوم` : d < 365 ? `من ${Math.round(d / 30)} شهر` : `من ${Math.round(d / 365)} سنة`;
}

// أول 5 فقط، وزر «عرض المزيد» يفتح للعشرة — حتى ما تطولش الصفحة على الهاتف.
function ShowMore({ rows, render }: { rows: Row[]; render: (r: Row, i: number) => ReactNode }) {
  const [all, setAll] = useState(false);
  return (
    <>
      {(all ? rows : rows.slice(0, 5)).map(render)}
      {rows.length > 5 && (
        <Button variant="ghost" className="w-full mt-1 text-primary" onClick={() => setAll(!all)}>{all ? "أقل" : `عرض المزيد (${rows.length})`}</Button>
      )}
    </>
  );
}

export default function CustomerDashboard({ onOpen }: { onOpen: (customerId: string) => void }) {
  const [days, setDays] = useState<number>(365);
  const { data, isLoading } = useQuery({
    queryKey: ["amarsoft-customer-insights", days],
    queryFn: async () => {
      const { data, error } = await sb.rpc("amarsoft_customer_insights", { p_start: startOf(days), p_end: new Date(Date.now() + 86_400_000).toISOString() });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });
  const v = useMemo(() => {
    const all = (data ?? []).filter((r) => !r.excluded && r.identified);
    const active = all.filter((r) => Number(r.invoices) > 0);
    const start = new Date(startOf(days)).getTime();
    const month = tripoliToday().slice(5, 7);
    const top = (rows: Row[], key: (r: Row) => number) => [...rows].sort((a, b) => key(b) - key(a)).slice(0, 10);
    const sales = active.reduce((s, r) => s + Number(r.sales_dirhams), 0);
    const invoices = active.reduce((s, r) => s + Number(r.invoices), 0);
    return {
      active: active.length,
      newOnes: active.filter((r) => new Date(r.first_at).getTime() >= start).length,
      returning: active.filter((r) => Number(r.life_visits) > 1).length,
      avgTicket: invoices ? sales / invoices : 0,
      byVisits: top(active, (r) => Number(r.visits) * 1e12 + Number(r.sales_dirhams)),
      bySpend: top(active, (r) => Number(r.sales_dirhams)),
      byGrams: top(active, (r) => Number(r.grams)),
      lost: top(all.filter((r) => daysSince(r.last_at) > 90 && Number(r.life_visits) >= 2), (r) => Number(r.life_sales_dirhams)),
      birthdays: all.filter((r) => r.dob && r.dob.slice(5, 7) === month),
      multiBranch: top(all.filter((r) => (r.branches ?? "").includes("،")), (r) => Number(r.life_sales_dirhams)),
    };
  }, [data, days]);

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>;

  const List = (p: Omit<ListProps, "onOpen">) => <CustomerList {...p} onOpen={onOpen} />;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-1.5">
        {PERIODS.map((p) => (
          <Button key={p.key} size="lg" variant={days === p.key ? "default" : "outline"} onClick={() => setDays(p.key)} className="text-base">{p.label}</Button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Card className="p-3"><div className="text-xs text-muted-foreground">زبائن اشتروا</div><div className="text-2xl font-bold">{v.active}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">زبائن جدد</div><div className="text-2xl font-bold">{v.newOnes}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">رجعوا أكثر من مرة</div><div className="text-2xl font-bold">{v.returning}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">متوسط الفاتورة</div><div className="text-xl font-bold">{formatLD(v.avgTicket)}</div></Card>
      </div>
      {List({ title: "أكثر زبون تردد علينا", rows: v.byVisits, metric: (r) => `${r.visits} زيارة`, sub: (r) => formatLD(r.sales_dirhams), hint: "عدد الأيام اللي شرى فيها" })}
      {List({ title: "أكثر زبون شرى", rows: v.bySpend, metric: (r) => formatLD(r.sales_dirhams), sub: (r) => `${r.invoices} فاتورة` })}
      {List({ title: "أكثر وزن", rows: v.byGrams, metric: (r) => formatGrams(r.grams), sub: (r) => formatLD(r.sales_dirhams) })}
      {List({ title: "زبائن مهمين غابوا", rows: v.lost, metric: (r) => ago(r.last_at), sub: (r) => `شرى ${formatLD(r.life_sales_dirhams)}`,
        hint: "شروا مرتين أو أكثر وما رجعوش من 3 أشهر — اتصل بيهم" })}
      {!!v.multiBranch.length && List({ title: "زاروا أكثر من فرع", rows: v.multiBranch, metric: (r) => formatLD(r.life_sales_dirhams), sub: (r) => `${r.life_invoices} فاتورة`,
        hint: "الفروع مكتوبة تحت الاسم" })}
      {!!v.birthdays.length && List({ title: "أعياد ميلاد هذا الشهر 🎂", rows: v.birthdays, metric: (r) => r.dob!.slice(5) })}
      <p className="text-xs text-muted-foreground text-center">
        من فواتير أمارسوفت اللي فيها اسم ورقم الزبون. الأسماء الداخلية (ذهب مسبوك، بضاعة...) مستبعدة.
      </p>
    </div>
  );
}

type ListProps = { title: string; rows: Row[]; metric: (r: Row) => string; sub?: (r: Row) => string; hint?: string; onOpen: (customerId: string) => void };

function CustomerList({ title, rows, metric, sub, hint, onOpen }: ListProps) {
  return (
    <Card className="p-3">
      <h3 className="font-bold text-lg">{title}</h3>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {!rows.length ? <p className="text-sm text-muted-foreground py-2">لا أحد.</p> : (
        <ShowMore rows={rows} render={(r, i) => {
          const body = (
            <>
              <span className={`size-8 shrink-0 rounded-full flex items-center justify-center font-bold ${i < 3 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{i + 1}</span>
              <div className="flex-1 min-w-0 text-right">
                <div className="font-bold text-base truncate">{r.name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {r.branches} · {ago(r.last_at)}{r.fav_type ? ` · يحب ${r.fav_type}${r.fav_karat ? ` ${r.fav_karat}` : ""}` : ""}
                </div>
              </div>
              <div className="shrink-0 text-left">
                <div className="font-bold text-primary">{metric(r)}</div>
                {sub && <div className="text-[11px] text-muted-foreground">{sub(r)}</div>}
              </div>
            </>
          );
          return (
            <div key={r.customer_key} className="flex items-center gap-2 py-2.5 border-b last:border-0">
              {r.customer_id
                ? <button className="flex flex-1 min-w-0 items-center gap-2" onClick={() => onOpen(r.customer_id!)}>{body}</button>
                : <div className="flex flex-1 min-w-0 items-center gap-2">{body}</div>}
              {r.phone && <a href={`tel:${r.phone}`} className="size-10 shrink-0 rounded-full bg-primary/10 text-primary flex items-center justify-center" aria-label={`اتصال ${r.phone}`}><Phone className="size-5" /></a>}
            </div>
          );
        }} />
      )}
    </Card>
  );
}
