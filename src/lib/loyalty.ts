// برنامج الولاء: أسماء المستويات وألوانها، ورابط بطاقة الزبون. الحسبة نفسها في قاعدة البيانات (loyalty_members / loyalty_card).
// نفس مستويات بطاقة MSTRMND «بطاقة مخرم للولاء».
export type Tier = "bronze" | "silver" | "gold";

export const TIERS: Record<Tier, { label: string; card: string; badge: string }> = {
  bronze: { label: "برونزي", card: "from-orange-800 via-amber-600 to-orange-900 text-orange-50", badge: "bg-orange-200 text-orange-900" },
  silver: { label: "فضي", card: "from-slate-300 via-slate-100 to-slate-400 text-slate-900", badge: "bg-slate-200 text-slate-800" },
  gold: { label: "ذهبي", card: "from-amber-500 via-yellow-300 to-amber-600 text-amber-950", badge: "bg-amber-200 text-amber-900" },
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

// رابط تركيب بطاقة MSTRMND، وأسماء قوائم التواصل (loyalty_contacts.category).
export const INSTALL_URL = "https://take.cards/gOwTN";
export const CONTACT_LABELS: Record<string, string> = {
  gold_no_card: "ذهبي بلا بطاقة", five: "5 شريات", gold_card: "ذهبي عنده بطاقة", silver_no_card: "فضي بلا بطاقة",
};
