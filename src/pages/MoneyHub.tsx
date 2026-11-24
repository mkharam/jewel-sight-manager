// «الفلوس» (المدير العام): كل شي على الفلوس في صفحة وحدة — كانت خانات متفرقة في «أمارسوفت»:
//  • المحاسب: الفلوس كيف دخلت (نقدي، مصرف، بطاقة، آجل) لكل فرع ولكل يوم.
//  • الأرباح: بكم يتباع الجرام في كل فرع، والربح الحقيقي فوق سعر الذهب يوم البيع.
//  • الموردون: شن دخل من كل مورد، وشن تباع منه، وحساباته.
//  • إقفال اليوم: تسليم الخزينة آخر النهار في كل فرع (مدير الفرع عنده نفس الصفحة في /closing).
import { lazy } from "react";
import PageTabs, { type PageTab } from "@/components/PageTabs";

const Accountant = lazy(() => import("@/pages/Accountant"));
const GramPrice = lazy(() => import("@/pages/GramPrice"));
const AmarsoftSuppliers = lazy(() => import("@/pages/AmarsoftSuppliers"));
const DailyClosing = lazy(() => import("@/pages/DailyClosing"));

const TABS: PageTab[] = [
  { key: "accountant", label: "المحاسب", render: () => <Accountant />,
    hint: "الفلوس كيف دخلت: نقدي، مصرف، بطاقة، آجل — لكل فرع ولكل يوم، وتنزيلها لـExcel." },
  { key: "profit", label: "الأرباح", render: () => <GramPrice />,
    hint: "بكم يتباع الجرام في كل فرع، والربح الحقيقي فوق سعر الذهب يوم البيع." },
  { key: "suppliers", label: "الموردون", render: () => <AmarsoftSuppliers />,
    hint: "شن دخل من كل مورد، وشن تباع منه، وحساباته." },
  { key: "closing", label: "إقفال اليوم", render: () => <DailyClosing />,
    hint: "تسليم الخزينة آخر النهار في كل فرع، والفرق بين المتوقّع واللي انعدّ." },
];

export default function MoneyHub() {
  return <PageTabs tabs={TABS} />;
}
