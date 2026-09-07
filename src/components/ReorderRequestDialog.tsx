import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PackagePlus } from "lucide-react";
import { toast } from "sonner";

export default function ReorderRequestDialog({
  productId, productName, branchId,
}: { productId: string; productName: string; branchId: string | null }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [note, setNote] = useState("");

  const submit = async () => {
    setSaving(true);
    const { error } = await supabase.from("product_reorder_requests").insert({
      product_id: productId,
      product_name_snapshot: productName,
      branch_id: branchId,
      customer_name: name.trim() || null,
      customer_phone: phone.trim() || null,
      quantity: Number(quantity) || 1,
      note: note.trim() || null,
      requested_by: user?.id ?? null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("تم إرسال الطلب للمدير", { description: "سيتابع المدير طلب القطعة من المورد" });
    setOpen(false);
    setName(""); setPhone(""); setQuantity("1"); setNote("");
    qc.invalidateQueries({ queryKey: ["reorder-requests"] });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="lg" className="w-full">
          <PackagePlus className="size-4 ml-1" /> اطلب هذه القطعة لزبون
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>طلب إعادة طلب «{productName}»</DialogTitle>
          <DialogDescription>
            يصل الطلب فوراً للمدير ليطلب القطعة من المورد. مفيد عند نفاد القطعة أو رغبة الزبون بواحدة إضافية.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>اسم الزبون</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><Label>الهاتف</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" /></div>
          </div>
          <div><Label>الكمية</Label><Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="numeric" dir="ltr" className="w-24" /></div>
          <div><Label>ملاحظات</Label><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="مثال: نفس الشكل بمقاس أكبر" /></div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={saving} className="w-full">{saving ? "جارٍ الإرسال..." : "إرسال الطلب للمدير"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
