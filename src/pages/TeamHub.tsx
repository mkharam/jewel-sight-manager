// «الفريق» للمدير العام: الموظفون والتقييم والمتصدرون في صفحة وحدة بدل ثلاث أزرار في «المزيد».
// الموظف ومسؤول التقييم يبقوا يفتحوا /leaderboard و /evaluations كيف قبل.
import { lazy } from "react";
import PageTabs, { type PageTab } from "@/components/PageTabs";

const Staff = lazy(() => import("@/pages/Staff"));
const Evaluations = lazy(() => import("@/pages/Evaluations"));
const Leaderboard = lazy(() => import("@/pages/Leaderboard"));

const TABS: PageTab[] = [
  { key: "staff", label: "الموظفون", render: () => <Staff /> },
  { key: "evaluations", label: "التقييم", render: () => <Evaluations /> },
  { key: "leaderboard", label: "المتصدرون", render: () => <Leaderboard /> },
];

export default function TeamHub() {
  return <PageTabs tabs={TABS} />;
}
