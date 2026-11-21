// «الجرد»: طريقتين للجرد في صفحة وحدة — مسح باركود القطع ومقارنتها بمخزون أمارسوفت (الأدق)،
// وجرد قطع التطبيق واحدة واحدة. كانوا صفحتين منفصلتين في القائمة.
import { lazy } from "react";
import PageTabs, { type PageTab } from "@/components/PageTabs";
import { useAuth } from "@/hooks/useAuth";

const PosCount = lazy(() => import("@/pages/PosCount"));
const StockTake = lazy(() => import("@/pages/StockTake"));

export default function CountHub() {
  const { roles } = useAuth();
  const canApp = roles.includes("admin") || roles.includes("supervisor");
  const tabs: PageTab[] = [
    { key: "scan", label: "مسح الباركود", render: () => <PosCount />,
      hint: "امسح ليبل كل قطعة في الفرع — يقارنها فوراً بمخزون أمارسوفت ويوريك الناقص والزايد." },
    ...(canApp ? [{ key: "app", label: "قطع التطبيق", render: () => <StockTake />,
      hint: "جرد القطع المسجّلة في التطبيق واحدة واحدة: موجودة ولا ناقصة." }] : []),
  ];
  return <PageTabs tabs={tabs} />;
}
