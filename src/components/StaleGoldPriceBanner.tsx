// تنبيه «سعر الذهب لم يُحدَّث اليوم» للمدير والمشرف.
//
// أسعار القطع كلها محسوبة من سعر الجرام (لا قطعة بسعر ثابت)، فتحديث السعر يحدّث كل
// الأسعار تلقائياً — والعكس صحيح: سعر قديم يعني أن كل عرض سعر لزبون خاطئ بصمت. لذلك
// ينبّه التطبيق بدل الاعتماد على تذكّر أحد.
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { AlertTriangle, X } from "lucide-react";
import { isManagerOrAdmin, useAuth } from "@/hooks/useAuth";
import { useGoldPrices } from "@/hooks/useGoldPrices";
import { KARAT_OPTIONS } from "@/lib/constants";
import { businessToday, daysBetween } from "@/lib/dates";

// سطر واحد رفيع (كان ثلاث سطور فوق كل صفحة)، ويتخبّى لليوم بالـ×، وما يطلعش في صفحة التسعير نفسها.
const HIDE_KEY = "staleGoldBanner.hiddenOn";

export default function StaleGoldPriceBanner() {
  const { roles } = useAuth();
  const { pathname } = useLocation();
  const { data: prices } = useGoldPrices();
  const today = businessToday();
  const [hiddenOn, setHiddenOn] = useState<string | null>(() => { try { return localStorage.getItem(HIDE_KEY); } catch { return null; } });
  const canUpdate = isManagerOrAdmin(roles);
  // قبل وصول الأسعار لا نعرف — لا إنذار كاذب. وفي الرئيسية بطاقة السعر فوق تقول «قديم» بروحها، فما نكرروش.
  if (!canUpdate || !prices || hiddenOn === today || pathname === "/gold-price" || pathname === "/") return null;

  const stale = KARAT_OPTIONS.map((k) => {
    const row = prices.get(k);
    return { karat: k, days: row ? daysBetween(row.effective_date, today) : null };
  }).filter((s) => s.days === null || s.days > 0);
  if (stale.length === 0) return null;

  const label = stale
    .map((s) => (s.days === null ? `${s.karat} بلا سعر` : `${s.karat} من ${s.days === 1 ? "يوم" : `${s.days} يوم`}`))
    .join(" · ");
  const hide = () => { try { localStorage.setItem(HIDE_KEY, today); } catch { /* تجاهل */ } setHiddenOn(today); };

  return (
    <div className="mb-2 flex items-center gap-2 rounded-lg border border-warning/50 bg-warning/10 px-2.5 py-1.5 text-xs">
      <AlertTriangle className="size-3.5 shrink-0 text-warning-foreground" />
      <Link to="/gold-price?tab=price" className="min-w-0 flex-1 truncate hover:underline">
        <b>سعر الذهب قديم</b> ({label}) — أسعار العروض للزبائن ممكن غلط. حدّثه
      </Link>
      <button type="button" onClick={hide} aria-label="إخفاء لليوم" title="إخفاء لليوم"
        className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-warning/20">
        <X className="size-3.5" />
      </button>
    </div>
  );
}
