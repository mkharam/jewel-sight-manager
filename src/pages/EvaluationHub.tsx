// «التقييم» للمدير العام: كل التقييم في مكان واحد — أرقام البائعين والفروع من الفواتير، التقييم
// الشهري (الاستمارات: مين قيّم ومين اتقيّم)، والمتصدرون. كانت أربع صفحات (منها «الفروع» داخل
// التقييم الشهري بحسبة ثانية مختلفة) — الحين حسبة وحدة للأرقام.
import { lazy } from "react";
import PageTabs, { type PageTab } from "@/components/PageTabs";

const StaffEval = lazy(() => import("@/pages/StaffEval"));
const Evaluations = lazy(() => import("@/pages/Evaluations"));
const Leaderboard = lazy(() => import("@/pages/Leaderboard"));

const TABS: PageTab[] = [
  { key: "numbers", label: "أرقام البائعين والفروع", render: () => <StaffEval />,
    hint: "من فواتير أمارسوفت: الوزن، السعر فوق الذهب، الخصم، الزبائن، والنقاط من 100." },
  { key: "monthly", label: "تقييم الموظفين", render: () => <Evaluations />,
    hint: "المشرف يقيّم موظفينه كل يوم، والموظفين يقيّموا نفسهم ومشرفهم مرتين في الشهر — ومين ناقص." },
  { key: "leaderboard", label: "المتصدرون", render: () => <Leaderboard />,
    hint: "الترتيب بالوزن — نفس اللي يشوفه الموظفين (بلا أرقام عندهم)." },
];

export default function EvaluationHub() {
  return <PageTabs tabs={TABS} />;
}
