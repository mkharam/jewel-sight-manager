import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import AppLayout from "@/components/AppLayout";
import ProtectedRoute from "@/components/ProtectedRoute";
import RequireRole from "@/components/RequireRole";
import ErrorBoundary from "@/components/ErrorBoundary";
import { ConfirmDialogProvider } from "@/components/ConfirmDialogProvider";
import { AuthProvider } from "@/hooks/useAuth";
import Auth from "@/pages/Auth";
import ProductSearch from "@/pages/ProductSearch";

// الصفحة الرئيسية وتسجيل الدخول فقط تُحمّل فوراً — الباقي يُحمّل عند الحاجة (route-based
// code splitting) بدل حزمة JS واحدة ضخمة تُبطئ أول ظهور على الجوال.
const ProductDetail = lazy(() => import("@/pages/ProductDetail"));
const ProductForm = lazy(() => import("@/pages/ProductForm"));
const Inquiries = lazy(() => import("@/pages/Inquiries"));
const StaffChat = lazy(() => import("@/pages/StaffChat"));
const Upload = lazy(() => import("@/pages/Upload"));
const ReviewUnnamed = lazy(() => import("@/pages/ReviewUnnamed"));
const MissingWeights = lazy(() => import("@/pages/MissingWeights"));
const Staff = lazy(() => import("@/pages/Staff"));
const Reports = lazy(() => import("@/pages/Reports"));
const DailySummary = lazy(() => import("@/pages/DailySummary"));
const Transfers = lazy(() => import("@/pages/Transfers"));
const Reorders = lazy(() => import("@/pages/Reorders"));
const GoldPrice = lazy(() => import("@/pages/GoldPrice"));
const StockTake = lazy(() => import("@/pages/StockTake"));
const Sales = lazy(() => import("@/pages/Sales"));
const PosSales = lazy(() => import("@/pages/PosSales"));
const PosStock = lazy(() => import("@/pages/PosStock"));
const PosCount = lazy(() => import("@/pages/PosCount"));
const AmarsoftHub = lazy(() => import("@/pages/AmarsoftHub"));
const Branches = lazy(() => import("@/pages/Branches"));
const Leaderboard = lazy(() => import("@/pages/Leaderboard"));
const Repairs = lazy(() => import("@/pages/Repairs"));
const DailyClosing = lazy(() => import("@/pages/DailyClosing"));
const Reservations = lazy(() => import("@/pages/Reservations"));
const Buybacks = lazy(() => import("@/pages/Buybacks"));
const Customers = lazy(() => import("@/pages/Customers"));
const LiveAdd = lazy(() => import("@/pages/LiveAdd"));
const AdminProducts = lazy(() => import("@/pages/AdminProducts"));
const Notifications = lazy(() => import("@/pages/Notifications"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const SaleReceipt = lazy(() => import("@/pages/SaleReceipt"));
const AmarsoftSuppliers = lazy(() => import("@/pages/AmarsoftSuppliers"));
const AmarsoftReports = lazy(() => import("@/pages/AmarsoftReports"));
const Watches = lazy(() => import("@/pages/Watches"));
const AmarsoftLink = lazy(() => import("@/pages/AmarsoftLink"));
const GramPrice = lazy(() => import("@/pages/GramPrice"));
const Accountant = lazy(() => import("@/pages/Accountant"));
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
              {/* رابط التقييم الشهري: يفتح بلا تسجيل دخول، بالرمز السري. */}
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
                <Route path="/inquiries" element={<Inquiries />} />
                <Route path="/chat" element={<StaffChat />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/upload" element={<Upload />} />
                <Route path="/live-add" element={<LiveAdd />} />
                <Route path="/upload/review" element={<ReviewUnnamed />} />
                <Route path="/weights" element={<MissingWeights />} />
                <Route path="/import" element={<Navigate to="/upload" replace />} />
                <Route path="/tray" element={<Navigate to="/upload" replace />} />
                <Route path="/staff" element={<RequireRole allow={["admin"]}><Staff /></RequireRole>} />
                <Route path="/reports" element={<RequireRole allow={["admin"]}><AmarsoftReports /></RequireRole>} />
                <Route path="/reports/app" element={<RequireRole allow={["admin"]}><Reports /></RequireRole>} />
                <Route path="/daily-summary" element={<RequireRole allow={["admin"]}><DailySummary /></RequireRole>} />
                <Route path="/transfers" element={<Transfers />} />
                <Route path="/reorders" element={<Reorders />} />
                <Route path="/gold-price" element={<RequireRole allow={["admin", "manager", "supervisor"]}><GoldPrice /></RequireRole>} />
                <Route path="/stock-take" element={<RequireRole allow={["admin", "supervisor"]}><StockTake /></RequireRole>} />
                <Route path="/sales" element={<RequireRole allow={["admin"]}><Sales /></RequireRole>} />
                <Route path="/pos-sales" element={<RequireRole allow={["admin"]}><PosSales /></RequireRole>} />
                <Route path="/pos-stock" element={<RequireRole allow={["admin", "manager", "supervisor"]}><PosStock /></RequireRole>} />
                <Route path="/pos-count" element={<RequireRole allow={["admin", "manager", "supervisor"]}><PosCount /></RequireRole>} />
                <Route path="/amarsoft" element={<RequireRole allow={["admin", "manager", "supervisor"]}><AmarsoftHub /></RequireRole>} />
                <Route path="/branches" element={<RequireRole allow={["admin"]}><Branches /></RequireRole>} />
                <Route path="/branches/:code" element={<RequireRole allow={["admin"]}><Branches /></RequireRole>} />
                <Route path="/suppliers" element={<RequireRole allow={["admin"]}><AmarsoftSuppliers /></RequireRole>} />
                <Route path="/leaderboard" element={<Leaderboard />} />
                <Route path="/reservations" element={<Reservations />} />
                <Route path="/watches" element={<Watches />} />
                <Route path="/amarsoft-link" element={<RequireRole allow={["admin"]}><AmarsoftLink /></RequireRole>} />
                <Route path="/gram-price" element={<RequireRole allow={["admin"]}><GramPrice /></RequireRole>} />
                <Route path="/accountant" element={<RequireRole allow={["admin"]}><Accountant /></RequireRole>} />
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
                <Route path="/admin/products" element={<RequireRole allow={["admin", "supervisor"]}><AdminProducts /></RequireRole>} />
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
