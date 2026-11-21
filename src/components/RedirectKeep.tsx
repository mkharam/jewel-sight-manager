// تحويل رابط قديم لمكانه الجديد مع الإبقاء على حالة التنقّل (state) وعلى أي فلتر في الرابط
// (مثلاً ?branch=03) — مثلاً قائمة القطع اللي ترسلها شاشة التصوير لمراجعتها. Navigate العادي يضيّعها.
import { Navigate, useLocation } from "react-router-dom";

export default function RedirectKeep({ to }: { to: string }) {
  const location = useLocation();
  const [path, query = ""] = to.split("?");
  const params = new URLSearchParams(query);
  new URLSearchParams(location.search).forEach((v, k) => { if (!params.has(k)) params.set(k, v); });
  const qs = params.toString();
  return <Navigate to={`${path}${qs ? `?${qs}` : ""}`} replace state={location.state} />;
}
