import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tag, AlertTriangle, Clock } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/constants";
import { toast } from "sonner";

interface Props {
  productId: string;
  productName?: string;
  branchId: string | null;
  trigger?: React.ReactNode;
  fullWidthButton?: boolean;
}

// عملاء متكررون — يُخزَّنون محلياً لتجنب إعادة الكتابة
const RECENT_CUSTOMERS_KEY = "lamaa.recentCustomers.v1";
type RecentCustomer = { name: string; phone: string };
function loadRecentCustomers(): RecentCustomer[] {
  try { return JSON.parse(localStorage.getItem(RECENT_CUSTOMERS_KEY) ?? "[]"); } catch { return []; }
}
function pushRecentCustomer(c: RecentCustomer) {
  if (!c.name && !c.phone) return;
  const list = loadRecentCustomers();
  const key = (x: RecentCustomer) => `${x.phone || ""}|${x.name || ""}`.toLowerCase();
  const k = key(c);
  const next = [c, ...list.filter((x) => key(x) !== k)].slice(0, 50);
  try { localStorage.setItem(RECENT_CUSTOMERS_KEY, JSON.stringify(next)); } catch {}
}

export default function QuickQuoteSheet({ productId, productName, branchId, trigger, fullWidthButton }: Props) {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const recentCustomers = useMemo(() => (open ? loadRecentCustomers() : []), [open]);

  const myBranchId = profile?.branch_id ?? branchId ?? null;

  // Last 3 quotes for this product — shown to prevent price drift between branches
  const { data: recent } = useQuery({
    queryKey: ["recent-quotes", productId],
    queryFn: async () => {
      const { data } = await supabase
        .from("product_quotes")
        .select("price, customer_name, created_at, branch:branches(name)")
        .eq("product_id", productId)
        .order("created_at", { ascending: false })
        .limit(3);
      return data ?? [];
    },
    enabled: open,
  });

  const lastPrice = recent?.[0]?.price ? Number(recent[0].price) : null;
  const newPrice = parseFloat(price);
  const variance =
    lastPrice && !isNaN(newPrice) && newPrice > 0
      ? ((newPrice - lastPrice) / lastPrice) * 100
      : null;
  const showVarianceWarning = variance !== null && Math.abs(variance) >= 10;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = parseFloat(price);
    if (isNaN(p) || p <= 0) return toast.error("أدخل سعراً صحيحاً");
    setSaving(true);
    const { error } = await supabase.from("product_quotes").insert({
      product_id: productId,
      price: p,
      customer_name: name.trim() || null,
      customer_phone: phone.trim() || null,
      notes: notes.trim() || null,
      branch_id: myBranchId,
      quoted_by: user?.id,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    await supabase.from("activity_log").insert({
      actor_id: user?.id,
      action: "quote",
      entity_type: "product",
      entity_id: productId,
      details: { price: p, customer: name },
    });
    pushRecentCustomer({ name: name.trim(), phone: phone.trim() });
    toast.success("تم تسجيل السعر");
    setPrice(""); setName(""); setPhone(""); setNotes("");
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["quotes", productId] });
    qc.invalidateQueries({ queryKey: ["recent-quotes", productId] });
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {trigger ?? (
          <Button
            size={fullWidthButton ? "lg" : "sm"}
            className={`bg-gold-gradient text-primary-foreground shadow-gold ${fullWidthButton ? "w-full" : ""}`}
          >
            <Tag className="size-4 ml-1" /> تسجيل سعر
          </Button>
        )}
      </SheetTrigger>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[92vh] overflow-y-auto">
        <SheetHeader className="text-right">
          <SheetTitle>تسجيل سعر معروض على عميل</SheetTitle>
          <SheetDescription>
            {productName ? <span className="font-semibold text-foreground">{productName}</span> : "سجّل السعر لمنع تخبط الأسعار بين الفروع."}
          </SheetDescription>
        </SheetHeader>

        {/* آخر أسعار */}
        {recent && recent.length > 0 && (
          <div className="mt-4 rounded-xl border border-border bg-muted/40 p-3 space-y-1.5">
            <p className="text-xs font-semibold flex items-center gap-1 text-muted-foreground">
              <Clock className="size-3.5" /> آخر {recent.length} عرض
            </p>
            {recent.map((q: any, i: number) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="font-bold text-primary">{formatCurrency(q.price)}</span>
                <span className="text-muted-foreground">
                  {q.customer_name ?? "—"} · {q.branch?.name ?? "—"} · {formatDate(q.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={submit} className="space-y-3 mt-4">
          <div>
            <Label>السعر المعروض *</Label>
            <Input
              type="number"
              step="0.01"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
              autoFocus
              className="text-lg h-12 font-bold"
            />
            {showVarianceWarning && (
              <div className="mt-2 flex items-start gap-2 rounded-lg bg-warning/15 border border-warning/30 p-2 text-xs">
                <AlertTriangle className="size-4 shrink-0 text-warning-foreground mt-0.5" />
                <span>
                  السعر يختلف بنسبة {variance!.toFixed(0)}% عن آخر عرض ({formatCurrency(lastPrice!)}). تأكّد قبل إعطائه للعميل.
                </span>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>اسم العميل</Label>
              <Input
                value={name}
                onChange={(e) => {
                  const v = e.target.value;
                  setName(v);
                  // ملء الهاتف تلقائياً إن كان الاسم متطابقاً مع عميل سابق
                  if (!phone) {
                    const hit = recentCustomers.find((c) => c.name && c.name === v);
                    if (hit?.phone) setPhone(hit.phone);
                  }
                }}
                maxLength={100}
                list="lamaa-recent-customer-names"
                autoComplete="off"
              />
            </div>
            <div>
              <Label>الهاتف</Label>
              <Input
                value={phone}
                onChange={(e) => {
                  const v = e.target.value;
                  setPhone(v);
                  if (!name) {
                    const hit = recentCustomers.find((c) => c.phone && c.phone === v);
                    if (hit?.name) setName(hit.name);
                  }
                }}
                maxLength={30}
                dir="ltr"
                inputMode="tel"
                list="lamaa-recent-customer-phones"
                autoComplete="off"
              />
            </div>
            <datalist id="lamaa-recent-customer-names">
              {recentCustomers.filter((c) => c.name).slice(0, 30).map((c, i) => (
                <option key={`n-${i}`} value={c.name}>{c.phone}</option>
              ))}
            </datalist>
            <datalist id="lamaa-recent-customer-phones">
              {recentCustomers.filter((c) => c.phone).slice(0, 30).map((c, i) => (
                <option key={`p-${i}`} value={c.phone}>{c.name}</option>
              ))}
            </datalist>
          </div>
          <div>
            <Label>ملاحظات</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={2} />
          </div>
          <Button type="submit" disabled={saving} className="w-full h-12 bg-gold-gradient text-primary-foreground" size="lg">
            {saving ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
