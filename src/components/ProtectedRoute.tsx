import { Navigate } from "react-router-dom";
import { useAuth, isManagerOrAdmin } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Sparkles, Clock } from "lucide-react";

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading, rolesLoading, roles, profile } = useAuth();


  if (loading || (session && rolesLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="size-12 rounded-2xl bg-gold-gradient flex items-center justify-center shadow-gold animate-pulse">
            <Sparkles className="size-6 text-primary-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>
        </div>
      </div>
    );
  }
  if (!session) return <Navigate to="/auth" replace />;

  // موظف بدون فرع: لا يرى البضاعة حتى يعيّنه المدير
  if (!isManagerOrAdmin(roles) && !profile?.branch_id) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-sm w-full text-center space-y-4">
          <div className="size-14 mx-auto rounded-2xl bg-gold-gradient flex items-center justify-center shadow-gold">
            <Clock className="size-7 text-primary-foreground" />
          </div>
          <h1 className="text-xl font-bold">حسابك قيد المراجعة</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            مرحباً {profile?.full_name ?? ""} — لا يمكنك رؤية البضاعة حتى يقوم المدير العام
            بتعيينك في أحد الفروع. تواصل معه لتفعيل حسابك.
          </p>
          <Button variant="outline" className="w-full" onClick={() => supabase.auth.signOut()}>
            تسجيل الخروج
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

