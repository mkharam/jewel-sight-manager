// «التقارير»: كل أرقام المدير العام من أمارسوفت في مكان واحد — نظرة عامة، الفروع، ملخّص اليوم، المحاسب،
// الأسعار والأرباح، والبيع من التطبيق. الروابط القديمة (/branches، /accountant…) تفتح على خانتها.
// «الجرد الشهري» انتقل لصفحة «المخزون» (/stock?tab=app).
import { lazy } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import PageTabs, { type PageTab } from "@/components/PageTabs";

const AmarsoftReports = lazy(() => import("@/pages/AmarsoftReports"));
const Branches = lazy(() => import("@/pages/Branches"));
const DailySummary = lazy(() => import("@/pages/DailySummary"));
const Accountant = lazy(() => import("@/pages/Accountant"));
const GramPrice = lazy(() => import("@/pages/GramPrice"));
const Sales = lazy(() => import("@/pages/Sales"));

const TABS: PageTab[] = [
  { key: "overview", label: "نظرة عامة", render: () => <AmarsoftReports />,
    hint: "كل الفروع مقارنة بالفترة اللي قبلها، والتنبيهات، والمبيعات يوم بيوم." },
  { key: "daily", label: "ملخّص اليوم", render: () => <DailySummary />,
    hint: "شن صار اليوم: المبيعات، الاستفسارات، الطلبات، ونشاط الموظفين." },
  { key: "branches", label: "الفروع", render: () => <Branches />,
    hint: "كل فرع بروحه: مبيعاته، وزنه، مخزونه، والممسوح والمعدّل." },
  { key: "gram", label: "الأسعار والأرباح", render: () => <GramPrice />,
    hint: "بكم يتباع الجرام في كل فرع، والربح الحقيقي فوق سعر الذهب يوم البيع." },
  { key: "accountant", label: "المحاسب", render: () => <Accountant />,
    hint: "الفلوس كيف دخلت: نقدي، مصرف، بطاقة، آجل — وتنزيلها لـExcel." },
  { key: "sales", label: "البيع من التطبيق", render: () => <Sales />,
    hint: "المبيعات المسجّلة من داخل التطبيق (زر «بيع» في صفحة القطعة)." },
];

export default function ReportsHub() {
  const [params] = useSearchParams();
  if (params.get("tab") === "stock") return <Navigate to="/stock?tab=app" replace />;
  return <PageTabs tabs={TABS} />;
}
