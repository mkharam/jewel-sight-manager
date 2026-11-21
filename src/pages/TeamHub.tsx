// «الموظفون» للمدير العام. التقييم والمتصدرون انتقلوا لصفحة «التقييم» (/evaluation)؛ الروابط
// القديمة (/staff?tab=evaluations و /staff?tab=leaderboard) تفتح على خانتها هناك.
import { lazy, Suspense } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";

const Staff = lazy(() => import("@/pages/Staff"));

export default function TeamHub() {
  const [params] = useSearchParams();
  const tab = params.get("tab");
  if (tab === "evaluations") return <Navigate to="/evaluation?tab=monthly" replace />;
  if (tab === "leaderboard") return <Navigate to="/evaluation?tab=leaderboard" replace />;
  return (
    <Suspense fallback={<div className="flex justify-center py-24"><Loader2 className="size-6 animate-spin text-primary" /></div>}>
      <Staff />
    </Suspense>
  );
}
