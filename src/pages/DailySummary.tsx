// الملخّص اليومي — صفحة واحدة يفتحها المالك أول شي، بدل أن يجمع الصورة من خمس صفحات
// (المبيعات، الجرد، الاستفسارات، إعادة الطلب، نشاط الموظفين). كل الأرقام "منذ منتصف
// الليل المحلي حتى الآن"، وتُحسب في قاعدة البيانات على كل الصفوف — لا عيّنة محدودة
// تُجلب للعرض (نفس درس staff_activity_counts وsales_totals). راجع daily_summary.
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { attachStaffNames } from "@/lib/staffNames";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CalendarDays, Package, Tag, MessageCircle, Receipt, PackagePlus, ArrowLeftRight,
  Scale, TrendingUp, Loader2, Landmark,
} from "lucide-react";
import { formatCurrency } from "@/lib/constants";
import { businessToday } from "@/lib/dates";

function todayStartISO() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
}

export default function DailySummary() {
  const since = useMemo(todayStartISO, []);

  const { data: summary, isLoading } = useQuery({
    queryKey: ["daily-summary", since],
    // يُبطَل تلقائياً كل بضع دقائق فقط — هذه صفحة مراجعة صباحية لا شاشة مباشرة، ولا
    // داعي لاشتراك realtime يراقب خمسة جداول لأجل رقم يُقرأ مرة أو مرتين في اليوم.
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("daily_summary", { p_since: since });
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  const { data: perEmployee } = useQuery({
    queryKey: ["daily-summary-staff", since],
    queryFn: async () => {
      const { data: counts, error } = await supabase.rpc("staff_activity_counts", { p_since: since });
      if (error) throw error;
      const { data: profs } = await supabase.from("profiles").select("id, full_name");
      const nameMap = new Map((profs ?? []).map((p: any) => [p.id, p.full_name]));
      const rows = ((counts ?? []) as any[])
        .map((c) => ({ ...c, full_name: nameMap.get(c.user_id) ?? "—" }))
        .filter((c) => c.products + c.quotes + c.transfers + c.inquiries + c.sales > 0)
        .sort((a, b) => (b.sales - a.sales) || (b.products - a.products));
      return rows;
    },
  });

  const { data: missingWeights } = useQuery({
    queryKey: ["daily-summary-missing-weights"],
    queryFn: async () => {
      const { count } = await supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .is("weight_grams", null)
        .eq("status", "available");
      return count ?? 0;
    },
  });

  // أي الفروع أقفلت اليوم — المالك يرى فوراً من لم يُقفل ومن عنده فرق.
  const { data: closingStatus } = useQuery({
    queryKey: ["daily-summary-closings", businessToday()],
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const db = supabase as any;
      const [{ data: br }, { data: cl }] = await Promise.all([
        supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
        db.from("daily_closings").select("branch_id, diff_cash, diff_card, diff_transfer").eq("closing_date", businessToday()),
      ]);
      const byBranch = new Map<string, any>(((cl ?? []) as any[]).map((c) => [c.branch_id, c]));
      return ((br ?? []) as any[]).map((b) => {
        const c = byBranch.get(b.id);
        const diff = c ? [c.diff_cash, c.diff_card, c.diff_transfer].some((d: number) => Math.abs(Number(d)) > 0.004) : false;
        return { id: b.id, name: b.name, closed: !!c, diff };
      });
    },
  });

  const dateLabel = new Intl.DateTimeFormat("ar-u-nu-latn", { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date());

  const stats = [
    { icon: Package, label: "قطع أُضيفت", value: summary?.products_added, href: "/admin/products" },
    { icon: Tag, label: "أسعار سُجّلت لزبائن", value: summary?.quotes_given, href: "/inquiries" },
    { icon: MessageCircle, label: "استفسارات جديدة", value: summary?.inquiries_created, href: "/inquiries" },
    { icon: PackagePlus, label: "طلبات إعادة طلب", value: summary?.reorders_requested, href: "/reorders" },
    { icon: ArrowLeftRight, label: "طلبات تحويل", value: summary?.transfers_requested, href: "/transfers" },
  ];

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CalendarDays className="size-6 text-primary" /> الملخّص اليومي
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{dateLabel} — منذ منتصف الليل حتى الآن</p>
      </div>

      {/* المبيعات أولاً وبمظهر مختلف — هي الرقم الذي يريده المالك أولاً كل صباح */}
      <Card className="p-5 bg-gold-gradient text-primary-foreground shadow-gold">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm opacity-90 flex items-center gap-1.5"><TrendingUp className="size-4" /> مبيعات اليوم</p>
            <p className="text-3xl font-extrabold mt-1">{formatCurrency(summary?.sales_revenue ?? 0)}</p>
          </div>
          <div className="text-left">
            <p className="text-2xl font-bold">{summary?.sales_count ?? 0}</p>
            <p className="text-xs opacity-90">قطعة مباعة</p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {stats.map((s) => (
          <Link key={s.label} to={s.href}>
            <Card className="p-3 hover:bg-muted/40 transition-colors h-full">
              <s.icon className="size-4 text-primary mb-1.5" />
              <p className="text-xl font-bold leading-none">{s.value ?? 0}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{s.label}</p>
            </Card>
          </Link>
        ))}
        {!!missingWeights && (
          <Link to="/weights">
            <Card className="p-3 hover:bg-muted/40 transition-colors h-full border-warning/40 bg-warning/10">
              <Scale className="size-4 text-warning-foreground mb-1.5" />
              <p className="text-xl font-bold leading-none">{missingWeights}</p>
              <p className="text-[11px] text-muted-foreground mt-1">قطعة بلا وزن (كل الوقت)</p>
            </Card>
          </Link>
        )}
      </div>

      {closingStatus && closingStatus.length > 0 && (
        <Link to="/closing">
          <Card className="p-4 hover:bg-muted/40 transition-colors">
            <h2 className="font-bold mb-2 flex items-center gap-2"><Landmark className="size-4 text-primary" /> إقفال اليوم</h2>
            <div className="flex flex-wrap gap-2">
              {closingStatus.map((b) => (
                <Badge
                  key={b.id}
                  variant="outline"
                  className={b.closed ? (b.diff ? "bg-destructive/15 text-destructive border-destructive/30" : "bg-emerald-500/15 text-emerald-600 border-emerald-500/30") : "text-muted-foreground"}
                >
                  {b.name}: {b.closed ? (b.diff ? "أُقفل — فرق" : "أُقفل") : "لم يُقفل"}
                </Badge>
              ))}
            </div>
          </Card>
        </Link>
      )}

      <Card className="p-4">
        <h2 className="font-bold mb-3 flex items-center gap-2"><Receipt className="size-4 text-primary" /> نشاط اليوم لكل موظف</h2>
        {!perEmployee || perEmployee.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">لا نشاط مسجّل اليوم بعد</p>
        ) : (
          <div className="divide-y divide-border">
            {perEmployee.map((e: any) => (
              <div key={e.user_id} className="py-2 flex items-center justify-between gap-2 text-sm">
                <span className="font-semibold truncate">{e.full_name}</span>
                <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                  {e.sales > 0 && <Badge variant="secondary" className="gap-1"><Receipt className="size-3" /> {e.sales}</Badge>}
                  {e.products > 0 && <span className="flex items-center gap-1"><Package className="size-3" /> {e.products}</span>}
                  {e.quotes > 0 && <span className="flex items-center gap-1"><Tag className="size-3" /> {e.quotes}</span>}
                  {e.inquiries > 0 && <span className="flex items-center gap-1"><MessageCircle className="size-3" /> {e.inquiries}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
        <Link to="/staff" className="block text-center text-sm font-semibold text-primary mt-3 pt-3 border-t border-border">
          كل نشاط الموظفين ←
        </Link>
      </Card>
    </div>
  );
}
