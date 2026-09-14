// بطاقة "مبيعاتي" — كل موظف يشوف أداءه الشخصي (عدد القطع + القيمة) بدون حاجة يسأل
// المدير، عكس لوحة الصدارة في Staff.tsx اللي مقصورة على المدير العام. تعتمد على سياسة
// RLS "read own sales" (sold_by = auth.uid()) فيبقى كل موظف يشوف مبيعاته هو فقط.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Coins, Package, TrendingUp } from "lucide-react";
import { formatCurrency, periodStartISO, PERIOD_LABEL, type Period } from "@/lib/constants";

export default function MySalesCard() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<Period>("today");
  const [stats, setStats] = useState<{ count: number; total: number } | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setStats(null);
      const { data, error } = await supabase
        .from("sales")
        .select("final_price")
        .eq("sold_by", user.id)
        .gte("sold_at", periodStartISO(period))
        .is("returned_at", null);
      if (cancelled) return;
      if (error) { setStats({ count: 0, total: 0 }); return; }
      const rows = data ?? [];
      setStats({ count: rows.length, total: rows.reduce((s, r) => s + (Number(r.final_price) || 0), 0) });
    })();
    return () => { cancelled = true; };
  }, [user, period]);

  if (!user) return null;

  return (
    <Card className="p-3.5 bg-gold-soft border-primary/20">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-sm font-bold flex items-center gap-1.5">
          <TrendingUp className="size-4 text-primary" /> مبيعاتي
        </p>
        <div className="flex rounded-lg border overflow-hidden shrink-0">
          {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2 h-7 text-[11px] font-semibold transition-colors ${
                period === p ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground"
              }`}
            >
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <Package className="size-4 text-muted-foreground" />
          <span className="font-bold">{stats?.count ?? "—"}</span>
          <span className="text-xs text-muted-foreground">قطعة</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Coins className="size-4 text-muted-foreground" />
          <span className="font-bold text-primary">{stats ? formatCurrency(stats.total) : "—"}</span>
        </div>
      </div>
    </Card>
  );
}
