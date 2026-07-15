import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart3, Download, TrendingUp, ArrowLeftRight, Package, DollarSign } from "lucide-react";

type Branch = { id: string; name: string; code: string | null };

function monthRange(ym: string) {
  // ym = "YYYY-MM"
  const [y, m] = ym.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

function buildMonthOptions(count = 12) {
  const out: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("ar-LY", { year: "numeric", month: "long" });
    out.push({ value, label });
  }
  return out;
}

export default function Reports() {
  const { roles, rolesLoading } = useAuth();
  const isAdmin = roles.includes("admin");
  const monthOptions = useMemo(() => buildMonthOptions(18), []);
  const [month, setMonth] = useState(monthOptions[0].value);
  const { startISO, endISO } = useMemo(() => monthRange(month), [month]);

  const { data: branches = [] } = useQuery({
    queryKey: ["branches-all"],
    queryFn: async () => {
      const { data } = await supabase.from("branches").select("id, name, code").order("name");
      return (data ?? []) as Branch[];
    },
  });

  const { data: quotes = [] } = useQuery({
    queryKey: ["report-quotes", month],
    queryFn: async () => {
      const { data } = await supabase
        .from("product_quotes")
        .select("id, branch_id, price, customer_name, created_at, product_id, products(name, sku)")
        .gte("created_at", startISO)
        .lt("created_at", endISO);
      return data ?? [];
    },
  });

  const { data: transfers = [] } = useQuery({
    queryKey: ["report-transfers", month],
    queryFn: async () => {
      const { data } = await supabase
        .from("transfers")
        .select("id, from_branch_id, to_branch_id, status, product_name_snapshot, created_at")
        .gte("created_at", startISO)
        .lt("created_at", endISO);
      return data ?? [];
    },
  });

  const { data: newProducts = [] } = useQuery({
    queryKey: ["report-new-products", month],
    queryFn: async () => {
      const { data } = await supabase
        .from("products")
        .select("id, branch_id, name, sku, created_at")
        .gte("created_at", startISO)
        .lt("created_at", endISO);
      return data ?? [];
    },
  });

  const summary = useMemo(() => {
    const map = new Map<string, {
      branch_id: string;
      name: string;
      quotes: number;
      revenue: number;
      transfersOut: number;
      transfersIn: number;
      transfersReceived: number;
      newProducts: number;
    }>();
    for (const b of branches) {
      map.set(b.id, {
        branch_id: b.id,
        name: b.name,
        quotes: 0,
        revenue: 0,
        transfersOut: 0,
        transfersIn: 0,
        transfersReceived: 0,
        newProducts: 0,
      });
    }
    for (const q of quotes) {
      if (!q.branch_id) continue;
      const row = map.get(q.branch_id);
      if (!row) continue;
      row.quotes += 1;
      row.revenue += Number(q.price ?? 0);
    }
    for (const t of transfers) {
      const from = map.get(t.from_branch_id);
      const to = map.get(t.to_branch_id);
      if (from) from.transfersOut += 1;
      if (to) {
        to.transfersIn += 1;
        if (t.status === "received") to.transfersReceived += 1;
      }
    }
    for (const p of newProducts) {
      if (!p.branch_id) continue;
      const row = map.get(p.branch_id);
      if (row) row.newProducts += 1;
    }
    return Array.from(map.values());
  }, [branches, quotes, transfers, newProducts]);

  const totals = useMemo(() => {
    return summary.reduce(
      (acc, r) => ({
        quotes: acc.quotes + r.quotes,
        revenue: acc.revenue + r.revenue,
        transfersOut: acc.transfersOut + r.transfersOut,
        newProducts: acc.newProducts + r.newProducts,
      }),
      { quotes: 0, revenue: 0, transfersOut: 0, newProducts: 0 },
    );
  }, [summary]);

  useEffect(() => {
    document.title = `جرد شهري | ${monthOptions.find((o) => o.value === month)?.label ?? ""}`;
  }, [month, monthOptions]);

  const exportCSV = () => {
    const header = ["الفرع", "عروض أسعار", "إجمالي المبيعات (د.ل)", "تحويلات صادرة", "تحويلات واردة", "استلمت فعلياً", "قطع جديدة"];
    const rows = summary.map((r) => [
      r.name,
      r.quotes,
      r.revenue.toFixed(2),
      r.transfersOut,
      r.transfersIn,
      r.transfersReceived,
      r.newProducts,
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `جرد-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (rolesLoading) return null;
  if (!isAdmin) return <Navigate to="/" replace />;

  const fmt = (n: number) => new Intl.NumberFormat("ar-LY", { maximumFractionDigits: 2 }).format(n);

  return (
    <div className="space-y-4">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-gold-gradient flex items-center justify-center shadow-gold">
            <BarChart3 className="size-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-gold-gradient">الجرد الشهري</h1>
            <p className="text-xs text-muted-foreground">ملخص أداء كل فرع خلال الشهر المختار</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              {monthOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={exportCSV}><Download className="size-4 ml-1" />تصدير CSV</Button>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={<DollarSign className="size-4" />} label="إجمالي المبيعات" value={`${fmt(totals.revenue)} د.ل`} />
        <StatCard icon={<TrendingUp className="size-4" />} label="عدد عروض الأسعار" value={fmt(totals.quotes)} />
        <StatCard icon={<ArrowLeftRight className="size-4" />} label="تحويلات بين الفروع" value={fmt(totals.transfersOut)} />
        <StatCard icon={<Package className="size-4" />} label="قطع جديدة أُضيفت" value={fmt(totals.newProducts)} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">ملخص كل فرع</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الفرع</TableHead>
                <TableHead className="text-center">مبيعات (عروض)</TableHead>
                <TableHead className="text-center">إجمالي (د.ل)</TableHead>
                <TableHead className="text-center">صادر</TableHead>
                <TableHead className="text-center">وارد</TableHead>
                <TableHead className="text-center">استُلم</TableHead>
                <TableHead className="text-center">قطع جديدة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.map((r) => (
                <TableRow key={r.branch_id}>
                  <TableCell className="font-semibold">{r.name}</TableCell>
                  <TableCell className="text-center">{fmt(r.quotes)}</TableCell>
                  <TableCell className="text-center font-mono">{fmt(r.revenue)}</TableCell>
                  <TableCell className="text-center">{fmt(r.transfersOut)}</TableCell>
                  <TableCell className="text-center">{fmt(r.transfersIn)}</TableCell>
                  <TableCell className="text-center text-primary font-semibold">{fmt(r.transfersReceived)}</TableCell>
                  <TableCell className="text-center">{fmt(r.newProducts)}</TableCell>
                </TableRow>
              ))}
              {summary.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">لا توجد فروع</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">آخر المبيعات (عروض الأسعار)</CardTitle></CardHeader>
          <CardContent className="max-h-80 overflow-y-auto">
            {quotes.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">لا مبيعات هذا الشهر</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {quotes.slice(0, 50).map((q: any) => (
                  <li key={q.id} className="flex justify-between items-center border-b border-border/60 pb-1">
                    <div>
                      <p className="font-medium">{q.products?.name ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">{q.customer_name ?? "زبون"} · {branches.find(b => b.id === q.branch_id)?.name ?? "—"}</p>
                    </div>
                    <span className="font-mono text-primary">{fmt(Number(q.price))} د.ل</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">حركة التحويلات</CardTitle></CardHeader>
          <CardContent className="max-h-80 overflow-y-auto">
            {transfers.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">لا تحويلات هذا الشهر</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {transfers.slice(0, 50).map((t: any) => (
                  <li key={t.id} className="flex justify-between items-center border-b border-border/60 pb-1">
                    <div>
                      <p className="font-medium">{t.product_name_snapshot ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">
                        {branches.find(b => b.id === t.from_branch_id)?.name ?? "—"} ← {branches.find(b => b.id === t.to_branch_id)?.name ?? "—"}
                      </p>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded bg-secondary">{t.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">{icon}{label}</div>
        <p className="text-xl font-extrabold text-gold-gradient">{value}</p>
      </CardContent>
    </Card>
  );
}
