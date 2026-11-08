// برنامج الولاء: أسماء المستويات وألوانها، ورابط بطاقة الزبون. الحسبة نفسها في قاعدة البيانات (loyalty_members / loyalty_card).
export type Tier = "silver" | "gold" | "diamond";

export const TIERS: Record<Tier, { label: string; card: string; badge: string }> = {
  silver: { label: "فضي", card: "from-slate-300 via-slate-100 to-slate-400 text-slate-900", badge: "bg-slate-200 text-slate-800" },
  gold: { label: "ذهبي", card: "from-amber-500 via-yellow-300 to-amber-600 text-amber-950", badge: "bg-amber-200 text-amber-900" },
  diamond: { label: "ماسي", card: "from-sky-900 via-indigo-700 to-slate-900 text-white", badge: "bg-indigo-200 text-indigo-900" },
};

export function cardUrl(code: string) {
  return `${window.location.origin}${import.meta.env.BASE_URL}card/${code}`;
}

// 09xxxxxxxx أو 2189xxxxxxxx → 2189xxxxxxxx لروابط واتساب.
export function waPhone(phone: string | null | undefined) {
  const d = (phone ?? "").replace(/\D/g, "");
  if (d.length < 9) return null;
  return `218${d.slice(-9)}`;
}

export const WALLET_FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/loyalty-wallet`;
