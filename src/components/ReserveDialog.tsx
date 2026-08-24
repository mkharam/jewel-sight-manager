import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { BookmarkPlus } from "lucide-react";
import { isoDatePlusDays } from "@/lib/luxury";
import { toast } from "sonner";

export default function ReserveDialog({
  productId, productName, branchId, defaultPrice,
}: { productId: string; productName: string; branchId: string | null; defaultPrice?: number | null }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [deposit, setDeposit] = useState("");
  const [price, setPrice] = useState(defaultPrice ? String(defaultPrice) : "");
  const [expires, setExpires] = useState(isoDatePlusDays(7));
  const [notes, setNotes] = useState("");

  const submit = async () => {
    if (!name.trim()) return toast.error("اكتب اسم الزبون");
    if (!deposit || Number(deposit) <= 0) return toast.error("اكتب مبلغ العربون");
    setSaving(true);
    const { error } = await supabase.from("reservations").insert({
      product_id: productId,
      customer_name: name.trim(),
      customer_phone: phone.trim() || null,
      deposit: Number(deposit),
      agreed_price: price ? Number(price) : null,
      expires_at: expires,
      branch_id: branchId,
      notes: notes.trim() || null,
      created_by: user?.id ?? null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("تم حجز القطعة");
    setOpen(false);
    setName(""); setPhone(""); setDeposit(""); setNotes("");
    qc.invalidateQueries({ queryKey: ["product", productId] });
    qc.invalidateQueries({ queryKey: ["reservations", productId] });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="lg" className="w-full">
          <BookmarkPlus className="size-4 ml-1" /> حجز بعربون
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>حجز «{productName}»</DialogTitle>
          <DialogDescription>سجّل بيانات الزبون والعربون — تصبح القطعة «محجوزة» تلقائياً.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>اسم الزبون *</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><Label>الهاتف</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" /></div>
            <div><Label>العربون (د.ل) *</Label><Input value={deposit} onChange={(e) => setDeposit(e.target.value)} inputMode="decimal" /></div>
            <div><Label>السعر المتفق عليه</Label><Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" /></div>
          </div>
          <div>
            <Label>ينتهي الحجز في</Label>
            <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
            <div className="flex gap-2 mt-2">
              {[3, 7, 14, 30].map((d) => (
                <Button key={d} type="button" variant="secondary" size="sm" onClick={() => setExpires(isoDatePlusDays(d))}>
                  {d} يوم
                </Button>
              ))}
            </div>
          </div>
          <div><Label>ملاحظات</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={saving} className="w-full">{saving ? "جارٍ الحفظ..." : "تأكيد الحجز"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
