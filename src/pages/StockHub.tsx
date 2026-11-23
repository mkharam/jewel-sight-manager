// «المخزون والجرد»: شن موجود في كل فرع (أمارسوفت)، والجرد بمسح الباركود، وجرد قطع التطبيق، وتقرير
// التطبيق الشهري — كانوا صفحتين («المخزون» و«الجرد») بأربع خانات. /count القديم يفتح على خانته.
import { lazy } from "react";
import PageTabs, { type PageTab } from "@/components/PageTabs";
import { useAuth } from "@/hooks/useAuth";

const PosStock = lazy(() => import("@/pages/PosStock"));
const PosCount = lazy(() => import("@/pages/PosCount"));
const StockTake = lazy(() => import("@/pages/StockTake"));
const Reports = lazy(() => import("@/pages/Reports"));

export default function StockHub() {
  const { roles } = useAuth();
  const isAdmin = roles.includes("admin");
  const canApp = isAdmin || roles.includes("supervisor");
  const tabs: PageTab[] = [
    { key: "amarsoft", label: "المخزون", render: () => <PosStock />,
      hint: "القطع الموجودة في كل فرع حسب أمارسوفت، بالنوع والعيار والوزن." },
    { key: "scan", label: "الجرد بالباركود", render: () => <PosCount />,
      hint: "امسح ليبل كل قطعة في الفرع — يقارنها فوراً بمخزون أمارسوفت ويوريك الناقص والزايد." },
    ...(canApp ? [{ key: "appcount", label: "جرد قطع التطبيق", render: () => <StockTake />,
      hint: "جرد القطع المسجّلة في التطبيق واحدة واحدة: موجودة ولا ناقصة." }] : []),
    ...(isAdmin ? [{ key: "app", label: "تقرير التطبيق الشهري", render: () => <Reports />,
      hint: "مخزون التطبيق، الحركة، والتحويلات شهر بشهر." }] : []),
  ];
  return <PageTabs tabs={tabs} />;
}
