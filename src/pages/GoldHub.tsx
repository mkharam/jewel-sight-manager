// «الذهب والسوق»: كل شي على سعر الذهب في صفحة وحدة — السوق اليوم (الأونصة، الدولار، الكسر، حاسبة)،
// تسعير المحل اليومي، أسعار المنافسين، ومقارنة سعري بالسوق وربحي (للمدير العام).
import { lazy } from "react";
import PageTabs, { type PageTab } from "@/components/PageTabs";
import { useAuth } from "@/hooks/useAuth";

const MarketToday = lazy(() => import("@/components/gold/MarketToday"));
const GoldPrice = lazy(() => import("@/pages/GoldPrice"));
const Competitors = lazy(() => import("@/components/gold/Competitors"));
const PriceCompare = lazy(() => import("@/components/gold/PriceCompare"));

export default function GoldHub() {
  const { roles } = useAuth();
  const tabs: PageTab[] = [
    { key: "market", label: "السوق اليوم", hint: "سعر الذهب العالمي والدولار، الكسر في طرابلس، وحاسبة.", render: () => <MarketToday /> },
    { key: "price", label: "تسعير المحل", hint: "سعر الجرام اللي يبيع بيه المحل اليوم — يشوفه الموظفين.", render: () => <GoldPrice /> },
    { key: "rivals", label: "المنافسين", hint: "سجّل أسعار المحلات الثانية وشوف متوسطها.", render: () => <Competitors /> },
    ...(roles.includes("admin")
      ? [{ key: "compare", label: "سعري والسوق", hint: "سعرك غالي ولا لا مقارنة بالمنافسين، وربحك فوق الذهب.", render: () => <PriceCompare /> }]
      : []),
  ];
  return <PageTabs tabs={tabs} />;
}
