// «التقارير»: كل أرقام المدير العام في مكان واحد — التقارير، الفروع، ملخّص اليوم، المحاسب، سعر الغرام،
// ومبيعات وجرد التطبيق. كانت سبع أزرار في «المزيد». الروابط القديمة (/branches، /accountant…) تفتح على خانتها.
import { lazy } from "react";
import PageTabs, { type PageTab } from "@/components/PageTabs";

const AmarsoftReports = lazy(() => import("@/pages/AmarsoftReports"));
const Branches = lazy(() => import("@/pages/Branches"));
const DailySummary = lazy(() => import("@/pages/DailySummary"));
const Accountant = lazy(() => import("@/pages/Accountant"));
const GramPrice = lazy(() => import("@/pages/GramPrice"));
const Sales = lazy(() => import("@/pages/Sales"));
const Reports = lazy(() => import("@/pages/Reports"));

const TABS: PageTab[] = [
  { key: "overview", label: "التقارير", render: () => <AmarsoftReports /> },
  { key: "branches", label: "الفروع", render: () => <Branches /> },
  { key: "daily", label: "ملخّص اليوم", render: () => <DailySummary /> },
  { key: "accountant", label: "المحاسب", render: () => <Accountant /> },
  { key: "gram", label: "سعر الغرام", render: () => <GramPrice /> },
  { key: "sales", label: "مبيعات التطبيق", render: () => <Sales /> },
  { key: "stock", label: "الجرد الشهري", render: () => <Reports /> },
];

export default function ReportsHub() {
  return <PageTabs tabs={TABS} />;
}
