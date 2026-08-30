import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { BadgeCheck } from "lucide-react";
import { PAYMENT_METHODS } from "@/lib/luxury";
import { toast } from "sonner";

type Product = {
  id: string; name: string; sku: string | null; karat: string | null;
  weight_grams: number | null; branch_id: string | null;
  sale_price: number | null; promo_price: number | null;
};

export default function SellDialog({ product }: { product: Product }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const base = product.promo_price ?? product.sale_price ?? null;
  const [price, setPrice] = useState(base ? String(base) : "");
  const [discount, setDiscount] = useState("0");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [method, setMethod] = useState(PAYMENT_METHODS[0]);
  const [notes, setNotes] = useState("");
  const [amarInvoice, setAmarInvoice] = useState("");

  const submit = async () => {
    if (!price || Number(price) <= 0) return toast.error("اكتب السعر النهائي");
    setSaving(true);
    const { error } = await supabase.from("sales").insert({
      product_id: product.id,
      product_name_snapshot: product.name,
      sku_snapshot: product.sku,
      weight_grams: product.weight_grams,
      karat: product.karat,
      branch_id: product.branch_id,
      customer_name: name.trim() || null,
      customer_phone: phone.trim() || null,
      final_price: Number(price),
      discount: Number(discount || 0),
      payment_method: method,
      sold_by: user?.id ?? null,
      notes: notes.trim() || null,
      amar_invoice_number: amarInvoice.trim() || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("تم تسجيل البيع");
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["product", product.id] });
    qc.invalidateQueries({ queryKey: ["sales", product.id] });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" className="w-full">
          <BadgeCheck className="size-4 ml-1" /> تسجيل بيع
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>بيع «{product.name}»</DialogTitle>
          <DialogDescription>سجّل السعر النهائي والخصم — تصبح القطعة «مبيعة» تلقائياً.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>السعر النهائي (د.ل) *</Label><Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" /></div>
            <div><Label>الخصم</Label><Input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" /></div>
            <div><Label>اسم الزبون</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><Label>الهاتف</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" /></div>
          </div>
          <div>
            <Label>طريقة الدفع</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>ملاحظات</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={saving} className="w-full">{saving ? "جارٍ الحفظ..." : "تأكيد البيع"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
