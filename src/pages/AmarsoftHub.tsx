// صفحة أمارسوفت: كل ما يأتي من نظام المحل في مكان واحد، بأزرار كبيرة واضحة.
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Boxes, Building2, ClipboardCheck, History, Receipt, TrendingUp, Trophy, type LucideIcon } from "lucide-react";
import { useAuth, hasRole } from "@/hooks/useAuth";
import { sb, formatTripoli, daysToRange, tripoliToday } from "@/lib/amarsoft";

type Tile = { to: string; label: string; hint: string; icon: LucideIcon; admin?: boolean };

const TILES: Tile[] = [
  { to: "/branches", label: "الفروع", hint: "شن دار كل فرع", icon: Building2, admin: true },
  { to: "/pos-sales", label: "المبيعات", hint: "كل الفواتير والبائعين", icon: Receipt, admin: true },
  { to: "/pos-sales?tab=profit", label: "الأرباح", hint: "سعر الغرام والمصنعية والربح", icon: TrendingUp, admin: true },
  { to: "/pos-sales?tab=log", label: "الممسوح والمعدّل", hint: "شن كان في الفاتورة قبل", icon: History, admin: true },
  { to: "/pos-stock", label: "المخزون", hint: "القطع في كل فرع", icon: Boxes },
  { to: "/pos-count", label: "الجرد", hint: "امسح القطع وقارن", icon: ClipboardCheck },
  { to: "/leaderboard", label: "المتصدرون", hint: "مبيعات كل موظف", icon: Trophy },
];

export default function AmarsoftHub() {
  const { roles } = useAuth();
  const isAdmin = hasRole(roles, "admin");

  const { data } = useQuery({
    queryKey: ["amarsoft-hub"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { start, end } = daysToRange(tripoliToday(), tripoliToday());
      const [sync, deleted] = await Promise.all([
        sb.from("amarsoft_sync_log").select("received_at").order("received_at", { ascending: false }).limit(1).maybeSingle(),
        isAdmin
          ? sb.from("amarsoft_doc_events").select("trn_no", { count: "exact", head: true }).eq("trn_type", "RSL").eq("status", "D").gte("at", start).lt("at", end)
          : Promise.resolve({ count: 0 }),
      ]);
      return { lastSync: (sync.data?.received_at as string | undefined) ?? null, deletedToday: deleted.count ?? 0 };
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
