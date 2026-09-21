// تنبيه «سعر الذهب لم يُحدَّث اليوم» للمدير والمشرف.
//
// أسعار القطع كلها محسوبة من سعر الجرام (لا قطعة بسعر ثابت)، فتحديث السعر يحدّث كل
// الأسعار تلقائياً — والعكس صحيح: سعر قديم يعني أن كل عرض سعر لزبون خاطئ بصمت. لذلك
// ينبّه التطبيق بدل الاعتماد على تذكّر أحد.
import { Link } from "react-router-dom";
import { AlertTriangle, ChevronLeft } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useGoldPrices } from "@/hooks/useGoldPrices";
import { KARAT_OPTIONS } from "@/lib/constants";
import { businessToday, daysBetween } from "@/lib/dates";

export default function StaleGoldPriceBanner() {
  const { roles } = useAuth();
  const { data: prices } = useGoldPrices();
  const canUpdate = roles.includes("admin") || roles.includes("manager");
  if (!canUpdate || !prices) return null; // قبل وصول الأسعار لا نعرف — لا إنذار كاذب

  const today = businessToday();
  const stale = KARAT_OPTIONS.map((k) => {
    const row = prices.get(k);
    return { karat: k, days: row ? daysBetween(row.effective_date, today) : null };
  }).filter((s) => s.days === null || s.days > 0);
  if (stale.length === 0) return null;

  const label = stale
    .map((s) => (s.days === null ? `${s.karat} (لا سعر)` : `${s.karat} (منذ ${s.days === 1 ? "يوم" : `${s.days} أيام`})`))
    .join(" · ");

  return (
    <Link
      to="/gold-price"
      className="mb-3 flex items-center gap-2 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2.5 text-sm hover:bg-warning/20"
    >
      <AlertTriangle className="size-4 shrink-0 text-warning-foreground" />
      <span className="flex-1 min-w-0">
        <span className="font-bold">سعر الذهب لم يُحدَّث اليوم:</span> {label} — أسعار العروض للزبائن قد تكون قديمة.
      </span>
      <ChevronLeft className="size-4 shrink-0" />
    </Link>
  );
}
