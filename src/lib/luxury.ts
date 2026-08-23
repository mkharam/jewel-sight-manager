/** أدوات مساعدة لميزات المتاجر الفاخرة: عمر المخزون، تسعير الذهب، مشاركة القطعة. */

export const RESERVATION_STATUS = {
  active: { label: "حجز ساري", color: "bg-status-reserved text-white" },
  expired: { label: "انتهى", color: "bg-muted text-foreground" },
  cancelled: { label: "ملغى", color: "bg-status-sold text-white" },
  converted: { label: "تحوّل لبيع", color: "bg-status-available text-white" },
} as const;

export const PAYMENT_METHODS = ["نقداً", "بطاقة", "تحويل بنكي", "تقسيط", "مقايضة ذهب"];

export const GOLD_COLORS = [
  { value: "yellow", label: "ذهب أصفر" },
  { value: "white", label: "ذهب أبيض" },
  { value: "rose", label: "ذهب وردي" },
  { value: "mixed", label: "ألوان مختلطة" },
];

export const STONE_TYPES = [
  "ألماس", "زركون", "زمرد", "ياقوت", "سفير", "جمشت", "سيترين", "لؤلؤ", "فيروز", "عقيق", "أخرى",
];

export function daysInStock(createdAt: string | null | undefined, receivedAt?: string | null): number {
  const base = receivedAt ?? createdAt;
  if (!base) return 0;
  const ms = Date.now() - new Date(base).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export type AgeBucket = "0-30" | "31-90" | "91-180" | "180+";

export function ageBucket(days: number): AgeBucket {
  if (days <= 30) return "0-30";
  if (days <= 90) return "31-90";
  if (days <= 180) return "91-180";
  return "180+";
}

export const AGE_BUCKET_META: Record<AgeBucket, { label: string; color: string }> = {
  "0-30": { label: "جديد (≤30 يوم)", color: "bg-status-available/15 text-foreground" },
  "31-90": { label: "31–90 يوم", color: "bg-primary/15 text-foreground" },
  "91-180": { label: "91–180 يوم", color: "bg-warning/20 text-foreground" },
  "180+": { label: "راكد (+180 يوم)", color: "bg-destructive/20 text-foreground" },
};

/** السعر المقترح = (الوزن × سعر الجرام) + المصنعية (لكل جرام أو مبلغ ثابت) */
export function suggestedPrice(
  weight: number | null | undefined,
  pricePerGram: number | null | undefined,
  makingCharge: number | null | undefined,
  makingPerGram = true,
): number | null {
  if (!weight || !pricePerGram) return null;
  const making = makingCharge ?? 0;
  return Math.round(weight * pricePerGram + (makingPerGram ? weight * making : making));
}

export function whatsappShareUrl(text: string, phone?: string | null) {
  const msg = encodeURIComponent(text);
  const clean = (phone ?? "").replace(/\D/g, "");
  return clean ? `https://wa.me/${clean}?text=${msg}` : `https://wa.me/?text=${msg}`;
}

export function isoDatePlusDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
