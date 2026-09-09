import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import AppLayout from "@/components/AppLayout";
import ProtectedRoute from "@/components/ProtectedRoute";
import { AuthProvider } from "@/hooks/useAuth";
import Auth from "@/pages/Auth";
import ProductSearch from "@/pages/ProductSearch";

// الصفحة الرئيسية وتسجيل الدخول فقط تُحمّل فوراً — الباقي يُحمّل عند الحاجة (route-based
// code splitting) بدل حزمة JS واحدة ضخمة تُبطئ أول ظهور على الجوال.
const ProductDetail = lazy(() => import("@/pages/ProductDetail"));
const ProductForm = lazy(() => import("@/pages/ProductForm"));
const Inquiries = lazy(() => import("@/pages/Inquiries"));
const Upload = lazy(() => import("@/pages/Upload"));
const ReviewUnnamed = lazy(() => import("@/pages/ReviewUnnamed"));
const Staff = lazy(() => import("@/pages/Staff"));
const Reports = lazy(() => import("@/pages/Reports"));
const Transfers = lazy(() => import("@/pages/Transfers"));
const Reorders = lazy(() => import("@/pages/Reorders"));
const GoldPrice = lazy(() => import("@/pages/GoldPrice"));
const StockTake = lazy(() => import("@/pages/StockTake"));
const Sales = lazy(() => import("@/pages/Sales"));
const LiveAdd = lazy(() => import("@/pages/LiveAdd"));
const AdminProducts = lazy(() => import("@/pages/AdminProducts"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

function PageLoader() {
  return (
    <div className="flex items-center justify-center py-24">
      <Loader2 className="size-6 animate-spin text-primary" />
    </div>
  );
}

const queryClient = new QueryClient();

const App = () => (
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
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route path="/index" element={<Navigate to="/" replace />} />
              <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                <Route path="/" element={<ProductSearch />} />
                <Route path="/products" element={<ProductSearch />} />
                <Route path="/products/new" element={<ProductForm />} />
                <Route path="/products/:id" element={<ProductDetail />} />
                <Route path="/products/:id/edit" element={<ProductForm />} />
                <Route path="/inquiries" element={<Inquiries />} />
                <Route path="/upload" element={<Upload />} />
                <Route path="/live-add" element={<LiveAdd />} />
                <Route path="/upload/review" element={<ReviewUnnamed />} />
                <Route path="/import" element={<Navigate to="/upload" replace />} />
                <Route path="/tray" element={<Navigate to="/upload" replace />} />
                <Route path="/staff" element={<Staff />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/transfers" element={<Transfers />} />
                <Route path="/reorders" element={<Reorders />} />
                <Route path="/gold-price" element={<GoldPrice />} />
                <Route path="/stock-take" element={<StockTake />} />
                <Route path="/sales" element={<Sales />} />
                <Route path="/admin/products" element={<AdminProducts />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
