import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, LogOut, MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import NavMenu from "@/components/NavMenu";
import { currentPage, navFor, type NavItem, type Role } from "@/lib/nav";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { roleLabel as roleLabelOf, useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import NotificationsBell from "@/components/NotificationsBell";
import InstallPrompt from "@/components/InstallPrompt";
import PullToRefresh from "@/components/PullToRefresh";
import { useIsEvalAdmin } from "@/lib/evaluation";
import StaleGoldPriceBanner from "@/components/StaleGoldPriceBanner";
import { uploadQueue, useUploadQueuePendingCount } from "@/lib/uploadQueue";
import { useResumeRoute } from "@/lib/resume";
import { ensurePushEnabled } from "@/lib/push";
import { resumePendingUploads } from "@/lib/uploadRunner";
import { useActivityFeed } from "@/hooks/useActivityFeed";
import { CHAT_SEEN_KEY, NOTIFS_SEEN_KEY, SEEN_EVENT, readSeen, setIconBadge } from "@/lib/appBadge";

// القائمة كلها من كتالوج واحد (src/lib/nav.ts): الأقسام والصلاحيات.
// الشريط السفلي على الهاتف: أربع صفحات يومية + «المزيد» (كل الباقي في شبكة وحدة). الموظف عمله اليومي تسجيل استفسار
// وطلب إعادة قطعة؛ المدير العام أمارسوفت أهم له من رفع القطع.
const MOBILE_BAR = ["/", "/chat", "/inquiries", "/upload"];
const MOBILE_BAR_ADMIN = ["/", "/chat", "/inquiries", "/amarsoft"];
// المشرف: أمارسوفت عنده هو المخزون.
const MOBILE_BAR_SUPERVISOR = ["/", "/chat", "/inquiries", "/stock"];
const MOBILE_BAR_STAFF = ["/", "/chat", "/inquiries", "/reorders", "/upload"];
// أسماء قصيرة للشريط السفلي (الاسم الكامل في القائمة).
const BAR_LABEL: Record<string, string> = { "/": "البحث", "/chat": "المحادثة", "/inquiries": "الاستفسارات", "/amarsoft": "أمارسوفت", "/stock": "المخزون", "/upload": "رفع قطع", "/reorders": "إعادة الطلب" };

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
  const { pathname } = useLocation();
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

  // آخر ما قرأه المستخدم من الإشعارات والمحادثة — يتحدّث فور فتح الجرس أو المحادثة
  // (SEEN_EVENT) أو من تبويب آخر (storage).
  const [seen, setSeen] = useState(() => ({ notifs: readSeen(NOTIFS_SEEN_KEY), chat: readSeen(CHAT_SEEN_KEY) }));
  useEffect(() => {
    const refresh = () => setSeen({ notifs: readSeen(NOTIFS_SEEN_KEY), chat: readSeen(CHAT_SEEN_KEY) });
    window.addEventListener(SEEN_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(SEEN_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  // رسائل المحادثة غير المقروءة (من الزملاء فقط، لا رسائلي).
  const { data: unreadChat = 0 } = useQuery({
    queryKey: ["chat-unread", user?.id, seen.chat],
    queryFn: async () => {
      const { count } = await supabase
        .from("staff_messages")
        .select("id", { count: "exact", head: true })
        .gt("created_at", seen.chat)
        .neq("sender_id", user!.id);
      return count ?? 0;
    },
    enabled: !!user,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("chat-unread-badge")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "staff_messages" }, () => {
        qc.invalidateQueries({ queryKey: ["chat-unread"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, qc]);

  // نفس تغذية جرس الإشعارات (نفس الكاش، لا طلب إضافي).
  const { data: feed = [] } = useActivityFeed(30);
  const unreadNotifs = feed.filter((e) => e.item.created_at > seen.notifs).length;

  // الرقم على أيقونة التطبيق في الشاشة الرئيسية.
  useEffect(() => {
    if (!user) return;
    setIconBadge(unreadNotifs + unreadChat);
  }, [user, unreadNotifs, unreadChat]);

  const pendingUploads = useUploadQueuePendingCount();
  const badges: Record<string, number> = { transfers: pendingTransfers, uploads: pendingUploads, reorders: pendingReorders, weights: missingWeights, chat: unreadChat };

  const [moreOpen, setMoreOpen] = useState(false);

  const isSupervisor = roles.includes("supervisor");
  const isStaff = !isAdmin && !isManager && !isSupervisor;
  const isEvalRecorder = !!useIsEvalAdmin();
  const navRoles: Role[] = [
    ...(isAdmin ? ["admin" as const] : []), ...(isSupervisor ? ["supervisor" as const] : []),
    ...(isManager ? ["manager" as const] : []), ...(isStaff ? ["staff" as const] : []),
    ...(isEvalRecorder ? ["evalRecorder" as const] : []),
  ];
  const sections = navFor(navRoles);
  const allItems = sections.flatMap((sec) => sec.items);
  const barPaths = isAdmin ? MOBILE_BAR_ADMIN : isSupervisor ? MOBILE_BAR_SUPERVISOR : isStaff ? MOBILE_BAR_STAFF : MOBILE_BAR;
  const mobileBar = barPaths.map((to) => allItems.find((i) => i.to === to)!).filter(Boolean);
  const countOf = (i: NavItem) => (i.badgeKey ? badges[i.badgeKey] ?? 0 : 0);
  // تنبيه مجمّع على زر «المزيد» للي مش في الشريط، حتى ما تختفيش التحويلات المعلّقة داخله.
  const moreBadgeCount = allItems.filter((i) => !i.searchOnly && !barPaths.includes(i.to)).reduce((n, i) => n + countOf(i), 0);
  // اسم الصفحة الحالية وقسمها في الرأس.
  const { search } = useLocation();
  const page = currentPage(sections, pathname, search);
  const roleLabel = roleLabelOf(roles);

  const signOut = async () => {
    setIconBadge(0);
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
          <div className="flex items-center gap-1">
          {/* زر رجوع: التطبيق المثبّت على الآيفون ما فيهش زر رجوع. لو الصفحة فُتحت مباشرة
              (رابط أو إشعار) ما فيش صفحة قبلها، فيرجع للرئيسية. */}
          {pathname !== "/" && (
            <Button
              variant="ghost"
              size="icon"
              className="size-10"
              aria-label="رجوع"
              onClick={() => ((window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate("/"))}
            >
              <ArrowRight className="size-6" />
            </Button>
          )}
          <Link to="/" className="flex items-center gap-2">
            {/* شعار المتجر الفعلي بدل أيقونة عامة — نفس النقش الذهبي على الحقل الزمرّدي */}
            <img
              src={`${import.meta.env.BASE_URL}brand-logo.webp`}
              alt="مخرّم"
              width={36}
              height={36}
              className="size-8 sm:size-9 rounded-xl object-cover shadow-emerald ring-1 ring-primary/25"
            />
            {/* وين أنت: اسم الصفحة وقسمها، وفي الرئيسية اسم المحل. */}
            {pathname === "/" || !page ? (
              <div className="leading-tight">
                <h1 className="text-base sm:text-lg font-extrabold text-gold-gradient">مخرّم</h1>
                <p className="text-[9px] sm:text-[10px] text-muted-foreground -mt-0.5 hidden sm:block">إدارة المجوهرات</p>
              </div>
            ) : (
              <div className="leading-tight min-w-0">
                {page.section && <p className="text-[10px] sm:text-[11px] text-muted-foreground truncate">{page.section.title}</p>}
                <h1 className="text-base sm:text-lg font-bold truncate max-w-[46vw] sm:max-w-none">{page.label}</h1>
              </div>
            )}
          </Link>
          </div>

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
        {/* الشريط الجانبي على الكمبيوتر والآيباد بالعرض: كل الأقسام مفتوحة. */}
        <aside className="hidden lg:block shrink-0 w-60 border-l border-border bg-card/60">
          <nav
            aria-label="التنقّل"
            className="sticky top-[calc(env(safe-area-inset-top)+4rem)] max-h-[calc(100dvh-env(safe-area-inset-top)-4rem)] overflow-y-auto py-3 px-2"
          >
            <NavMenu sections={sections} countOf={countOf} variant="list" />
          </nav>
        </aside>

        <main className="flex-1 min-w-0 px-3 sm:px-4 lg:px-6 py-3 sm:py-4 pb-28 lg:pb-8">
          <div className="mx-auto w-full max-w-7xl">
            <StaleGoldPriceBanner />
            <Outlet />
          </div>
        </main>
      </div>

      <nav data-mobile-bottom-nav className="lg:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-card/95 backdrop-blur safe-area-pb">
        <div className={cn("grid", mobileBar.length >= 5 ? "grid-cols-6" : "grid-cols-5")}>
          {mobileBar.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}
              className={({ isActive }) => cn(
                "min-h-[64px] py-2 flex flex-col items-center justify-center gap-1 font-semibold transition-colors relative select-none",
                mobileBar.length >= 5 ? "text-[11px]" : "text-xs",
                isActive ? "text-primary" : "text-muted-foreground active:bg-muted/40"
              )}>
              {({ isActive }) => (
                <>
                  <div className={cn("relative flex items-center justify-center rounded-xl transition-colors h-8 w-12", isActive && "bg-primary/12")}>
                    <item.icon className="size-[22px]" />
                    <CountBadge count={countOf(item)} className="absolute -top-1 left-1" />
                  </div>
                  <span className="leading-none">{BAR_LABEL[item.to] ?? item.label}</span>
                </>
              )}
            </NavLink>
          ))}

          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                aria-label="المزيد"
                className="min-h-[64px] py-2 flex flex-col items-center justify-center gap-1 text-xs font-semibold text-muted-foreground active:bg-muted/40 select-none"
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
              <div className="mt-3">
                <NavMenu sections={sections} countOf={countOf} variant="grid" hide={barPaths} onNavigate={() => setMoreOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>

      <InstallPrompt />
      <PullToRefresh />
    </div>
  );
}
