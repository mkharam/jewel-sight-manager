// كتالوج واحد لكل صفحات التطبيق: كل صفحة بقسمها ووصف قصير ومن يقدر يفتحها. منه تُبنى القائمة
// (الهاتف والكمبيوتر)، والبحث في القائمة، واسم الصفحة الحالية في الرأس — فما فيش قائمتين
// تختلفوا، وأي صفحة جديدة تنضاف هنا مرة وحدة.
import {
  Search, MessageCircle, MessagesSquare, Upload, Users, ArrowLeftRight, BarChart3, Coins, ClipboardCheck, PackagePlus,
  Receipt, ListChecks, Wrench, Landmark, BookmarkCheck, Recycle, Trophy, Boxes, Truck, UserCog, Watch, ClipboardList,
  Award, Layers, Scale, Building2, Wallet, TrendingUp, History, Link2, CalendarDays, CreditCard, ShoppingBag, Gem,
  PieChart, Bell, Tags, ScanLine, Store, UserCheck, type LucideIcon,
} from "lucide-react";
import { normalizeAr } from "@/lib/arabic-search";

export type Role = "admin" | "supervisor" | "manager" | "staff" | "evalRecorder";
/** requests = التحويلات + إعادة الطلب (صفحة وحدة). */
export type BadgeKey = "transfers" | "uploads" | "reorders" | "weights" | "chat" | "requests";
export type NavItem = {
  to: string; label: string; hint: string; icon: LucideIcon;
  /** من يشوفها. فارغ = الكل. */
  roles?: Role[];
  badgeKey?: BadgeKey;
  /** كلمات إضافية للبحث في القائمة. */
  keywords?: string;
  end?: boolean;
  /** خانة داخل صفحة: ما تظهرش في شبكة القائمة (الصفحة الأم تكفي)، لكن تطلع في البحث،
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

// القائمة صارت أقصر: الصفحات اللي لها نفس الغرض صارت خانات في صفحة وحدة (الاستفسارات والحجوزات،
// التحويلات وإعادة الطلب، المخزون والجرد، القطع وإدارتها، الفروع والفريق)، والولاء زر واحد بدل أربعة.
// الخانات كلها تطلع في بحث القائمة (searchOnly)، والروابط القديمة تتحوّل لمكانها (راجع App.tsx).
export const NAV: NavSection[] = [
  {
    key: "sell", title: "البيع والزبائن", hint: "البحث عن قطعة، الاستفسارات، الزبائن، الولاء", icon: ShoppingBag,
    tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    items: [
      { to: "/", label: "البحث عن قطعة", hint: "ابحث بالكلام أو بالصورة أو بالكود", icon: Search, end: true, roles: ALL, keywords: "كتالوج صورة باركود" },
      { to: "/inquiries", label: "الاستفسارات والحجوزات", hint: "زبون سأل على قطعة، والقطع المحجوزة", icon: MessageCircle, roles: ALL, keywords: "طلبات الزبائن استفسار" },
      { to: "/inquiries?tab=reservations", label: "الحجوزات", hint: "قطع محجوزة لزبائن", icon: BookmarkCheck, roles: ALL, searchOnly: true, keywords: "عربون حجز" },
      { to: "/customers", label: "العملاء", hint: "بيانات الزبائن ومشترياتهم", icon: Users, roles: ALL, keywords: "زبائن زبون عميل" },
      { to: "/loyalty", label: "الولاء", hint: "الخصم، البطاقات، والأعضاء", icon: Award, roles: ALL, keywords: "خصم نقاط بطاقة" },
      { to: "/loyalty?tab=newcard", label: "بطاقة ولاء جديدة", hint: "تسجيل زبون في الولاء", icon: CreditCard, roles: ALL, searchOnly: true },
      { to: "/loyalty?tab=members", label: "أعضاء الولاء", hint: "كل اللي عندهم بطاقة", icon: Users, roles: AMS, searchOnly: true },
      { to: "/loyalty?tab=wallet", label: "بطاقات Wallet", hint: "بطاقات الآيفون والأندرويد", icon: Wallet, roles: A, searchOnly: true },
      { to: "/buybacks", label: "شراء الكسر", hint: "شراء ذهب مستعمل من زبون", icon: Recycle, roles: AM },
    ],
  },
  {
    key: "goods", title: "البضاعة", hint: "رفع القطع، القطع الناقصة، التحويلات، المخزون والجرد", icon: Gem,
    tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    items: [
      { to: "/upload", label: "رفع قطع", hint: "تصوير وإضافة قطع جديدة", icon: Upload, roles: ALL, badgeKey: "uploads", keywords: "تصوير اضافة كاميرا جلسة" },
      { to: "/pieces", label: "القطع", hint: "بلا اسم، بلا وزن، أطقم ناقصة، الربط، والتعديل بالجملة", icon: Tags, roles: ALL, badgeKey: "weights", keywords: "ناقص مراجعة متابعة قطع تحتاج" },
      { to: "/pieces?tab=unnamed", label: "قطع بلا اسم", hint: "تستنى التحليل والتسمية", icon: Tags, roles: ALL, searchOnly: true },
      { to: "/pieces?tab=weights", label: "قطع بلا وزن", hint: "ناقصها الوزن", icon: Scale, roles: ALL, searchOnly: true, keywords: "ميزان" },
      { to: "/pieces?tab=sets", label: "الأطقم الناقصة", hint: "أطقم بيعت منها قطعة", icon: Layers, roles: ALL, searchOnly: true, keywords: "طقم طاقم" },
      { to: "/pieces?tab=link", label: "ربط القطع بأمارسوفت", hint: "قطع التطبيق بلا رقم أمارسوفت", icon: Link2, roles: A, searchOnly: true, keywords: "باركود تاق" },
      { to: "/pieces?tab=manage", label: "إدارة القطع", hint: "تعديل وأرشفة القطع بالجملة", icon: ListChecks, roles: AS, searchOnly: true, keywords: "ارشيف تعديل بالجملة" },
      { to: "/transfers", label: "التحويلات والطلبات", hint: "نقل قطع بين الفروع، وطلب قطعة نفدت", icon: ArrowLeftRight, roles: ALL, badgeKey: "requests", keywords: "تحويل نقل" },
      { to: "/transfers?tab=reorders", label: "إعادة الطلب", hint: "طلب قطعة نفدت من المورد", icon: PackagePlus, roles: ALL, badgeKey: "reorders", searchOnly: true, keywords: "مورد نفدت" },
      { to: "/watches", label: "الساعات", hint: "مخزون الساعات", icon: Watch, roles: ALL },
      { to: "/admin/repairs", label: "الصيانة", hint: "قطع الزبائن عند الفني", icon: Wrench, roles: AMS, keywords: "تصليح" },
      { to: "/stock", label: "المخزون والجرد", hint: "شن موجود في كل فرع، والجرد بالباركود", icon: Boxes, roles: AMS, keywords: "جرد مسح باركود" },
      { to: "/stock?tab=scan", label: "الجرد بالباركود", hint: "امسح القطع وقارن بمخزون أمارسوفت", icon: ScanLine, roles: AMS, searchOnly: true, keywords: "جرد مسح" },
      { to: "/stock?tab=appcount", label: "جرد قطع التطبيق", hint: "القطع المسجّلة في التطبيق", icon: ClipboardCheck, roles: AS, searchOnly: true },
      { to: "/stock?tab=app", label: "تقرير مخزون التطبيق", hint: "المخزون والحركة شهر بشهر", icon: ClipboardCheck, roles: A, searchOnly: true, keywords: "جرد شهري" },
    ],
  },
  {
    key: "money", title: "الفلوس والسوق", hint: "أمارسوفت، سعر الذهب والمنافسين، والإقفال", icon: PieChart,
    tone: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
    items: [
      { to: "/amarsoft", label: "أمارسوفت", hint: "التقارير، الفروع، الفواتير، الأرباح، المحاسب، الموردون", icon: Boxes, roles: A },
      { to: "/amarsoft?tab=overview", label: "نظرة عامة", hint: "كل الفروع ومقارنتها والتنبيهات", icon: BarChart3, roles: A, searchOnly: true, keywords: "تقارير" },
      { to: "/amarsoft?tab=branches", label: "مبيعات الفروع", hint: "كل فرع بروحه، يوم بيوم", icon: Building2, roles: A, searchOnly: true },
      { to: "/amarsoft?tab=invoices", label: "الفواتير", hint: "كل فواتير البيع من أمارسوفت", icon: Receipt, roles: A, searchOnly: true },
      { to: "/amarsoft?tab=log", label: "الممسوح والمعدّل", hint: "شن تبدّل في الفواتير", icon: History, roles: A, searchOnly: true, keywords: "محذوف" },
      { to: "/amarsoft?tab=customers", label: "تسجيل الزبائن", hint: "اسم ورقم الزبون في الفواتير", icon: UserCheck, roles: A, searchOnly: true },
      { to: "/amarsoft?tab=gram", label: "الأسعار والأرباح", hint: "سعر الغرام والربح فوق سعر الذهب", icon: Coins, roles: A, searchOnly: true, keywords: "ربح" },
      { to: "/amarsoft?tab=accountant", label: "المحاسب", hint: "نقدي ومصرف وآجل", icon: Wallet, roles: A, searchOnly: true, keywords: "فلوس نقدي مصرف" },
      { to: "/amarsoft?tab=suppliers", label: "الموردون", hint: "شن دخل منهم وشن تباع وحساباتهم", icon: Truck, roles: A, searchOnly: true },
      { to: "/amarsoft?tab=daily", label: "ملخّص اليوم", hint: "شن صار اليوم في كل الفروع", icon: CalendarDays, roles: A, searchOnly: true },
      { to: "/amarsoft?tab=appsales", label: "البيع من التطبيق", hint: "المبيعات المسجّلة من التطبيق", icon: TrendingUp, roles: A, searchOnly: true },
      { to: "/gold-price", label: "الذهب والسوق", hint: "سعر الذهب العالمي والدولار، تسعير المحل، المنافسين", icon: Coins, roles: AMS, keywords: "اونصة دولار موازي كسر حاسبة سعر الذهب اليوم" },
      { to: "/gold-price?tab=price", label: "تسعير المحل", hint: "سعر الجرام اللي يبيع بيه المحل اليوم", icon: Coins, roles: AMS, searchOnly: true, keywords: "سعر الذهب اليوم مصنعية" },
      { to: "/gold-price?tab=rivals", label: "أسعار المنافسين", hint: "سجّل سعر محل ثاني وشوف متوسطهم", icon: Store, roles: AMS, searchOnly: true, keywords: "منافس محلات سوق" },
      { to: "/gold-price?tab=compare", label: "سعري مقارنة بالسوق", hint: "سعرك غالي ولا لا، وربحك فوق الذهب", icon: Scale, roles: A, searchOnly: true, keywords: "منافسين ربح غالي رخيص" },
      { to: "/closing", label: "إقفال اليوم", hint: "تسليم الخزينة آخر اليوم", icon: Landmark, roles: AM, keywords: "خزينة" },
    ],
  },
  {
    key: "team", title: "الفريق", hint: "المحادثة، مقارنة الفروع والموظفين، التقييم", icon: UserCog,
    tone: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
    items: [
      { to: "/chat", label: "المحادثة", hint: "محادثة الفريق", icon: MessagesSquare, roles: ALL, badgeKey: "chat" },
      { to: "/team", label: "الفروع والفريق", hint: "قارن الفروع والموظفين، الأرقام، التقييم، والحسابات", icon: Building2, roles: A, keywords: "مقارنة فروع موظفين بائعين" },
      { to: "/team?tab=numbers", label: "أرقام البائعين", hint: "الوزن، السعر فوق الذهب، الخصم، النقاط", icon: BarChart3, roles: A, searchOnly: true, keywords: "تقييم البائعين نقاط" },
      { to: "/team?tab=evaluations", label: "تقييم الموظفين", hint: "المشرف كل يوم، والموظفين مرتين في الشهر", icon: ClipboardList, roles: A, searchOnly: true, keywords: "استمارة التقييم" },
      { to: "/team?tab=leaderboard", label: "المتصدرون", hint: "ترتيب البائعين بالوزن", icon: Trophy, roles: A, searchOnly: true },
      { to: "/team?tab=accounts", label: "حسابات الموظفين", hint: "الحسابات والصلاحيات والفروع والأجهزة", icon: UserCog, roles: A, searchOnly: true, keywords: "الموظفون صلاحيات حساب جهاز" },
      { to: "/evaluations", label: "تقييم الموظفين", hint: "المشرف كل يوم، والموظفين مرتين في الشهر", icon: ClipboardList, roles: ["evalRecorder"] },
      { to: "/leaderboard", label: "المتصدرون", hint: "ترتيب البائعين بالوزن", icon: Trophy, roles: ["supervisor", "manager", "staff"] },
    ],
  },
  {
    key: "more", title: "أخرى", hint: "الإشعارات", icon: Bell,
    tone: "bg-muted text-muted-foreground",
    items: [
      // الإشعارات من الجرس فوق — ما تحتاجش مربع في القائمة، لكن تطلع في البحث.
      { to: "/notifications", label: "الإشعارات", hint: "كل التنبيهات والأحداث", icon: Bell, roles: ALL, searchOnly: true, keywords: "تنبيهات" },
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
      if (i.roles.includes("evalRecorder") && isAdmin) return false; // المدير عنده /team?tab=evaluations
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

export type NavHit = { item: NavItem; section: NavSection; parent?: NavItem };

/**
 * بحث القائمة: كل كلمة لازم تطلع في الاسم ولا الوصف ولا الكلمات الإضافية ولا اسم القسم/الصفحة الأم.
 * يلقى الصفحات والخانات اللي داخلها (مثلاً «جرد» تجيب «المخزون والجرد» و«الجرد بالباركود»).
 * اللي الكلمة في اسمه يطلع أول، والصفحات قبل خاناتها.
 */
export function searchNav(sections: NavSection[], query: string): NavHit[] {
  const words = normalizeAr(query).split(" ").filter(Boolean);
  if (!words.length) return [];
  const pages = sections.flatMap((s) => s.items.filter((i) => !i.searchOnly));
  const seen = new Set<string>();
  const hits: (NavHit & { rank: number })[] = [];
  for (const section of sections) {
    for (const item of section.items) {
      if (seen.has(item.to)) continue;
      const parent = item.searchOnly ? pages.find((p) => splitTo(p.to).path === splitTo(item.to).path) : undefined;
      const hay = normalizeAr(`${item.label} ${item.hint} ${item.keywords ?? ""} ${section.title} ${parent?.label ?? ""}`);
      if (!words.every((w) => hay.includes(w))) continue;
      seen.add(item.to);
      const label = normalizeAr(item.label);
      hits.push({ item, section, parent, rank: (words.every((w) => label.includes(w)) ? 0 : 2) + (item.searchOnly ? 1 : 0) });
    }
  }
  return hits.sort((a, b) => a.rank - b.rank).map(({ rank: _rank, ...h }) => h);
}
