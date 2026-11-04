// صفحة أمارسوفت: كل ما يأتي من نظام المحل في مكان واحد، بأزرار كبيرة واضحة.
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Boxes, Building2, ClipboardCheck, History, Link2, Receipt, TrendingUp, Trophy, Truck, type LucideIcon } from "lucide-react";
import { useAuth, hasRole } from "@/hooks/useAuth";
import { sb, formatTripoli, formatLD, formatGrams, daysToRange, tripoliToday } from "@/lib/amarsoft";

type Tile = { to: string; label: string; hint: string; icon: LucideIcon; admin?: boolean };
type BranchToday = { branch_code: string; branch_name: string; invoices: number; grams: number; sales_dirhams: number };

const TILES: Tile[] = [
  { to: "/reports", label: "التقارير", hint: "كل الفروع ومقارنتها", icon: BarChart3, admin: true },
  { to: "/pos-sales", label: "المبيعات", hint: "كل الفواتير والبائعين", icon: Receipt, admin: true },
  { to: "/pos-sales?tab=profit", label: "الأرباح", hint: "سعر الغرام والمصنعية والربح", icon: TrendingUp, admin: true },
  { to: "/pos-sales?tab=log", label: "الممسوح والمعدّل", hint: "شن كان في الفاتورة قبل", icon: History, admin: true },
  { to: "/amarsoft-link", label: "ربط القطع", hint: "قطع التطبيق برقم أمارسوفت", icon: Link2, admin: true },
  { to: "/suppliers", label: "الموردون", hint: "شن دخل وشن تباع وحسابهم", icon: Truck, admin: true },
  { to: "/pos-stock", label: "المخزون", hint: "القطع في كل فرع", icon: Boxes },
  { to: "/pos-count", label: "الجرد", hint: "امسح القطع وقارن", icon: ClipboardCheck },
  { to: "/leaderboard", label: "المتصدرون", hint: "مبيعات كل موظف", icon: Trophy },
];

export default function AmarsoftHub() {
  const { roles } = useAuth();
  const isAdmin = hasRole(roles, "admin");

  const { data } = useQuery({
    queryKey: ["amarsoft-hub", isAdmin],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { start, end } = daysToRange(tripoliToday(), tripoliToday());
      const [sync, deleted, branches] = await Promise.all([
        sb.from("amarsoft_sync_log").select("received_at").order("received_at", { ascending: false }).limit(1).maybeSingle(),
        isAdmin
          ? sb.from("amarsoft_doc_events").select("trn_no", { count: "exact", head: true }).eq("trn_type", "RSL").eq("status", "D").gte("at", start).lt("at", end)
          : Promise.resolve({ count: 0 }),
        isAdmin ? sb.rpc("amarsoft_branch_overview", { p_start: start, p_end: end }) : Promise.resolve({ data: [] }),
      ]);
      return {
        lastSync: (sync.data?.received_at as string | undefined) ?? null,
        deletedToday: deleted.count ?? 0,
        branches: (branches.data ?? []) as BranchToday[],
      };
    },
  });

  return (
    <div className="max-w-md mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold">أمارسوفت</h1>
        <p className="text-sm text-muted-foreground">آخر تحديث: {formatTripoli(data?.lastSync)}</p>
      </div>
      {isAdmin && !!data?.deletedToday && (
        <Link to="/pos-sales?tab=log" className="block rounded-2xl border-2 border-destructive bg-destructive/10 p-4 text-lg font-bold text-destructive">
          ⚠️ حُذفت {data.deletedToday} فاتورة اليوم — اضغط للتفاصيل
        </Link>
      )}
      {isAdmin && (
        <div className="rounded-2xl border border-border bg-card shadow-card p-3">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-bold flex items-center gap-2"><Building2 className="size-5 text-primary" />الفروع اليوم</h2>
            <Link to="/branches" className="text-sm font-semibold text-primary">كل الفروع ←</Link>
          </div>
          {(data?.branches ?? []).map((b) => (
            <Link key={b.branch_code} to={`/branches/${b.branch_code}`} className="flex items-center justify-between py-2.5 border-b last:border-0 active:bg-muted/50">
              <span className="text-base font-bold">{b.branch_name}</span>
              <span className="text-left">
                <span className="block font-bold text-primary">{formatLD(b.sales_dirhams)}</span>
                <span className="block text-xs text-muted-foreground">{b.invoices} فاتورة · {formatGrams(b.grams)}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        {TILES.filter((t) => !t.admin || isAdmin).map((t) => (
          <Link key={t.to} to={t.to} className="rounded-2xl border border-border bg-card p-4 min-h-[120px] flex flex-col items-center justify-center gap-2 text-center active:bg-muted/50 shadow-card">
            <t.icon className="size-10 text-primary" />
            <span className="text-lg font-bold leading-tight">{t.label}</span>
            <span className="text-xs text-muted-foreground leading-tight">{t.hint}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
