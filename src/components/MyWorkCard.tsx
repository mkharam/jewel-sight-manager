// بطاقة "شغلي" — تلخّص للموظف إيه اللي بانتظاره تحديداً بدل ما يفتح صفحة الاستفسارات
// وصفحة التحويلات ويدوّر بينهم كل مرة. لا يوجد عمود "assigned_to" فعلي في القاعدة، فنعتمد
// أقرب تقريب متاح: استفساراته هو (سجّلها بنفسه) المعلّقة، وتحويلات واردة لفرعه بانتظار
// استلام (أي موظف في الفرع يقدر يستلمها، فهي "شغل الفرع" لا شغل شخص بعينه بالضبط).
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { MessageCircle, ArrowLeftRight, ListChecks } from "lucide-react";

export default function MyWorkCard() {
  const { user, profile } = useAuth();

  // ضمن الكاش المشترك (لا useEffect يدوي) حتى تتحدّث البطاقة تلقائياً مع بقية الشاشات —
  // الاستفسارات والتحويلات لهما بثّ realtime في صفحتيهما، ونعيد الجلب عند العودة للنافذة
  // فلا يبقى الموظف أمام رقم قديم بعد أن يتصرّف زميله في نفس الفرع.
  const { data } = useQuery({
    queryKey: ["my-work", user?.id, profile?.branch_id],
    enabled: !!user,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const [inqRes, trRes] = await Promise.all([
        supabase
          .from("customer_inquiries")
          .select("id", { count: "exact", head: true })
          .eq("created_by", user!.id)
          .eq("status", "pending"),
        profile?.branch_id
          ? supabase
              .from("transfers")
              .select("id", { count: "exact", head: true })
              .eq("to_branch_id", profile.branch_id)
              .in("status", ["approved", "in_transit"])
          : Promise.resolve({ count: 0 }),
      ]);
      return {
        pendingInquiries: inqRes.count ?? 0,
        awaitingTransfers: (trRes as { count: number | null }).count ?? 0,
      };
    },
  });

  const pendingInquiries = data?.pendingInquiries ?? 0;
  const awaitingTransfers = data?.awaitingTransfers ?? 0;
  const total = pendingInquiries + awaitingTransfers;
  if (!user || total === 0) return null;

  return (
    <Card className="p-3.5">
      <p className="text-sm font-bold flex items-center gap-1.5 mb-2">
        <ListChecks className="size-4 text-primary" /> بانتظارك
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        {!!pendingInquiries && (
          <Link
            to="/inquiries"
            className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg bg-muted/50 hover:bg-muted transition-colors text-xs font-semibold"
          >
            <MessageCircle className="size-3.5 text-primary" />
            {pendingInquiries} استفسار بانتظار متابعة
          </Link>
        )}
        {!!awaitingTransfers && (
          <Link
            to="/transfers"
            className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg bg-muted/50 hover:bg-muted transition-colors text-xs font-semibold"
          >
            <ArrowLeftRight className="size-3.5 text-primary" />
            {awaitingTransfers} تحويل بانتظار الاستلام
          </Link>
        )}
      </div>
    </Card>
  );
}
