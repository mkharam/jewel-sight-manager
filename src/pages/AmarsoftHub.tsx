// «أمارسوفت»: كل اللي يجي من نظام المحل في صفحة وحدة بخانات — بدل التقارير والفواتير والموردين
// والمحاسب كل وحدة صفحة لروحها. الروابط القديمة (/reports، /pos-sales، /suppliers…) تفتح على خانتها.
// المدير العام يشوف كل الخانات؛ المشرف ومدير الفرع يشوفوا المخزون والجرد.
import { lazy } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import PageTabs, { type PageTab } from "@/components/PageTabs";
import { useAuth, hasRole } from "@/hooks/useAuth";
import { sb, formatTripoli, daysToRange, tripoliToday } from "@/lib/amarsoft";

const AmarsoftReports = lazy(() => import("@/pages/AmarsoftReports"));
const Branches = lazy(() => import("@/pages/Branches"));
const PosSales = lazy(() => import("@/pages/PosSales"));
const CustomerCapture = lazy(() => import("@/components/amarsoft/CustomerCapture"));
const GramPrice = lazy(() => import("@/pages/GramPrice"));
const Accountant = lazy(() => import("@/pages/Accountant"));
const AmarsoftSuppliers = lazy(() => import("@/pages/AmarsoftSuppliers"));
const DailySummary = lazy(() => import("@/pages/DailySummary"));
const Sales = lazy(() => import("@/pages/Sales"));
const PosStock = lazy(() => import("@/pages/PosStock"));
const PosCount = lazy(() => import("@/pages/PosCount"));

const ADMIN_TABS: PageTab[] = [
  { key: "overview", label: "نظرة عامة", render: () => <AmarsoftReports />,
    hint: "كل الفروع مقارنة بالفترة اللي قبلها، والتنبيهات، والمبيعات يوم بيوم." },
  { key: "branches", label: "الفروع", render: () => <Branches />,
    hint: "كل فرع بروحه: مبيعاته، وزنه، مخزونه، وموظفوه." },
  { key: "invoices", label: "الفواتير", render: () => <PosSales key="invoices" embedded />,
    hint: "كل فواتير البيع — دوّر برقم الفاتورة ولا اسم الزبون ولا الباركود." },
  { key: "log", label: "الممسوح والمعدّل", render: () => <PosSales key="log" embedded />,
    hint: "الفواتير اللي انمسحت ولا تعدّلت بعد ما تسجلت." },
  { key: "customers", label: "تسجيل الزبائن", render: () => <CustomerCapture />,
    hint: "كل فرع وكل بائع: يسجّل اسم ورقم الزبون في الفاتورة ولا لا." },
  { key: "gram", label: "الأسعار والأرباح", render: () => <GramPrice />,
    hint: "بكم يتباع الجرام في كل فرع، والربح الحقيقي فوق سعر الذهب يوم البيع." },
  { key: "accountant", label: "المحاسب", render: () => <Accountant />,
    hint: "الفلوس كيف دخلت: نقدي، مصرف، بطاقة، آجل — وتنزيلها لـExcel." },
  { key: "suppliers", label: "الموردون", render: () => <AmarsoftSuppliers />,
    hint: "شن دخل من كل مورد، وشن تباع منه، وحساباته." },
  { key: "daily", label: "ملخّص اليوم", render: () => <DailySummary />,
    hint: "شن صار اليوم: المبيعات، الاستفسارات، الطلبات، ونشاط الموظفين." },
  { key: "appsales", label: "البيع من التطبيق", render: () => <Sales />,
    hint: "المبيعات المسجّلة من داخل التطبيق (زر «بيع» في صفحة القطعة)." },
];
const LEAD_TABS: PageTab[] = [
  { key: "stock", label: "المخزون", render: () => <PosStock />, hint: "القطع الموجودة في كل فرع حسب أمارسوفت." },
  { key: "count", label: "الجرد", render: () => <PosCount />, hint: "امسح القطع وقارنها بمخزون أمارسوفت." },
];

export default function AmarsoftHub() {
  const { roles } = useAuth();
  const isAdmin = hasRole(roles, "admin");

  // تنبيه يبان فوق كل الخانات: فواتير انمسحت اليوم.
  const { data } = useQuery({
    queryKey: ["amarsoft-hub", isAdmin],
    enabled: isAdmin,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { start, end } = daysToRange(tripoliToday(), tripoliToday());
      const [sync, deleted] = await Promise.all([
        sb.from("amarsoft_sync_log").select("received_at").order("received_at", { ascending: false }).limit(1).maybeSingle(),
        sb.from("amarsoft_doc_events").select("trn_no", { count: "exact", head: true }).eq("trn_type", "RSL").eq("status", "D").gte("at", start).lt("at", end),
      ]);
      return { lastSync: (sync.data?.received_at as string | undefined) ?? null, deletedToday: deleted.count ?? 0 };
    },
  });

  return (
    <div className="space-y-2">
      {/* سطر واحد: آخر تحديث، وجنبه تنبيه الفواتير الممسوحة اليوم (كان صندوق أحمر كبير فوق كل خانة). */}
      {isAdmin && (
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-2 gap-y-1 px-1">
          <p className="text-[11px] text-muted-foreground">آخر تحديث من أمارسوفت: {formatTripoli(data?.lastSync)}</p>
          {!!data?.deletedToday && (
            <Link to="/amarsoft?tab=log" className="flex items-center gap-1 rounded-full border border-destructive bg-destructive/10 px-2.5 py-1 text-xs font-bold text-destructive">
              <AlertTriangle className="size-3.5 shrink-0" />حُذفت {data.deletedToday} فاتورة اليوم ←
            </Link>
          )}
        </div>
      )}
      <PageTabs tabs={isAdmin ? ADMIN_TABS : LEAD_TABS} />
    </div>
  );
}
