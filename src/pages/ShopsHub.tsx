// «المحلات» (المدير العام): كل شي على الفروع في صفحة وحدة. كانت خانات في «أمارسوفت»؛ صارت مرتبة حسب
// الموضوع — المحلات هنا، الموظفين في «الموظفين» (/team)، والفلوس في «الفلوس» (/money):
//  • اليوم: شن صار اليوم في كل المحلات (المبيعات، كل فاتورة، الولاء، الإقفال، نشاط الموظفين).
//  • المقارنة: الفروع مقارنة بالفترة اللي قبلها، التنبيهات، يوم بيوم، العيارات، أحسن البائعين، المخزون.
//  • كل فرع: الفروع، والضغط على فرع يفتح صفحته الكاملة (/branches/:code).
//  • الفواتير، الممسوح والمعدّل، والبيع من التطبيق.
// الروابط القديمة (/amarsoft?tab=…، /reports، /pos-sales…) تفتح على خانتها هنا (راجع App.tsx).
import { lazy } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import PageTabs, { type PageTab } from "@/components/PageTabs";
import { sb, formatTripoli, daysToRange, tripoliToday } from "@/lib/amarsoft";

const DailySummary = lazy(() => import("@/pages/DailySummary"));
const AmarsoftReports = lazy(() => import("@/pages/AmarsoftReports"));
const Branches = lazy(() => import("@/pages/Branches"));
const PosSales = lazy(() => import("@/pages/PosSales"));
const Sales = lazy(() => import("@/pages/Sales"));

const TABS: PageTab[] = [
  { key: "today", label: "اليوم", render: () => <DailySummary />,
    hint: "شن صار اليوم في كل المحلات: المبيعات، كل فاتورة، الولاء، الإقفال، ونشاط الموظفين." },
  { key: "overview", label: "المقارنة", render: () => <AmarsoftReports />,
    hint: "كل الفروع مقارنة بالفترة اللي قبلها، والتنبيهات، والمبيعات يوم بيوم." },
  { key: "branches", label: "كل فرع", render: () => <Branches />,
    hint: "اضغط على فرع تفتح صفحته: مبيعاته، موظفينه وتقييمهم، مخزونه، وفواتيره." },
  { key: "invoices", label: "الفواتير", render: () => <PosSales key="invoices" embedded />,
    hint: "كل فواتير البيع — دوّر برقم الفاتورة ولا اسم الزبون ولا الباركود." },
  { key: "log", label: "الممسوح والمعدّل", render: () => <PosSales key="log" embedded />,
    hint: "الفواتير اللي انمسحت ولا تعدّلت بعد ما تسجلت." },
  { key: "appsales", label: "البيع من التطبيق", render: () => <Sales />,
    hint: "المبيعات المسجّلة من داخل التطبيق (زر «بيع» في صفحة القطعة)." },
];

/** آخر تحديث من أمارسوفت، وكم فاتورة انمسحت اليوم — يبانوا فوق كل الخانات. */
function useAmarsoftPulse(enabled = true) {
  return useQuery({
    queryKey: ["amarsoft-pulse"],
    enabled,
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
}

export default function ShopsHub() {
  const { data } = useAmarsoftPulse();
  return (
    <div className="space-y-2">
      {/* سطر واحد: آخر تحديث، وجنبه تنبيه الفواتير الممسوحة اليوم. */}
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-2 gap-y-1 px-1">
        <p className="text-[11px] text-muted-foreground">آخر تحديث من أمارسوفت: {formatTripoli(data?.lastSync)}</p>
        {!!data?.deletedToday && (
          <Link to="/shops?tab=log" className="flex items-center gap-1 rounded-full border border-destructive bg-destructive/10 px-2.5 py-1 text-xs font-bold text-destructive">
            <AlertTriangle className="size-3.5 shrink-0" />انمسحت {data.deletedToday} فاتورة اليوم ←
          </Link>
        )}
      </div>
      <PageTabs tabs={TABS} />
    </div>
  );
}
