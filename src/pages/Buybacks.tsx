// شراء الذهب القديم (كسر) — يسجّل ما اشتراه المحل من زبون: العيار والوزن الصافي وسعر الجرام
// والمبلغ ووسيلة الدفع، ويحفظ سعر السوق لحظتها للمقارنة.
//
// النقد الخارج من الدرج يُخصم تلقائياً من المتوقّع في الإقفال اليومي (submit_daily_closing)،
// والمقايضة لا تحرّك مالاً فلا تدخل. المشرف يسجّل لفرعه فقط، والمدير العام لكل الفروع؛ الموظف
// العادي لا يشتري ذهباً. تعديل السجل ممنوع بعد الحفظ — يتغيّر «مصير» الكسر فقط (صُهر/بيع).
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useGoldPrices } from "@/hooks/useGoldPrices";
import { KARAT_OPTIONS, formatCurrency, formatDate, formatWeight, normalizeDecimalInput } from "@/lib/constants";
import { useConfirm } from "@/components/ConfirmDialogProvider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Recycle } from "lucide-react";
import { toast } from "sonner";

const db = supabase as any;
const PAYOUT_METHODS = ["نقداً", "تحويل بنكي", "مقايضة ذهب"];
const DISPOSITION: Record<string, string> = { in_stock: "في الخزنة", melted: "صُهر", sold_to_refiner: "بيع لمصفّاة" };

interface Buyback {
  id: string;
  branch_id: string;
  customer_name: string;
  customer_phone: string | null;
  karat: string;
  gross_weight_grams: number;
  net_weight_grams: number;
  price_per_gram: number;
  total_paid: number;
  market_price_per_gram: number | null;
  payment_method: string;
  disposition: string;
  notes: string | null;
  created_at: string;
  branch?: { name: string } | null;
  buyer?: { full_name: string } | null;
}

const num = (v: string) => (v.trim() === "" ? null : Number(v));

export default function Buybacks() {
  const { user, roles, profile } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const isAdmin = roles.includes("admin");
  const { data: prices } = useGoldPrices();

  const [branchId, setBranchId] = useState<string>(profile?.branch_id ?? "");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [karat, setKarat] = useState<string>(KARAT_OPTIONS[0]);
  const [gross, setGross] = useState("");
  const [net, setNet] = useState("");
  const [perGram, setPerGram] = useState("");
  const [total, setTotal] = useState("");
  const [totalTouched, setTotalTouched] = useState(false);
  const [method, setMethod] = useState(PAYOUT_METHODS[0]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: branches = [] } = useQuery({
    queryKey: ["buyback-branches"],
    queryFn: async () => (await supabase.from("branches").select("id,name").order("name")).data ?? [],
  });
  const effectiveBranch = isAdmin ? branchId : (profile?.branch_id ?? "");

  const { data: list = [], isLoading } = useQuery({
    queryKey: ["gold-buybacks"],
    queryFn: async () => {
      const { data, error } = await db
        .from("gold_buybacks")
        .select("*, branch:branches(name), buyer:profiles!gold_buybacks_created_by_fkey(full_name)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as Buyback[];
    },
  });

  const market = prices?.get(karat)?.price_per_gram ?? null;
  const netN = num(net);
  const perGramN = num(perGram);
  const computedTotal = netN != null && perGramN != null && !isNaN(netN) && !isNaN(perGramN) ? Math.round(netN * perGramN * 100) / 100 : null;
  const shownTotal = totalTouched ? total : computedTotal != null ? String(computedTotal) : "";
  const spread = market && perGramN != null && !isNaN(perGramN) ? ((market - perGramN) / market) * 100 : null;

  // الكسر الموجود فعلاً في الخزنة (لم يُصهر ولم يُبع) بحسب العيار.
  const stock = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of list) if (b.disposition === "in_stock") m.set(b.karat, (m.get(b.karat) ?? 0) + Number(b.net_weight_grams));
    return m;
  }, [list]);

  const resolveCustomerId = async (): Promise<string | null> => {
    const p = phone.trim();
    if (p) {
      const { data: existing } = await supabase.from("customers").select("id").eq("phone", p).limit(1).maybeSingle();
      if (existing) return existing.id;
    }
    const { data: created } = await supabase
      .from("customers")
      .insert({ full_name: name.trim(), phone: p || null, branch_id: effectiveBranch, created_by: user?.id ?? null })
      .select("id")
      .single();
    return created?.id ?? null;
  };

  const submit = async () => {
    const g = num(gross), n = num(net), pg = num(perGram), t = num(shownTotal);
    if (!effectiveBranch) return toast.error(isAdmin ? "اختر الفرع" : "حسابك غير مرتبط بفرع");
    if (!name.trim()) return toast.error("اكتب اسم البائع");
    if (g == null || isNaN(g) || g <= 0) return toast.error("أدخل الوزن الإجمالي");
    if (n == null || isNaN(n) || n <= 0) return toast.error("أدخل الوزن الصافي");
    if (n > g) return toast.error("الوزن الصافي لا يزيد عن الإجمالي");
    if (pg == null || isNaN(pg) || pg < 0) return toast.error("أدخل سعر الجرام");
    if (t == null || isNaN(t) || t < 0) return toast.error("المبلغ المدفوع غير صحيح");

    const ok = await confirm({
      title: "تأكيد شراء الذهب؟",
      description: `${karat} · ${formatWeight(n)} صافي · ${formatCurrency(t)} (${method}). لا يمكن تعديل السجل بعد الحفظ.`,
      confirmLabel: "سجّل الشراء",
    });
    if (!ok) return;

    setBusy(true);
    const customerId = await resolveCustomerId();
    const { error } = await db.from("gold_buybacks").insert({
      branch_id: effectiveBranch,
      customer_id: customerId,
      customer_name: name.trim(),
      customer_phone: phone.trim() || null,
      id_number: idNumber.trim() || null,
      karat,
      gross_weight_grams: g,
      net_weight_grams: n,
      price_per_gram: pg,
      total_paid: t,
      market_price_per_gram: market,
      payment_method: method,
      notes: notes.trim() || null,
      created_by: user?.id ?? null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("تم تسجيل شراء الذهب");
    setName(""); setPhone(""); setIdNumber(""); setGross(""); setNet(""); setPerGram(""); setTotal(""); setTotalTouched(false); setNotes("");
    qc.invalidateQueries({ queryKey: ["gold-buybacks"] });
  };

  const setDisposition = async (b: Buyback, disposition: string) => {
    const ok = await confirm({
      title: `تسجيل الكسر: ${DISPOSITION[disposition]}؟`,
      description: `${b.karat} · ${formatWeight(b.net_weight_grams)} — اشتراه ${b.customer_name}.`,
      confirmLabel: "تأكيد",
    });
    if (!ok) return;
    const { error } = await db.rpc("set_buyback_disposition", { p_id: b.id, p_disposition: disposition });
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["gold-buybacks"] });
  };

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <header className="flex items-center gap-3">
        <div className="size-10 rounded-xl bg-gold-gradient flex items-center justify-center shadow-gold">
          <Recycle className="size-5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-xl font-extrabold text-gold-gradient">شراء الذهب القديم (كسر)</h1>
          <p className="text-xs text-muted-foreground">النقد المدفوع يُخصم تلقائياً من المتوقّع في إقفال اليوم.</p>
        </div>
      </header>

      {stock.size > 0 && (
        <Card className="p-3">
          <p className="text-xs text-muted-foreground mb-1">كسر في الخزنة (لم يُصهر ولم يُبع)</p>
          <div className="flex gap-4 flex-wrap">
            {[...stock.entries()].map(([k, w]) => (
              <span key={k} className="font-bold">{k}: {formatWeight(w)}</span>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-4 space-y-3">
        <h2 className="font-bold">تسجيل شراء جديد</h2>
        {isAdmin && (
          <div>
            <Label className="text-xs">الفرع</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger><SelectValue placeholder="اختر الفرع" /></SelectTrigger>
              <SelectContent>{branches.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">اسم البائع *</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label className="text-xs">الهاتف</Label><Input dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <div className="col-span-2"><Label className="text-xs">رقم الهوية (يحمي المحل عند أي نزاع)</Label><Input dir="ltr" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} /></div>
        </div>
        <div>
          <Label className="text-xs">العيار</Label>
          <div className="flex gap-2 mt-1">
            {KARAT_OPTIONS.map((k) => (
              <Button key={k} type="button" size="sm" variant={karat === k ? "default" : "secondary"} onClick={() => setKarat(k)}>{k}</Button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">الوزن الإجمالي (غ) *</Label><Input dir="ltr" inputMode="decimal" value={gross} onChange={(e) => setGross(normalizeDecimalInput(e.target.value))} /></div>
          <div><Label className="text-xs">الوزن الصافي (غ) * <span className="text-muted-foreground">بعد خصم الأحجار</span></Label><Input dir="ltr" inputMode="decimal" value={net} onChange={(e) => setNet(normalizeDecimalInput(e.target.value))} /></div>
          <div>
            <Label className="text-xs">سعر شراء الجرام *</Label>
            <Input dir="ltr" inputMode="decimal" value={perGram} onChange={(e) => setPerGram(normalizeDecimalInput(e.target.value))} />
            {market != null && (
              <p className="text-[11px] text-muted-foreground mt-1">
                سعر السوق اليوم {formatCurrency(market)}
                {spread != null && ` · ${spread >= 0 ? `أقل بـ${spread.toFixed(1)}%` : `أعلى بـ${(-spread).toFixed(1)}%`}`}
              </p>
            )}
          </div>
          <div>
            <Label className="text-xs">المبلغ المدفوع *</Label>
            <Input dir="ltr" inputMode="decimal" value={shownTotal} onChange={(e) => { setTotalTouched(true); setTotal(normalizeDecimalInput(e.target.value)); }} />
            <p className="text-[11px] text-muted-foreground mt-1">يُحسب من الصافي × السعر، وتقدر تعدّله (تقريب/تفاوض).</p>
          </div>
        </div>
        <div>
          <Label className="text-xs">وسيلة الدفع للبائع</Label>
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{PAYOUT_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
          </Select>
          {method === "مقايضة ذهب" && <p className="text-[11px] text-muted-foreground mt-1">مقايضة: لا يخرج مال من الدرج، فلا يُخصم في الإقفال.</p>}
        </div>
        <div><Label className="text-xs">ملاحظات</Label><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="وصف القطع، شوائب…" /></div>
        <Button className="w-full" disabled={busy} onClick={submit}>{busy ? "جارٍ الحفظ…" : "سجّل الشراء"}</Button>
      </Card>

      <section className="space-y-2">
        <h2 className="font-bold">آخر المشتريات</h2>
        {isLoading ? (
          <Card className="p-4 text-center text-sm text-muted-foreground">جارٍ التحميل…</Card>
        ) : list.length === 0 ? (
          <Card className="p-4 text-center text-sm text-muted-foreground">لا مشتريات بعد</Card>
        ) : (
          list.map((b) => (
            <Card key={b.id} className="p-3 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold">{b.karat} · {formatWeight(b.net_weight_grams)} <span className="text-xs font-normal text-muted-foreground">(إجمالي {formatWeight(b.gross_weight_grams)})</span></p>
                  <p className="text-xs text-muted-foreground truncate">{b.customer_name}{b.customer_phone ? ` · ${b.customer_phone}` : ""}{isAdmin && b.branch?.name ? ` · ${b.branch.name}` : ""}</p>
                </div>
                <Badge variant="outline" className="shrink-0">{DISPOSITION[b.disposition]}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {formatCurrency(b.total_paid)} ({b.payment_method}) · {formatCurrency(b.price_per_gram)}/غ
                {b.market_price_per_gram ? ` · السوق ${formatCurrency(b.market_price_per_gram)}` : ""} · {formatDate(b.created_at)}
                {b.buyer?.full_name ? ` · ${b.buyer.full_name}` : ""}
              </p>
              {b.disposition === "in_stock" && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setDisposition(b, "melted")}>صُهر</Button>
                  <Button size="sm" variant="outline" onClick={() => setDisposition(b, "sold_to_refiner")}>بيع لمصفّاة</Button>
                </div>
              )}
            </Card>
          ))
        )}
      </section>
    </div>
  );
}
