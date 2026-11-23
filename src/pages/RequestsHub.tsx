// «الاستفسارات والحجوزات»: طلبات الزبائن في صفحة وحدة — زبون سأل على قطعة، وقطع محجوزة لزبائن.
// كانوا زرين منفصلين في القائمة. /reservations القديم يفتح على خانته.
import { lazy } from "react";
import PageTabs, { type PageTab } from "@/components/PageTabs";

const Inquiries = lazy(() => import("@/pages/Inquiries"));
const Reservations = lazy(() => import("@/pages/Reservations"));

const TABS: PageTab[] = [
  { key: "inquiries", label: "الاستفسارات", render: () => <Inquiries />,
    hint: "زبون سأل على قطعة مش موجودة — سجّلها وتابعها لين نردّوا عليه." },
  { key: "reservations", label: "الحجوزات", render: () => <Reservations />,
    hint: "قطع محجوزة لزبائن — لين يستلموها ولا يتلغى الحجز." },
];

export default function RequestsHub() {
  return <PageTabs tabs={TABS} />;
}
