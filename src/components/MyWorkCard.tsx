// بطاقة "شغلي" — تلخّص للموظف إيه اللي بانتظاره تحديداً بدل ما يفتح صفحة الاستفسارات
// وصفحة التحويلات ويدوّر بينهم كل مرة. لا يوجد عمود "assigned_to" فعلي في القاعدة، فنعتمد
// أقرب تقريب متاح: استفساراته هو (سجّلها بنفسه) المعلّقة، وتحويلات واردة لفرعه بانتظار
// استلام (أي موظف في الفرع يقدر يستلمها، فهي "شغل الفرع" لا شغل شخص بعينه بالضبط).
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { MessageCircle, ArrowLeftRight, ListChecks } from "lucide-react";

export default function MyWorkCard() {
  const { user, profile } = useAuth();
  const [pendingInquiries, setPendingInquiries] = useState<number | null>(null);
  const [awaitingTransfers, setAwaitingTransfers] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const inquiriesQ = supabase
        .from("customer_inquiries")
        .select("id", { count: "exact", head: true })
        .eq("created_by", user.id)
        .eq("status", "pending");
      const transfersQ = profile?.branch_id
        ? supabase
            .from("transfers")
            .select("id", { count: "exact", head: true })
            .eq("to_branch_id", profile.branch_id)
            .in("status", ["approved", "in_transit"])
        : null;
      const [inqRes, trRes] = await Promise.all([inquiriesQ, transfersQ ?? Promise.resolve({ count: 0 })]);
      if (cancelled) return;
      setPendingInquiries(inqRes.count ?? 0);
      setAwaitingTransfers((trRes as any).count ?? 0);
    })();
    return () => { cancelled = true; };
  }, [user, profile?.branch_id]);

  const total = (pendingInquiries ?? 0) + (awaitingTransfers ?? 0);
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
