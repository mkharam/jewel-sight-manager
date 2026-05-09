import { useEffect, useMemo, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { ArrowLeftRight, Plus, Check, X, Truck, PackageCheck, Clock, Search } from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/constants";

type TransferStatus = "pending" | "approved" | "in_transit" | "received" | "rejected" | "cancelled";

const STATUS_META: Record<TransferStatus, { label: string; class: string; icon: any }> = {
  pending:    { label: "بانتظار الموافقة", class: "bg-amber-100 text-amber-900 border-amber-300", icon: Clock },
  approved:   { label: "موافق عليه",       class: "bg-blue-100 text-blue-900 border-blue-300", icon: Check },
  in_transit: { label: "قيد الإرسال",      class: "bg-purple-100 text-purple-900 border-purple-300", icon: Truck },
  received:   { label: "تم الاستلام",      class: "bg-emerald-100 text-emerald-900 border-emerald-300", icon: PackageCheck },
  rejected:   { label: "مرفوض",            class: "bg-rose-100 text-rose-900 border-rose-300", icon: X },
  cancelled:  { label: "ملغي",             class: "bg-muted text-muted-foreground border-border", icon: X },
};

interface Transfer {
  id: string;
  product_id: string | null;
  product_name_snapshot: string | null;
  from_branch_id: string;
  to_branch_id: string;
  status: TransferStatus;
  reason: string | null;
  notes: string | null;
  customer_name: string | null;
  requested_by: string;
  created_at: string;
  approved_at: string | null;
  received_at: string | null;
  from_branch?: { name: string };
  to_branch?: { name: string };
  requester?: { full_name: string };
}

interface Branch { id: string; name: string }

export default function Transfers() {
  const { user, profile } = useAuth();
  const [params] = useSearchParams();
  const presetProductId = params.get("product");
  const presetProductName = params.get("name");

  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [tab, setTab] = useState<"all" | "incoming" | "outgoing" | "active">("active");
  const [openNew, setOpenNew] = useState(!!presetProductId);

  const load = async () => {
    const [{ data: br }, { data: tr }] = await Promise.all([
      supabase.from("branches").select("id,name").order("name"),
      supabase
        .from("transfers")
        .select(`*,
          from_branch:branches!transfers_from_branch_id_fkey(name),
          to_branch:branches!transfers_to_branch_id_fkey(name),
          requester:profiles!transfers_requested_by_fkey(full_name)
        `)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    setBranches(br ?? []);
    setTransfers((tr ?? []) as any);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("transfers-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "transfers" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const filtered = useMemo(() => {
    if (tab === "all") return transfers;
    if (tab === "active") return transfers.filter((t) => ["pending", "approved", "in_transit"].includes(t.status));
    if (tab === "incoming") return transfers.filter((t) => t.to_branch_id === profile?.branch_id);
    if (tab === "outgoing") return transfers.filter((t) => t.from_branch_id === profile?.branch_id);
    return transfers;
  }, [transfers, tab, profile?.branch_id]);

  const updateStatus = async (t: Transfer, status: TransferStatus) => {
    const patch: any = { status };
    if (status === "approved") { patch.approved_by = user?.id; patch.approved_at = new Date().toISOString(); }
    if (status === "received") { patch.received_by = user?.id; patch.received_at = new Date().toISOString(); }
    const { error } = await supabase.from("transfers").update(patch).eq("id", t.id);
    if (error) return toast.error(error.message);
    toast.success("تم التحديث");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ArrowLeftRight className="size-5 text-primary" />
          <h1 className="text-xl font-bold">تحويلات الفروع</h1>
        </div>
        <Dialog open={openNew} onOpenChange={setOpenNew}>
          <DialogTrigger asChild>
            <Button className="bg-gold-gradient text-primary-foreground shadow-gold">
              <Plus className="size-4 ml-1" /> طلب تحويل
            </Button>
          </DialogTrigger>
          <NewTransferDialog
            branches={branches}
            myBranchId={profile?.branch_id ?? null}
            presetProductId={presetProductId}
            presetProductName={presetProductName}
            onCreated={() => { setOpenNew(false); load(); }}
          />
        </Dialog>
      </div>

      <Tabs value={tab} onValueChange={(v: any) => setTab(v)}>
        <TabsList className="w-full grid grid-cols-4">
          <TabsTrigger value="active">جارية</TabsTrigger>
          <TabsTrigger value="incoming">واردة</TabsTrigger>
          <TabsTrigger value="outgoing">صادرة</TabsTrigger>
          <TabsTrigger value="all">الكل</TabsTrigger>
        </TabsList>
        <TabsContent value={tab} className="space-y-2 mt-3">
          {filtered.length === 0 && (
            <div className="text-center py-12 text-muted-foreground bg-muted/30 rounded-xl">لا توجد طلبات</div>
          )}
          {filtered.map((t) => (
            <TransferRow
              key={t.id}
              t={t}
              myBranchId={profile?.branch_id ?? null}
              onUpdate={updateStatus}
            />
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TransferRow({ t, myBranchId, onUpdate }: {
  t: Transfer; myBranchId: string | null;
  onUpdate: (t: Transfer, s: TransferStatus) => void;
}) {
  const meta = STATUS_META[t.status];
  const Icon = meta.icon;
  const isFromMe = t.from_branch_id === myBranchId;
  const isToMe = t.to_branch_id === myBranchId;

  const actions: { label: string; status: TransferStatus; variant?: any; show: boolean }[] = [
    { label: "موافقة", status: "approved", show: t.status === "pending" && (isFromMe || !myBranchId) },
    { label: "رفض", status: "rejected", variant: "outline", show: t.status === "pending" && (isFromMe || !myBranchId) },
    { label: "أرسلت", status: "in_transit", show: t.status === "approved" && (isFromMe || !myBranchId) },
    { label: "تأكيد الاستلام", status: "received", show: t.status === "in_transit" && (isToMe || !myBranchId) },
    { label: "إلغاء", status: "cancelled", variant: "outline", show: ["pending", "approved"].includes(t.status) },
  ];

  return (
    <Card className="p-3 sm:p-4 space-y-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {t.product_id ? (
              <Link to={`/products/${t.product_id}`} className="font-bold text-base hover:text-primary truncate">
                {t.product_name_snapshot ?? "قطعة"}
              </Link>
            ) : (
              <span className="font-bold text-base truncate">{t.product_name_snapshot ?? "قطعة"}</span>
            )}
            <Badge variant="outline" className={`${meta.class} gap-1`}>
              <Icon className="size-3" /> {meta.label}
            </Badge>
          </div>
          <div className="text-sm text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
            <span className="font-medium text-foreground">{t.from_branch?.name}</span>
            <ArrowLeftRight className="size-3" />
            <span className="font-medium text-foreground">{t.to_branch?.name}</span>
          </div>
          {t.customer_name && <p className="text-xs mt-1">👤 الزبون: {t.customer_name}</p>}
          {t.reason && <p className="text-xs mt-1 text-muted-foreground">💡 {t.reason}</p>}
          {t.notes && <p className="text-xs mt-1 italic text-muted-foreground">{t.notes}</p>}
        </div>
        <div className="text-left text-[11px] text-muted-foreground shrink-0">
          <p>{t.requester?.full_name}</p>
          <p>{formatDate(t.created_at)}</p>
        </div>
      </div>
      {actions.some((a) => a.show) && (
        <div className="flex gap-2 flex-wrap pt-2 border-t border-border">
          {actions.filter((a) => a.show).map((a) => (
            <Button key={a.status} size="sm" variant={a.variant ?? "default"} onClick={() => onUpdate(t, a.status)}
              className={!a.variant ? "bg-gold-gradient text-primary-foreground" : ""}>
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </Card>
  );
}

function NewTransferDialog({ branches, myBranchId, presetProductId, presetProductName, onCreated }: {
  branches: Branch[]; myBranchId: string | null;
  presetProductId: string | null; presetProductName: string | null;
  onCreated: () => void;
}) {
  const { user } = useAuth();
  const [productId, setProductId] = useState<string | null>(presetProductId);
  const [productName, setProductName] = useState(presetProductName ?? "");
  const [fromBranch, setFromBranch] = useState<string>("");
  const [toBranch, setToBranch] = useState<string>(myBranchId ?? "");
  const [reason, setReason] = useState("");
  const [customer, setCustomer] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Live product search
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<any[]>([]);
  useEffect(() => {
    if (productId || search.length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("products")
        .select("id,name,karat,branch_id,branch:branches(name)")
        .or(`name.ilike.%${search}%,description.ilike.%${search}%`)
        .limit(8);
      setResults(data ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [search, productId]);

  const submit = async () => {
    if (!toBranch || !fromBranch) return toast.error("اختر الفرعين");
    if (toBranch === fromBranch) return toast.error("الفرعان يجب أن يكونا مختلفين");
    if (!productName.trim() && !productId) return toast.error("حدّد القطعة");
    setSaving(true);
    const { error } = await supabase.from("transfers").insert({
      product_id: productId,
      product_name_snapshot: productName.trim() || null,
      from_branch_id: fromBranch,
      to_branch_id: toBranch,
      requested_by: user?.id,
      reason: reason.trim() || null,
      customer_name: customer.trim() || null,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("تم إرسال الطلب");
    onCreated();
  };

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>طلب تحويل قطعة</DialogTitle></DialogHeader>
      <div className="space-y-3">
        {!productId ? (
          <div className="space-y-1.5">
            <Label>ابحث عن القطعة</Label>
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="اسم القطعة..." className="pr-10" />
            </div>
            {results.length > 0 && (
              <div className="border rounded-lg divide-y max-h-48 overflow-y-auto">
                {results.map((r) => (
                  <button key={r.id} type="button" onClick={() => {
                    setProductId(r.id); setProductName(r.name);
                    setFromBranch(r.branch_id);
                  }} className="w-full text-right p-2 hover:bg-muted/60 text-sm">
                    <span className="font-medium">{r.name}</span>
                    <span className="text-muted-foreground text-xs"> · {r.karat ?? "—"} · {r.branch?.name}</span>
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">أو اكتب اسم القطعة يدوياً إن لم تكن مسجّلة:</p>
            <Input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="مثال: خاتم ألماس مقاس 16" />
          </div>
        ) : (
          <Card className="p-3 flex items-center justify-between gap-2 bg-muted/40">
            <span className="font-semibold">{productName}</span>
            <Button variant="ghost" size="sm" onClick={() => { setProductId(null); setProductName(""); }}>تغيير</Button>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>من فرع</Label>
            <Select value={fromBranch} onValueChange={setFromBranch}>
              <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
              <SelectContent>
                {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>إلى فرع</Label>
            <Select value={toBranch} onValueChange={setToBranch}>
              <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
              <SelectContent>
                {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>اسم الزبون (اختياري)</Label>
          <Input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="إن وجد" />
        </div>
        <div className="space-y-1.5">
          <Label>السبب</Label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: زبون يطلب القطعة" />
        </div>
        <div className="space-y-1.5">
          <Label>ملاحظات</Label>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={saving} className="bg-gold-gradient text-primary-foreground">
          {saving ? "جارٍ..." : "إرسال الطلب"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
