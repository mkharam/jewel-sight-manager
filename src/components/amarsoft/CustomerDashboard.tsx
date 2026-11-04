// لوحة العملاء: أكثر زبون تردد، أكثر زبون شرى، أكثر وزن، زبائن جدد ورجعوا، زبائن مهمين غابوا،
// وأعياد الميلاد — من مبيعات أمارسوفت. الأسماء الداخلية (ذهب مسبوك، بضاعة...) مستبعدة.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Phone } from "lucide-react";
import { toast } from "sonner";
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
const dmy = (iso: string) => iso.slice(0, 10);

export default function CustomerDashboard({ onOpen }: { onOpen: (customerId: string) => void }) {
  const qc = useQueryClient();
  const [days, setDays] = useState<number>(365);
  const { data, isLoading } = useQuery({
    queryKey: ["amarsoft-customer-insights", days],
    queryFn: async () => {
      const { data, error } = await sb.rpc("amarsoft_customer_insights", { p_start: startOf(days), p_end: new Date(Date.now() + 86_400_000).toISOString() });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });
  const exclude = useMutation({
    mutationFn: async (r: Row) => {
      const { error } = await sb.from("amarsoft_customer_exclusions").insert({ customer_key: r.customer_key, label: r.name });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("أُخفي من اللوحة"); qc.invalidateQueries({ queryKey: ["amarsoft-customer-insights"] }); },
    onError: (e: Error) => toast.error(e.message),
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
    };
  }, [data, days]);

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>;

  const List = ({ title, rows, metric, hint }: { title: string; rows: Row[]; metric: (r: Row) => string; hint?: string }) => (
    <Card className="p-3">
      <h3 className="font-bold text-base">{title}</h3>
      {hint && <p className="text-xs text-muted-foreground mb-1">{hint}</p>}
      {!rows.length ? <p className="text-sm text-muted-foreground py-2">لا أحد.</p> : rows.map((r, i) => (
        <div key={r.customer_key} className="flex items-center gap-2 py-2 border-b last:border-0">
          <span className="w-6 text-center font-bold text-muted-foreground">{i + 1}</span>
          <button className="flex-1 min-w-0 text-right" onClick={() => r.customer_id && onOpen(r.customer_id)}>
            <div className="font-bold truncate">{r.name}</div>
            <div className="text-xs text-muted-foreground truncate">
              {r.fav_type ? `يحب: ${r.fav_type}${r.fav_karat ? ` ${r.fav_karat}K` : ""} · ` : ""}آخر زيارة {dmy(r.last_at)} · {r.branches}
            </div>
          </button>
          <span className="text-sm font-bold text-primary shrink-0 text-left">{metric(r)}</span>
          {r.phone && <a href={`tel:${r.phone}`} className="p-2 text-primary" aria-label="اتصال"><Phone className="size-5" /></a>}
          <button className="text-[10px] text-muted-foreground underline shrink-0" onClick={() => exclude.mutate(r)}>مش زبون</button>
        </div>
      ))}
    </Card>
  );

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
      <List title="أكثر زبون تردد علينا" rows={v.byVisits} metric={(r) => `${r.visits} زيارة`} hint="عدد الأيام اللي شرى فيها" />
      <List title="أكثر زبون شرى" rows={v.bySpend} metric={(r) => formatLD(r.sales_dirhams)} />
      <List title="أكثر وزن" rows={v.byGrams} metric={(r) => formatGrams(r.grams)} />
      <List title="زبائن مهمين غابوا" rows={v.lost} metric={(r) => `${daysSince(r.last_at)} يوم`}
        hint="شروا مرتين أو أكثر وما رجعوش من 3 أشهر — اتصل بيهم" />
      {!!v.birthdays.length && <List title="أعياد ميلاد هذا الشهر 🎂" rows={v.birthdays} metric={(r) => r.dob!.slice(5)} />}
      <p className="text-xs text-muted-foreground text-center">
        من فواتير أمارسوفت اللي فيها اسم ورقم الزبون. «مش زبون» يخفي الأسماء الداخلية والعائلة من اللوحة.
      </p>
    </div>
  );
}
