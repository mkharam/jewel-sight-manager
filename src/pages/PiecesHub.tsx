// «القطع»: كل القطع اللي ناقصها شي في مكان واحد — بلا اسم (تستنى التحليل)، بلا وزن، أطقم بيعت منها
// قطعة، وقطع مش مربوطة برقم أمارسوفت — و«إدارة القطع» (تعديل وأرشفة بالجملة) للمدير والمشرف.
// على كل خانة عدد اللي يستنى شغل، فتعرف من أول نظرة وين الشغل. /admin/products القديم يفتح على خانته.
import { lazy } from "react";
import { useQuery } from "@tanstack/react-query";
import PageTabs, { type PageTab } from "@/components/PageTabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const ReviewUnnamed = lazy(() => import("@/pages/ReviewUnnamed"));
const MissingWeights = lazy(() => import("@/pages/MissingWeights"));
const IncompleteSets = lazy(() => import("@/pages/IncompleteSets"));
const AmarsoftLink = lazy(() => import("@/pages/AmarsoftLink"));
const AdminProducts = lazy(() => import("@/pages/AdminProducts"));

const PLACEHOLDER_NAME = "قطعة جديدة";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export default function PiecesHub() {
  const { roles, profile, user } = useAuth();
  const isAdmin = roles.includes("admin");
  const canManage = isAdmin || roles.includes("supervisor");
  const branchId = profile?.branch_id ?? null;

  const { data: counts } = useQuery({
    queryKey: ["pieces-hub-counts", user?.id, branchId],
    enabled: !!user,
    refetchInterval: 60_000,
    queryFn: async () => {
      let weights = db.from("products").select("id", { count: "exact", head: true }).eq("status", "available").is("weight_grams", null);
      if (branchId) weights = weights.eq("branch_id", branchId);
      const [u, w, s] = await Promise.all([
        db.from("products").select("id", { count: "exact", head: true }).eq("name", PLACEHOLDER_NAME),
        weights,
        db.from("incomplete_sets").select("product_id", { count: "exact", head: true }),
      ]);
      return { unnamed: u.count ?? 0, weights: w.count ?? 0, sets: s.count ?? 0 };
    },
  });

  const tabs: PageTab[] = [
    { key: "unnamed", label: "بلا اسم", count: counts?.unnamed, render: () => <ReviewUnnamed />,
      hint: "قطع رُفعت وتستنى الذكاء الاصطناعي يسمّيها — راجع الاسم واحفظ، ولا أعد التحليل." },
    { key: "weights", label: "بلا وزن", count: counts?.weights, render: () => <MissingWeights />,
      hint: "قطع متوفرة ناقصها الوزن — الوزن أساس السعر، اكتبه من الميزان." },
    { key: "sets", label: "أطقم ناقصة", count: counts?.sets, render: () => <IncompleteSets />,
      hint: "أطقم بيعت منها قطعة منفردة — عدّل وزنها في أمارسوفت." },
    ...(isAdmin ? [{ key: "link", label: "ربط أمارسوفت", render: () => <AmarsoftLink />,
      hint: "قطع التطبيق بلا رقم أمارسوفت — نقترح لكل وحدة القطعة المطابقة." }] : []),
    ...(canManage ? [{ key: "manage", label: "إدارة القطع", render: () => <AdminProducts />,
      hint: "تعديل وأرشفة القطع بالجملة: الفرع، الحالة، السعر." }] : []),
  ];
  return <PageTabs tabs={tabs} />;
}
