// عدّادات الشغل المعلّق (للقائمة وللخانات) في مكان واحد — نفس المفتاح ونفس الطلب، فالقائمة وصفحة
// «التحويلات والطلبات» يشاركوا نفس الكاش بلا طلبات زيادة.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/** طلبات إعادة الطلب اللي تستنى قرار المدير. معرّف المستخدم في المفتاح: بدونه كان العدّاد
 *  المحسوب لحساب سابق يبقى في الكاش ويظهر للحساب التالي على نفس الجهاز. */
export function usePendingReorders(): number {
  const { user } = useAuth();
  const { data = 0 } = useQuery({
    queryKey: ["pending-reorders-count", user?.id],
    queryFn: async () => {
      const { count } = await supabase
        .from("product_reorder_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      return count ?? 0;
    },
    enabled: !!user,
    refetchInterval: 60_000,
  });
  return data;
}

/** التحويلات الواردة لفرعي اللي تستنى موافقة/شحن/استلام. */
export function usePendingTransfers(): number {
  const { user, profile } = useAuth();
  const branchId = profile?.branch_id ?? null;
  const { data = 0 } = useQuery({
    queryKey: ["pending-transfers-count", branchId, user?.id],
    queryFn: async () => {
      if (!user || !branchId) return 0;
      const { count } = await supabase
        .from("transfers")
        .select("id", { count: "exact", head: true })
        .eq("to_branch_id", branchId)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .in("status", ["pending", "approved", "in_transit"] as any);
      return count ?? 0;
    },
    enabled: !!user,
    refetchInterval: 60_000,
  });
  return data;
}
