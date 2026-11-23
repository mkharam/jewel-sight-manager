import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import AppLayout from "@/components/AppLayout";
import ProtectedRoute from "@/components/ProtectedRoute";
import RequireRole from "@/components/RequireRole";
import ErrorBoundary from "@/components/ErrorBoundary";
import RedirectKeep from "@/components/RedirectKeep";
import { ConfirmDialogProvider } from "@/components/ConfirmDialogProvider";
import { AuthProvider } from "@/hooks/useAuth";
import Auth from "@/pages/Auth";
import ProductSearch from "@/pages/ProductSearch";

// الصفحة الرئيسية وتسجيل الدخول فقط تُحمّل فوراً — الباقي يُحمّل عند الحاجة (route-based
// code splitting) بدل حزمة JS واحدة ضخمة تُبطئ أول ظهور على الجوال.
const ProductDetail = lazy(() => import("@/pages/ProductDetail"));
const ProductForm = lazy(() => import("@/pages/ProductForm"));
const StaffChat = lazy(() => import("@/pages/StaffChat"));
const Upload = lazy(() => import("@/pages/Upload"));
const PiecesHub = lazy(() => import("@/pages/PiecesHub"));
const StockHub = lazy(() => import("@/pages/StockHub"));
const TeamHub = lazy(() => import("@/pages/TeamHub"));
const TransfersHub = lazy(() => import("@/pages/TransfersHub"));
const RequestsHub = lazy(() => import("@/pages/RequestsHub"));
const GoldHub = lazy(() => import("@/pages/GoldHub"));
const AmarsoftHub = lazy(() => import("@/pages/AmarsoftHub"));
const Branches = lazy(() => import("@/pages/Branches"));
const Leaderboard = lazy(() => import("@/pages/Leaderboard"));
const Repairs = lazy(() => import("@/pages/Repairs"));
const DailyClosing = lazy(() => import("@/pages/DailyClosing"));
const Buybacks = lazy(() => import("@/pages/Buybacks"));
const Customers = lazy(() => import("@/pages/Customers"));
const LiveAdd = lazy(() => import("@/pages/LiveAdd"));
const Notifications = lazy(() => import("@/pages/Notifications"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const SaleReceipt = lazy(() => import("@/pages/SaleReceipt"));
const Watches = lazy(() => import("@/pages/Watches"));
const Evaluations = lazy(() => import("@/pages/Evaluations"));
const EvaluatePublic = lazy(() => import("@/pages/EvaluatePublic"));
const Loyalty = lazy(() => import("@/pages/Loyalty"));
const LoyaltyCard = lazy(() => import("@/pages/LoyaltyCard"));

function PageLoader() {
  return (
    <div className="flex items-center justify-center py-24">
      <Loader2 className="size-6 animate-spin text-primary" />
    </div>
  );
}

// العودة للتطبيق (من الواتساب مثلاً) تُحدّث البيانات في الخلفية مع إبقاء المعروض كما هو —
// لا شاشات تحميل ولا قفز. staleTime يمنع موجة طلبات عند كل خروج وعودة سريعين: ما جُلب
// خلال آخر 30 ثانية لا يُعاد جلبه. الحالات/الأسعار/الإشعارات تتحدّث؛ ما يكتبه الموظف ونتائج
// البحث بالصورة حالة محلية لا تمسّها هذه الإعدادات إطلاقاً.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  },
});

// التقارير والفواتير والموردين والمحاسب… كلها صارت خانات في صفحة «أمارسوفت». الروابط القديمة تفتح
// على خانتها (ومعاها ?q= و?branch= و?sman= لو موجودين).
const REPORTS_TAB: Record<string, string> = {
  overview: "overview", daily: "daily", branches: "branches", gram: "gram", accountant: "accountant", sales: "appsales",
};
function ReportsRedirect() {
  const [params] = useSearchParams();
  const t = params.get("tab") ?? "overview";
  if (t === "stock") return <Navigate to="/stock?tab=app" replace />;
  return <Navigate to={`/amarsoft?tab=${REPORTS_TAB[t] ?? "overview"}`} replace />;
}
// «الفروع والفريق» (/team) لمّ «التقييم» و«الموظفون»؛ و«المخزون والجرد» (/stock) لمّ «الجرد».
const TEAM_TAB: Record<string, string> = { numbers: "numbers", monthly: "evaluations", evaluations: "evaluations", leaderboard: "leaderboard" };
function EvaluationRedirect() {
  const [params] = useSearchParams();
  return <Navigate to={`/team?tab=${TEAM_TAB[params.get("tab") ?? ""] ?? "numbers"}`} replace />;
}
function StaffRedirect() {
  const [params] = useSearchParams();
  const t = params.get("tab");
  return <Navigate to={`/team?tab=${t === "evaluations" || t === "leaderboard" ? t : "accounts"}`} replace />;
}
function CountRedirect() {
  const [params] = useSearchParams();
  return <Navigate to={`/stock?tab=${params.get("tab") === "app" ? "appcount" : "scan"}`} replace />;
}

function PosSalesRedirect() {
  const [params] = useSearchParams();
  const t = params.get("tab");
  return <RedirectKeep to={t === "log" ? "/amarsoft?tab=log" : t === "profit" ? "/amarsoft?tab=gram" : "/amarsoft?tab=invoices"} />;
}

const App = () => (
  <ErrorBoundary>
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner
        position="top-center"
        dir="rtl"
        richColors
        offset="max(1rem, calc(env(safe-area-inset-top) + 0.75rem))"
        // sonner يستخدم mobileOffset بدل offset على شاشات الجوال تحديداً (حيث النوتش/الجزيرة
        // الديناميكية فعلياً موجودة) — ضبط offset وحده كان يُطبَّق على الديسكتوب فقط، فتبقى
        // إشعارات الهاتف ملتصقة بأعلى الشاشة خلف الساعة/الإشارة دائماً بدون هذا السطر تحديداً.
        mobileOffset="max(1rem, calc(env(safe-area-inset-top) + 0.75rem))"
      />
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <AuthProvider>
          <ConfirmDialogProvider>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/auth" element={<Auth />} />
              {/* رابط التقييم (المشرف كل يوم، الموظفين مرتين في الشهر): يفتح بلا تسجيل دخول، بالرمز السري. */}
              <Route path="/evaluate/:token" element={<EvaluatePublic />} />
              {/* بطاقة الولاء للزبون: بلا تسجيل دخول، بالرمز في الرابط. */}
              <Route path="/card/:code" element={<LoyaltyCard />} />
              <Route path="/index" element={<Navigate to="/" replace />} />
              {/* الإيصال خارج AppLayout حتى يُطبع بلا شريط تنقّل. */}
              <Route path="/sales/:id/receipt" element={<ProtectedRoute><SaleReceipt /></ProtectedRoute>} />
              <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                <Route path="/" element={<ProductSearch />} />
                <Route path="/products" element={<ProductSearch />} />
                <Route path="/products/new" element={<ProductForm />} />
                <Route path="/products/:id" element={<ProductDetail />} />
                <Route path="/products/:id/edit" element={<ProductForm />} />
                <Route path="/inquiries" element={<RequestsHub />} />
                <Route path="/chat" element={<StaffChat />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/upload" element={<Upload />} />
                <Route path="/live-add" element={<LiveAdd />} />
                {/* «قطع تحتاج متابعة»: بلا اسم، بلا وزن، أطقم ناقصة، ربط أمارسوفت — صفحة وحدة بخانات. */}
                <Route path="/pieces" element={<PiecesHub />} />
                <Route path="/upload/review" element={<RedirectKeep to="/pieces?tab=unnamed" />} />
                <Route path="/weights" element={<RedirectKeep to="/pieces?tab=weights" />} />
                <Route path="/sets" element={<RedirectKeep to="/pieces?tab=sets" />} />
                <Route path="/amarsoft-link" element={<RedirectKeep to="/pieces?tab=link" />} />
                <Route path="/import" element={<Navigate to="/upload" replace />} />
                <Route path="/tray" element={<Navigate to="/upload" replace />} />
                {/* الفريق والتقارير: كل وحدة صفحة بخانات. الروابط القديمة تفتح على خانتها. */}
                <Route path="/team" element={<RequireRole allow={["admin"]}><TeamHub /></RequireRole>} />
                <Route path="/staff" element={<StaffRedirect />} />
                <Route path="/reports" element={<ReportsRedirect />} />
                <Route path="/reports/app" element={<Navigate to="/stock?tab=app" replace />} />
                <Route path="/daily-summary" element={<Navigate to="/amarsoft?tab=daily" replace />} />
                <Route path="/transfers" element={<TransfersHub />} />
                <Route path="/reorders" element={<RedirectKeep to="/transfers?tab=reorders" />} />
                {/* «الذهب والسوق»: السوق اليوم، تسعير المحل، المنافسين، سعري والسوق (للمدير العام). */}
                <Route path="/gold-price" element={<RequireRole allow={["admin", "manager", "supervisor"]}><GoldHub /></RequireRole>} />
                {/* «الجرد» و«المخزون»: كل وحدة صفحة بخانات (أمارسوفت + التطبيق). */}
                <Route path="/count" element={<CountRedirect />} />
                <Route path="/stock" element={<RequireRole allow={["admin", "manager", "supervisor"]}><StockHub /></RequireRole>} />
                <Route path="/stock-take" element={<RedirectKeep to="/stock?tab=appcount" />} />
                <Route path="/sales" element={<Navigate to="/amarsoft?tab=appsales" replace />} />
                <Route path="/pos-sales" element={<PosSalesRedirect />} />
                <Route path="/pos-stock" element={<RedirectKeep to="/stock?tab=amarsoft" />} />
                <Route path="/pos-count" element={<RedirectKeep to="/stock?tab=scan" />} />
                <Route path="/amarsoft" element={<RequireRole allow={["admin", "manager", "supervisor"]}><AmarsoftHub /></RequireRole>} />
                <Route path="/branches" element={<Navigate to="/amarsoft?tab=branches" replace />} />
                <Route path="/branches/:code" element={<RequireRole allow={["admin"]}><Branches /></RequireRole>} />
                <Route path="/suppliers" element={<Navigate to="/amarsoft?tab=suppliers" replace />} />
                <Route path="/leaderboard" element={<Leaderboard />} />
                {/* «التقييم» للمدير العام: الأرقام، تقييم الموظفين، المتصدرون. */}
                <Route path="/evaluation" element={<EvaluationRedirect />} />
                <Route path="/staff-eval" element={<RedirectKeep to="/team?tab=numbers" />} />
                <Route path="/reservations" element={<RedirectKeep to="/inquiries?tab=reservations" />} />
                <Route path="/watches" element={<Watches />} />
                <Route path="/gram-price" element={<Navigate to="/amarsoft?tab=gram" replace />} />
                <Route path="/accountant" element={<Navigate to="/amarsoft?tab=accountant" replace />} />
                {/* المدير العام ومسؤول التقييم (أيمن) — الصلاحية في قاعدة البيانات (is_eval_admin). */}
                <Route path="/evaluations" element={<Evaluations />} />
                <Route path="/buybacks" element={<RequireRole allow={["admin", "manager"]}><Buybacks /></RequireRole>} />
                <Route path="/closing" element={<RequireRole allow={["admin", "manager"]}><DailyClosing /></RequireRole>} />
                <Route path="/admin/repairs" element={<RequireRole allow={["admin", "manager", "supervisor"]}><Repairs /></RequireRole>} />
                <Route path="/customers" element={<Customers />} />
                {/* كل الولاء في صفحة وحدة؛ الخانات حسب الدور. الروابط القديمة تفتح على خانتها. */}
                <Route path="/loyalty" element={<Loyalty />} />
                <Route path="/discount" element={<Navigate to="/loyalty?tab=discount" replace />} />
                <Route path="/wallet-customers" element={<Navigate to="/loyalty?tab=wallet" replace />} />
                <Route path="/admin/products" element={<RedirectKeep to="/pieces?tab=manage" />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
          </ConfirmDialogProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
