// «المخزون»: شن موجود في كل فرع — من أمارسوفت (الأساس)، وتقرير مخزون التطبيق الشهري للمدير.
import { lazy } from "react";
import PageTabs, { type PageTab } from "@/components/PageTabs";
import { useAuth } from "@/hooks/useAuth";

const PosStock = lazy(() => import("@/pages/PosStock"));
const Reports = lazy(() => import("@/pages/Reports"));

export default function StockHub() {
  const { roles } = useAuth();
  const isAdmin = roles.includes("admin");
  const tabs: PageTab[] = [
    { key: "amarsoft", label: "مخزون أمارسوفت", render: () => <PosStock />,
      hint: "القطع الموجودة في كل فرع حسب أمارسوفت، بالنوع والعيار والوزن." },
    ...(isAdmin ? [{ key: "app", label: "تقرير التطبيق الشهري", render: () => <Reports />,
      hint: "مخزون التطبيق، الحركة، والتحويلات شهر بشهر." }] : []),
  ];
  return <PageTabs tabs={tabs} />;
}
