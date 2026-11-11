// صفحة أمارسوفت: كل ما يأتي من نظام المحل في مكان واحد، أيقونات مقسّمة على أقسام واضحة.
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Boxes, Building2, ClipboardCheck, Coins, History, Link2, Receipt, TrendingUp, Trophy, Truck, Wallet, type LucideIcon } from "lucide-react";
import { useAuth, hasRole } from "@/hooks/useAuth";
import { sb, formatTripoli, daysToRange, tripoliToday } from "@/lib/amarsoft";

type Tile = { to: string; label: string; hint: string; icon: LucideIcon; admin?: boolean };
type Section = { title: string; tiles: Tile[] };

const SECTIONS: Section[] = [
  {
    title: "الأرقام والحسابات",
    tiles: [
      { to: "/reports", label: "التقارير", hint: "كل الفروع ومقارنتها", icon: BarChart3, admin: true },
      { to: "/reports?tab=branches", label: "الفروع", hint: "كل فرع بروحه، يوم بيوم", icon: Building2, admin: true },
      { to: "/reports?tab=gram", label: "سعر الغرام", hint: "بكم يبيع كل فرع الغرام", icon: Coins, admin: true },
      { to: "/reports?tab=accountant", label: "المحاسب", hint: "نقدي ومصرف وآجل", icon: Wallet, admin: true },
    ],
  },
  {
    title: "المبيعات",
    tiles: [
      { to: "/pos-sales", label: "الفواتير", hint: "كل فواتير البيع", icon: Receipt, admin: true },
      { to: "/pos-sales?tab=profit", label: "الأرباح", hint: "سعر الغرام والمصنعية", icon: TrendingUp, admin: true },
      { to: "/pos-sales?tab=log", label: "الممسوح والمعدّل", hint: "شن تبدّل في الفواتير", icon: History, admin: true },
      { to: "/leaderboard", label: "المتصدرون", hint: "مبيعات كل موظف", icon: Trophy },
    ],
  },
  {
    title: "البضاعة",
    tiles: [
      { to: "/pos-stock", label: "المخزون", hint: "القطع في كل فرع", icon: Boxes },
      { to: "/pos-count", label: "الجرد", hint: "امسح القطع وقارن", icon: ClipboardCheck },
      { to: "/suppliers", label: "الموردون", hint: "شن دخل وشن تباع", icon: Truck, admin: true },
      { to: "/amarsoft-link", label: "ربط القطع", hint: "قطع التطبيق برقم أمارسوفت", icon: Link2, admin: true },
    ],
  },
];

export default function AmarsoftHub() {
  const { roles } = useAuth();
  const isAdmin = hasRole(roles, "admin");

  const { data } = useQuery({
    queryKey: ["amarsoft-hub", isAdmin],
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
    <div className="max-w-md mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold">أمارسوفت</h1>
        <p className="text-sm text-muted-foreground">آخر تحديث: {formatTripoli(data?.lastSync)}</p>
      </div>
      {isAdmin && !!data?.deletedToday && (
        <Link to="/pos-sales?tab=log" className="block rounded-2xl border-2 border-destructive bg-destructive/10 p-4 text-lg font-bold text-destructive">
          ⚠️ حُذفت {data.deletedToday} فاتورة اليوم — اضغط للتفاصيل
        </Link>
      )}
      {SECTIONS.map((s) => {
        const tiles = s.tiles.filter((t) => !t.admin || isAdmin);
        if (!tiles.length) return null;
        return (
          <section key={s.title} className="space-y-2">
            <h2 className="text-sm font-bold text-muted-foreground">{s.title}</h2>
            <div className="grid grid-cols-2 gap-3">
              {tiles.map((t) => (
                <Link key={t.to} to={t.to} className="rounded-2xl border border-border bg-card p-3 min-h-[108px] flex flex-col items-center justify-center gap-1.5 text-center active:bg-muted/50 shadow-card">
                  <span className="size-12 rounded-full bg-gold-soft flex items-center justify-center"><t.icon className="size-6 text-primary" /></span>
                  <span className="text-base font-bold leading-tight">{t.label}</span>
                  <span className="text-[11px] text-muted-foreground leading-tight">{t.hint}</span>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
