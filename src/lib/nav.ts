// كتالوج واحد لكل صفحات التطبيق: كل صفحة بقسمها ووصف قصير ومن يقدر يفتحها. منه تُبنى القائمة
// (الهاتف والكمبيوتر)، والبحث في القائمة، و«آخر صفحات»، واسم الصفحة الحالية في الرأس — فما فيش
// قائمتين تختلفوا، وأي صفحة جديدة تنضاف هنا مرة وحدة.
import {
  Search, MessageCircle, MessagesSquare, Upload, Users, ArrowLeftRight, BarChart3, Coins, ClipboardCheck, PackagePlus,
  Receipt, ListChecks, Wrench, Landmark, BookmarkCheck, Recycle, Trophy, Boxes, Truck, UserCog, Watch, ClipboardList,
  Award, Layers, Scale, Building2, Wallet, TrendingUp, History, Link2, CalendarDays, CreditCard, ShoppingBag, Gem,
  PieChart, Bell, Tags, ScanLine, type LucideIcon,
} from "lucide-react";

export type Role = "admin" | "supervisor" | "manager" | "staff" | "evalRecorder";
export type BadgeKey = "transfers" | "uploads" | "reorders" | "weights" | "chat";
export type NavItem = {
  to: string; label: string; hint: string; icon: LucideIcon;
  /** من يشوفها. فارغ = الكل. */
  roles?: Role[];
  badgeKey?: BadgeKey;
  /** كلمات إضافية للبحث في القائمة. */
  keywords?: string;
  end?: boolean;
  /** خانة داخل صفحة: ما تظهرش في القائمة نفسها (الصفحة الأم تكفي)، لكن تطلع في البحث وفي «آخر صفحات»
   *  واسمها يظهر في الرأس لما تكون فيها. */
  searchOnly?: boolean;
};
export type NavSectionKey = "sell" | "goods" | "money" | "team" | "more";
export type NavSection = { key: NavSectionKey; title: string; hint: string; icon: LucideIcon; tone: string; items: NavItem[] };

const ALL: Role[] | undefined = undefined;
const A: Role[] = ["admin"];
const AS: Role[] = ["admin", "supervisor"];
const AMS: Role[] = ["admin", "manager", "supervisor"];
const AM: Role[] = ["admin", "manager"];

export const NAV: NavSection[] = [
  {
    key: "sell", title: "البيع والزبائن", hint: "البحث عن قطعة، الزبائن، الاستفسارات، الولاء", icon: ShoppingBag,
    tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    items: [
      { to: "/", label: "البحث عن قطعة", hint: "ابحث بالكلام أو بالصورة أو بالكود", icon: Search, end: true, roles: ALL, keywords: "كتالوج صورة باركود" },
      { to: "/inquiries", label: "الاستفسارات", hint: "زبون سأل على قطعة", icon: MessageCircle, roles: ALL },
      { to: "/reservations", label: "الحجوزات", hint: "قطع محجوزة لزبائن", icon: BookmarkCheck, roles: ALL, keywords: "عربون" },
      { to: "/customers", label: "العملاء", hint: "بيانات الزبائن ومشترياتهم", icon: Users, roles: ALL, keywords: "زبائن زبون عميل" },
      { to: "/loyalty", label: "الولاء", hint: "لوحة الولاء والخصومات", icon: Award, roles: ALL, keywords: "خصم نقاط" },
      { to: "/loyalty?tab=newcard", label: "بطاقة ولاء جديدة", hint: "تسجيل زبون في الولاء", icon: CreditCard, roles: ALL },
      { to: "/loyalty?tab=members", label: "أعضاء الولاء", hint: "كل اللي عندهم بطاقة", icon: Users, roles: ["admin", "manager", "supervisor"] },
      { to: "/loyalty?tab=wallet", label: "بطاقات Wallet", hint: "بطاقات الآيفون والأندرويد", icon: Wallet, roles: A },
      { to: "/buybacks", label: "شراء الكسر", hint: "شراء ذهب مستعمل من زبون", icon: Recycle, roles: AM },
      { to: "/gold-price", label: "سعر الذهب اليوم", hint: "سعر الجرام للبيع في المحل", icon: Coins, roles: AMS },
    ],
  },
  {
    key: "goods", title: "البضاعة", hint: "رفع القطع، القطع الناقصة، التحويلات، المخزون، الجرد", icon: Gem,
    tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    items: [
      { to: "/upload", label: "رفع قطع", hint: "تصوير وإضافة قطع جديدة", icon: Upload, roles: ALL, badgeKey: "uploads", keywords: "تصوير اضافة كاميرا جلسة" },
      { to: "/pieces", label: "قطع تحتاج متابعة", hint: "بلا اسم، بلا وزن، أطقم ناقصة، ربط أمارسوفت", icon: Tags, roles: ALL, badgeKey: "weights", keywords: "ناقص مراجعة" },
      { to: "/pieces?tab=unnamed", label: "قطع بلا اسم", hint: "تستنى التحليل والتسمية", icon: Tags, roles: ALL, searchOnly: true },
      { to: "/pieces?tab=weights", label: "قطع بلا وزن", hint: "ناقصها الوزن", icon: Scale, roles: ALL, searchOnly: true, keywords: "ميزان" },
      { to: "/pieces?tab=sets", label: "الأطقم الناقصة", hint: "أطقم بيعت منها قطعة", icon: Layers, roles: ALL, searchOnly: true, keywords: "طقم طاقم" },
      { to: "/pieces?tab=link", label: "ربط القطع بأمارسوفت", hint: "قطع التطبيق بلا رقم أمارسوفت", icon: Link2, roles: A, searchOnly: true, keywords: "باركود تاق" },
      { to: "/admin/products", label: "إدارة القطع", hint: "تعديل وأرشفة القطع بالجملة", icon: ListChecks, roles: AS },
      { to: "/transfers", label: "التحويلات", hint: "نقل قطع بين الفروع", icon: ArrowLeftRight, roles: ALL, badgeKey: "transfers" },
      { to: "/reorders", label: "إعادة الطلب", hint: "طلب قطعة نفدت من المورد", icon: PackagePlus, roles: ALL, badgeKey: "reorders" },
      { to: "/watches", label: "الساعات", hint: "مخزون الساعات", icon: Watch, roles: ALL },
      { to: "/admin/repairs", label: "الصيانة", hint: "قطع الزبائن عند الفني", icon: Wrench, roles: AMS, keywords: "تصليح" },
      { to: "/stock", label: "المخزون", hint: "شن موجود في كل فرع (أمارسوفت)", icon: Boxes, roles: AMS },
      { to: "/stock?tab=app", label: "تقرير مخزون التطبيق", hint: "المخزون والحركة شهر بشهر", icon: ClipboardCheck, roles: A, searchOnly: true, keywords: "جرد شهري" },
      { to: "/count", label: "الجرد", hint: "امسح القطع وقارن بالمخزون", icon: ScanLine, roles: AMS, keywords: "مسح باركود" },
      { to: "/count?tab=app", label: "جرد قطع التطبيق", hint: "القطع المسجّلة في التطبيق", icon: ClipboardCheck, roles: AS, searchOnly: true },
    ],
  },
  {
    key: "money", title: "المبيعات والفلوس", hint: "التقارير، الأسعار والأرباح، الفواتير، الإقفال", icon: PieChart,
    tone: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
    items: [
      { to: "/reports", label: "التقارير", hint: "كل الفروع ومقارنتها والتنبيهات", icon: BarChart3, roles: A },
      { to: "/reports?tab=daily", label: "ملخّص اليوم", hint: "شن صار اليوم في كل الفروع", icon: CalendarDays, roles: A },
      { to: "/reports?tab=branches", label: "الفروع", hint: "كل فرع بروحه، يوم بيوم", icon: Building2, roles: A },
      { to: "/reports?tab=gram", label: "الأسعار والأرباح", hint: "سعر الغرام والربح فوق سعر الذهب", icon: Coins, roles: A, keywords: "سعر الغرام ربح مصنعية" },
      { to: "/reports?tab=accountant", label: "المحاسب", hint: "نقدي ومصرف وآجل", icon: Wallet, roles: A },
      { to: "/reports?tab=sales", label: "البيع من التطبيق", hint: "المبيعات المسجّلة من التطبيق", icon: TrendingUp, roles: A, searchOnly: true },
      { to: "/pos-sales", label: "الفواتير", hint: "كل فواتير البيع من أمارسوفت", icon: Receipt, roles: A },
      { to: "/pos-sales?tab=log", label: "الممسوح والمعدّل", hint: "شن تبدّل في الفواتير", icon: History, roles: A },
      { to: "/amarsoft", label: "أمارسوفت", hint: "كل صفحات أمارسوفت في مكان واحد", icon: Boxes, roles: AMS },
      { to: "/closing", label: "إقفال اليوم", hint: "تسليم الخزينة آخر اليوم", icon: Landmark, roles: AM },
      { to: "/suppliers", label: "الموردون", hint: "شن دخل منهم وشن تباع وحساباتهم", icon: Truck, roles: A },
    ],
  },
  {
    key: "team", title: "الفريق والتقييم", hint: "المحادثة، الموظفين، التقييم، المتصدرون", icon: UserCog,
    tone: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
    items: [
      { to: "/chat", label: "المحادثة", hint: "محادثة الفريق", icon: MessagesSquare, roles: ALL, badgeKey: "chat" },
      { to: "/staff", label: "الموظفون", hint: "الحسابات والصلاحيات والفروع", icon: UserCog, roles: A, keywords: "صلاحيات رواتب حساب" },
      { to: "/evaluation", label: "التقييم", hint: "الأرقام، التقييم الشهري، المتصدرون", icon: ClipboardList, roles: A },
      { to: "/evaluation?tab=numbers", label: "أرقام البائعين والفروع", hint: "الوزن، السعر فوق الذهب، الخصم، النقاط", icon: BarChart3, roles: A, searchOnly: true, keywords: "تقييم البائعين نقاط" },
      { to: "/evaluation?tab=monthly", label: "التقييم الشهري", hint: "مين قيّم ومين اتقيّم", icon: ClipboardList, roles: A, searchOnly: true, keywords: "استمارة" },
      { to: "/evaluation?tab=leaderboard", label: "المتصدرون", hint: "ترتيب البائعين بالوزن", icon: Trophy, roles: A, searchOnly: true },
      { to: "/evaluations", label: "التقييم الشهري", hint: "مين قيّم ومين اتقيّم، والترتيب", icon: ClipboardList, roles: ["evalRecorder"] },
      { to: "/leaderboard", label: "المتصدرون", hint: "ترتيب البائعين بالوزن", icon: Trophy, roles: ["supervisor", "manager", "staff"] },
    ],
  },
  {
    key: "more", title: "أخرى", hint: "الإشعارات", icon: Bell,
    tone: "bg-muted text-muted-foreground",
    items: [
      { to: "/notifications", label: "الإشعارات", hint: "كل التنبيهات والأحداث", icon: Bell, roles: ALL },
    ],
  },
];

/** الأقسام اللي يشوفها المستخدم حسب صلاحياته (والتكرار بين المدير ومسؤول التقييم يتشال). */
export function navFor(roles: Role[]): NavSection[] {
  const isAdmin = roles.includes("admin");
  return NAV.map((s) => ({
    ...s,
    items: s.items.filter((i) => {
      if (!i.roles) return true;
      if (i.roles.includes("evalRecorder") && isAdmin) return false; // المدير عنده /staff?tab=evaluations
      return i.roles.some((r) => roles.includes(r));
    }),
  })).filter((s) => s.items.length);
}

const splitTo = (to: string) => {
  const [path, q] = to.split("?");
  return { path, tab: q ? new URLSearchParams(q).get("tab") : null };
};

/** هل الرابط هو الصفحة الحالية؟ الخانات (?tab=) تتطابق بدقة؛ الخانة الأولى بلا tab = الصفحة نفسها. */
export function isActiveItem(item: NavItem, pathname: string, search: string): boolean {
  const { path, tab } = splitTo(item.to);
  if (path !== pathname) return false;
  const cur = new URLSearchParams(search).get("tab");
  return tab ? cur === tab : !cur;
}

/** اسم الصفحة الحالية وقسمها — للرأس، حتى تعرف دايماً وين أنت. */
export function currentPage(sections: NavSection[], pathname: string, search: string): { section?: NavSection; item?: NavItem; label: string } | null {
  for (const s of sections) for (const i of s.items) if (isActiveItem(i, pathname, search)) return { section: s, item: i, label: i.label };
  // صفحة بخانات مفتوحة على خانة ما لهاش زر: اسم الصفحة الأم.
  for (const s of sections) for (const i of s.items) if (splitTo(i.to).path === pathname && !splitTo(i.to).tab && pathname !== "/") return { section: s, item: i, label: i.label };
  if (pathname.startsWith("/products/")) return { label: pathname.endsWith("/edit") ? "تعديل قطعة" : "قطعة" };
  if (pathname === "/products/new") return { label: "قطعة جديدة" };
  if (pathname === "/live-add") return { label: "إضافة مباشرة" };
  if (pathname.startsWith("/branches/")) return { label: "فرع" };
  return null;
}

// ===== آخر الصفحات المفتوحة =====
const RECENT_KEY = "nav.recent";
export function readRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); } catch { return []; }
}
export function pushRecent(to: string) {
  try {
    const list = [to, ...readRecent().filter((x) => x !== to)].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch { /* ignore */ }
}

/** بحث في القائمة: يطابق الاسم والوصف والكلمات، بتطبيع بسيط للحروف العربية. */
const norm = (s: string) => s.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, " ").trim();
export function searchNav(sections: NavSection[], q: string): { section: NavSection; item: NavItem }[] {
  const n = norm(q);
  if (!n) return [];
  const out: { section: NavSection; item: NavItem; score: number }[] = [];
  for (const s of sections) for (const i of s.items) {
    const label = norm(i.label), hay = norm(`${i.hint} ${i.keywords ?? ""} ${s.title}`);
    const score = label.startsWith(n) ? 3 : label.includes(n) ? 2 : hay.includes(n) ? 1 : 0;
    if (score) out.push({ section: s, item: i, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 12);
}
