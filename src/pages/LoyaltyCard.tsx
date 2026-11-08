// بطاقة الولاء للزبون: تفتح بلا تسجيل دخول بالرمز في الرابط. فيها المستوى والنقاط والخصم ورمز QR،
// وأزرار الإضافة لـ Apple Wallet و Google Wallet لما يكونوا مفعّلين في الدالة loyalty-wallet.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, Gem } from "lucide-react";
import { sb } from "@/lib/amarsoft";
import { TIERS, Tier, cardUrl, WALLET_FN } from "@/lib/loyalty";

type Card = {
  program_name: string; full_name: string; points: number; tier: Tier; discount: number;
  next_tier: Tier | null; points_to_next: number | null; member_since: string; window_months: number; code: string;
};

export default function LoyaltyCard() {
  const { code = "" } = useParams<{ code: string }>();
  const { data: card, isLoading } = useQuery({
    queryKey: ["loyalty-card", code],
    queryFn: async () => {
      const { data, error } = await sb.rpc("loyalty_card", { p_code: code });
      if (error) throw error;
      return (data?.[0] ?? null) as Card | null;
    },
  });
  const [wallet, setWallet] = useState<{ apple: boolean; google: boolean }>({ apple: false, google: false });
  useEffect(() => {
    // الدالة ممكن ما تكونش منشورة بعد: الأزرار تبقى مخفية.
    fetch(`${WALLET_FN}?type=status`).then((r) => (r.ok ? r.json() : null)).then((j) => j && setWallet(j)).catch(() => {});
  }, []);

  if (isLoading) return <div className="min-h-dvh flex items-center justify-center"><Loader2 className="size-6 animate-spin text-primary" /></div>;
  if (!card) return <div dir="rtl" className="min-h-dvh flex items-center justify-center p-6 text-center text-muted-foreground">البطاقة مش موجودة. تأكد من الرابط أو اسأل المحل.</div>;

  const t = TIERS[card.tier];
  const next = card.next_tier ? TIERS[card.next_tier] : null;
  const goal = card.points + (card.points_to_next ?? 0);
  const pct = goal ? Math.min(100, (card.points / goal) * 100) : 100;

  return (
    <div dir="rtl" className="min-h-dvh bg-background">
      <div className="max-w-md mx-auto p-4 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-[calc(env(safe-area-inset-bottom)+2rem)] space-y-5">
        <div className={`rounded-3xl p-5 shadow-xl bg-gradient-to-br ${t.card} aspect-[1.6/1] flex flex-col justify-between`}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm opacity-80">{card.program_name}</p>
              <p className="text-xl font-bold mt-0.5">{card.full_name}</p>
            </div>
            <Gem className="size-7 opacity-80" />
          </div>
          <div className="flex items-end justify-between">
            <div>
              <p className="text-xs opacity-75">المستوى</p>
              <p className="text-2xl font-black">{t.label}</p>
            </div>
            <div className="text-left">
              <p className="text-xs opacity-75">النقاط</p>
              <p className="text-2xl font-black tabular-nums">{card.points.toLocaleString("en-US")}</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border p-4 space-y-2 text-center">
          <p className="text-lg font-bold">خصم {card.discount}% على الفاتورة</p>
          {next ? (
            <>
              <div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
              <p className="text-sm text-muted-foreground">باقيلك {card.points_to_next?.toLocaleString("en-US")} نقطة وتولّي {next.label}</p>
            </>
          ) : <p className="text-sm text-muted-foreground">انت في أعلى مستوى</p>}
          <p className="text-xs text-muted-foreground">النقاط من مشترياتك في آخر {card.window_months} شهر.</p>
        </div>

        <div className="rounded-2xl border p-4 flex flex-col items-center gap-2">
          <div className="bg-white p-3 rounded-xl"><QRCodeSVG value={cardUrl(card.code)} size={170} /></div>
          <p className="text-xs text-muted-foreground">ورّي الرمز هذا للموظف وقت الشراء</p>
        </div>

        {(wallet.apple || wallet.google) && (
          <div className="grid gap-2">
            {wallet.apple && (
              <a href={`${WALLET_FN}?type=apple&code=${encodeURIComponent(card.code)}`}
                 className="h-12 rounded-xl bg-black text-white flex items-center justify-center font-semibold">Add to Apple Wallet</a>
            )}
            {wallet.google && (
              <a href={`${WALLET_FN}?type=google&code=${encodeURIComponent(card.code)}`}
                 className="h-12 rounded-xl bg-black text-white flex items-center justify-center font-semibold">Add to Google Wallet</a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
