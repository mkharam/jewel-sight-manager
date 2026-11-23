// «الفروع والفريق» للمدير العام: كل شي على الموظفين والفروع في صفحة وحدة —
//  • المقارنة: الفروع جنب بعض، وموظفين كل فرع مع بعض (المبيعات، الربح فوق الذهب، تسجيل الزبون، التقييم).
//  • أرقام البائعين: تفاصيل أرقام أمارسوفت والنقاط من 100.
//  • تقييم الموظفين: اللوحة والاستمارات.  • المتصدرون.  • الحسابات: حسابات الموظفين وصلاحياتهم.
// كانت «التقييم» و«الموظفون» صفحتين منفصلتين؛ روابطهم القديمة تفتح على خانتها هنا (راجع App.tsx).
import { lazy } from "react";
import PageTabs, { type PageTab } from "@/components/PageTabs";

const TeamCompare = lazy(() => import("@/components/team/TeamCompare"));
const StaffEval = lazy(() => import("@/pages/StaffEval"));
const Evaluations = lazy(() => import("@/pages/Evaluations"));
const Leaderboard = lazy(() => import("@/pages/Leaderboard"));
const Staff = lazy(() => import("@/pages/Staff"));

const TABS: PageTab[] = [
  { key: "compare", label: "المقارنة", render: () => <TeamCompare />,
    hint: "الفروع جنب بعض، وموظفين كل فرع مع بعض: المبيعات، الربح فوق الذهب، تسجيل الزبون، والتقييم." },
  { key: "numbers", label: "أرقام البائعين", render: () => <StaffEval />,
    hint: "من فواتير أمارسوفت: الوزن، السعر فوق الذهب، الخصم، الزبائن، والنقاط من 100." },
  { key: "evaluations", label: "تقييم الموظفين", render: () => <Evaluations />,
    hint: "المشرف يقيّم موظفينه كل يوم، والموظفين مشرفهم مرتين في الشهر. التقييم الذاتي لوحده للمقارنة." },
  { key: "leaderboard", label: "المتصدرون", render: () => <Leaderboard />,
    hint: "الترتيب بالوزن — نفس اللي يشوفه الموظفين (بلا أرقام عندهم)." },
  { key: "accounts", label: "الحسابات", render: () => <Staff />,
    hint: "حسابات الموظفين في التطبيق: الصلاحيات، الفروع، النشاط، والأجهزة." },
];

export default function TeamHub() {
  return <PageTabs tabs={TABS} />;
}
