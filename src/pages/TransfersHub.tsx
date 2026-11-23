// «التحويلات والطلبات»: نقل القطع بين الفروع، وطلب قطعة نفدت من المورد — صفحة وحدة بخانتين.
// العدد على كل خانة من نفس عدّادات القائمة (نفس الكاش، بلا طلب زيادة). /reorders القديم يفتح على خانته.
import { lazy } from "react";
import PageTabs, { type PageTab } from "@/components/PageTabs";
import { usePendingReorders, usePendingTransfers } from "@/hooks/usePendingCounts";

const Transfers = lazy(() => import("@/pages/Transfers"));
const Reorders = lazy(() => import("@/pages/Reorders"));

export default function TransfersHub() {
  const transfers = usePendingTransfers();
  const reorders = usePendingReorders();
  const tabs: PageTab[] = [
    { key: "transfers", label: "التحويلات", count: transfers, render: () => <Transfers />,
      hint: "نقل قطع بين الفروع: اطلب، وافق، استلم." },
    { key: "reorders", label: "إعادة الطلب", count: reorders, render: () => <Reorders />,
      hint: "قطعة نفدت وتبيها من المورد — اطلبها وتابعها لين توصل." },
  ];
  return <PageTabs tabs={tabs} />;
}
