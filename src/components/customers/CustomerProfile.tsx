// أعلى ملف العميل (المدير العام): آخر زيارة، سعر القرام آخر مرة والمتوسط، بطاقة الولاء والأختام، وشكون تواصل معاه —
// كل اللي كان يحتاج دخول MSTRMND. الأرقام من customers_overview (نفس كاش القائمة).
import { useQuery } from "@tanstack/react-query";
import { CreditCard, Clock, MessageCircle, Scale } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { sb } from "@/lib/amarsoft";
import { CONTACT_LABELS, INSTALL_URL, TIERS, waPhone } from "@/lib/loyalty";
import { daysSince, ld, sinceText, tripoliDate, useCustomersOverview } from "@/lib/customers";

type Discounts = { bronze_discount: number; silver_discount: number; gold_discount: number };

export default function CustomerProfile({ customerId }: { customerId: string }) {
  const { data } = useCustomersOverview();
  const { data: settings } = useQuery({
    queryKey: ["loyalty-settings"],
    queryFn: async () => {
      const { data, error } = await sb.from("loyalty_settings").select("*").eq("id", 1).single();
      if (error) throw error;
      return data as Discounts;
    },
  });
  const r = data?.find((x) => x.customer_id === customerId);
  if (!r) return null;

  const d = r.last_at ? daysSince(r.last_at) : null;
  const wa = (text?: string) => {
    const ph = waPhone(r.phone);
    if (!ph) return toast.error("الرقم مش صالح");
    window.open(`https://wa.me/${ph}${text ? `?text=${encodeURIComponent(text)}` : ""}`, "_blank");
  };
  const tierPct = r.tier && settings ? settings[`${r.tier}_discount`] : null;
  const first = r.full_name.trim().split(/\s+/)[0];
  const invite = r.tier && tierPct != null
    ? `مرحبا ${first} 💚\nمن مجوهرات مخرّم: عندك بطاقة ولاء ${TIERS[r.tier].label} بخصم ${tierPct}% على كل شرية.\nركّبها على موبايلك من هنا وسجّل بنفس رقمك، وشرياتك القديمة تنحسبلك وحدها:\n${INSTALL_URL}`
    : null;
  const stamps = r.stamps_now ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {r.tier && <span className={`text-sm px-2.5 py-1 rounded-full ${TIERS[r.tier].badge}`}>{TIERS[r.tier].label} · {ld(r.total_ld)}</span>}
        <Button size="sm" variant="outline" className="mr-auto" onClick={() => wa()}><MessageCircle className="size-4 ml-1" /> واتساب</Button>
      </div>

      <Card className="p-3 space-y-1.5 text-sm">
        <h3 className="font-bold flex items-center gap-1.5"><Clock className="size-4 text-primary" /> آخر زيارة</h3>
        {d == null ? <p className="text-muted-foreground">ما عندهش فواتير في أمارسوفت بعد.</p> : (
          <>
            <div className="flex justify-between"><span className="text-muted-foreground">آخر مرة جا</span>
              <span className={d > 365 ? "text-destructive font-bold" : "font-bold"}>{sinceText(d)} ({tripoliDate(r.last_at!)})</span></div>
            {r.last_branch_name && <div className="flex justify-between"><span className="text-muted-foreground">الفرع</span><span>{r.last_branch_name}</span></div>}
            {r.last_salesman && <div className="flex justify-between"><span className="text-muted-foreground">البائع</span><span>{r.last_salesman}</span></div>}
            <div className="flex justify-between"><span className="text-muted-foreground">زياراته</span>
              <span>{r.visit_days} يوم · {r.invoices} فاتورة{r.returns ? ` · ${r.returns} مرتجع` : ""}</span></div>
            {r.main_branch_name && <div className="flex justify-between"><span className="text-muted-foreground">فرعه</span><span>{r.main_branch_name}</span></div>}
          </>
        )}
      </Card>

      {(r.last_price18 != null || r.last_price21 != null) && (
        <Card className="p-3 space-y-1.5 text-sm">
          <h3 className="font-bold flex items-center gap-1.5"><Scale className="size-4 text-primary" /> سعر القرام اللي نباعله</h3>
          {([["18", r.last_price18, r.avg_price18], ["21", r.last_price21, r.avg_price21]] as const).filter(([, last]) => last != null).map(([k, last, avg]) => (
            <div key={k} className="flex justify-between">
              <span className="text-muted-foreground">عيار {k}</span>
              <span>آخر مرة <b className="text-primary">{ld(last!)}</b>{avg != null && avg !== last ? ` · المتوسط ${ld(avg)}` : ""}</span>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">قيمة القطع ÷ وزنها في الفاتورة (فيها المصنعية).{r.grams ? ` شرى ${r.grams} جم الكل.` : ""}</p>
        </Card>
      )}

      <Card className="p-3 space-y-2 text-sm">
        <h3 className="font-bold flex items-center gap-1.5"><CreditCard className="size-4 text-primary" /> بطاقة الولاء</h3>
        {r.has_card ? (
          <>
            <div className="flex justify-between"><span className="text-muted-foreground">المستوى</span>
              <span className="font-bold">{r.card_level ?? "—"}{r.card_discount != null ? ` · خصم ${r.card_discount}%` : ""}</span></div>
            {r.card_to_next != null && (
              <div className="flex justify-between"><span className="text-muted-foreground">المستوى الجاي</span>
                <span>{r.card_to_next > 0 ? `باقي ${ld(r.card_to_next)}` : "في أعلى مستوى"}</span></div>
            )}
            {r.stamps_now != null && (
              <div className="flex justify-between items-center"><span className="text-muted-foreground">الأختام</span>
                <span className="flex items-center gap-1" aria-label={`${stamps} من 5`}>
                  {[0, 1, 2, 3, 4].map((i) => <span key={i} className={`size-3 rounded-full ${i < stamps ? "bg-primary" : "bg-muted"}`} />)}
                  <span className="mr-1">{stamps}/5</span>
                </span></div>
            )}
            {!!r.rewards_unused && <p className="text-status-available font-bold">عنده {r.rewards_unused} هدية ما استعملهاش: خصم 1,250 على الفاتورة + 50 على القرام.</p>}
            {r.gift_balance != null && <div className="flex justify-between"><span className="text-muted-foreground">بطاقة هدية</span><span>رصيد {ld(r.gift_balance)}</span></div>}
            {!r.card_installed && <p className="text-xs text-destructive">البطاقة مسجّلة بس مش مركّبة في موبايله.</p>}
          </>
        ) : (
          <>
            <p className="text-muted-foreground">ما عندهش بطاقة ولاء.{r.tier ? ` حسب شرياته يستاهل ${TIERS[r.tier].label}.` : ""}</p>
            {invite && <Button size="sm" variant="outline" className="w-full" onClick={() => wa(invite)}><MessageCircle className="size-4 ml-1" /> ابعتله رابط البطاقة</Button>}
          </>
        )}
        {r.contacted.length > 0 && (
          <p className="text-xs text-muted-foreground">تواصلنا معاه: {r.contacted.map((c) => CONTACT_LABELS[c] ?? c).join("، ")}</p>
        )}
      </Card>
    </div>
  );
}
