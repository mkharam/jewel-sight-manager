import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Sparkles } from "lucide-react";

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();

  if (loading) {
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
  return <>{children}</>;
}
