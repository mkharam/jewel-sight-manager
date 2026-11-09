// صفحة العملاء: بحث/إضافة عميل، وتاريخ شراء/حجز/طلبات كل عميل في مكان واحد. الربط
// الفعلي بالمبيعات يتم عبر customer_id (راجع SellDialog/ReserveDialog — resolveCustomerId)
// بدل الاكتفاء بالاسم كنص حر كما كان سابقاً. المدير العام يشوف القائمة المرتّبة (آخر زيارة، سعر القرام، البطاقة).
import { useMemo, useState } from "react";
import { usePersistentState } from "@/lib/resume";
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
import { Users, Search, UserPlus, Phone, Receipt, Bookmark, Heart, Package, Loader2, type LucideIcon } from "lucide-react";
import { formatCurrency, formatDate, normalizeDecimalInput } from "@/lib/constants";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { sb, formatLD } from "@/lib/amarsoft";
import CustomerDashboard from "@/components/amarsoft/CustomerDashboard";
import CustomerBook from "@/components/customers/CustomerBook";
import CustomerProfile from "@/components/customers/CustomerProfile";
import { sinceText, tripoliDate } from "@/lib/customers";

type Customer = { id: string; full_name: string; phone: string | null; notes: string | null; branch_id: string | null; created_at: string };

export default function Customers() {
  const { user, roles } = useAuth();
  const isAdmin = roles.includes("admin");
  const qc = useQueryClient();
  const [view, setView] = useState<"book" | "dashboard">("book");
  const [q, setQ] = useState("");
  const [openNew, setOpenNew] = usePersistentState(`customer:new:openNew`, false);
  const [activeCustomer, setActiveCustomer] = useState<Customer | null>(null);

  const [name, setName, clearName] = usePersistentState(`customer:new:name`, "");
  const [phone, setPhone, clearPhone] = usePersistentState(`customer:new:phone`, "");
  const [notes, setNotes, clearNotes] = usePersistentState(`customer:new:notes`, "");
  // المسودّة تنجو من إغلاق الآيفون للتطبيق في الخلفية؛ تُمسح بعد الحفظ أو الإلغاء.
  const clearDraft = () => { clearName(); clearPhone(); clearNotes(); };

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

  const resetForm = () => clearDraft();

  const openById = async (id: string) => {
    const { data } = await supabase.from("customers").select("*").eq("id", id).maybeSingle();
    if (data) setActiveCustomer(data as Customer);
  };

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
    qc.invalidateQueries({ queryKey: ["customers-overview"] });
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

      {isAdmin && (
        <div className="grid grid-cols-2 gap-1.5">
          <Button size="lg" variant={view === "book" ? "default" : "outline"} onClick={() => setView("book")} className="text-base">العملاء</Button>
          <Button size="lg" variant={view === "dashboard" ? "default" : "outline"} onClick={() => setView("dashboard")} className="text-base">اللوحة</Button>
        </div>
      )}

      {isAdmin ? (view === "dashboard" ? <CustomerDashboard onOpen={openById} /> : (
        <CustomerBook onOpen={(r) => setActiveCustomer({ id: r.customer_id, full_name: r.full_name, phone: r.phone, notes: r.notes, branch_id: null, created_at: "" })} />
      )) : (<>
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
      </>)}

      <CustomerDetailSheet customer={activeCustomer} onClose={() => setActiveCustomer(null)} />
    </div>
  );
}

function CustomerDetailSheet({ customer, onClose }: { customer: Customer | null; onClose: () => void }) {
  const { user, roles } = useAuth();
  const isAdmin = roles.includes("admin");
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
                  {isAdmin && <CustomerProfile customerId={customer.id} />}
                  <AmarsoftSection customerId={customer.id} />

                  {totalSpent > 0 && (
                    <Card className="p-3 flex items-center justify-between bg-gold-soft border-primary/20">
                      <span className="text-sm font-semibold flex items-center gap-1.5"><Receipt className="size-4 text-primary" /> مشتريات مسجّلة في التطبيق</span>
                      <span className="font-bold text-primary">{formatCurrency(totalSpent)}</span>
                    </Card>
                  )}

                  <Section title="سجل الشراء في التطبيق" icon={Receipt} empty="لا توجد مبيعات بعد">
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

type AmarsoftLink = {
  branch_code: string; guest_code: string;
  data: {
    phones?: string[]; city?: string; area?: string; address?: string; dob?: string | null; gender?: string;
    last_sale_no?: string; last_sale_on?: string | null; total_sales_dirhams?: number;
  };
};
type AmarsoftItem = { desc?: string; grams?: number; code?: string; tag?: string; pcs?: number; purity?: number };
type AmarsoftInvoice = {
  id: number; branch_code: string; invoice_no: string; invoice_date: string; kind: string; net_dirhams: number;
  items: AmarsoftItem[] | null;
  price18?: number | null; price21?: number | null; salesman?: string | null; sent_to_card?: boolean;
};

const karatOf = (p?: number) => (!p ? null : p >= 0.99 ? "24" : p >= 0.91 ? "22" : p >= 0.86 ? "21" : p >= 0.74 ? "18" : null);
const daysBetween = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
const gramsOf = (inv: AmarsoftInvoice) => (inv.items ?? []).reduce((s, i) => s + Number(i.grams ?? 0), 0);

// ملف الزبون من أمارسوفت: كم مرة جا، شن يحب، وهل مشترياته تكبر ولا تصغر، وفواتيره.
// المدير العام ياخذ كل فواتيره (برقم هاتفه على الفاتورة ولا برمزه) من customer_invoices، مع سعر القرام وهل وصلت لبطاقته.
// غيره: برمز الزبون بس — الرمز خاص بكل فرع، فالزبون اللي زار أكثر من فرع عنده رمز في كل واحد — نجمعهم.
function AmarsoftSection({ customerId }: { customerId: string }) {
  const [shown, setShown] = useState(10);
  const { data } = useQuery({
    queryKey: ["customer-amarsoft", customerId],
    queryFn: async () => {
      const [{ data: links }, { data: map }, { data: own }] = await Promise.all([
        sb.from("amarsoft_customer_links").select("branch_code, guest_code, data").eq("customer_id", customerId),
        sb.from("amarsoft_branch_map").select("code, branches(name)"),
        sb.rpc("customer_invoices", { p_customer: customerId }),
      ]);
      const list = (links ?? []) as AmarsoftLink[];
      const names = new Map<string, string>(((map ?? []) as { code: string; branches: { name: string } | null }[]).map((m) => [m.code, m.branches?.name ?? m.code]));
      const types = new Map<string, string>();
      let invs: AmarsoftInvoice[] = ((own ?? []) as (AmarsoftInvoice & { sold_at: string })[]).map((i) => ({ ...i, invoice_date: tripoliDate(i.sold_at) }));
      if (!invs.length && list.length) {
        const or = list.map((l) => `and(branch_code.eq.${l.branch_code},details->>guest_code.eq.${l.guest_code})`).join(",");
        const { data: invoices } = await sb.from("amarsoft_invoices").select("id, branch_code, invoice_no, invoice_date, kind, net_dirhams, items")
          .eq("is_deleted", false).or(or).order("sold_at", { ascending: false }).limit(500);
        invs = (invoices ?? []) as AmarsoftInvoice[];
      }
      // نوع كل قطعة (خاتم، طقم...) من مخزون أمارسوفت برقم التاق.
      const tags = [...new Set(invs.flatMap((i) => (i.items ?? []).map((it) => it.tag).filter((t): t is string => !!t && /^\d+$/.test(t))))];
      if (tags.length) {
        const { data: stock } = await sb.from("amarsoft_stock").select("tag, type").in("tag", tags.slice(0, 500));
        for (const s of (stock ?? []) as { tag: string; type: string | null }[]) if (s.type) types.set(s.tag, s.type);
      }
      return { links: list, invoices: invs, names, types };
    },
  });

  const v = useMemo(() => {
    if (!data?.invoices.length) return null;
    const sales = data.invoices.filter((i) => i.kind !== "return" && Number(i.net_dirhams) > 0);
    const oldest = [...sales].reverse();
    const days = [...new Set(oldest.map((i) => i.invoice_date))];
    const total = sales.reduce((s, i) => s + Number(i.net_dirhams), 0);
    const grams = sales.reduce((s, i) => s + gramsOf(i), 0);
    const gaps = days.slice(1).map((d, i) => daysBetween(days[i], d));
    // شن يحب: الأنواع والعيار من القطع اللي شراها.
    const typeCount = new Map<string, number>();
    const karatGrams = new Map<string, number>();
    for (const inv of sales) for (const it of inv.items ?? []) {
      const t = (it.tag && data.types.get(it.tag)) || (it.desc && !it.desc.startsWith("ذهب") ? it.desc : null);
      if (t) typeCount.set(t, (typeCount.get(t) ?? 0) + 1);
      const k = karatOf(it.purity);
      if (k) karatGrams.set(k, (karatGrams.get(k) ?? 0) + Number(it.grams ?? 0));
    }
    const likes = [...typeCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const karats = [...karatGrams.entries()].sort((a, b) => b[1] - a[1]);
    const karatTotal = karats.reduce((s, [, g]) => s + g, 0);
    const sortedGrams = sales.map(gramsOf).sort((a, b) => a - b);
    const typicalGrams = sortedGrams[Math.floor(sortedGrams.length / 2)] ?? 0;
    // تكبر ولا تصغر: نقارن متوسط آخر نص الفواتير بأول نص.
    let trend: number | null = null;
    if (oldest.length >= 2) {
      const half = Math.floor(oldest.length / 2);
      const avgOf = (xs: AmarsoftInvoice[]) => xs.reduce((s, i) => s + Number(i.net_dirhams), 0) / xs.length;
      const before = avgOf(oldest.slice(0, half)), after = avgOf(oldest.slice(oldest.length - half));
      trend = before ? Math.round(((after - before) / before) * 100) : null;
    }
    const chart = oldest.map((i) => ({ date: i.invoice_date.slice(2).replace(/-/g, "/"), value: Number(i.net_dirhams) / 1000 }));
    const byBranch = [...sales.reduce((m, inv) => {
      const b = m.get(inv.branch_code) ?? { code: inv.branch_code, invoices: 0, sales: 0, last: inv.invoice_date };
      b.invoices += 1; b.sales += Number(inv.net_dirhams);
      if (inv.invoice_date > b.last) b.last = inv.invoice_date;
      return m.set(inv.branch_code, b);
    }, new Map<string, { code: string; invoices: number; sales: number; last: string }>()).values()].sort((a, b) => b.sales - a.sales);
    return {
      visits: days.length, invoices: sales.length, total, grams, avgTicket: sales.length ? total / sales.length : 0,
      first: days[0], last: days[days.length - 1], everyDays: gaps.length ? Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length) : null,
      likes, karats, karatTotal, typicalGrams, trend, chart, byBranch,
    };
  }, [data]);

  if (!data || (!data.links.length && !data.invoices.length)) return null;
  const branchName = (c: string) => data.names.get(c) ?? `فرع ${c}`;
  const phones = [...new Set(data.links.flatMap((l) => l.data.phones ?? []))];
  const info = data.links[0]?.data ?? {};
  const sinceLast = v ? daysBetween(v.last, new Date().toISOString().slice(0, 10)) : null;

  return (
    <div className="space-y-3">
      {v && (
        <>
          {/* الخلاصة */}
          <div className="grid grid-cols-3 gap-1.5 text-center">
            <Card className="p-2"><div className="text-[11px] text-muted-foreground">جا</div><div className="text-xl font-bold">{v.visits}</div><div className="text-[11px] text-muted-foreground">مرة</div></Card>
            <Card className="p-2"><div className="text-[11px] text-muted-foreground">شرى بـ</div><div className="text-base font-bold text-primary">{formatLD(v.total)}</div><div className="text-[11px] text-muted-foreground">{v.invoices} فاتورة</div></Card>
            <Card className="p-2"><div className="text-[11px] text-muted-foreground">الفاتورة عادة</div><div className="text-base font-bold">{formatLD(v.avgTicket)}</div><div className="text-[11px] text-muted-foreground">{v.grams.toFixed(1)} جم الكل</div></Card>
          </div>
          <Card className="p-3 space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">آخر مرة جا</span><span className={sinceLast! > 120 ? "text-destructive font-bold" : ""}>{sinceText(sinceLast!)} ({v.last})</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">أول مرة</span><span>{v.first}</span></div>
            {v.everyDays != null && <div className="flex justify-between"><span className="text-muted-foreground">يرجع عادة كل</span><span>{v.everyDays} يوم</span></div>}
            {v.trend != null && (
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">مشترياته</span>
                <span className={`font-bold ${v.trend > 10 ? "text-status-available" : v.trend < -10 ? "text-destructive" : ""}`}>
                  {v.trend > 10 ? `تكبر ↑ ${v.trend}%` : v.trend < -10 ? `تصغر ↓ ${Math.abs(v.trend)}%` : "ثابتة تقريباً"}
                </span>
              </div>
            )}
            {v.trend != null && <p className="text-[11px] text-muted-foreground">نقارن متوسط فواتيره الأخيرة بفواتيره الأولى.</p>}
          </Card>

          {/* شن يحب */}
          <Card className="p-3 space-y-2">
            <h3 className="text-sm font-bold flex items-center gap-1.5"><Heart className="size-4 text-primary" /> شن يحب</h3>
            {v.likes.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {v.likes.map(([t, n]) => <Badge key={t} variant="secondary" className="text-sm">{t}{n > 1 ? ` ×${n}` : ""}</Badge>)}
              </div>
            ) : <p className="text-xs text-muted-foreground">نوع القطع مش مسجّل في فواتيره.</p>}
            {v.karatTotal > 0 && (
              <div className="space-y-1">
                <div className="flex h-3 rounded-full overflow-hidden bg-muted">
                  {v.karats.map(([k, g], i) => <div key={k} style={{ width: `${(g / v.karatTotal) * 100}%` }} className={i === 0 ? "bg-primary" : "bg-primary/40"} />)}
                </div>
                <p className="text-xs text-muted-foreground">{v.karats.map(([k, g]) => `عيار ${k}: ${Math.round((g / v.karatTotal) * 100)}%`).join(" · ")}</p>
              </div>
            )}
            {v.typicalGrams > 0 && <p className="text-xs text-muted-foreground">يشري عادة قطع وزنها حوالي <b className="text-foreground">{v.typicalGrams.toFixed(1)} جم</b> في الفاتورة.</p>}
          </Card>

          {/* المشتريات مع الوقت */}
          {v.chart.length > 1 && (
            <Card className="p-3">
              <h3 className="text-sm font-bold mb-1">كل فاتورة بقداش (بالألف د.ل)</h3>
              <div className="h-36" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={v.chart} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(x) => `${Math.round(x / 1000)}`} />
                    <Tooltip formatter={(x: number) => formatLD(x * 1000)} labelFormatter={(l) => String(l)} />
                    <Bar dataKey="value" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          {v.byBranch.length > 0 && (
            <Card className="p-3">
              <p className="text-sm font-bold mb-1">{v.byBranch.length > 1 ? `زار ${v.byBranch.length} فروع` : "يشري من فرع واحد"}</p>
              {v.byBranch.map((b) => (
                <Link key={b.code} to={`/branches/${b.code}`} className="flex justify-between text-sm py-0.5">
                  <span>{branchName(b.code)}</span>
                  <span className="text-muted-foreground">{b.invoices} فاتورة · <b className="text-foreground">{formatLD(b.sales)}</b></span>
                </Link>
              ))}
            </Card>
          )}
        </>
      )}

      {data.links.length > 0 && <Section title="بياناته في أمارسوفت" icon={Package} empty="">
        <div className="space-y-1 text-sm py-1">
          {phones.length > 1 && <div className="flex justify-between"><span className="text-muted-foreground">الهواتف</span><span dir="ltr">{phones.join(" · ")}</span></div>}
          {(info.city || info.area || info.address) && (
            <div className="flex justify-between"><span className="text-muted-foreground">العنوان</span><span>{[info.city, info.area, info.address].filter(Boolean).join("، ")}</span></div>
          )}
          {info.dob && <div className="flex justify-between"><span className="text-muted-foreground">تاريخ الميلاد</span><span>{info.dob}</span></div>}
          <div className="text-[11px] text-muted-foreground">رمز الزبون: {data.links.map((l) => `${l.guest_code} (${branchName(l.branch_code)})`).join("، ")}</div>
        </div>
      </Section>}

      {data.invoices.length > 0 && (
        <Section title={`فواتيره (${data.invoices.length})`} icon={Receipt} empty="">
          {data.invoices.slice(0, shown).map((inv) => (
            <Link key={inv.id} to={`/pos-sales?q=${encodeURIComponent(inv.invoice_no)}&branch=${inv.branch_code}`}
              className="flex items-center justify-between gap-2 py-2 border-b border-border last:border-0 hover:bg-muted/30 rounded px-1">
              <div className="min-w-0">
                <p className="text-sm font-medium">{inv.invoice_date} · {branchName(inv.branch_code)}{inv.kind === "return" ? " · مرتجع" : ""}</p>
                {!!inv.items?.length && (
                  <p className="text-[11px] text-muted-foreground truncate">
                    {inv.items.map((i) => `${(i.tag && data.types.get(i.tag)) || i.desc || i.code || "قطعة"}${i.grams ? ` ${Number(i.grams)}جم` : ""}`).join(" · ")}
                  </p>
                )}
                {(inv.price18 || inv.price21 || inv.salesman || inv.sent_to_card) && (
                  <p className="text-[11px] text-muted-foreground">
                    {[inv.price18 && `قرام 18 بـ ${inv.price18.toLocaleString("en-US")}`, inv.price21 && `قرام 21 بـ ${inv.price21.toLocaleString("en-US")}`,
                      inv.salesman && `البائع ${inv.salesman}`].filter(Boolean).join(" · ")}
                    {inv.sent_to_card && <span className="text-status-available"> ✓ على البطاقة</span>}
                  </p>
                )}
              </div>
              <span className={`text-sm font-bold shrink-0 ${inv.net_dirhams < 0 ? "text-destructive" : "text-primary"}`}>{formatLD(inv.net_dirhams)}</span>
            </Link>
          ))}
          {data.invoices.length > shown && (
            <Button variant="ghost" className="w-full text-primary" onClick={() => setShown(shown + 20)}>عرض المزيد ({data.invoices.length - shown} باقي)</Button>
          )}
        </Section>
      )}
    </div>
  );
}

function Section({ title, icon: Icon, empty, children }: { title: string; icon: LucideIcon; empty: string; children: React.ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div>
      <h3 className="text-sm font-bold flex items-center gap-1.5 mb-1"><Icon className="size-4 text-primary" /> {title}</h3>
      {hasChildren ? <div>{children}</div> : <p className="text-xs text-muted-foreground py-2">{empty}</p>}
    </div>
  );
}
