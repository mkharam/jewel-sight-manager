// «الموظفين» للمدير العام: كل شي على الموظفين في صفحة وحدة —
//  • المقارنة: الفروع جنب بعض، وموظفين كل فرع مع بعض (المبيعات، الربح فوق الذهب، تسجيل الزبون، التقييم).
//  • أرقام البائعين: تفاصيل أرقام أمارسوفت والنقاط من 100.
//  • تسجيل الزبائن: كل فرع وكل بائع يكتب اسم ورقم الزبون في الفاتورة ولا لا (كانت خانة في «أمارسوفت»).
//  • التقييم: اللوحة والاستمارات.  • المتصدرون.  • الحسابات: حسابات الموظفين وصلاحياتهم.
// كانت «التقييم» و«الموظفون» صفحتين منفصلتين؛ روابطهم القديمة تفتح على خانتها هنا (راجع App.tsx).
import { lazy } from "react";
import PageTabs, { type PageTab } from "@/components/PageTabs";

const TeamCompare = lazy(() => import("@/components/team/TeamCompare"));
const StaffEval = lazy(() => import("@/pages/StaffEval"));
const CustomerCapture = lazy(() => import("@/components/amarsoft/CustomerCapture"));
const Evaluations = lazy(() => import("@/pages/Evaluations"));
const Leaderboard = lazy(() => import("@/pages/Leaderboard"));
const Staff = lazy(() => import("@/pages/Staff"));

const TABS: PageTab[] = [
  { key: "compare", label: "المقارنة", render: () => <TeamCompare />,
    hint: "الفروع جنب بعض، وموظفين كل فرع مع بعض: المبيعات، الربح فوق الذهب، تسجيل الزبون، والتقييم." },
  { key: "numbers", label: "أرقام البائعين", render: () => <StaffEval />,
    hint: "من فواتير أمارسوفت: الوزن، السعر فوق الذهب، الخصم، الزبائن، والنقاط من 100." },
  { key: "customers", label: "تسجيل الزبائن", render: () => <CustomerCapture />,
    hint: "كل فرع وكل بائع: يسجّل اسم ورقم الزبون في الفاتورة ولا لا." },
  { key: "evaluations", label: "التقييم", render: () => <Evaluations />,
    hint: "المشرف يقيّم موظفينه كل يوم، والموظفين مشرفهم مرتين في الشهر. التقييم الذاتي لوحده للمقارنة." },
  { key: "leaderboard", label: "المتصدرون", render: () => <Leaderboard />,
    hint: "الترتيب بالوزن — نفس اللي يشوفه الموظفين (بلا أرقام عندهم)." },
  { key: "accounts", label: "الحسابات", render: () => <Staff />,
    hint: "حسابات الموظفين في التطبيق: الصلاحيات، الفروع، النشاط، والأجهزة." },
];

export default function TeamHub() {
  return <PageTabs tabs={TABS} />;
}
