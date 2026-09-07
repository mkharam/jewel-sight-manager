import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PackagePlus, Camera, X } from "lucide-react";
import { toast } from "sonner";

interface ReorderRequestDialogProps {
  /** من صفحة قطعة موجودة: مُمرَّرة ومقفلة. بدونها (من صفحة الاستفسارات): الموظف يكتب الاسم ويرفع صورة. */
  productId?: string;
  productName?: string;
  branchId?: string | null;
  trigger?: React.ReactNode;
}

export default function ReorderRequestDialog({
  productId, productName, branchId, trigger,
}: ReorderRequestDialogProps) {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [freeName, setFreeName] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  const standalone = !productId;

  const onPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024 || !f.type.startsWith("image/")) {
      toast.error("الصورة يجب أن تكون أقل من 5MB");
      return;
    }
    setPhoto(f);
    setPhotoPreview(URL.createObjectURL(f));
  };

  const reset = () => {
    setFreeName(""); setName(""); setPhone(""); setQuantity("1"); setNote("");
    setPhoto(null); setPhotoPreview(null);
  };

  const submit = async () => {
    if (standalone && !freeName.trim() && !photo) {
      toast.error("اكتب اسم القطعة أو أرفق صورة لها");
      return;
    }
    setSaving(true);
    try {
      let imagePath: string | null = null;
      if (photo) {
        const ext = photo.name.split(".").pop();
        const path = `reorder-requests/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supabase.storage.from("inquiry-images").upload(path, photo);
        if (upErr) throw upErr;
        imagePath = path;
      }

      const { error } = await supabase.from("product_reorder_requests").insert({
        product_id: productId ?? null,
        product_name_snapshot: productName ?? (freeName.trim() || "قطعة بالصورة المرفقة"),
        branch_id: branchId ?? profile?.branch_id ?? null,
        customer_name: name.trim() || null,
        customer_phone: phone.trim() || null,
        quantity: Number(quantity) || 1,
        note: note.trim() || null,
        image_path: imagePath,
        requested_by: user?.id ?? null,
      });
      if (error) throw error;
      toast.success("تم إرسال الطلب للمدير", { description: "سيتابع المدير طلب القطعة من المورد" });
      setOpen(false);
      reset();
      qc.invalidateQueries({ queryKey: ["reorder-requests"] });
    } catch (e: any) {
      toast.error(e.message ?? "تعذّر إرسال الطلب");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="lg" className="w-full">
            <PackagePlus className="size-4 ml-1" /> اطلب هذه القطعة لزبون
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{standalone ? "طلب إعادة طلب قطعة" : `طلب إعادة طلب «${productName}»`}</DialogTitle>
          <DialogDescription>
            يصل الطلب فوراً للمدير ليطلب القطعة من المورد. مفيد عند نفاد القطعة أو رغبة الزبون بواحدة إضافية.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {standalone && (
            <>
              <div>
                <Label>اسم القطعة أو وصفها</Label>
                <Input value={freeName} onChange={(e) => setFreeName(e.target.value)} placeholder="مثال: خاتم سوليتير ألماس مقاس 16" />
              </div>
              <div>
                <Label>صورة القطعة (اختياري إن كتبت الاسم)</Label>
                {photoPreview ? (
                  <div className="relative aspect-square w-32 rounded-lg overflow-hidden bg-muted mt-1.5">
                    <img src={photoPreview} className="w-full h-full object-cover" alt="" />
                    <button
                      type="button"
                      onClick={() => { setPhoto(null); setPhotoPreview(null); }}
                      className="absolute top-1 left-1 size-6 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ) : (
                  <label className="mt-1.5 block">
                    <input type="file" accept="image/*" capture="environment" onChange={onPhoto} className="hidden" />
                    <div className="border-2 border-dashed border-border rounded-xl p-4 text-center cursor-pointer hover:bg-muted/50 transition">
                      <Camera className="size-5 mx-auto mb-1 text-muted-foreground" />
                      <p className="text-xs font-medium">اضغط لالتقاط/رفع صورة</p>
                    </div>
                  </label>
                )}
              </div>
            </>
          )}
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
