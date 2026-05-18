import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { Search, Package, MessageCircle, Upload, LogOut, Sparkles, Users, ArrowLeftRight, Share2 } from "lucide-react";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import NotificationsBell from "@/components/NotificationsBell";

type NavItem = { to: string; label: string; icon: any; end?: boolean; badgeKey?: "transfers" };

const baseNav: NavItem[] = [
  { to: "/", label: "البحث", icon: Search, end: true },
  { to: "/transfers", label: "تحويلات", icon: ArrowLeftRight, badgeKey: "transfers" },
  { to: "/inquiries", label: "استفسارات", icon: MessageCircle },
  { to: "/products/new", label: "إضافة", icon: Package },
];

const desktopExtras: NavItem[] = [
  { to: "/import", label: "استيراد", icon: Upload },
  { to: "/import-social", label: "من السوشيال", icon: Share2 },
];

export default function AppLayout() {
  const { profile, roles, user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = roles.includes("admin");
  const qc = useQueryClient();
  const branchId = profile?.branch_id ?? null;

  // عدد التحويلات المعلّقة للموظف: واردة بانتظار استلام، أو صادرة بانتظار موافقة
  const { data: pendingTransfers = 0 } = useQuery({
    queryKey: ["pending-transfers-count", branchId, user?.id],
    queryFn: async () => {
      if (!user) return 0;
      // واردة إلى فرعي بانتظار approval/شحن
      let total = 0;
      if (branchId) {
        const { count: incoming } = await supabase
          .from("transfers")
          .select("id", { count: "exact", head: true })
          .eq("to_branch_id", branchId)
          .in("status", ["pending", "approved", "in_transit"] as any);
        total += incoming ?? 0;
      }
      return total;
    },
    enabled: !!user,
    refetchInterval: 60_000,
  });

  // اشتراك Realtime لتحديث العدّاد فوراً
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("transfers-badge")
      .on("postgres_changes", { event: "*", schema: "public", table: "transfers" }, () => {
        qc.invalidateQueries({ queryKey: ["pending-transfers-count"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, qc]);

  const badges: Record<string, number> = { transfers: pendingTransfers };

  const mobileNav: NavItem[] = isAdmin
    ? [...baseNav, { to: "/staff", label: "موظفون", icon: Users }]
    : baseNav;

  const desktopNav: NavItem[] = isAdmin
    ? [...baseNav, ...desktopExtras, { to: "/staff", label: "موظفون", icon: Users }]
    : [...baseNav, ...desktopExtras];

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur shadow-card">
        <div className="container mx-auto px-3 sm:px-4 h-14 sm:h-16 flex items-center justify-between gap-2 sm:gap-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="size-8 sm:size-9 rounded-xl bg-gold-gradient flex items-center justify-center shadow-gold">
              <Sparkles className="size-4 sm:size-5 text-primary-foreground" />
            </div>
            <div className="leading-tight">
              <h1 className="text-base sm:text-lg font-extrabold text-gold-gradient">لمعة</h1>
              <p className="text-[9px] sm:text-[10px] text-muted-foreground -mt-0.5 hidden sm:block">إدارة المجوهرات</p>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {desktopNav.map((item) => {
              const count = item.badgeKey ? badges[item.badgeKey] : 0;
              return (
                <NavLink key={item.to} to={item.to} end={item.end}
                  className={({ isActive }) => cn(
                    "px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 relative",
                    isActive ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                  )}>
                  <item.icon className="size-4" />
                  {item.label}
                  {count > 0 && (
                    <span className="ml-1 min-w-5 h-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                      {count > 99 ? "99+" : count}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </nav>

          <div className="flex items-center gap-1 sm:gap-2">
            <NotificationsBell />
            <div className="hidden sm:block text-left">
              <p className="text-sm font-semibold leading-tight">{profile?.full_name ?? "—"}</p>
              <p className="text-[11px] text-muted-foreground leading-tight">
                {roles.includes("admin") ? "مدير عام" : roles.includes("manager") ? "مدير فرع" : "موظف"}
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={signOut} aria-label="خروج">
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-3 sm:px-4 py-3 sm:py-4 pb-24 md:pb-8">
        <Outlet />
      </main>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-card/95 backdrop-blur safe-area-pb">
        <div className={cn(
          "grid h-16",
          mobileNav.length === 5 ? "grid-cols-5" : "grid-cols-4"
        )}>
          {mobileNav.map((item) => {
            const count = item.badgeKey ? badges[item.badgeKey] : 0;
            return (
              <NavLink key={item.to} to={item.to} end={item.end}
                className={({ isActive }) => cn(
                  "flex flex-col items-center justify-center gap-0.5 text-[10px] transition-colors relative",
                  isActive ? "text-primary" : "text-muted-foreground active:bg-muted/40"
                )}>
                <div className="relative">
                  <item.icon className="size-5" />
                  {count > 0 && (
                    <span className="absolute -top-1.5 -right-2 min-w-4 h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center">
                      {count > 9 ? "9+" : count}
                    </span>
                  )}
                </div>
                {item.label}
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
