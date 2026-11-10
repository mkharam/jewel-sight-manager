// برنامج الولاء: أسماء المستويات وألوانها، ورابط بطاقة الزبون. الحسبة نفسها في قاعدة البيانات (loyalty_members / loyalty_card).
// نفس مستويات بطاقة MSTRMND «بطاقة مخرم للولاء».
export type Tier = "bronze" | "silver" | "gold";

export const TIERS: Record<Tier, { label: string; card: string; badge: string }> = {
  bronze: { label: "برونزي", card: "from-orange-800 via-amber-600 to-orange-900 text-orange-50", badge: "bg-orange-200 text-orange-900" },
  silver: { label: "فضي", card: "from-slate-300 via-slate-100 to-slate-400 text-slate-900", badge: "bg-slate-200 text-slate-800" },
  gold: { label: "ذهبي", card: "from-amber-500 via-yellow-300 to-amber-600 text-amber-950", badge: "bg-amber-200 text-amber-900" },
};

// اسم المستوى مثل ما يجي من بطاقة MSTRMND («برونزي»، «فضي»، «ذهبي») → المستوى.
export const tierOfLevel = (name: string | null | undefined) =>
  (Object.keys(TIERS) as Tier[]).find((t) => TIERS[t].label === name?.trim()) ?? null;

// هدية بطاقة الأختام (5 أختام): خصم على الفاتورة + خصم على كل قرام، على الشراء مش كاش.
export const STAMP_REWARD = { invoice: 1250, perGram: 50 };

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

// بطاقات MSTRMND الثلاثة. رابط التركيب يحمل الفرع (utm_source=b05): MSTRMND يسجّله في عملية «Card installed»،
// ومنه نعرفو الزبون دخل من أنهي فرع (mstrmnd_customer_branches).
export const WALLET_CARDS = [
  { key: "loyalty", template: 908119, hash: "LeWLkS", label: "بطاقة الولاء", desc: "كل شرية تنحسبله، ويطلع برونزي ثم فضي ثم ذهبي بخصم أكبر." },
  { key: "stamps", template: 908120, hash: "ovhcrF", label: "بطاقة الأختام", desc: "ختم على كل شرية، و5 أختام = هدية على الشرية الجاية." },
  { key: "gift", template: 908118, hash: "XZSiKu", label: "بطاقة الهدايا", desc: "بطاقة هدية من مخرّم." },
] as const;
export const cardInstallUrl = (hash: string, branchCode?: string | null) =>
  `https://app.mstrmnd.agency/getpass/${hash}?utm_source=${branchCode ? `b${branchCode}` : "qr"}`;
export const CONTACT_LABELS: Record<string, string> = {
  gold_no_card: "ذهبي بلا بطاقة", five: "5 شريات", gold_card: "ذهبي عنده بطاقة", silver_no_card: "فضي بلا بطاقة",
};

// ليش الربط ما بعتش فاتورة لبطاقة الزبون في MSTRMND (mstrmnd_sync.reason).
export const SYNC_REASON_AR: Record<string, string> = {
  no_mstrmnd_customer: "الزبون مش في MSTRMND", no_loyalty_card: "ما عندهش بطاقة ولاء", no_stamp_card: "ما عندهش بطاقة أختام",
  zero_amount: "مبلغ صفر", return_no_stamp: "مرتجع (ما ينقصش ختم)",
};
