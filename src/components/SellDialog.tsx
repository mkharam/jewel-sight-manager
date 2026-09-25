import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { BadgeCheck, ChevronDown } from "lucide-react";
import { PAYMENT_METHODS } from "@/lib/luxury";
import { formatCurrency, normalizeDecimalInput } from "@/lib/constants";
import { invalidateInventoryAndSales } from "@/lib/queryInvalidation";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Product = {
  id: string; name: string; sku?: string | null; karat: string | null;
  weight_grams: number | null; branch_id?: string | null;
  sale_price: number | null; promo_price: number | null;
};

// أرقام الهاتف تُكتب غالباً بلوحة عربية (٠٩١…) — نحوّلها لأرقام لاتينية فقط.
const normalizePhone = (raw: string) => normalizeDecimalInput(raw).replace(/\./g, "");

/**
 * تسجيل بيع في أقل عدد من الضغطات — كان الموظفون لا يسجّلون البيع إطلاقاً (بيعة واحدة من 548
 * قطعة)، فتبقى القطع المبيعة "متوفرة" في الكتالوج ويَعِد الموظف زبوناً بقطعة ذهبت. السبب:
 * سبعة حقول دفعة واحدة، سعر فارغ لـ40% من القطع، وخانة سعر ترفض الأرقام العربية (لوحة
 * الآيفون العربية تكتب ١٢٣ فيصير السعر NaN ويظهر "اكتب السعر" رغم كتابته).
 * الآن: السعر مملوء مسبقاً (المثبّت أو سعر اليوم)، الدفع بضغطة، والباقي اختياري ومطوي.
 */
export default function SellDialog({
  product,
  suggestedPrice,
  open: controlledOpen,
  onOpenChange,
  hideTrigger,
}: {
  product: Product;
  /** سعر اليوم المحسوب من الوزن والعيار — يُستخدم حين لا سعر مثبّت للقطعة. */
  suggestedPrice?: number | null;
  /** للتحكّم من الخارج (قائمة "مبيع" في بطاقة القطعة) بدل زر الفتح الداخلي. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [innerOpen, setInnerOpen] = useState(false);
  const open = controlledOpen ?? innerOpen;
  const setOpen = (v: boolean) => { onOpenChange?.(v); if (controlledOpen === undefined) setInnerOpen(v); };
  const [saving, setSaving] = useState(false);
  const base = product.promo_price ?? product.sale_price ?? (suggestedPrice ? Math.round(suggestedPrice) : null);
  const [price, setPrice] = useState(base ? String(base) : "");
  const [method, setMethod] = useState(PAYMENT_METHODS[0]);
  const [showMore, setShowMore] = useState(false);
  const [discount, setDiscount] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [amarInvoice, setAmarInvoice] = useState("");
  // سعر اليوم يُحمَّل بعد الصفحة بلحظة — نملأ الخانة عند فتح النافذة إن كانت ما زالت فارغة.
  useEffect(() => {
    if (open && !price && base) setPrice(String(base));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, base]);

  // يربط البيع بعميل فعلي في جدول customers (بحث بالهاتف، وإلا إنشاء عميل جديد) بدل
  // الاكتفاء باسم/هاتف كنص حر — بدون هذا الربط لا يظهر البيع أبداً في تاريخ شراء أي
  // عميل بصفحة العملاء الجديدة، حتى لو الاسم والهاتف مكتوبين هنا.
  const resolveCustomerId = async (): Promise<string | null> => {
    const trimmedPhone = phone.trim();
    const trimmedName = name.trim();
    if (!trimmedPhone && !trimmedName) return null;
    if (trimmedPhone) {
      const { data: existing } = await supabase
        .from("customers")
        .select("id")
        .eq("phone", trimmedPhone)
        .limit(1)
        .maybeSingle();
      if (existing) return existing.id;
    }
    if (!trimmedName) return null;
    const { data: created, error: custErr } = await supabase
      .from("customers")
      .insert({ full_name: trimmedName, phone: trimmedPhone || null, branch_id: product.branch_id, created_by: user?.id ?? null })
      .select("id")
      .single();
    if (custErr) { console.warn("تعذّر إنشاء سجل العميل", custErr); return null; }
    return created?.id ?? null;
  };

  const priceNum = Number(price);
  const submit = async () => {
    if (!price || !(priceNum > 0)) return toast.error("اكتب السعر النهائي");
    setSaving(true);
    const customerId = await resolveCustomerId();
    const { error } = await supabase.from("sales").insert({
      product_id: product.id,
      product_name_snapshot: product.name,
      sku_snapshot: product.sku ?? null,
      weight_grams: product.weight_grams,
      karat: product.karat,
      branch_id: product.branch_id ?? null,
      customer_id: customerId,
      customer_name: name.trim() || null,
      customer_phone: phone.trim() || null,
      final_price: priceNum,
      discount: Number(discount || 0),
      payment_method: method,
      sold_by: user?.id ?? null,
      notes: notes.trim() || null,
      amar_invoice_number: amarInvoice.trim() || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`تم تسجيل البيع — ${formatCurrency(priceNum)}`);
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["product", product.id] });
    qc.invalidateQueries({ queryKey: ["sales", product.id] });
    // الكتالوج وبطاقة "مبيعاتي" ولوحة الصدارة وتنبيه نقص المخزون — كانت كلها تبقى على
    // بياناتها القديمة بعد البيع حتى إعادة تحميل الصفحة. راجع lib/queryInvalidation.
    invalidateInventoryAndSales(qc);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hideTrigger && (
        <DialogTrigger asChild>
          <Button size="lg" className="w-full">
            <BadgeCheck className="size-4 ml-1" /> بيع
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>بيع «{product.name}»</DialogTitle>
          <DialogDescription>تصبح القطعة «مبيعة» فوراً وتختفي من المتوفر.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="sell-price">السعر النهائي (د.ل)</Label>
            <Input
              id="sell-price"
              value={price}
              onChange={(e) => setPrice(normalizeDecimalInput(e.target.value))}
              inputMode="decimal"
              dir="ltr"
              className="h-14 text-2xl font-bold text-center"
              placeholder="0"
            />
            {!product.promo_price && !product.sale_price && suggestedPrice ? (
              <p className="mt-1 text-[11px] text-muted-foreground">مملوء من سعر اليوم — عدّله إن اتفقت مع الزبون على غيره.</p>
            ) : null}
          </div>

          <div>
            <Label>طريقة الدفع</Label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={cn(
                    "h-10 px-3.5 rounded-xl border text-sm font-semibold transition-colors",
                    method === m ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border",
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            className="flex items-center gap-1 text-sm text-muted-foreground"
          >
            تفاصيل إضافية (اختياري) — الزبون، الخصم، الفاتورة
            <ChevronDown className={cn("size-4 transition-transform", showMore && "rotate-180")} />
          </button>
          {showMore && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>اسم الزبون</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div><Label>الهاتف</Label><Input value={phone} onChange={(e) => setPhone(normalizePhone(e.target.value))} inputMode="tel" dir="ltr" /></div>
                <div><Label>الخصم</Label><Input value={discount} onChange={(e) => setDiscount(normalizeDecimalInput(e.target.value))} inputMode="decimal" dir="ltr" placeholder="0" /></div>
                <div><Label>فاتورة عمار</Label><Input value={amarInvoice} onChange={(e) => setAmarInvoice(e.target.value)} dir="ltr" /></div>
              </div>
              <div><Label>ملاحظات</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={saving || !(priceNum > 0)} size="lg" className="w-full h-12 text-base">
            {saving ? "جارٍ الحفظ..." : priceNum > 0 ? `تأكيد البيع — ${formatCurrency(priceNum)}` : "اكتب السعر"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
