// صفحة العملاء: بحث/إضافة عميل، وتاريخ شراء/حجز/طلبات كل عميل في مكان واحد. الربط
// الفعلي بالمبيعات يتم عبر customer_id (راجع SellDialog/ReserveDialog — resolveCustomerId)
// بدل الاكتفاء بالاسم كنص حر كما كان سابقاً.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Users, Search, UserPlus, Phone, Receipt, Bookmark, Heart, Package, Loader2 } from "lucide-react";
import { formatCurrency, formatDate, normalizeDecimalInput } from "@/lib/constants";
import { toast } from "sonner";
import { Link } from "react-router-dom";

type Customer = { id: string; full_name: string; phone: string | null; notes: string | null; branch_id: string | null; created_at: string };

export default function Customers() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [openNew, setOpenNew] = useState(false);
  const [activeCustomer, setActiveCustomer] = useState<Customer | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  const { data: customers, isLoading } = useQuery({
    queryKey: ["customers", q],
    queryFn: async () => {
      let query = supabase.from("customers").select("*").order("created_at", { ascending: false }).limit(200);
      const term = q.trim();
      if (term) query = query.or(`full_name.ilike.%${term}%,phone.ilike.%${term}%`);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as Customer[];
    },
  });

  const resetForm = () => { setName(""); setPhone(""); setNotes(""); };

  const createCustomer = async () => {
    if (!name.trim()) return toast.error("اكتب اسم العميل");
    const { error } = await supabase.from("customers").insert({
      full_name: name.trim(),
      phone: phone.trim() || null,
      notes: notes.trim() || null,
      created_by: user?.id ?? null,
    });
    if (error) return toast.error(error.message);
    toast.success("تم إضافة العميل");
    setOpenNew(false);
    resetForm();
    qc.invalidateQueries({ queryKey: ["customers"] });
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Users className="size-5 text-primary" /> العملاء
        </h1>
        <Dialog open={openNew} onOpenChange={(o) => { setOpenNew(o); if (!o) resetForm(); }}>
          <DialogTrigger asChild>
            <Button className="bg-gold-gradient text-primary-foreground shadow-gold">
              <UserPlus className="size-4 ml-1" /> عميل جديد
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>إضافة عميل</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>الاسم *</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>الهاتف</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" dir="ltr" /></div>
              <div className="space-y-1.5"><Label>ملاحظات</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpenNew(false)}>إلغاء</Button>
              <Button onClick={createCustomer} className="bg-gold-gradient text-primary-foreground">حفظ</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالاسم أو الهاتف" className="pr-9" />
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">جارٍ التحميل...</div>
      ) : !customers?.length ? (
        <Card className="p-10 text-center text-muted-foreground">
          {q ? "لا يوجد عميل مطابق" : "لا يوجد عملاء بعد — أضف أول عميل"}
        </Card>
      ) : (
        <div className="space-y-2">
          {customers.map((c) => (
            <Card
              key={c.id}
              className="p-3 flex items-center gap-3 cursor-pointer hover:bg-muted/40 transition-colors"
              onClick={() => setActiveCustomer(c)}
            >
              <div className="size-10 rounded-full bg-gold-soft flex items-center justify-center shrink-0 font-bold text-primary">
                {c.full_name.trim().charAt(0) || "?"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold truncate">{c.full_name}</p>
                {c.phone && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1" dir="ltr">
                    <Phone className="size-3" /> {c.phone}
                  </p>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <CustomerDetailSheet customer={activeCustomer} onClose={() => setActiveCustomer(null)} />
    </div>
  );
}

function CustomerDetailSheet({ customer, onClose }: { customer: Customer | null; onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [wanted, setWanted] = useState("");
  const [budget, setBudget] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["customer-detail", customer?.id],
    enabled: !!customer,
    queryFn: async () => {
      const [{ data: sales }, { data: reservations }, { data: wishlist }] = await Promise.all([
        supabase.from("sales").select("id,product_id,product_name_snapshot,final_price,sold_at,returned_at").eq("customer_id", customer!.id).order("sold_at", { ascending: false }),
        supabase.from("reservations").select("id,product_id,agreed_price,deposit,status,expires_at,created_at").eq("customer_id", customer!.id).order("created_at", { ascending: false }),
        supabase.from("wishlist_items").select("id,wanted_text,budget,is_fulfilled,created_at").eq("customer_id", customer!.id).order("created_at", { ascending: false }),
      ]);
      return { sales: sales ?? [], reservations: reservations ?? [], wishlist: wishlist ?? [] };
    },
  });

  const totalSpent = useMemo(
    () => (data?.sales ?? []).filter((s) => !s.returned_at).reduce((sum, s) => sum + Number(s.final_price || 0), 0),
    [data],
  );

  const addWishlistItem = async () => {
    if (!customer || !wanted.trim()) return toast.error("اكتب وصف القطعة المطلوبة");
    const { error } = await supabase.from("wishlist_items").insert({
      customer_id: customer.id,
      wanted_text: wanted.trim(),
      budget: budget ? Number(budget) : null,
      created_by: user?.id ?? null,
    });
    if (error) return toast.error(error.message);
    toast.success("تمت الإضافة لقائمة الرغبات");
    setWanted(""); setBudget("");
    qc.invalidateQueries({ queryKey: ["customer-detail", customer.id] });
  };

  return (
    <Sheet open={!!customer} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="left" className="w-full sm:max-w-md overflow-y-auto">
        {customer && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <div className="size-9 rounded-full bg-gold-soft flex items-center justify-center font-bold text-primary shrink-0">
                  {customer.full_name.trim().charAt(0) || "?"}
                </div>
                {customer.full_name}
              </SheetTitle>
            </SheetHeader>

            <div className="space-y-4 mt-4">
              {customer.phone && (
                <a href={`tel:${customer.phone}`} className="flex items-center gap-2 text-sm text-primary" dir="ltr">
                  <Phone className="size-4" /> {customer.phone}
                </a>
              )}
              {customer.notes && <p className="text-sm text-muted-foreground bg-muted/40 rounded-lg p-2">{customer.notes}</p>}

              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground flex items-center justify-center gap-2">
                  <Loader2 className="size-4 animate-spin" /> جارٍ التحميل...
                </div>
              ) : (
                <>
                  <Card className="p-3 flex items-center justify-between bg-gold-soft border-primary/20">
                    <span className="text-sm font-semibold flex items-center gap-1.5"><Receipt className="size-4 text-primary" /> إجمالي المشتريات</span>
                    <span className="font-bold text-primary">{formatCurrency(totalSpent)}</span>
                  </Card>

                  <Section title="سجل الشراء" icon={Receipt} empty="لا توجد مبيعات بعد">
                    {(data?.sales ?? []).map((s) => (
                      <Link key={s.id} to={s.product_id ? `/products/${s.product_id}` : "#"} className="flex items-center justify-between py-2 border-b border-border last:border-0 hover:bg-muted/30 rounded px-1">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{s.product_name_snapshot ?? "قطعة محذوفة"}</p>
                          <p className="text-[11px] text-muted-foreground">{formatDate(s.sold_at)}{s.returned_at ? " · مرتجع" : ""}</p>
                        </div>
                        <span className={`text-sm font-bold shrink-0 ${s.returned_at ? "text-muted-foreground line-through" : "text-primary"}`}>
                          {formatCurrency(s.final_price)}
                        </span>
                      </Link>
                    ))}
                  </Section>

                  <Section title="الحجوزات" icon={Bookmark} empty="لا توجد حجوزات">
                    {(data?.reservations ?? []).map((r) => (
                      <div key={r.id} className="flex items-center justify-between py-2 border-b border-border last:border-0 px-1">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">عربون {formatCurrency(r.deposit)}</p>
                          <p className="text-[11px] text-muted-foreground">ينتهي {formatDate(r.expires_at)}</p>
                        </div>
                        <Badge variant="secondary">{r.status}</Badge>
                      </div>
                    ))}
                  </Section>

                  <Section title="قائمة الرغبات" icon={Heart} empty="لا توجد طلبات">
                    {(data?.wishlist ?? []).map((w) => (
                      <div key={w.id} className="flex items-center justify-between py-2 border-b border-border last:border-0 px-1">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{w.wanted_text}</p>
                          <p className="text-[11px] text-muted-foreground">{formatDate(w.created_at)}{w.budget ? ` · ميزانية ${formatCurrency(w.budget)}` : ""}</p>
                        </div>
                        {w.is_fulfilled && <Badge className="bg-status-available text-white">تم التوفير</Badge>}
                      </div>
                    ))}
                    <div className="flex gap-2 mt-2">
                      <Input value={wanted} onChange={(e) => setWanted(e.target.value)} placeholder="وصف القطعة المطلوبة" className="flex-1" />
                      <Input value={budget} onChange={(e) => setBudget(normalizeDecimalInput(e.target.value))} placeholder="الميزانية" className="w-24" inputMode="decimal" />
                      <Button size="sm" onClick={addWishlistItem}>إضافة</Button>
                    </div>
                  </Section>
                </>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, icon: Icon, empty, children }: { title: string; icon: any; empty: string; children: React.ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div>
      <h3 className="text-sm font-bold flex items-center gap-1.5 mb-1"><Icon className="size-4 text-primary" /> {title}</h3>
      {hasChildren ? <div>{children}</div> : <p className="text-xs text-muted-foreground py-2">{empty}</p>}
    </div>
  );
}
