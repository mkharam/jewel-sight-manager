import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { BarChart3, Download, TrendingUp, ArrowLeftRight, Package, DollarSign, Clock, AlertTriangle, Receipt, Undo2, Wallet, Plus, Trash2 } from "lucide-react";
import ReindexImagesCard from "@/components/ReindexImagesCard";
import GenerateThumbsCard from "@/components/GenerateThumbsCard";
import { useConfirm } from "@/components/ConfirmDialogProvider";
import { toast } from "sonner";

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
  const { roles, rolesLoading, profile } = useAuth();
  const isAdmin = roles.includes("admin");
  const isManager = roles.includes("manager");
  const myBranchId = profile?.branch_id ?? null;
  const monthOptions = useMemo(() => buildMonthOptions(18), []);
  const [month, setMonth] = useState(monthOptions[0].value);
  const { startISO, endISO } = useMemo(() => monthRange(month), [month]);

  const { data: branches = [] } = useQuery({
    queryKey: ["branches-all", isAdmin ? "all" : myBranchId],
    queryFn: async () => {
      let q = supabase.from("branches").select("id, name, code").order("name");
      // مدير الفرع يرى فرعه فقط
      if (!isAdmin && myBranchId) q = q.eq("id", myBranchId);
      const { data } = await q;
      return (data ?? []) as Branch[];
    },
  });

  // الأرقام (الإيراد، تكلفة البضاعة، الأعداد بالفرع) تأتي من report_branch_summary لا
  // من جمع هذه الصفوف يدوياً — راجع التعليق على "summary" أدناه. هذا الجلب هنا لعرض
  // "آخر الأسعار المسجَّلة" فقط، فحدّ 200 مقصود وموثَّق لا حداً ضمنياً من Supabase.
  const { data: quotes = [] } = useQuery({
    queryKey: ["report-quotes", month],
    queryFn: async () => {
      const { data } = await supabase
        .from("product_quotes")
        .select("id, branch_id, price, customer_name, created_at, product_id, products(name, sku)")
        .gte("created_at", startISO)
        .lt("created_at", endISO)
        .order("created_at", { ascending: false })
        .limit(200);
      return data ?? [];
    },
  });

  // مصاريف المحل خلال نفس الشهر — إيجار/رواتب/صيانة... لحساب صافي الربح الحقيقي لا
  // الإيراد فقط. راجع بطاقة "المصاريف" أسفل الصفحة لإضافة/حذف مصروف. القائمة تُعرض
  // كاملة (لا slice) فيلزم أن تكون شاملة فعلاً — حدّ 500 سخيّ جداً لمصاريف شهر واحد.
  const { data: expenses = [] } = useQuery({
    queryKey: ["report-expenses", month],
    queryFn: async () => {
      const { data } = await supabase
        .from("expenses")
        .select("id, branch_id, category, amount, note, expense_date, created_at")
        .gte("expense_date", startISO.slice(0, 10))
        .lt("expense_date", endISO.slice(0, 10))
        .order("expense_date", { ascending: false })
        .limit(500);
      return data ?? [];
    },
  });

  // نفس ملاحظة quotes أعلاه: هذا الجلب لعرض "آخر التحويلات" فقط، الأعداد من الدالة.
  const { data: transfers = [] } = useQuery({
    queryKey: ["report-transfers", month],
    queryFn: async () => {
      const { data } = await supabase
        .from("transfers")
        .select("id, from_branch_id, to_branch_id, status, product_name_snapshot, created_at")
        .gte("created_at", startISO)
        .lt("created_at", endISO)
        .order("created_at", { ascending: false })
        .limit(200);
      return data ?? [];
    },
  });

  // الأرقام الفعلية (الإيراد، تكلفة البضاعة، عدد المبيعات/التحويلات/القطع الجديدة بكل
  // فرع) تُحسب في قاعدة البيانات على كل الصفوف — لا بجمع صفوف quotes/transfers المجلوبة
  // أعلاه للعرض فقط (وحدّها 200 مقصود لذاك الغرض تحديداً، لا يصلح مصدراً لرقم مالي).
  // نفس الدرس الذي صُحِّح في sales_totals وstaff_activity_counts سابقاً.
  const { data: branchSummary } = useQuery({
    queryKey: ["report-branch-summary", month],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("report_branch_summary", { p_start: startISO, p_end: endISO });
      if (error) throw error;
      return data ?? [];
    },
  });

  // لقطة المخزون الحيّة (القطع المتوفرة الآن) محسوبة أيضاً في القاعدة — بلا حدّ زمني
  // فتكبر مع نمو المخزون كله لا شهراً واحداً، وهذا ما كان يجعلها الأخطر بين الاستعلامات
  // القديمة هنا.
  const { data: inventorySnapshot } = useQuery({
    queryKey: ["report-inventory-snapshot"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("report_inventory_snapshot");
      if (error) throw error;
      return data ?? [];
    },
  });

  // أقدم ١٠ قطع متوفرة — استعلام مُرتَّب ومحدود فعلياً (لا جلب الكل ثم فرز في المتصفح)،
  // فالحدّ هنا جزء من المعنى المطلوب (أقدم ١٠) لا حداً ضمنياً يُخشى منه.
  const { data: stalestPieces = [] } = useQuery({
    queryKey: ["report-stalest-pieces"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, branch_id, name, sku, created_at")
        .eq("status", "available")
        .order("created_at", { ascending: true })
        .limit(10);
      if (error) throw error;
      const now = Date.now();
      return (data ?? [])
        .map((p) => ({ ...p, days: Math.floor((now - new Date(p.created_at).getTime()) / (1000 * 60 * 60 * 24)) }))
        .filter((p) => p.days >= 90);
    },
  });

  const summary = useMemo(() => {
    const nameOf = new Map(branches.map((b) => [b.id, b.name]));
    return (branchSummary ?? []).map((r) => ({
      branch_id: r.branch_id,
      name: nameOf.get(r.branch_id) ?? "—",
      quotes: Number(r.quotes),
      salesCount: Number(r.sales_count),
      returnsCount: Number(r.returns_count),
      revenue: Number(r.revenue),
      cogs: Number(r.cogs),
      transfersOut: Number(r.transfers_out),
      transfersIn: Number(r.transfers_in),
      transfersReceived: Number(r.transfers_received),
      newProducts: Number(r.new_products),
    }));
  }, [branches, branchSummary]);

  const totals = useMemo(() => {
    const base = summary.reduce(
      (acc, r) => ({
        quotes: acc.quotes + r.quotes,
        salesCount: acc.salesCount + r.salesCount,
        returnsCount: acc.returnsCount + r.returnsCount,
        revenue: acc.revenue + r.revenue,
        cogs: acc.cogs + r.cogs,
        transfersOut: acc.transfersOut + r.transfersOut,
        newProducts: acc.newProducts + r.newProducts,
      }),
      { quotes: 0, salesCount: 0, returnsCount: 0, revenue: 0, cogs: 0, transfersOut: 0, newProducts: 0 },
    );
    const totalExpenses = expenses.reduce((sum, e: any) => sum + Number(e.amount ?? 0), 0);
    // صافي الربح = الإيراد - تكلفة البضاعة المباعة - مصاريف الشهر. ملاحظة: cost_price
    // هو التكلفة الحالية للقطعة لا لحظة بيعها بالضبط (غير محفوظة كلقطة وقت البيع).
    const netProfit = base.revenue - base.cogs - totalExpenses;
    return { ...base, totalExpenses, netProfit };
  }, [summary, expenses]);

  // Inventory value + aging (available stock only)
  const inventoryByBranch = useMemo(() => {
    const nameOf = new Map(branches.map((b) => [b.id, b.name]));
    return (inventorySnapshot ?? []).map((r) => ({
      branch_id: r.branch_id,
      name: nameOf.get(r.branch_id) ?? "—",
      count: Number(r.count),
      valueSale: Number(r.value_sale),
      valueCost: Number(r.value_cost),
      age60: Number(r.age60),
      age90: Number(r.age90),
      age180: Number(r.age180),
      agePlus: Number(r.age_plus),
    }));
  }, [branches, inventorySnapshot]);

  const inventoryTotals = useMemo(() => {
    return inventoryByBranch.reduce(
      (acc, r) => ({
        count: acc.count + r.count,
        valueSale: acc.valueSale + r.valueSale,
        valueCost: acc.valueCost + r.valueCost,
        stale: acc.stale + r.age180 + r.agePlus,
      }),
      { count: 0, valueSale: 0, valueCost: 0, stale: 0 },
    );
  }, [inventoryByBranch]);

  useEffect(() => {
    document.title = `جرد شهري | ${monthOptions.find((o) => o.value === month)?.label ?? ""}`;
  }, [month, monthOptions]);

  const exportCSV = () => {
    const header = ["الفرع", "عدد المبيعات", "مُرجعة", "إجمالي الإيراد (د.ل)", "عروض أسعار", "تحويلات صادرة", "تحويلات واردة", "استلمت فعلياً", "قطع جديدة"];
    const rows = summary.map((r) => [
      r.name,
      r.salesCount,
      r.returnsCount,
      r.revenue.toFixed(2),
      r.quotes,
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
  // التقارير أمر إداري/حسابي — للمدير العام فقط الآن (كان متاحاً للمشرف أيضاً).
  if (!isAdmin) return <Navigate to="/" replace />;

  const fmt = (n: number) => new Intl.NumberFormat("ar-LY-u-nu-latn", { maximumFractionDigits: 2 }).format(n);

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

      {/* صافي الربح الحقيقي = الإيراد - تكلفة البضاعة المباعة - مصاريف الشهر، لا الإيراد
          وحده. بطاقة منفصلة أعلى البقية عمداً لأنها الرقم اللي المالك فعلاً محتاجه. */}
      <div className="rounded-2xl bg-gold-gradient p-4 flex items-center justify-between gap-3 shadow-gold">
        <div>
          <p className="text-xs text-primary-foreground/80 mb-0.5">صافي الربح الحقيقي هذا الشهر</p>
          <p className="text-2xl font-extrabold text-primary-foreground">{fmt(totals.netProfit)} د.ل</p>
          <p className="text-[11px] text-primary-foreground/70 mt-1">
            الإيراد {fmt(totals.revenue)} − تكلفة البضاعة {fmt(totals.cogs)} − المصاريف {fmt(totals.totalExpenses)}
          </p>
        </div>
        <TrendingUp className="size-10 text-primary-foreground/50 shrink-0" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={<DollarSign className="size-4" />} label="إجمالي الإيراد (مبيعات فعلية)" value={`${fmt(totals.revenue)} د.ل`} />
        <StatCard icon={<Receipt className="size-4" />} label="عدد المبيعات" value={fmt(totals.salesCount)} />
        {totals.returnsCount > 0 && (
          <StatCard icon={<Undo2 className="size-4" />} label="مبيعات مُرجعة" value={fmt(totals.returnsCount)} />
        )}
        <StatCard icon={<TrendingUp className="size-4" />} label="عدد عروض الأسعار" value={fmt(totals.quotes)} />
        <StatCard icon={<ArrowLeftRight className="size-4" />} label="تحويلات بين الفروع" value={fmt(totals.transfersOut)} />
        <StatCard icon={<Package className="size-4" />} label="قطع جديدة أُضيفت" value={fmt(totals.newProducts)} />
      </div>

      <ExpensesCard month={month} expenses={expenses as any[]} branches={branches} fmt={fmt} />

      {/* Live inventory snapshot — قيمة المخزون الحالية + القطع الراكدة */}
      <div className="rounded-2xl bg-gold-soft border border-primary/20 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Package className="size-4 text-primary" />
          <h2 className="font-bold text-sm">جرد المخزون الحالي (المتوفر)</h2>
          <span className="text-[11px] text-muted-foreground mr-auto">لحظي — لا يتأثر بالشهر المختار</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={<Package className="size-4" />} label="قطع متوفرة" value={fmt(inventoryTotals.count)} />
          <StatCard icon={<DollarSign className="size-4" />} label="قيمة البيع الإجمالية" value={`${fmt(inventoryTotals.valueSale)} د.ل`} />
          <StatCard icon={<DollarSign className="size-4" />} label="قيمة التكلفة" value={`${fmt(inventoryTotals.valueCost)} د.ل`} />
          <StatCard icon={<AlertTriangle className="size-4" />} label="راكد +180 يوم" value={fmt(inventoryTotals.stale)} />
        </div>
      </div>

      {/* صيانة الذكاء الاصطناعي — إعادة فهرسة الصور غير المحلَّلة */}
      <ReindexImagesCard />
      <GenerateThumbsCard />

      {/* Aging report per branch */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="size-4 text-primary" />
            القطع الراكدة حسب الفرع
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الفرع</TableHead>
                <TableHead className="text-center">إجمالي متوفر</TableHead>
                <TableHead className="text-center">أقل من 60 يوم</TableHead>
                <TableHead className="text-center">60 - 90</TableHead>
                <TableHead className="text-center text-amber-600">90 - 180</TableHead>
                <TableHead className="text-center text-destructive">أكثر من 180</TableHead>
                <TableHead className="text-center">قيمة البيع (د.ل)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inventoryByBranch.map((r) => (
                <TableRow key={r.branch_id}>
                  <TableCell className="font-semibold">{r.name}</TableCell>
                  <TableCell className="text-center">{fmt(r.count)}</TableCell>
                  <TableCell className="text-center">{fmt(r.age60)}</TableCell>
                  <TableCell className="text-center">{fmt(r.age90)}</TableCell>
                  <TableCell className="text-center text-amber-600 font-semibold">{fmt(r.age180)}</TableCell>
                  <TableCell className="text-center text-destructive font-bold">{fmt(r.agePlus)}</TableCell>
                  <TableCell className="text-center font-mono">{fmt(r.valueSale)}</TableCell>
                </TableRow>
              ))}
              {inventoryByBranch.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">لا يوجد مخزون متوفر</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Top stalest pieces to prioritize for sale / transfer */}
      {stalestPieces.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="size-4 text-destructive" />
              أقدم 10 قطع راكدة (اقتراح للبيع أو النقل)
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-80 overflow-y-auto">
            <ul className="space-y-2 text-sm">
              {stalestPieces.map((p: any) => (
                <li key={p.id} className="flex justify-between items-center border-b border-border/60 pb-1">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {p.sku ?? "—"} · {branches.find((b) => b.id === p.branch_id)?.name ?? "—"}
                    </p>
                  </div>
                  <span className="text-xs px-2 py-1 rounded bg-destructive/10 text-destructive font-bold whitespace-nowrap">
                    {p.days} يوم
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">ملخص كل فرع</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الفرع</TableHead>
                <TableHead className="text-center">مبيعات</TableHead>
                <TableHead className="text-center">مُرجعة</TableHead>
                <TableHead className="text-center">إيراد (د.ل)</TableHead>
                <TableHead className="text-center">عروض أسعار</TableHead>
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
                  <TableCell className="text-center">{fmt(r.salesCount)}</TableCell>
                  <TableCell className={"text-center " + (r.returnsCount > 0 ? "text-destructive font-semibold" : "text-muted-foreground")}>
                    {fmt(r.returnsCount)}
                  </TableCell>
                  <TableCell className="text-center font-mono">{fmt(r.revenue)}</TableCell>
                  <TableCell className="text-center">{fmt(r.quotes)}</TableCell>
                  <TableCell className="text-center">{fmt(r.transfersOut)}</TableCell>
                  <TableCell className="text-center">{fmt(r.transfersIn)}</TableCell>
                  <TableCell className="text-center text-primary font-semibold">{fmt(r.transfersReceived)}</TableCell>
                  <TableCell className="text-center">{fmt(r.newProducts)}</TableCell>
                </TableRow>
              ))}
              {summary.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">لا توجد فروع</TableCell></TableRow>
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

const EXPENSE_CATEGORIES = ["إيجار", "رواتب", "صيانة", "كهرباء وماء", "تسويق", "نقل", "أخرى"];

function ExpensesCard({
  month, expenses, branches, fmt,
}: { month: string; expenses: any[]; branches: Branch[]; fmt: (n: number) => string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [amount, setAmount] = useState("");
  const [branchId, setBranchId] = useState<string>("none");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  const total = expenses.reduce((s, e) => s + Number(e.amount ?? 0), 0);

  const resetForm = () => { setCategory(EXPENSE_CATEGORIES[0]); setAmount(""); setBranchId("none"); setNote(""); setDate(new Date().toISOString().slice(0, 10)); };

  const addExpense = async () => {
    if (!amount || Number(amount) <= 0) return toast.error("اكتب المبلغ");
    const { error } = await supabase.from("expenses").insert({
      category,
      amount: Number(amount),
      branch_id: branchId === "none" ? null : branchId,
      note: note.trim() || null,
      expense_date: date,
      created_by: user?.id ?? null,
    });
    if (error) return toast.error(error.message);
    toast.success("تم تسجيل المصروف");
    setOpen(false);
    resetForm();
    qc.invalidateQueries({ queryKey: ["report-expenses", month] });
  };

  const deleteExpense = async (id: string) => {
    const ok = await confirm({ title: "حذف هذا المصروف؟", confirmLabel: "حذف", destructive: true });
    if (!ok) return;
    const { error } = await supabase.from("expenses").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["report-expenses", month] });
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <Wallet className="size-4 text-primary" /> المصاريف — {fmt(total)} د.ل
        </CardTitle>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetForm(); }}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline"><Plus className="size-3.5 ml-1" /> مصروف جديد</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>تسجيل مصروف</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>النوع</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EXPENSE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label>المبلغ (د.ل) *</Label><Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></div>
                <div className="space-y-1.5">
                  <Label>الفرع (اختياري)</Label>
                  <Select value={branchId} onValueChange={setBranchId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">عام (كل الفروع)</SelectItem>
                      {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label>التاريخ</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
              </div>
              <div className="space-y-1.5"><Label>ملاحظة</Label><Input value={note} onChange={(e) => setNote(e.target.value)} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
              <Button onClick={addExpense} className="bg-gold-gradient text-primary-foreground">حفظ</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {expenses.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">لا مصاريف مسجّلة هذا الشهر</p>
        ) : (
          <ul className="space-y-2 text-sm max-h-72 overflow-y-auto">
            {expenses.map((e: any) => (
              <li key={e.id} className="flex justify-between items-center border-b border-border/60 pb-1.5">
                <div className="min-w-0">
                  <p className="font-medium">{e.category}{e.note ? ` — ${e.note}` : ""}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.expense_date} · {branches.find((b) => b.id === e.branch_id)?.name ?? "عام"}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-mono text-destructive">-{fmt(Number(e.amount))}</span>
                  <button onClick={() => deleteExpense(e.id)} aria-label="حذف" className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
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
