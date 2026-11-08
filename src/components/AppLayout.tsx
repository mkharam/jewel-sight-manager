import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, Scale, CalendarDays, Search, MessageCircle, MessagesSquare, Upload, LogOut, Sparkles, Users, ArrowLeftRight, BarChart3, MoreHorizontal, Coins, ClipboardCheck, PackagePlus, Receipt, ListChecks, Wrench, Landmark, BookmarkCheck, Recycle, Trophy, Boxes, Building2, Truck, UserCog, Wallet, Watch, ClipboardList, Award, BadgePercent, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
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

type BadgeKey = "transfers" | "uploads" | "reorders" | "weights" | "chat";
type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean; badgeKey?: BadgeKey };
// compact: صفحات قليلة الاستعمال — أيقوناتها في «المزيد» بلون هادي بدل الذهبي.
type NavSection = { title: string; items: NavItem[]; compact?: boolean };

// المدير العام: «المزيد» مقسوم حسب الموضوع — الفلوس، البضاعة، الناس — بدل «الإدارة/اليوم/أخرى»
// اللي كانت تخلط مواضيع مختلفة في نفس القسم. «أخرى» صغيرة وفيها بس اللي يُستعمل نادراً.
function buildAdminNav(): NavSection[] {
  return [
    {
      title: "الرئيسية",
      items: [
        { to: "/", label: "البحث", icon: Search, end: true },
        { to: "/chat", label: "المحادثة", icon: MessagesSquare, badgeKey: "chat" },
        { to: "/inquiries", label: "الاستفسارات", icon: MessageCircle },
        { to: "/amarsoft", label: "أمارسوفت", icon: Boxes },
        { to: "/discount", label: "خصم الزبون", icon: BadgePercent },
      ],
    },
    {
      title: "المبيعات والفلوس",
      items: [
        { to: "/reports", label: "التقارير", icon: BarChart3 },
        { to: "/branches", label: "الفروع", icon: Building2 },
        { to: "/pos-sales", label: "الفواتير", icon: Receipt },
        { to: "/accountant", label: "المحاسب", icon: Wallet },
        { to: "/gram-price", label: "سعر بيع الغرام", icon: Coins },
        { to: "/gold-price", label: "سعر الذهب اليوم", icon: Coins },
        { to: "/closing", label: "إقفال اليوم", icon: Landmark },
        { to: "/buybacks", label: "شراء الكسر", icon: Recycle },
      ],
    },
    {
      title: "البضاعة",
      items: [
        { to: "/transfers", label: "التحويلات", icon: ArrowLeftRight, badgeKey: "transfers" },
        { to: "/reorders", label: "إعادة الطلب", icon: PackagePlus, badgeKey: "reorders" },
        { to: "/reservations", label: "الحجوزات", icon: BookmarkCheck },
        { to: "/admin/repairs", label: "الصيانة", icon: Wrench },
        { to: "/watches", label: "الساعات", icon: Watch },
        { to: "/upload", label: "رفع قطع", icon: Upload, badgeKey: "uploads" },
        { to: "/weights", label: "قطع بلا وزن", icon: Scale, badgeKey: "weights" },
        { to: "/admin/products", label: "إدارة القطع", icon: ListChecks },
      ],
    },
    {
      title: "الناس",
      items: [
        { to: "/staff", label: "الموظفون", icon: UserCog },
        { to: "/evaluations", label: "التقييم", icon: ClipboardList },
        { to: "/leaderboard", label: "المتصدرون", icon: Trophy },
        { to: "/customers", label: "العملاء", icon: Users },
        { to: "/loyalty", label: "الولاء", icon: Award },
        { to: "/suppliers", label: "الموردون", icon: Truck },
      ],
    },
    {
      title: "أخرى",
      compact: true,
      items: [
        { to: "/daily-summary", label: "الملخّص اليومي", icon: CalendarDays },
        { to: "/stock-take", label: "جرد التطبيق", icon: ClipboardCheck },
        { to: "/sales", label: "مبيعات التطبيق", icon: Receipt },
      ],
    },
  ];
}

// مصدر واحد لكل التنقّل، مقسّم بأقسام واضحة — كان هناك ست قوائم متداخلة (أساسية، إضافات
// سطح المكتب، مشتركة، مشرف، مدير، موظف) فتتكرّر العناصر وتظهر للمدير 20 رابطاً في صف واحد
// أعلى الشاشة على الآيباد والكمبيوتر. الآن: شريط جانبي بأقسام على الشاشات الكبيرة، ونفس
// الأقسام داخل «المزيد» على الهاتف.
// المشرف العام: نفس قائمة الإدارة بلا صفحات الفلوس (مبيعات، فروع، محاسب، موردين، تقارير، إقفال…).
const MONEY_PAGES = new Set(["/branches", "/pos-sales", "/gram-price", "/accountant", "/suppliers", "/staff", "/reports",
  "/closing", "/buybacks", "/daily-summary", "/sales"]);
function buildSupervisorNav(): NavSection[] {
  const secs = buildAdminNav()
    .map((s) => ({ ...s, items: s.items.filter((i) => !MONEY_PAGES.has(i.to)) }))
    .filter((s) => s.items.length);
  // قسم «المبيعات والفلوس» يبقى فيه سعر الذهب بس — ما يستاهلش قسم لروحه، يمشي للبضاعة.
  const money = secs.find((s) => s.title === "المبيعات والفلوس");
  const goods = secs.find((s) => s.title === "البضاعة");
  if (money && goods) goods.items.push(...money.items);
  return secs.filter((s) => s !== money);
}

function buildNav(isAdmin: boolean, isManager: boolean, isEvalRecorder = false, isSupervisor = false): NavSection[] {
  if (isAdmin) return buildAdminNav();
  if (isSupervisor) return buildSupervisorNav();
  const sections: NavSection[] = [
    {
      title: "الرئيسية",
      items: [
        { to: "/", label: "البحث", icon: Search, end: true },
        { to: "/chat", label: "المحادثة", icon: MessagesSquare, badgeKey: "chat" },
        { to: "/inquiries", label: "الاستفسارات", icon: MessageCircle },
        { to: "/upload", label: "رفع قطع", icon: Upload, badgeKey: "uploads" },
        { to: "/discount", label: "خصم الزبون", icon: BadgePercent },
        // الإشعارات ليست هنا: الجرس في الرأس ظاهر على كل الشاشات ويفتح صفحتها الكاملة.
      ],
    },
    {
      title: "العمل اليومي",
      items: [
        { to: "/transfers", label: "التحويلات", icon: ArrowLeftRight, badgeKey: "transfers" },
        { to: "/reorders", label: "إعادة الطلب", icon: PackagePlus, badgeKey: "reorders" },
        { to: "/watches", label: "الساعات", icon: Watch },
        { to: "/reservations", label: "الحجوزات", icon: BookmarkCheck },
        { to: "/customers", label: "العملاء", icon: Users },
        { to: "/weights", label: "قطع بلا وزن", icon: Scale, badgeKey: "weights" },
        { to: "/leaderboard", label: "لوحة المتصدرين", icon: Trophy },
      ],
    },
  ];
  // سعر الذهب والإقفال والصيانة وشراء الكسر: المشرف (المدير العام له قائمته فوق).
  if (isManager) {
    sections.push({
      title: "الفرع",
      items: [
        { to: "/gold-price", label: "سعر الذهب", icon: Coins },
        { to: "/closing", label: "إقفال اليوم", icon: Landmark },
        { to: "/loyalty", label: "الولاء", icon: Award },
        { to: "/admin/repairs", label: "الصيانة", icon: Wrench },
        { to: "/buybacks", label: "شراء الكسر", icon: Recycle },
        // كل صفحات أمارسوفت (مبيعات، أرباح، سجل، مخزون، جرد) خلف زر واحد بدل خمسة.
        { to: "/amarsoft", label: "أمارسوفت", icon: Boxes },
      ],
    });
  }
  // مسؤول التقييم (أيمن) يشوف لوحة التقييمات ويسجّل فيها، حتى لو موظف عادي.
  if (isEvalRecorder) sections[1].items.unshift({ to: "/evaluations", label: "تقييم الموظفين", icon: ClipboardList });
  return sections;
}

// الشريط السفلي على الهاتف: أربع/خمس صفحات يومية + «المزيد». الموظف عمله اليومي تسجيل
// استفسار وطلب إعادة قطعة، فيحصل «إعادة الطلب» على مكان في الشريط بدل دفنه في «المزيد».
const MOBILE_BAR = ["/", "/chat", "/inquiries", "/upload"];
// المدير العام ما يرفعش قطع كل يوم؛ أمارسوفت (مبيعات، فروع، مخزون) أهم له، و«رفع قطع» في «المزيد».
const MOBILE_BAR_ADMIN = ["/", "/chat", "/inquiries", "/amarsoft"];
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
  const sections = buildNav(isAdmin, isManager, isEvalRecorder, isSupervisor);
  const allItems = sections.flatMap((sec) => sec.items);
  const barPaths = isAdmin || isSupervisor ? MOBILE_BAR_ADMIN : isStaff ? MOBILE_BAR_STAFF : MOBILE_BAR;
  const mobileBar = barPaths.map((to) => allItems.find((i) => i.to === to)!).filter(Boolean);
  // «المزيد» = كل ما ليس في الشريط السفلي، بنفس الأقسام.
  const moreSections = sections
    .map((sec) => ({ ...sec, items: sec.items.filter((i) => !barPaths.includes(i.to)) }))
    .filter((sec) => sec.items.length > 0);
  const countOf = (i: NavItem) => (i.badgeKey ? badges[i.badgeKey] ?? 0 : 0);
  // تنبيه مجمّع على زر «المزيد» حتى لا تختفي التحويلات المعلّقة داخله دون أن يعرف بها أحد.
  const moreBadgeCount = moreSections.reduce((n, sec) => n + sec.items.reduce((m, i) => m + countOf(i), 0), 0);
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
            <div className="leading-tight">
              <h1 className="text-base sm:text-lg font-extrabold text-gold-gradient">مخرّم</h1>
              <p className="text-[9px] sm:text-[10px] text-muted-foreground -mt-0.5 hidden sm:block">إدارة المجوهرات</p>
            </div>
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
                mobileBar.length >= 5 ? "text-[11px]" : "text-xs",
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
              {/* شبكة أيقونات مرتّبة زي شاشة التلفون: أربعة في كل سطر، أيقونة صغيرة في مربع
                  ملوّن واسمها تحتها. الأقسام الرئيسية بلون ذهبي، و«أخرى» (قليلة الاستعمال) بلون هادي. */}
              <div className="mt-3 space-y-4">
                {moreSections.map((sec) => (
                  <div key={sec.title}>
                    <p className="mb-1.5 px-1 text-xs font-bold text-muted-foreground">{sec.title}</p>
                    <div className="grid grid-cols-4 gap-x-1 gap-y-3 rounded-2xl bg-muted/40 p-2">
                      {sec.items.map((item) => (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          onClick={() => setMoreOpen(false)}
                          className={({ isActive }) => cn(
                            "relative flex flex-col items-center gap-1 rounded-xl py-1.5 active:bg-muted",
                            isActive ? "text-primary" : "text-foreground"
                          )}
                        >
                          <span className={cn(
                            "relative flex size-11 items-center justify-center rounded-2xl",
                            sec.compact ? "bg-card border border-border" : "bg-gold-soft",
                          )}>
                            <item.icon className={cn("size-5", sec.compact ? "text-muted-foreground" : "text-primary")} />
                            <CountBadge count={countOf(item)} className="absolute -top-1 -left-1" />
                          </span>
                          <span className="text-[11px] font-semibold leading-tight text-center line-clamp-2 px-0.5">{item.label}</span>
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
      <PullToRefresh />
    </div>
  );
}
