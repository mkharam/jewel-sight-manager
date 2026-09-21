// إقفال اليوم — المشرف يُدخل ما عدّه فعلاً (نقد/بطاقة/تحويل) فيُقارَن بما يُفترض أن يكون.
//
// العدّ أعمى: لا نُظهر المتوقّع قبل الإرسال حتى لا يطابق المُقفِل رقمه به. المتوقّع يُحسب في
// الخادم (submit_daily_closing) ويُخزَّن لقطةً. المدير العام يرى كل الفروع ويعيد فتح إقفال
// خاطئ؛ المشرف يقفل فرعه فقط. الجداول غير موجودة في types.ts المولّدة بعد، فنمرّر عبر any.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { businessToday } from "@/lib/dates";
import { formatCurrency, formatDate, normalizeDecimalInput } from "@/lib/constants";
import { useConfirm } from "@/components/ConfirmDialogProvider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Landmark, CheckCircle2, AlertTriangle, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

const db = supabase as any;

interface Closing {
  id: string;
  branch_id: string;
  closing_date: string;
  opening_cash: number;
  counted_cash: number;
  counted_card: number;
  counted_transfer: number;
  sales_count: number;
  cash_sales: number;
  card_sales: number;
  transfer_sales: number;
  installment_sales: number;
  tradein_sales: number;
  expenses_total: number;
  expected_cash: number;
  expected_card: number;
  expected_transfer: number;
  diff_cash: number;
  diff_card: number;
  diff_transfer: number;
  notes: string | null;
  created_at: string;
  branch?: { name: string } | null;
  closer?: { full_name: string } | null;
}

const num = (v: string) => (v.trim() === "" ? null : Number(v));
const hasDiff = (c: Closing) => [c.diff_cash, c.diff_card, c.diff_transfer].some((d) => Math.abs(Number(d)) > 0.004);

export default function DailyClosing() {
  const { roles, profile } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const isAdmin = roles.includes("admin");
  const myBranch = profile?.branch_id ?? null;

  const [branchId, setBranchId] = useState<string>(myBranch ?? "");
  const [date, setDate] = useState(businessToday());
  const [opening, setOpening] = useState("");
  const [cash, setCash] = useState("");
  const [card, setCard] = useState("");
  const [transfer, setTransfer] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [expCat, setExpCat] = useState("");
  const [expAmount, setExpAmount] = useState("");

  const { data: branches = [] } = useQuery({
    queryKey: ["closing-branches"],
    queryFn: async () => (await supabase.from("branches").select("id,name").order("name")).data ?? [],
  });
  const effectiveBranch = isAdmin ? branchId : (myBranch ?? "");

  const { data: closing, isLoading } = useQuery({
    queryKey: ["daily-closing", effectiveBranch, date],
    enabled: !!effectiveBranch,
    queryFn: async () => {
      const { data, error } = await db
        .from("daily_closings")
        .select("*, branch:branches(name), closer:profiles!daily_closings_closed_by_fkey(full_name)")
        .eq("branch_id", effectiveBranch)
        .eq("closing_date", date)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as Closing | null;
    },
  });

  const { data: expenses = [] } = useQuery({
    queryKey: ["closing-expenses", effectiveBranch, date],
    enabled: !!effectiveBranch,
    queryFn: async () => {
      const { data, error } = await db
        .from("expenses")
        .select("id, category, amount, note")
        .eq("branch_id", effectiveBranch)
        .eq("expense_date", date)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as { id: string; category: string; amount: number; note: string | null }[];
    },
  });

  const { data: history = [] } = useQuery({
    queryKey: ["daily-closings-history"],
    queryFn: async () => {
      const { data, error } = await db
        .from("daily_closings")
        .select("*, branch:branches(name), closer:profiles!daily_closings_closed_by_fkey(full_name)")
        .order("closing_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data ?? []) as Closing[];
    },
  });

  const expensesTotal = useMemo(() => expenses.reduce((s, e) => s + Number(e.amount), 0), [expenses]);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["daily-closing"] });
    qc.invalidateQueries({ queryKey: ["daily-closings-history"] });
    qc.invalidateQueries({ queryKey: ["closing-expenses"] });
    qc.invalidateQueries({ queryKey: ["daily-summary-closings"] });
  };

  const addExpense = async () => {
    const amount = num(expAmount);
    if (!expCat.trim()) return toast.error("اكتب بند المصروف");
    if (amount == null || isNaN(amount) || amount <= 0) return toast.error("أدخل مبلغاً صحيحاً");
    const { error } = await db.from("expenses").insert({
      branch_id: effectiveBranch, category: expCat.trim(), amount, expense_date: date,
    });
    if (error) return toast.error(error.message);
    setExpCat(""); setExpAmount("");
    refresh();
  };

  const removeExpense = async (id: string) => {
    const { error } = await db.from("expenses").delete().eq("id", id);
    if (error) return toast.error(error.message);
    refresh();
  };

  const submit = async () => {
    const counted = num(cash);
    if (counted == null || isNaN(counted)) return toast.error("أدخل النقد المعدود");
    const ok = await confirm({
      title: "تأكيد الإقفال؟",
      description: "بعد الإرسال لا يمكن تعديل الأرقام — يعيد المدير العام فتح الإقفال عند الخطأ.",
      confirmLabel: "أقفل اليوم",
    });
    if (!ok) return;
    setBusy(true);
    const { error } = await db.rpc("submit_daily_closing", {
      p_branch_id: effectiveBranch,
      p_date: date,
      p_opening_cash: num(opening) ?? 0,
      p_counted_cash: counted,
      p_counted_card: num(card) ?? 0,
      p_counted_transfer: num(transfer) ?? 0,
      p_notes: notes || null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("تم إقفال اليوم");
    setOpening(""); setCash(""); setCard(""); setTransfer(""); setNotes("");
    refresh();
  };

  const reopen = async (c: Closing) => {
    const ok = await confirm({
      title: "إعادة فتح الإقفال؟",
      description: `سيُحذف إقفال ${c.branch?.name ?? ""} بتاريخ ${c.closing_date} ليُعاد إدخاله.`,
      confirmLabel: "إعادة فتح",
      destructive: true,
    });
    if (!ok) return;
    const { error } = await db.from("daily_closings").delete().eq("id", c.id);
    if (error) return toast.error(error.message);
    refresh();
  };

  const canClose = !!effectiveBranch;

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <header className="flex items-center gap-3">
        <div className="size-10 rounded-xl bg-gold-gradient flex items-center justify-center shadow-gold">
          <Landmark className="size-5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-xl font-extrabold text-gold-gradient">إقفال اليوم</h1>
          <p className="text-xs text-muted-foreground">عُدّ الدرج وأدخل ما لديك؛ يقارنه النظام بمبيعات اليوم ومصروفاته.</p>
        </div>
      </header>

      <Card className="p-3 grid grid-cols-2 gap-2">
        {isAdmin ? (
          <div>
            <Label className="text-xs">الفرع</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger><SelectValue placeholder="اختر الفرع" /></SelectTrigger>
              <SelectContent>{branches.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        ) : (
          <div>
            <Label className="text-xs">الفرع</Label>
            <p className="h-10 flex items-center text-sm font-semibold">{branches.find((b: any) => b.id === myBranch)?.name ?? "—"}</p>
          </div>
        )}
        <div>
          <Label className="text-xs">التاريخ</Label>
          <Input type="date" dir="ltr" value={date} max={businessToday()} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </div>
      </Card>

      {!canClose ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          {isAdmin ? "اختر فرعاً" : "حسابك غير مرتبط بفرع — اطلب من المدير ربطه."}
        </Card>
      ) : isLoading ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">جارٍ التحميل…</Card>
      ) : closing ? (
        <ClosingResult c={closing} onReopen={isAdmin ? () => reopen(closing) : undefined} />
      ) : (
        <>
          <Card className="p-4 space-y-3">
            <h2 className="font-bold">مصروفات هذا اليوم</h2>
            {expenses.length === 0 && <p className="text-xs text-muted-foreground">لا مصروفات مسجّلة — سجّل أي مبلغ خرج من الدرج (إيجار، ضيافة، نقل…).</p>}
            <div className="divide-y divide-border">
              {expenses.map((e) => (
                <div key={e.id} className="py-1.5 flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{e.category}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    {formatCurrency(Number(e.amount))}
                    {isAdmin && (
                      <button type="button" onClick={() => removeExpense(e.id)} className="text-destructive" aria-label="حذف"><Trash2 className="size-4" /></button>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Input placeholder="البند" value={expCat} onChange={(e) => setExpCat(e.target.value)} />
              <Input placeholder="المبلغ" inputMode="decimal" dir="ltr" className="w-28" value={expAmount} onChange={(e) => setExpAmount(normalizeDecimalInput(e.target.value))} />
              <Button type="button" variant="secondary" onClick={addExpense}><Plus className="size-4" /></Button>
            </div>
            {expenses.length > 0 && <p className="text-xs text-muted-foreground">المجموع: {formatCurrency(expensesTotal)}</p>}
          </Card>

          <Card className="p-4 space-y-3">
            <h2 className="font-bold">ما عددته فعلاً</h2>
            <div className="grid grid-cols-2 gap-2">
              <Field label="نقد افتتاح الدرج" value={opening} set={setOpening} />
              <Field label="النقد المعدود الآن *" value={cash} set={setCash} />
              <Field label="مجموع البطاقة" value={card} set={setCard} />
              <Field label="مجموع التحويلات البنكية" value={transfer} set={setTransfer} />
            </div>
            <div>
              <Label className="text-xs">ملاحظات</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختياري — سبب أي فرق تعرفه" />
            </div>
            <Button className="w-full" disabled={busy} onClick={submit}>{busy ? "جارٍ الإقفال…" : "أقفل اليوم"}</Button>
            <p className="text-[11px] text-muted-foreground text-center">لن يظهر المتوقّع إلا بعد الإرسال.</p>
          </Card>
        </>
      )}

      <section className="space-y-2">
        <h2 className="font-bold">آخر الإقفالات</h2>
        {history.length === 0 ? (
          <Card className="p-4 text-center text-sm text-muted-foreground">لا إقفالات بعد</Card>
        ) : (
          history.map((c) => (
            <Card key={c.id} className={`p-3 flex items-center justify-between gap-2 text-sm ${hasDiff(c) ? "border-destructive/50" : ""}`}>
              <div className="min-w-0">
                <p className="font-semibold truncate">{c.branch?.name ?? "—"} · {c.closing_date}</p>
                <p className="text-xs text-muted-foreground truncate">{c.closer?.full_name ?? "—"} · {formatDate(c.created_at)}</p>
              </div>
              {hasDiff(c) ? (
                <Badge variant="outline" className="bg-destructive/15 text-destructive border-destructive/30 shrink-0">فرق</Badge>
              ) : (
                <Badge variant="outline" className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 shrink-0">مطابق</Badge>
              )}
            </Card>
          ))
        )}
      </section>
    </div>
  );
}

function Field({ label, value, set }: { label: string; value: string; set: (v: string) => void }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input inputMode="decimal" dir="ltr" value={value} onChange={(e) => set(normalizeDecimalInput(e.target.value))} placeholder="0" />
    </div>
  );
}

function DiffBadge({ diff }: { diff: number }) {
  const d = Number(diff);
  if (Math.abs(d) < 0.005) return <Badge variant="outline" className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30">مطابق</Badge>;
  return (
    <Badge variant="outline" className="bg-destructive/15 text-destructive border-destructive/30" dir="ltr">
      {d > 0 ? "+" : ""}{formatCurrency(d)} {d > 0 ? "زيادة" : "نقص"}
    </Badge>
  );
}

function ClosingResult({ c, onReopen }: { c: Closing; onReopen?: () => void }) {
  const rows = [
    { label: "نقد", expected: c.expected_cash, counted: c.counted_cash, diff: c.diff_cash },
    { label: "بطاقة", expected: c.expected_card, counted: c.counted_card, diff: c.diff_card },
    { label: "تحويل بنكي", expected: c.expected_transfer, counted: c.counted_transfer, diff: c.diff_transfer },
  ];
  const bad = hasDiff(c);
  return (
    <Card className={`p-4 space-y-3 ${bad ? "border-destructive/50" : "border-emerald-500/40"}`}>
      <div className="flex items-center gap-2">
        {bad ? <AlertTriangle className="size-5 text-destructive" /> : <CheckCircle2 className="size-5 text-emerald-600" />}
        <h2 className="font-bold">{bad ? "أُقفل اليوم — يوجد فرق" : "أُقفل اليوم — مطابق"}</h2>
        {onReopen && <Button size="sm" variant="outline" className="mr-auto" onClick={onReopen}>إعادة فتح</Button>}
      </div>
      <p className="text-xs text-muted-foreground">
        {c.sales_count} عملية بيع · مصروفات {formatCurrency(c.expenses_total)} · افتتاح {formatCurrency(c.opening_cash)}
      </p>
      <div className="divide-y divide-border">
        {rows.map((r) => (
          <div key={r.label} className="py-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-sm">
            <span className="font-semibold">{r.label}</span>
            <DiffBadge diff={r.diff} />
            <span className="text-xs text-muted-foreground col-span-2">
              المتوقّع {formatCurrency(r.expected)} · المعدود {formatCurrency(r.counted)}
            </span>
          </div>
        ))}
      </div>
      {(Number(c.installment_sales) > 0 || Number(c.tradein_sales) > 0) && (
        <p className="text-xs text-muted-foreground">
          لا تدخل الدرج: تقسيط {formatCurrency(c.installment_sales)} · مقايضة ذهب {formatCurrency(c.tradein_sales)}
        </p>
      )}
      {c.notes && <p className="text-sm bg-muted/40 rounded p-2">{c.notes}</p>}
    </Card>
  );
}
