import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import AppLayout from "@/components/AppLayout";
import ProtectedRoute from "@/components/ProtectedRoute";
import Auth from "@/pages/Auth";
import ProductSearch from "@/pages/ProductSearch";
import ProductDetail from "@/pages/ProductDetail";
import ProductForm from "@/pages/ProductForm";
import Inquiries from "@/pages/Inquiries";
import BulkImport from "@/pages/BulkImport";
import Staff from "@/pages/Staff";
import Reports from "@/pages/Reports";
import Transfers from "@/pages/Transfers";
import GoldPrice from "@/pages/GoldPrice";
import StockTake from "@/pages/StockTake";
import TrayImport from "@/pages/TrayImport";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner position="top-center" dir="rtl" richColors />
      <BrowserRouter>
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
            <Route path="/import" element={<BulkImport />} />
            <Route path="/tray" element={<TrayImport />} />
            <Route path="/staff" element={<Staff />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/transfers" element={<Transfers />} />
            <Route path="/gold-price" element={<GoldPrice />} />
            <Route path="/stock-take" element={<StockTake />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
