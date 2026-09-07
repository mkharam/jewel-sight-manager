import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Truck, Plus, Phone, Edit } from "lucide-react";
import { toast } from "sonner";

interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  is_active: boolean;
}

export default function Suppliers() {
  const { roles } = useAuth();
  const isAdmin = roles.includes("admin");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("suppliers").select("*").order("name");
    setSuppliers(data ?? []);
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditing(null); setName(""); setPhone(""); setNotes(""); setIsActive(true);
    setOpen(true);
  };
  const openEdit = (s: Supplier) => {
    setEditing(s); setName(s.name); setPhone(s.phone ?? ""); setNotes(s.notes ?? ""); setIsActive(s.is_active);
    setOpen(true);
  };

  const submit = async () => {
    if (!name.trim()) return toast.error("اكتب اسم المورد");
    setSaving(true);
    const payload = { name: name.trim(), phone: phone.trim() || null, notes: notes.trim() || null, is_active: isActive };
    const { error } = editing
      ? await supabase.from("suppliers").update(payload).eq("id", editing.id)
      : await supabase.from("suppliers").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(editing ? "تم التحديث" : "تمت الإضافة");
    setOpen(false);
    load();
  };

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Truck className="size-5 text-primary" />
          <h1 className="text-xl font-bold">الموردون</h1>
        </div>
        {isAdmin && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-gold-gradient text-primary-foreground shadow-gold" onClick={openNew}>
                <Plus className="size-4 ml-1" /> مورد جديد
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{editing ? "تعديل مورد" : "إضافة مورد"}</DialogTitle>
                <DialogDescription>يُستخدم عند طلب قطع جديدة أو إعادة طلب قطع نفدت.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div><Label>الاسم *</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div><Label>الهاتف</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" inputMode="tel" /></div>
                <div><Label>ملاحظات</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
                <div className="flex items-center justify-between">
                  <Label>نشط</Label>
                  <Switch checked={isActive} onCheckedChange={setIsActive} />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={submit} disabled={saving} className="w-full">{saving ? "جارٍ..." : "حفظ"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="space-y-2">
        {suppliers.length === 0 && (
          <div className="text-center py-12 text-muted-foreground bg-muted/30 rounded-xl">لا يوجد موردون بعد</div>
        )}
        {suppliers.map((s) => (
          <Card key={s.id} className="p-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-bold">{s.name}</p>
                {!s.is_active && <Badge variant="outline" className="bg-muted text-muted-foreground">غير نشط</Badge>}
              </div>
              {s.phone && (
                <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5" dir="ltr">
                  <Phone className="size-3" /> {s.phone}
                </p>
              )}
              {s.notes && <p className="text-xs text-muted-foreground mt-1">{s.notes}</p>}
            </div>
            {isAdmin && (
              <Button variant="ghost" size="icon" onClick={() => openEdit(s)}>
                <Edit className="size-4" />
              </Button>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
