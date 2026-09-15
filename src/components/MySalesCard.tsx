// بطاقة "مبيعاتي" — كل موظف يشوف أداءه الشخصي (عدد القطع + القيمة) بدون حاجة يسأل
// المدير، عكس لوحة الصدارة في Staff.tsx اللي مقصورة على المدير العام. تعتمد على سياسة
// RLS "read own sales" (sold_by = auth.uid()) فيبقى كل موظف يشوف مبيعاته هو فقط.
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Coins, Package, TrendingUp } from "lucide-react";
import { formatCurrency, periodStartISO, PERIOD_LABEL, type Period } from "@/lib/constants";

export default function MySalesCard() {
  const { user, roles } = useAuth();
  // القيمة المالية للمبيعات معلومة إدارية — الموظف يشوف عدد القطع اللي باعها (تحفيز/تتبّع
  // ذاتي) بس مش قيمتها بالدينار؛ المدير والمدير العام يشوفوا الاتنين زي لوحة الصدارة.
  const canSeeValue = roles.includes("admin") || roles.includes("manager");
  const [period, setPeriod] = useState<Period>("today");

  // react-query لا useEffect يدوي: البطاقة بهذا تدخل ضمن الكاش المشترك، فتتحدّث تلقائياً
  // فور تسجيل أي بيع (راجع invalidateInventoryAndSales) بدل أن تبقى على رقمها القديم حتى
  // إعادة تحميل الصفحة. keepPreviousData يمنع وميض "—" عند تبديل الفترة أو إعادة الجلب.
  const { data: stats } = useQuery({
    queryKey: ["my-sales", user?.id, period],
    enabled: !!user,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("final_price")
        .eq("sold_by", user!.id)
        .gte("sold_at", periodStartISO(period))
        .is("returned_at", null);
      if (error) throw error;
      const rows = data ?? [];
      return { count: rows.length, total: rows.reduce((s, r) => s + (Number(r.final_price) || 0), 0) };
    },
  });

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
        {canSeeValue && (
          <div className="flex items-center gap-1.5">
            <Coins className="size-4 text-muted-foreground" />
            <span className="font-bold text-primary">{stats ? formatCurrency(stats.total) : "—"}</span>
          </div>
        )}
      </div>
    </Card>
  );
}
