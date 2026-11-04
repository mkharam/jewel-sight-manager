// مقبوضات اليوم كما سجّلها أمارسوفت للفرع (نقد/مصرف/بطاقة/آجل...) لمقارنتها بالإقفال.
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { sb, formatLD } from "@/lib/amarsoft";

const LABELS: Record<string, string> = { CASH: "نقداً", BANK: "مصرف", CARD: "بطاقة", CRE: "آجل" };

export default function AmarsoftDayPayments({ branchId, date }: { branchId: string; date: string }) {
  const { data } = useQuery({
    queryKey: ["amarsoft-day-payments", branchId, date],
    queryFn: async () => {
      const { data, error } = await sb.rpc("amarsoft_day_payments", { p_branch_id: branchId, p_date: date });
      if (error) throw error;
      return (data ?? []) as { account: string; amount_dirhams: number; invoices: number }[];
    },
  });
  if (!data) return null;
  const total = data.reduce((s, r) => s + Number(r.amount_dirhams), 0);
  return (
    <Card className="p-4 space-y-2">
      <div className="flex justify-between items-baseline">
        <h2 className="font-bold">في أمارسوفت لهذا اليوم</h2>
        <span className="font-bold text-primary">{formatLD(total)}</span>
      </div>
      {!data.length ? (
        <p className="text-sm text-muted-foreground">لا مبيعات مسجّلة في أمارسوفت لهذا اليوم.</p>
      ) : (
        <div className="divide-y text-sm">
          {data.map((r) => (
            <div key={r.account} className="flex justify-between py-1.5">
              <span>{LABELS[r.account] ?? r.account} <span className="text-xs text-muted-foreground">({r.invoices} فاتورة)</span></span>
              <span className="font-medium">{formatLD(r.amount_dirhams)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
