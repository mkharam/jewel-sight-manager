// «بطاقة جديدة»: الزبون الجديد يختار أي بطاقة يبيها (ولاء، أختام، هدايا) ويمسح الـ QR من شاشة الموظف.
// كل QR فيه الفرع (utm_source=b05)، فالبطاقة تتسجّل على الفرع اللي ركّبها فيه بلا ما حد يكتب حاجة.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { sb } from "@/lib/amarsoft";
import { WALLET_CARDS, cardInstallUrl } from "@/lib/loyalty";

type Branch = { code: string; name: string; mine: boolean };

export default function LoyaltyNewCard() {
  const { data: branches } = useQuery({
    queryKey: ["loyalty-counter-branches"],
    queryFn: async () => {
      const { data, error } = await sb.rpc("loyalty_counter_branches");
      if (error) throw error;
      return (data ?? []) as Branch[];
    },
  });
  const [picked, setPicked] = useState<string | null>(null);
  const branch = picked ?? branches?.find((b) => b.mine)?.code ?? (branches?.length === 1 ? branches[0].code : null);
  const [card, setCard] = useState<(typeof WALLET_CARDS)[number]["key"]>("loyalty");
  const c = WALLET_CARDS.find((x) => x.key === card)!;
  const url = cardInstallUrl(c.hash, branch);

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); toast.success("تم نسخ الرابط"); } catch { toast.error("ما قدرتش ننسخ الرابط"); }
  };

  return (
    <div className="space-y-3">
      {(branches?.length ?? 0) > 1 && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">الفرع اللي الزبون فيه توا (البطاقة تتسجّل عليه):</p>
          <div className="flex flex-wrap gap-1.5">
            {branches!.map((b) => (
              <button key={b.code} onClick={() => setPicked(b.code)}
                className={`text-xs rounded-full border px-2.5 py-1 ${branch === b.code ? "bg-primary text-primary-foreground border-primary" : ""}`}>
                {b.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {WALLET_CARDS.map((x) => (
          <Button key={x.key} variant={card === x.key ? "default" : "outline"} onClick={() => setCard(x.key)} className="h-auto py-2 whitespace-normal">
            {x.label}
          </Button>
        ))}
      </div>

      <Card className="p-5 flex flex-col items-center gap-3 text-center">
        <p className="text-lg font-bold">{c.label}</p>
        <p className="text-sm text-muted-foreground">{c.desc}</p>
        {branch ? (
          <>
            <div className="bg-white p-3 rounded-xl"><QRCodeSVG value={url} size={220} /></div>
            <p className="text-sm">خلي الزبون يمسح الـ QR بكاميرا موبايله، ويسجّل باسمه ورقم موبايله، ويضيفها لـ Wallet.</p>
            <p className="text-xs text-muted-foreground">
              البطاقة تتسجّل على فرع {branches?.find((b) => b.code === branch)?.name}. واكتب نفس رقمه في فاتورة أمارسوفت باش شرياته تنحسبله.
            </p>
            <Button variant="outline" size="sm" onClick={copy}><Copy className="size-4 me-1" /> انسخ الرابط (للواتساب)</Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">اختار الفرع فوق باش يطلع الـ QR.</p>
        )}
      </Card>
    </div>
  );
}
