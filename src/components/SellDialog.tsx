import { useEffect, useState } from "react";
import { usePersistentState } from "@/lib/resume";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { BadgeCheck, ChevronDown, Minus, Plus } from "lucide-react";
import { PAYMENT_METHODS } from "@/lib/luxury";
import { formatCurrency, normalizeDecimalInput } from "@/lib/constants";
import { invalidateInventoryAndSales } from "@/lib/queryInvalidation";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Product = {
  id: string; name: string; sku?: string | null; karat: string | null;
  weight_grams: number | null; branch_id?: string | null;
  sale_price: number | null; promo_price: number | null;
  /** المتوفر من القطعة — إن زاد عن 1 يختار الموظف كم قطعة يبيع. */
  quantity?: number;
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
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  // البيع يُسجَّل في فرع البائع — حيث تمّ فعلاً — لا في فرع القطعة. 61% من القطع بلا فرع
  // و"القادسية" بلا قطع مسجّلة إطلاقاً، وسياسة RLS تسمح للموظف بالبيع في فرعه فقط، فكان
  // كل بيع لقطعة بلا فرع أو من فرع آخر يُرفض بـ403 (هكذا فشل البيع في القادسية).
  // المدير العام بلا فرع: يبقى فرع القطعة.
  const saleBranchId = profile?.branch_id ?? product.branch_id ?? null;
  const qc = useQueryClient();
  // البيع يُكتب والزبون واقف، وكثيراً ما يخرج الموظف للواتساب في المنتصف (يرسل صورة، يتأكد
  // من السعر). الآيفون قد يغلق التطبيق في الخلفية — فنحفظ النافذة مفتوحة وكل ما كُتب فيها.
  const dk = (f: string) => `sell:${product.id}:${f}`;
  const [innerOpen, setInnerOpen, clearOpen] = usePersistentState(dk("open"), false);
  const open = controlledOpen ?? innerOpen;
  const [saving, setSaving] = useState(false);
  // سعر القطعة الواحدة؛ الخانة تحمل إجمالي البيع (سعر × العدد) ما لم يكتب الموظف سعراً بنفسه.
  const base = product.promo_price ?? product.sale_price ?? (suggestedPrice ? Math.round(suggestedPrice) : null);
  const available = Math.max(product.quantity ?? 1, 1);
  const [qty, setQty, clearQty] = usePersistentState(dk("qty"), 1);
  const [priceTouched, setPriceTouched, clearPriceTouched] = usePersistentState(dk("priceTouched"), false);
  const [price, setPrice, clearPrice] = usePersistentState(dk("price"), base ? String(base) : "");
  const changeQty = (next: number) => {
    const q = Math.min(Math.max(next, 1), available);
    setQty(q);
    if (!priceTouched && base) setPrice(String(base * q));
  };
  const [method, setMethod, clearMethod] = usePersistentState(dk("method"), PAYMENT_METHODS[0]);
  const [showMore, setShowMore, clearShowMore] = usePersistentState(dk("showMore"), false);
  const [discount, setDiscount, clearDiscount] = usePersistentState(dk("discount"), "");
  const [name, setName, clearName] = usePersistentState(dk("name"), "");
  const [phone, setPhone, clearPhone] = usePersistentState(dk("phone"), "");
  const [notes, setNotes, clearNotes] = usePersistentState(dk("notes"), "");
  const [amarInvoice, setAmarInvoice, clearAmar] = usePersistentState(dk("amar"), "");
  // إغلاق النافذة (إلغاء أو بعد البيع) يمسح المسودّة — المرة القادمة تبدأ نظيفة.
  const setOpen = (v: boolean) => {
    onOpenChange?.(v);
    if (controlledOpen === undefined) setInnerOpen(v);
    if (!v) {
      clearOpen(); clearQty(); clearPriceTouched(); clearPrice(); clearMethod(); clearShowMore();
      clearDiscount(); clearName(); clearPhone(); clearNotes(); clearAmar();
    }
  };
  // سعر اليوم يُحمَّل بعد الصفحة بلحظة — نملأ الخانة عند فتح النافذة إن كانت ما زالت فارغة.
  useEffect(() => {
    if (open && !price && base) setPrice(String(base * qty));
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
      .insert({ full_name: trimmedName, phone: trimmedPhone || null, branch_id: saleBranchId, created_by: user?.id ?? null })
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
    const { data: sale, error } = await supabase.from("sales").insert({
      product_id: product.id,
      product_name_snapshot: product.name,
      sku_snapshot: product.sku ?? null,
      weight_grams: product.weight_grams,
      karat: product.karat,
      branch_id: saleBranchId,
      customer_id: customerId,
      customer_name: name.trim() || null,
      customer_phone: phone.trim() || null,
      final_price: priceNum,
      quantity: qty,
      discount: Number(discount || 0),
      payment_method: method,
      sold_by: user?.id ?? null,
      notes: notes.trim() || null,
      amar_invoice_number: amarInvoice.trim() || null,
    }).select("id").single();
    setSaving(false);
    if (error) {
      // رفض صلاحيات (موظف بلا فرع مثلاً) — رسالة مفهومة بدل نص قاعدة البيانات الإنجليزي.
      const denied = error.code === "42501" || /row-level security/i.test(error.message);
      return toast.error(denied ? "لا يمكن تسجيل البيع — حسابك غير مرتبط بفرع. راجع المدير." : error.message);
    }
    toast.success(`تم تسجيل البيع — ${formatCurrency(priceNum)}`);
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["product", product.id] });
    qc.invalidateQueries({ queryKey: ["sales", product.id] });
    // الكتالوج وبطاقة "مبيعاتي" ولوحة الصدارة وتنبيه نقص المخزون — كانت كلها تبقى على
    // بياناتها القديمة بعد البيع حتى إعادة تحميل الصفحة. راجع lib/queryInvalidation.
    invalidateInventoryAndSales(qc);
    // الإيصال مباشرة بعد البيع: طباعة أو إرسال للزبون على الواتساب.
    if (sale?.id) navigate(`/sales/${sale.id}/receipt`);
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
          {available > 1 && (
            <div>
              <Label>العدد <span className="text-muted-foreground font-normal">(المتوفر {available})</span></Label>
              <div className="mt-1.5 flex items-center gap-3">
                <Button type="button" size="icon" variant="outline" className="size-11" onClick={() => changeQty(qty - 1)} disabled={qty <= 1} aria-label="أقل">
                  <Minus className="size-5" />
                </Button>
                <span className="min-w-8 text-center text-2xl font-bold tabular-nums">{qty}</span>
                <Button type="button" size="icon" variant="outline" className="size-11" onClick={() => changeQty(qty + 1)} disabled={qty >= available} aria-label="أكثر">
                  <Plus className="size-5" />
                </Button>
              </div>
            </div>
          )}

          <div>
            <Label htmlFor="sell-price">{available > 1 ? "الإجمالي (د.ل)" : "السعر النهائي (د.ل)"}</Label>
            <Input
              id="sell-price"
              value={price}
              onChange={(e) => { setPriceTouched(true); setPrice(normalizeDecimalInput(e.target.value)); }}
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
            {saving ? "جارٍ الحفظ..." : priceNum > 0 ? `تأكيد البيع${qty > 1 ? ` (${qty} قطع)` : ""} — ${formatCurrency(priceNum)}` : "اكتب السعر"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
