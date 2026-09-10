import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, MessageCircle, Phone, MapPin, PackagePlus, Tag } from "lucide-react";
import { Link } from "react-router-dom";
import { INQUIRY_STATUS, KARAT_OPTIONS, formatCurrency, formatDate, getThumbUrl, InquiryStatus } from "@/lib/constants";
import ReorderRequestDialog from "@/components/ReorderRequestDialog";
import { toast } from "sonner";

const schema = z.object({
  customer_name: z.string().trim().max(100).optional().or(z.literal("")),
  customer_phone: z.string().trim().max(30).optional().or(z.literal("")),
  description: z.string().trim().min(2, "اكتب وصف القطعة المطلوبة").max(1000),
  budget: z.string().optional(),
  desired_karat: z.string().optional(),
  desired_size: z.string().max(20).optional(),
  branch_id: z.string().optional(),
});

export default function Inquiries() {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<InquiryStatus | "all">("all");
  const [open, setOpen] = useState(false);

  // بث مباشر — أي استفسار جديد أو تغيير حالة يظهر فوراً للجميع
  useEffect(() => {
    const ch = supabase
      .channel("inquiries-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "customer_inquiries" }, () => {
        qc.invalidateQueries({ queryKey: ["inquiries"] });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "product_quotes" }, () => {
        qc.invalidateQueries({ queryKey: ["quotes-feed"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const { data: branches } = useQuery({
    queryKey: ["branches"],
    queryFn: async () => (await supabase.from("branches").select("id,name").order("name")).data ?? [],
  });

  // الأسعار المعروضة على العملاء — كانت تظهر فقط في صفحة القطعة، الآن تظهر هنا أيضاً
  // حتى يتابع الجميع كل سعر أُعطي لعميل بدون الحاجة لفتح كل قطعة على حدة.
  const { data: quotes, isLoading: quotesLoading } = useQuery({
    queryKey: ["quotes-feed"],
    queryFn: async () => {
      const { data } = await supabase
        .from("product_quotes")
        .select("*, branch:branches(name), staff:profiles!product_quotes_quoted_by_fkey(full_name), product:products(id,name,images:product_images(storage_path,thumb_path,is_primary))")
        .order("created_at", { ascending: false })
        .limit(100);
      return data ?? [];
    },
  });

  const { data: inquiries, isLoading } = useQuery({
    queryKey: ["inquiries", filter],
    queryFn: async () => {
      let q = supabase
        .from("customer_inquiries")
        .select("*, branch:branches(name), staff:profiles!customer_inquiries_created_by_fkey(full_name), product:products(name)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (filter !== "all") q = q.eq("status", filter);
      return (await q).data ?? [];
    },
  });

  const updateStatus = async (id: string, status: InquiryStatus) => {
    const { error } = await supabase.from("customer_inquiries").update({ status }).eq("id", id);
    if (error) return toast.error(error.message);
    await supabase.from("activity_log").insert({
      actor_id: user?.id, action: "inquiry_status", entity_type: "inquiry", entity_id: id, details: { status },
    });
    qc.invalidateQueries({ queryKey: ["inquiries"] });
  };

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">استفسارات العملاء</h1>
          <p className="text-sm text-muted-foreground">سجّل ما يطلبه العملاء حتى لو القطعة غير موجودة الآن.</p>
        </div>
        <div className="flex gap-2">
          <ReorderRequestDialog
            branchId={profile?.branch_id ?? null}
            trigger={
              <Button variant="outline">
                <PackagePlus className="size-4 ml-1" /> طلب إعادة طلب بصورة
              </Button>
            }
          />
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-gold-gradient text-primary-foreground shadow-gold">
              <Plus className="size-4 ml-1" /> استفسار جديد
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>تسجيل استفسار عميل</DialogTitle>
              <DialogDescription>سجّل ما طلبه العميل حتى يبحث الموظفون عنه.</DialogDescription>
            </DialogHeader>
            <NewInquiryForm
              defaultBranch={profile?.branch_id ?? ""}
              branches={branches ?? []}
              userId={user?.id}
              onDone={() => { setOpen(false); qc.invalidateQueries({ queryKey: ["inquiries"] }); }}
            />
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1">
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>الكل</FilterChip>
        {Object.entries(INQUIRY_STATUS).map(([k, v]) => (
          <FilterChip key={k} active={filter === k} onClick={() => setFilter(k as InquiryStatus)}>{v.label}</FilterChip>
        ))}
      </div>

      {isLoading ? (
        <p className="text-center text-muted-foreground py-8">جارٍ...</p>
      ) : inquiries && inquiries.length > 0 ? (
        <div className="space-y-2">
          {inquiries.map((i: any) => (
            <Card key={i.id} className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold">{i.customer_name ?? "عميل بدون اسم"}</h3>
                    <Badge className={`${INQUIRY_STATUS[i.status as InquiryStatus].color} border-0 text-xs`}>
                      {INQUIRY_STATUS[i.status as InquiryStatus].label}
                    </Badge>
                  </div>
                  {i.customer_phone && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5" dir="ltr">
                      <Phone className="size-3" /> {i.customer_phone}
                    </p>
                  )}
                </div>
                <Select value={i.status} onValueChange={(v) => updateStatus(i.id, v as InquiryStatus)}>
                  <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(INQUIRY_STATUS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-sm">{i.description}</p>
              <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground pt-2 border-t border-border">
                {i.desired_karat && <span>قيراط: {i.desired_karat}</span>}
                {i.desired_size && <span>· مقاس: {i.desired_size}</span>}
                {i.budget && <span>· ميزانية: {formatCurrency(i.budget)}</span>}
                {i.branch?.name && <span className="flex items-center gap-1"><MapPin className="size-3" />{i.branch.name}</span>}
                <span className="ms-auto">{i.staff?.full_name} · {formatDate(i.created_at)}</span>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          <MessageCircle className="size-10 mx-auto mb-2 opacity-30" />
          <p>لا توجد استفسارات بعد.</p>
        </div>
      )}

      {/* الأسعار المعروضة على العملاء — تُسجَّل من صفحة كل قطعة (تسجيل سعر)، تظهر هنا
          مجمّعة حتى تتابعها بدون فتح كل قطعة على حدة. */}
      <div className="pt-4 border-t border-border">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Tag className="size-5 text-primary" /> الأسعار المعروضة على العملاء
        </h2>
        <p className="text-sm text-muted-foreground mb-3">كل سعر يُعطى لعميل من صفحة القطعة يظهر هنا فوراً.</p>

        {quotesLoading ? (
          <p className="text-center text-muted-foreground py-8">جارٍ...</p>
        ) : quotes && quotes.length > 0 ? (
          <div className="space-y-2">
            {quotes.map((q: any) => {
              const images = (q.product?.images ?? []) as { storage_path: string; thumb_path?: string | null; is_primary: boolean }[];
              const primary = images.find((i) => i.is_primary) ?? images[0];
              const imgUrl = getThumbUrl(primary);
              return (
                <Link key={q.id} to={q.product?.id ? `/products/${q.product.id}` : "#"}>
                  <Card className="p-3 hover:bg-muted/40 transition-colors">
                    <div className="flex gap-3">
                      <div className="size-16 rounded-lg bg-gold-soft overflow-hidden shrink-0">
                        {imgUrl ? (
                          <img src={imgUrl} alt={q.product?.name ?? ""} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                            <Tag className="size-5 opacity-40" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold truncate">{q.product?.name ?? "قطعة محذوفة"}</h3>
                            {q.customer_name && (
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">{q.customer_name}{q.customer_phone ? ` · ${q.customer_phone}` : ""}</p>
                            )}
                          </div>
                          <span className="text-lg font-extrabold text-primary shrink-0">{formatCurrency(q.price)}</span>
                        </div>
                        {q.notes && <p className="text-sm mt-1 line-clamp-2">{q.notes}</p>}
                        <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground pt-1.5 mt-1.5 border-t border-border">
                          {q.branch?.name && <span className="flex items-center gap-1"><MapPin className="size-3" />{q.branch.name}</span>}
                          <span className="ms-auto">{q.staff?.full_name} · {formatDate(q.created_at)}</span>
                        </div>
                      </div>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Tag className="size-10 mx-auto mb-2 opacity-30" />
            <p>لا توجد أسعار معروضة بعد.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition ${
      active ? "bg-primary text-primary-foreground shadow-gold" : "bg-secondary text-secondary-foreground"
    }`}>{children}</button>
  );
}

function NewInquiryForm({ defaultBranch, branches, userId, onDone }: {
  defaultBranch: string; branches: { id: string; name: string }[]; userId?: string; onDone: () => void;
}) {
  const [form, setForm] = useState({
    customer_name: "", customer_phone: "", description: "",
    budget: "", desired_karat: "", desired_size: "", branch_id: defaultBranch,
  });
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);
    setSaving(true);
    const { error } = await supabase.from("customer_inquiries").insert({
      customer_name: form.customer_name.trim() || null,
      customer_phone: form.customer_phone.trim() || null,
      description: form.description.trim(),
      budget: form.budget ? parseFloat(form.budget) : null,
      desired_karat: form.desired_karat || null,
      desired_size: form.desired_size || null,
      branch_id: form.branch_id || null,
      created_by: userId,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("تم تسجيل الاستفسار");
    onDone();
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div><Label>اسم العميل</Label><Input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} maxLength={100} /></div>
        <div><Label>الهاتف</Label><Input value={form.customer_phone} onChange={(e) => setForm({ ...form, customer_phone: e.target.value })} maxLength={30} dir="ltr" /></div>
      </div>
      <div><Label>وصف القطعة المطلوبة *</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} maxLength={1000} required /></div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label>القيراط</Label>
          <Select value={form.desired_karat} onValueChange={(v) => setForm({ ...form, desired_karat: v })}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>{KARAT_OPTIONS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>المقاس</Label><Input value={form.desired_size} onChange={(e) => setForm({ ...form, desired_size: e.target.value })} maxLength={20} dir="ltr" /></div>
        <div><Label>الميزانية</Label><Input type="number" step="0.01" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} dir="ltr" /></div>
      </div>
      <div>
        <Label>الفرع</Label>
        <Select value={form.branch_id} onValueChange={(v) => setForm({ ...form, branch_id: v })}>
          <SelectTrigger><SelectValue placeholder="اختر..." /></SelectTrigger>
          <SelectContent>{branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <Button type="submit" disabled={saving} className="w-full bg-gold-gradient text-primary-foreground">
        {saving ? "جارٍ..." : "حفظ الاستفسار"}
      </Button>
    </form>
  );
}
