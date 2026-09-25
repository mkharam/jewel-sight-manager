import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { Scale, CalendarDays, Search, MessageCircle, MessagesSquare, Upload, LogOut, Sparkles, Users, ArrowLeftRight, BarChart3, MoreHorizontal, Coins, ClipboardCheck, PackagePlus, Receipt, ListChecks, Wrench, Landmark, BookmarkCheck, Recycle, type LucideIcon } from "lucide-react";
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
import { uploadQueue, useUploadQueuePendingCount } from "@/lib/uploadQueue";
import { useResumeRoute } from "@/lib/resume";
import { ensurePushEnabled } from "@/lib/push";
import { resumePendingUploads } from "@/lib/uploadRunner";

type BadgeKey = "transfers" | "uploads" | "reorders" | "weights";
type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean; badgeKey?: BadgeKey };
type NavSection = { title: string; items: NavItem[] };

// مصدر واحد لكل التنقّل، مقسّم بأقسام واضحة — كان هناك ست قوائم متداخلة (أساسية، إضافات
// سطح المكتب، مشتركة، مشرف، مدير، موظف) فتتكرّر العناصر وتظهر للمدير 20 رابطاً في صف واحد
// أعلى الشاشة على الآيباد والكمبيوتر. الآن: شريط جانبي بأقسام على الشاشات الكبيرة، ونفس
// الأقسام داخل «المزيد» على الهاتف.
function buildNav(isAdmin: boolean, isManager: boolean): NavSection[] {
  const sections: NavSection[] = [
    {
      title: "الرئيسية",
      items: [
        { to: "/", label: "البحث", icon: Search, end: true },
        { to: "/chat", label: "المحادثة", icon: MessagesSquare },
        { to: "/inquiries", label: "الاستفسارات", icon: MessageCircle },
        { to: "/upload", label: "رفع قطع", icon: Upload, badgeKey: "uploads" },
        // الإشعارات ليست هنا: الجرس في الرأس ظاهر على كل الشاشات ويفتح صفحتها الكاملة.
      ],
    },
    {
      title: "العمل اليومي",
      items: [
        { to: "/transfers", label: "التحويلات", icon: ArrowLeftRight, badgeKey: "transfers" },
        { to: "/reorders", label: "إعادة الطلب", icon: PackagePlus, badgeKey: "reorders" },
        { to: "/reservations", label: "الحجوزات", icon: BookmarkCheck },
        { to: "/customers", label: "العملاء", icon: Users },
        { to: "/weights", label: "قطع بلا وزن", icon: Scale, badgeKey: "weights" },
      ],
    },
  ];
  // سعر الذهب والإقفال والصيانة وشراء الكسر: المدير العام والمشرف فقط.
  if (isAdmin || isManager) {
    sections.push({
      title: "الفرع",
      items: [
        { to: "/gold-price", label: "سعر الذهب", icon: Coins },
        { to: "/closing", label: "إقفال اليوم", icon: Landmark },
        { to: "/admin/repairs", label: "الصيانة", icon: Wrench },
        { to: "/buybacks", label: "شراء الكسر", icon: Recycle },
      ],
    });
  }
  // الأرباح والمبيعات والجرد وإدارة الموظفين: المدير العام فقط.
  if (isAdmin) {
    sections.push({
      title: "الإدارة",
      items: [
        { to: "/daily-summary", label: "الملخّص اليومي", icon: CalendarDays },
        { to: "/reports", label: "التقارير", icon: BarChart3 },
        { to: "/sales", label: "المبيعات", icon: Receipt },
        { to: "/stock-take", label: "الجرد", icon: ClipboardCheck },
        { to: "/admin/products", label: "إدارة القطع", icon: ListChecks },
        { to: "/staff", label: "الموظفون", icon: Users },
      ],
    });
  }
  return sections;
}

// الشريط السفلي على الهاتف: أربع/خمس صفحات يومية + «المزيد». الموظف عمله اليومي تسجيل
// استفسار وطلب إعادة قطعة، فيحصل «إعادة الطلب» على مكان في الشريط بدل دفنه في «المزيد».
const MOBILE_BAR = ["/", "/chat", "/inquiries", "/upload"];
const MOBILE_BAR_STAFF = ["/", "/chat", "/inquiries", "/reorders", "/upload"];

function CountBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span className={cn(
      "min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center",
      className,
    )}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

export default function AppLayout() {
  const { profile, roles, user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = roles.includes("admin");
  const isManager = roles.includes("manager");
  const qc = useQueryClient();
  const branchId = profile?.branch_id ?? null;

  // العودة لنفس الصفحة بعد الخروج للواتساب وغيره. راجع src/lib/resume.ts.
  useResumeRoute(() => uploadQueue.getItems().some((i) => i.status !== "done" && i.status !== "error"));

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

  const isStaff = !isAdmin && !isManager;
  const sections = buildNav(isAdmin, isManager);
  const allItems = sections.flatMap((sec) => sec.items);
  const barPaths = isStaff ? MOBILE_BAR_STAFF : MOBILE_BAR;
  const mobileBar = barPaths.map((to) => allItems.find((i) => i.to === to)!).filter(Boolean);
  // «المزيد» = كل ما ليس في الشريط السفلي، بنفس الأقسام.
  const moreSections = sections
    .map((sec) => ({ ...sec, items: sec.items.filter((i) => !barPaths.includes(i.to)) }))
    .filter((sec) => sec.items.length > 0);
  const countOf = (i: NavItem) => (i.badgeKey ? badges[i.badgeKey] ?? 0 : 0);
  // تنبيه مجمّع على زر «المزيد» حتى لا تختفي التحويلات المعلّقة داخله دون أن يعرف بها أحد.
  const moreBadgeCount = moreSections.reduce((n, sec) => n + sec.items.reduce((m, i) => m + countOf(i), 0), 0);
  const roleLabel = isAdmin ? "مدير عام" : isManager ? "مدير فرع" : "موظف";

  const signOut = async () => {
    await supabase.auth.signOut();
    // بدون هذا تبقى نتائج الحساب السابق في كاش react-query، فيفتح الموظف التطبيق على
    // جهاز استعمله المدير فيرى للحظة بياناته هو (القطع، المحادثة، العدّادات).
    qc.clear();
    navigate("/auth");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* الرأس بسيط الآن: الشعار، الإشعارات، الحساب. التنقّل انتقل للشريط الجانبي (آيباد/كمبيوتر)
          أو الشريط السفلي (هاتف) بدل صف روابط مزدحم هنا. */}
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur shadow-card safe-area-pt">
        <div className="px-3 sm:px-4 h-14 sm:h-16 flex items-center justify-between gap-2 sm:gap-4">
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

          <div className="flex items-center gap-1 sm:gap-2">
            <NotificationsBell />
            <div className="hidden sm:block text-left">
              <p className="text-sm font-semibold leading-tight">{profile?.full_name ?? "—"}</p>
              <p className="text-[11px] text-muted-foreground leading-tight">{roleLabel}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={signOut} aria-label="خروج" title="تسجيل الخروج">
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        {/* الشريط الجانبي (يمين الشاشة في العربية): آيباد = أيقونات بعناوين صغيرة تحتها لتوفير
            العرض، كمبيوتر = أيقونة واسم وأقسام معنونة. */}
        <aside className="hidden md:block shrink-0 w-[88px] lg:w-60 border-l border-border bg-card/60">
          <nav
            aria-label="التنقّل"
            className="sticky top-[calc(env(safe-area-inset-top)+4rem)] max-h-[calc(100dvh-env(safe-area-inset-top)-4rem)] overflow-y-auto py-3 px-2 lg:px-3 space-y-4"
          >
            {sections.map((sec, si) => (
              <div key={sec.title} className="space-y-1">
                <p className="hidden lg:block px-3 pb-1 text-[11px] font-bold text-muted-foreground">{sec.title}</p>
                {si > 0 && <div className="lg:hidden mx-3 mb-2 border-t border-border" />}
                {sec.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    title={item.label}
                    className={({ isActive }) => cn(
                      "relative flex items-center rounded-xl transition-colors",
                      "flex-col gap-1 py-2 text-[10px] font-semibold text-center",
                      "lg:flex-row lg:gap-3 lg:px-3 lg:py-2.5 lg:text-sm lg:font-medium lg:text-right",
                      isActive ? "bg-primary/12 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary/70",
                    )}
                  >
                    <item.icon className="size-5 shrink-0" />
                    <span className="leading-tight lg:flex-1">{item.label}</span>
                    <CountBadge count={countOf(item)} className="absolute top-1 left-2 lg:static" />
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
        </aside>

        <main className="flex-1 min-w-0 px-3 sm:px-4 lg:px-6 py-3 sm:py-4 pb-28 md:pb-8">
          <div className="mx-auto w-full max-w-7xl">
            <StaleGoldPriceBanner />
            <Outlet />
          </div>
        </main>
      </div>

      <nav data-mobile-bottom-nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-card/95 backdrop-blur safe-area-pb">
        <div className={cn("grid", mobileBar.length >= 5 ? "grid-cols-6" : "grid-cols-5")}>
          {mobileBar.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}
              className={({ isActive }) => cn(
                "min-h-[64px] py-2 flex flex-col items-center justify-center gap-1 font-semibold transition-colors relative select-none",
                mobileBar.length >= 5 ? "text-[10px]" : "text-[11px]",
                isActive ? "text-primary" : "text-muted-foreground active:bg-muted/40"
              )}>
              {({ isActive }) => (
                <>
                  <div className={cn("relative flex items-center justify-center rounded-xl transition-colors h-8 w-12", isActive && "bg-primary/12")}>
                    <item.icon className="size-[22px]" />
                    <CountBadge count={countOf(item)} className="absolute -top-1 left-1" />
                  </div>
                  <span className="leading-none">{item.label}</span>
                </>
              )}
            </NavLink>
          ))}

          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                aria-label="المزيد"
                className="min-h-[64px] py-2 flex flex-col items-center justify-center gap-1 text-[11px] font-semibold text-muted-foreground active:bg-muted/40 select-none"
              >
                <div className="relative flex items-center justify-center rounded-xl h-8 w-12">
                  <MoreHorizontal className="size-[22px]" />
                  <CountBadge count={moreBadgeCount} className="absolute -top-1 left-1" />
                </div>
                <span className="leading-none">المزيد</span>
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="rounded-t-2xl pb-8 max-h-[85dvh] overflow-y-auto">
              <SheetHeader className="text-right">
                <SheetTitle>المزيد</SheetTitle>
              </SheetHeader>
              <div className="mt-3 space-y-4">
                {moreSections.map((sec) => (
                  <div key={sec.title}>
                    <p className="mb-2 text-xs font-bold text-muted-foreground">{sec.title}</p>
                    <div className="grid grid-cols-3 gap-2.5">
                      {sec.items.map((item) => (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          onClick={() => setMoreOpen(false)}
                          className={({ isActive }) => cn(
                            "relative flex flex-col items-center justify-center gap-2 rounded-xl border border-border p-3 min-h-[80px] text-xs font-semibold",
                            isActive ? "bg-secondary text-primary" : "text-foreground active:bg-muted/50"
                          )}
                        >
                          <item.icon className="size-6" />
                          <span className="text-center leading-tight">{item.label}</span>
                          <CountBadge count={countOf(item)} className="absolute top-1.5 left-1.5" />
                        </NavLink>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>

      <InstallPrompt />
    </div>
  );
}
