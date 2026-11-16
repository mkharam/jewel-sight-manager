// «بطاقة جديدة»: الزبون الجديد يختار أي بطاقة يبيها (ولاء، أختام، هدايا) ويمسح الـ QR من شاشة الموظف.
// كل QR فيه الفرع (utm_source=b05)، فالبطاقة تتسجّل على الفرع اللي ركّبها فيه بلا ما حد يكتب حاجة.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { sb } from "@/lib/amarsoft";
import { WALLET_CARDS, cardInstallUrl } from "@/lib/loyalty";

type Branch = { code: string; name: string; mine: boolean };
type Issued = { serial: string | null; existed: boolean; via_manager: boolean; url: string | null };

// الموظف يكتب اسم الزبون ورقمه، والبطاقة تطلع في MSTRMND بحساب مدير الفرع (تتسجّل بفرعه)، ويطلع QR خاص بيها.
function IssueCard({ branch }: { branch: string }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Issued | null>(null);

  const submit = async () => {
    setBusy(true);
    const { data, error } = await sb.functions.invoke("mstrmnd-link?action=issue", { body: { branch, name, phone } });
    setBusy(false);
    if (error || !data?.ok) {
      const msg = (await (error as any)?.context?.json?.().catch(() => null))?.error ?? data?.error ?? "ما قدرتش نطلّع البطاقة";
      toast.error(msg);
      return;
    }
    setDone(data as Issued);
    if (!data.via_manager) toast.warning("طلعت بالحساب الرئيسي (حساب مدير الفرع مش مربوط)، فما تنحسبش على الفرع في MSTRMND");
  };

  if (done) {
    return (
      <Card className="p-5 flex flex-col items-center gap-3 text-center">
        <p className="font-bold">{done.existed ? "الزبون عنده بطاقة من قبل" : "طلعت البطاقة"} {done.serial && <span dir="ltr" className="text-xs text-muted-foreground">{done.serial}</span>}</p>
        {done.url ? (
          <>
            <div className="bg-white p-3 rounded-xl"><QRCodeSVG value={done.url} size={220} /></div>
            <p className="text-sm">خلي الزبون يمسح الـ QR ويضيف البطاقة لـ Wallet. ما يحتاجش يكتب حاجة.</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">البطاقة طلعت، لكن رابطها مازال ما بانش. جرّب بعد شوية من «بطاقات Wallet».</p>
        )}
        <Button variant="outline" size="sm" onClick={() => { setDone(null); setName(""); setPhone(""); }}>زبون ثاني</Button>
      </Card>
    );
  }
  return (
    <Card className="p-4 space-y-2">
      <p className="font-bold">طلّع بطاقة ولاء للزبون</p>
      <input className="w-full rounded-md border px-3 py-2 text-sm bg-background" placeholder="اسم الزبون" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="w-full rounded-md border px-3 py-2 text-sm bg-background" placeholder="رقم الموبايل 09xxxxxxxx" dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <Button className="w-full" disabled={busy || !name.trim() || phone.replace(/\D/g, "").length < 9} onClick={submit}>
        {busy ? "لحظة…" : "طلّع البطاقة"}
      </Button>
    </Card>
  );
}

type NoInvoice = { customer_id: string; full_name: string | null; phone9: string; created_at: string; branch_code: string; issued_here: boolean };

// بطاقات جديدة (آخر 7 أيام) وصاحبها ما عندهش فاتورة في أمارسوفت برقمه.
function NoInvoiceCards() {
  const { data } = useQuery({
    queryKey: ["loyalty-cards-no-invoice"],
    queryFn: async () => {
      const { data, error } = await sb.rpc("loyalty_cards_no_invoice", { p_days: 7 });
      if (error) throw error;
      return (data ?? []) as NoInvoice[];
    },
  });
  if (!data?.length) return null;
  return (
    <Card className="p-4 space-y-2 border-amber-500/50">
      <p className="font-bold text-sm">بطاقات جديدة بلا فاتورة ({data.length})</p>
      <p className="text-xs text-muted-foreground">زبون طلّع بطاقة وما فيش فاتورة أمارسوفت برقمه. لو شرا، حط رقمه في الفاتورة باش تنحسبله.</p>
      <ul className="text-sm divide-y">
        {data.map((r) => (
          <li key={r.customer_id} className="py-1.5 flex justify-between gap-2">
            <span>{r.full_name ?? "—"} <span dir="ltr" className="text-xs text-muted-foreground">0{r.phone9}</span></span>
            <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString("ar-LY")}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

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

  // MSTRMND ما يحفظش الفرع من الرابط، فنسجّلو عندنا أي فرع الـ QR ظاهر فيه توا (وكل دقيقتين ما دام مفتوح).
  useEffect(() => {
    if (!branch) return;
    const ping = () => { if (document.visibilityState === "visible") void sb.rpc("loyalty_qr_shown", { p_branch: branch }); };
    ping();
    const t = setInterval(ping, 120_000);
    return () => clearInterval(t);
  }, [branch]);

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

      {card === "loyalty" && branch && <IssueCard branch={branch} />}
      <NoInvoiceCards />

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
