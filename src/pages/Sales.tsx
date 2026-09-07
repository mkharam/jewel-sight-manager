import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Receipt, Undo2, Search as SearchIcon, DollarSign } from "lucide-react";
import { formatCurrency, formatDate, formatWeight } from "@/lib/constants";
import { toast } from "sonner";

interface Sale {
  id: string;
  product_id: string | null;
  product_name_snapshot: string | null;
  sku_snapshot: string | null;
  weight_grams: number | null;
  karat: string | null;
  branch_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  final_price: number;
  discount: number;
  payment_method: string | null;
  notes: string | null;
  amar_invoice_number: string | null;
  sold_at: string;
  returned_at: string | null;
  return_reason: string | null;
  sold_by: string | null;
  branch?: { name: string } | null;
  seller?: { full_name: string } | null;
}

export default function Sales() {
  const { profile, roles } = useAuth();
  const isAdmin = roles.includes("admin");
  const isManager = roles.includes("manager");
  const canReturn = isAdmin || isManager;
  const [sales, setSales] = useState<Sale[]>([]);
  const [q, setQ] = useState("");
  const [branchFilter, setBranchFilter] = useState("all");
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [returnTarget, setReturnTarget] = useState<Sale | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [{ data: br }, { data }] = await Promise.all([
      supabase.from("branches").select("id,name").order("name"),
      supabase
        .from("sales")
        .select("*, branch:branches(name), seller:profiles!sales_sold_by_fkey(full_name)")
        .order("sold_at", { ascending: false })
        .limit(300),
    ]);
    setBranches(br ?? []);
    setSales((data ?? []) as any);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("sales-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const filtered = useMemo(() => {
    return sales.filter((s) => {
      if (branchFilter !== "all" && s.branch_id !== branchFilter) return false;
      if (!q.trim()) return true;
      const term = q.trim().toLowerCase();
      return (
        s.product_name_snapshot?.toLowerCase().includes(term) ||
        s.sku_snapshot?.toLowerCase().includes(term) ||
        s.customer_name?.toLowerCase().includes(term) ||
        s.customer_phone?.includes(term) ||
        s.amar_invoice_number?.toLowerCase().includes(term)
      );
    });
  }, [sales, q, branchFilter]);

  const totals = useMemo(() => {
    const active = filtered.filter((s) => !s.returned_at);
    return {
      count: active.length,
      revenue: active.reduce((sum, s) => sum + Number(s.final_price ?? 0), 0),
    };
  }, [filtered]);

  const submitReturn = async () => {
    if (!returnTarget) return;
    if (!returnReason.trim()) return toast.error("اكتب سبب الإرجاع");
    setBusy(true);
    const { error } = await supabase.rpc("return_sale", { _sale_id: returnTarget.id, _reason: returnReason.trim() });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("تم إرجاع البيعة — القطعة أصبحت متوفرة مجدداً");
    setReturnTarget(null);
    setReturnReason("");
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Receipt className="size-5 text-primary" />
        <h1 className="text-xl font-bold">سجل المبيعات</h1>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><DollarSign className="size-4" />إجمالي المبيعات</div>
          <p className="text-xl font-extrabold text-gold-gradient">{formatCurrency(totals.revenue)}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Receipt className="size-4" />عدد المبيعات</div>
          <p className="text-xl font-extrabold text-gold-gradient">{totals.count}</p>
        </Card>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <SearchIcon className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث: اسم القطعة، الزبون، رقم الفاتورة..." className="pr-10" />
        </div>
        <Select value={branchFilter} onValueChange={setBranchFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="الفرع" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الفروع</SelectItem>
            {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="text-center py-12 text-muted-foreground bg-muted/30 rounded-xl">لا توجد مبيعات</div>
        )}
        {filtered.map((s) => (
          <Card key={s.id} className={`p-3 sm:p-4 space-y-2 ${s.returned_at ? "opacity-60" : ""}`}>
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {s.product_id ? (
                    <Link to={`/products/${s.product_id}`} className="font-bold text-base hover:text-primary truncate">
                      {s.product_name_snapshot ?? "قطعة"}
                    </Link>
                  ) : (
                    <span className="font-bold text-base truncate">{s.product_name_snapshot ?? "قطعة"}</span>
                  )}
                  {s.returned_at ? (
                    <Badge variant="outline" className="bg-muted text-muted-foreground">مُرجعة</Badge>
                  ) : (
                    <Badge className="bg-status-available text-white border-0">مباعة</Badge>
                  )}
                  {s.karat && <span className="text-xs text-muted-foreground">{s.karat}</span>}
                  {s.weight_grams != null && <span className="text-xs text-muted-foreground">· {formatWeight(s.weight_grams)}</span>}
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {s.branch?.name && <span>{s.branch.name} · </span>}
                  باعها {s.seller?.full_name ?? "—"}
                </p>
                {(s.customer_name || s.customer_phone) && (
                  <p className="text-xs mt-1">👤 {s.customer_name} {s.customer_phone && `· ${s.customer_phone}`}</p>
                )}
                {s.amar_invoice_number && <p className="text-xs mt-1 text-muted-foreground">فاتورة عمار: {s.amar_invoice_number}</p>}
                {s.returned_at && <p className="text-xs mt-1 text-destructive">سبب الإرجاع: {s.return_reason}</p>}
              </div>
              <div className="text-left shrink-0">
                <p className="font-mono font-bold text-primary">{formatCurrency(s.final_price)}</p>
                {s.discount > 0 && <p className="text-[11px] text-muted-foreground">خصم {formatCurrency(s.discount)}</p>}
                <p className="text-[11px] text-muted-foreground">{formatDate(s.sold_at)}</p>
              </div>
            </div>
            {canReturn && !s.returned_at && (
              <div className="pt-2 border-t border-border">
                <Button size="sm" variant="outline" onClick={() => setReturnTarget(s)}>
                  <Undo2 className="size-3.5 ml-1" /> إرجاع البيعة
                </Button>
              </div>
            )}
          </Card>
        ))}
      </div>

      <Dialog open={!!returnTarget} onOpenChange={(o) => { if (!o) { setReturnTarget(null); setReturnReason(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>إرجاع «{returnTarget?.product_name_snapshot}»</DialogTitle>
            <DialogDescription>تصبح القطعة «متوفرة» مجدداً فور الإرجاع. هذا الإجراء لا يمكن التراجع عنه.</DialogDescription>
          </DialogHeader>
          <Textarea value={returnReason} onChange={(e) => setReturnReason(e.target.value)} rows={3} placeholder="سبب الإرجاع *" />
          <DialogFooter>
            <Button onClick={submitReturn} disabled={busy} variant="destructive" className="w-full">
              {busy ? "جارٍ..." : "تأكيد الإرجاع"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
