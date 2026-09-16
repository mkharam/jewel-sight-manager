// شريط "قطع بلا وزن" — أول ما يراه الموظف في الصفحة الرئيسية، لا شارة صغيرة بين شارات
// أخرى داخل بطاقة "بانتظارك". الوزن أساس تسعير الذهب، وموظف لا يعرف أن عنده بضاعة بلا
// وزن في فرعه لا يستطيع تسعيرها لزبون واقف أمامه — يستحق مكاناً أوضح من شارة قد يفوتها.
//
// يخصّ فرع المستخدم فقط: قطعة بلا وزن في فرع آخر ليست مسؤوليته ولا يقدر يزنها أصلاً.
// المدير العام عادة بلا فرع محدَّد (يرى كل الفروع من "الملخّص اليومي" بدلاً من هذا)، فلا
// يظهر له هذا الشريط إلا إن كان مُسنداً لفرع بعينه هو الآخر.
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Scale, ChevronLeft } from "lucide-react";

export default function MissingWeightsBanner() {
  const { user, profile } = useAuth();
  const branchId = profile?.branch_id ?? null;

  const { data: count = 0 } = useQuery({
    queryKey: ["missing-weights-count", branchId],
    enabled: !!user && !!branchId,
    queryFn: async () => {
      const { count } = await supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("branch_id", branchId!)
        .eq("status", "available")
        .is("weight_grams", null);
      return count ?? 0;
    },
  });

  if (!user || !branchId || count === 0) return null;

  return (
    <Link
      to="/weights"
      className="flex items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 hover:bg-warning/15 active:bg-warning/20 transition-colors p-3.5"
    >
      <div className="size-10 rounded-full bg-warning/20 flex items-center justify-center shrink-0">
        <Scale className="size-5 text-warning-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold">{count} قطعة بلا وزن في فرعك</p>
        <p className="text-xs text-muted-foreground">اضغط لتزنها الآن — بدونه لا يمكن تسعيرها لزبون</p>
      </div>
      <ChevronLeft className="size-4 text-muted-foreground shrink-0" />
    </Link>
  );
}
