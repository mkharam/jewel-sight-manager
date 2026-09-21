import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { Scale, CalendarDays, Search, MessageCircle, MessagesSquare, Upload, LogOut, Sparkles, Users, ArrowLeftRight, BarChart3, MoreHorizontal, Coins, ClipboardCheck, PackagePlus, Receipt, ListChecks, Bell, Wrench, Landmark, BookmarkCheck, Recycle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import NotificationsBell from "@/components/NotificationsBell";
import InstallPrompt from "@/components/InstallPrompt";
import StaleGoldPriceBanner from "@/components/StaleGoldPriceBanner";
import { useUploadQueuePendingCount } from "@/lib/uploadQueue";
import { ensurePushEnabled } from "@/lib/push";
import { resumePendingUploads } from "@/lib/uploadRunner";

type NavItem = { to: string; label: string; icon: any; end?: boolean; badgeKey?: "transfers" | "uploads" | "reorders" | "weights" };

const baseNav: NavItem[] = [
  { to: "/", label: "البحث", icon: Search, end: true },
  { to: "/chat", label: "المحادثة", icon: MessagesSquare },
  { to: "/inquiries", label: "استفسارات", icon: MessageCircle },
  { to: "/upload", label: "رفع", icon: Upload, badgeKey: "uploads" },
];

// الشريط السفلي للموظف: عمله اليومي هو تسجيل سعر لزبون، وطلب إعادة قطعة، وتسجيل
// استفسار — وكان «إعادة الطلب» مدفوناً داخل «المزيد». تسجيل السعر يبدأ من القطعة
// نفسها (داخل صفحتها) فمكانه البحث. المحادثة تبقى في الشريط فيصير ستة أعمدة.
const employeeMobileNav: NavItem[] = [
  { to: "/", label: "البحث", icon: Search, end: true },
  { to: "/chat", label: "المحادثة", icon: MessagesSquare },
  { to: "/inquiries", label: "استفسارات", icon: MessageCircle },
  { to: "/reorders", label: "إعادة طلب", icon: PackagePlus, badgeKey: "reorders" },
  { to: "/upload", label: "رفع", icon: Upload, badgeKey: "uploads" },
];

const desktopExtras: NavItem[] = [
  { to: "/transfers", label: "تحويلات", icon: ArrowLeftRight, badgeKey: "transfers" },
  { to: "/notifications", label: "الإشعارات", icon: Bell },
];

// مفيد للعمل اليومي — يراه المشرف والموظف بلا فرق بينهما، بخلاف الأمور الإدارية أدناه.
const sharedExtras: NavItem[] = [
  { to: "/weights", label: "قطع بلا وزن", icon: Scale, badgeKey: "weights" },
  { to: "/customers", label: "العملاء", icon: Users },
  { to: "/reservations", label: "الحجوزات", icon: BookmarkCheck },
  { to: "/reorders", label: "طلبات إعادة الطلب", icon: PackagePlus, badgeKey: "reorders" },
];

// سعر الذهب: المدير العام والمشرف فقط — ليس الموظف.
const managerExtras: NavItem[] = [
  { to: "/gold-price", label: "سعر الذهب", icon: Coins },
  // الصيانة: المدير العام يرى كل الفروع، والمشرف فرعه وحده (تفرضه RLS).
  { to: "/admin/repairs", label: "الصيانة", icon: Wrench },
  // إقفال اليوم: المشرف يقفل فرعه، والمدير العام يراجع كل الفروع.
  { to: "/closing", label: "إقفال اليوم", icon: Landmark },
  // شراء الذهب القديم: مال يخرج من الدرج — المدير العام والمشرف فقط.
  { to: "/buybacks", label: "شراء الكسر", icon: Recycle },
];

// أمور إدارية/حسابية — للمدير العام فقط: تقارير الأرباح، سجل المبيعات، التعديل الجماعي،
// وإدارة الموظفين.
const adminExtras: NavItem[] = [
  // أول ما يريد المالك رؤيته كل يوم — ملخّص شامل الفروع بدل فتح خمس صفحات.
  { to: "/daily-summary", label: "الملخّص اليومي", icon: CalendarDays },
  // الجرد الميداني للإدارة فقط — الموظف يبحث ويسجّل ويطلب، والجرد قرار إداري.
  { to: "/stock-take", label: "جرد ميداني", icon: ClipboardCheck },
  { to: "/reports", label: "التقارير", icon: BarChart3 },
  { to: "/sales", label: "المبيعات", icon: Receipt },
  { to: "/admin/products", label: "إدارة القطع", icon: ListChecks },
];

export default function AppLayout() {
  const { profile, roles, user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = roles.includes("admin");
  const isManager = roles.includes("manager");
  const qc = useQueryClient();
  const branchId = profile?.branch_id ?? null;

  // نتأكد من تفعيل إشعارات الجهاز عند كل فتح للتطبيق بدل انتظار أن يتذكّر الموظف
  // فتح الجرس والضغط على "تفعيل" يدوياً — إن كان الإذن ممنوحاً فعلاً لكن الاشتراك ضاع
  // تُعاد صامتة، وإن لم يُطلب الإذن من قبل تظهر نافذة الإذن الأصلية تلقائياً. راجع
  // ensurePushEnabled في src/lib/push.ts.
  useEffect(() => {
    if (!user) return;
    void ensurePushEnabled();
  }, [user]);

  // صور بقيت من جلسة رفع انقطعت (خروج من التطبيق أو قتل التبويب على الهاتف) — تُستأنف
  // مرة واحدة عند فتح التطبيق. بدون هذا كانت الصورة تضيع نهائياً لأنها من الكاميرا ولا
  // نسخة منها في أي مكان آخر. راجع src/lib/pendingUploads.ts.
  useEffect(() => {
    if (!user) return;
    let done = false;
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      void resumePendingUploads(user.id).catch(() => {});
    }, 3000);
    return () => clearTimeout(t);
  }, [user]);

  // عدد طلبات إعادة الطلب التي بانتظار قرار المدير
  // مُعرّف المستخدم جزء من المفتاح: بدونه كان العدّاد المحسوب لحساب سابق يبقى في الكاش
  // ويظهر كما هو للحساب التالي بعد تبديل المستخدم على الجهاز نفسه.
  const { data: pendingReorders = 0 } = useQuery({
    queryKey: ["pending-reorders-count", user?.id],
    queryFn: async () => {
      const { count } = await supabase
        .from("product_reorder_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      return count ?? 0;
    },
    enabled: !!user,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("reorders-badge")
      .on("postgres_changes", { event: "*", schema: "public", table: "product_reorder_requests" }, () => {
        qc.invalidateQueries({ queryKey: ["pending-reorders-count"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, qc]);

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

  const { data: missingWeights = 0 } = useQuery({
    queryKey: ["missing-weights-nav-count", branchId, user?.id],
    queryFn: async () => {
      let q = supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("status", "available")
        .is("weight_grams", null);
      if (branchId) q = q.eq("branch_id", branchId);
      const { count } = await q;
      return count ?? 0;
    },
    enabled: !!user,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("missing-weights-badge")
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, () => {
        qc.invalidateQueries({ queryKey: ["missing-weights-nav-count"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, qc]);

  const pendingUploads = useUploadQueuePendingCount();
  const badges: Record<string, number> = { transfers: pendingTransfers, uploads: pendingUploads, reorders: pendingReorders, weights: missingWeights };

  const [moreOpen, setMoreOpen] = useState(false);

  // الشريط السفلي: 4 أساسية + زر «المزيد» يفتح بقية الصفحات. الموظف يحصل على ترتيب
  // خاص به مبني على عمله اليومي (راجع employeeMobileNav)، والمدير يبقى على الترتيب العام.
  const isStaff = !isAdmin && !isManager;
  const mobileNav: NavItem[] = isStaff ? employeeMobileNav : baseNav;
  const moreItems: NavItem[] = [
    ...desktopExtras,
    // «إعادة الطلب» صار في الشريط السفلي للموظف فلا نكرّره هنا
    ...sharedExtras.filter((i) => !(isStaff && i.to === "/reorders")),
    ...((isAdmin || isManager) ? managerExtras : []),
    ...(isAdmin ? [...adminExtras, { to: "/staff", label: "موظفون", icon: Users }] : []),
  ];

  // تنبيه مجمّع على زر «المزيد»: التحويلات المعلّقة كانت تظهر داخل القائمة فقط، فلا
  // يعرف الموظف بوجودها ما لم يفتحها. النقطة تظهر إن كان أي عنصر بالداخل يحمل عدداً.
  const moreBadgeCount = moreItems.reduce((n, i) => n + (i.badgeKey ? badges[i.badgeKey] ?? 0 : 0), 0);

  // المشرف والموظف يريان نفس الشيء تقريباً — بضاعة كل الفروع والاستفسارات وما يفيد
  // العمل اليومي، بدون أي فرق بينهما في التنقّل عدا سعر الذهب (للمشرف والمدير فقط).
  // صلاحيات التعديل/الحذف تُضبط داخل كل صفحة (مثلاً ProductDetail) لا من القائمة.
  const desktopNav: NavItem[] = isAdmin
    ? [...baseNav, ...desktopExtras, ...sharedExtras, ...managerExtras, ...adminExtras, { to: "/staff", label: "موظفون", icon: Users }]
    : isManager
      ? [...baseNav, ...desktopExtras, ...sharedExtras, ...managerExtras]
      : [...baseNav, ...desktopExtras, ...sharedExtras];

  const signOut = async () => {
    await supabase.auth.signOut();
    // بدون هذا تبقى نتائج الحساب السابق في كاش react-query، فيفتح الموظف التطبيق على
    // جهاز استعمله المدير فيرى للحظة بياناته هو (القطع، المحادثة، العدّادات).
    qc.clear();
    navigate("/auth");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur shadow-card safe-area-pt">
        <div className="container mx-auto px-3 sm:px-4 h-14 sm:h-16 flex items-center justify-between gap-2 sm:gap-4">
          <Link to="/" className="flex items-center gap-2">
            {/* شعار المتجر الفعلي بدل أيقونة عامة — نفس النقش الذهبي على الحقل الزمرّدي */}
            <img
              src={`${import.meta.env.BASE_URL}brand-logo.webp`}
              alt="مخرّم"
              width={36}
              height={36}
              className="size-8 sm:size-9 rounded-xl object-cover shadow-emerald ring-1 ring-primary/25"
            />
            <div className="leading-tight">
              <h1 className="text-base sm:text-lg font-extrabold text-gold-gradient">مخرّم</h1>
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

      <main className="flex-1 container mx-auto px-3 sm:px-4 py-3 sm:py-4 pb-28 md:pb-8">
        <StaleGoldPriceBanner />
        <Outlet />
      </main>

      <nav data-mobile-bottom-nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-card/95 backdrop-blur safe-area-pb">
        {/* عدد الأعمدة يتبع طول الشريط: خمسة للمدير، ستة للموظف (بند إضافي: إعادة الطلب) */}
        <div className={cn("grid", mobileNav.length >= 5 ? "grid-cols-6" : "grid-cols-5")}>
          {mobileNav.map((item) => {
            const count = item.badgeKey ? badges[item.badgeKey] : 0;
            return (
              <NavLink key={item.to} to={item.to} end={item.end}
                className={({ isActive }) => cn(
                  "min-h-[64px] py-2 flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors relative select-none",
                  isActive ? "text-primary" : "text-muted-foreground active:bg-muted/40"
                )}>
                {({ isActive }) => (
                  <>
                    <div className={cn(
                      "relative flex items-center justify-center rounded-xl transition-colors h-8 w-12",
                      isActive && "bg-primary/12"
                    )}>
                      <item.icon className="size-[22px]" />
                      {count > 0 && (
                        <span className="absolute -top-1 left-1 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                          {count > 9 ? "9+" : count}
                        </span>
                      )}
                    </div>
                    <span className={cn("leading-none", mobileNav.length >= 5 && "text-[10px]")}>{item.label}</span>
                  </>
                )}
              </NavLink>
            );
          })}

          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                aria-label="المزيد"
                className="min-h-[64px] py-2 flex flex-col items-center justify-center gap-1 text-[11px] font-semibold text-muted-foreground active:bg-muted/40 select-none"
              >
                <div className="relative flex items-center justify-center rounded-xl h-8 w-12">
                  <MoreHorizontal className="size-[22px]" />
                  {moreBadgeCount > 0 && (
                    <span className="absolute -top-1 left-1 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                      {moreBadgeCount > 9 ? "9+" : moreBadgeCount}
                    </span>
                  )}
                </div>
                <span>المزيد</span>
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="rounded-t-2xl pb-8">
              <SheetHeader className="text-right">
                <SheetTitle>المزيد</SheetTitle>
              </SheetHeader>
              <div className="grid grid-cols-3 gap-3 mt-4">
                {moreItems.map((item) => {
                  const count = item.badgeKey ? badges[item.badgeKey] : 0;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={() => setMoreOpen(false)}
                      className={({ isActive }) => cn(
                        "relative flex flex-col items-center justify-center gap-2 rounded-xl border border-border p-3 min-h-[86px] text-xs font-semibold",
                        isActive ? "bg-secondary text-primary" : "text-foreground active:bg-muted/50"
                      )}
                    >
                      <item.icon className="size-6" />
                      <span className="text-center leading-tight">{item.label}</span>
                      {count > 0 && (
                        <span className="absolute top-1.5 left-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                          {count > 9 ? "9+" : count}
                        </span>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>

      <InstallPrompt />
    </div>
  );
}
