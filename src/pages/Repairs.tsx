import { useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Wrench, Search as SearchIcon, Clock, CheckCircle2, AlertTriangle, PackageCheck } from "lucide-react";
import { formatCurrency, formatDate, formatWeight } from "@/lib/constants";

// تذاكر الصيانة تأتي من تطبيق Goldsystem (قاعدة مستقلة) وتُنسخ هنا عبر repair-api
// عند كل تغيير على التذكرة. هذه الصفحة للقراءة فقط — لا تعديل من هنا.
// الجدول غير موجود في types.ts المولّدة بعد، فنمرّر الاستعلام عبر any.
const db = supabase as any;

const STATUS: Record<string, { label: string; className: string }> = {
  received: { label: "مستلمة", className: "bg-blue-500/15 text-blue-600 border-blue-500/30" },
  in_progress: { label: "قيد التنفيذ", className: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
  ready: { label: "جاهزة", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
  delivered: { label: "مسلّمة", className: "bg-muted text-muted-foreground border-border" },
  cancelled: { label: "ملغاة", className: "bg-destructive/15 text-destructive border-destructive/30" },
};
const OPEN = ["received", "in_progress", "ready"];

interface RepairTicket {
  id: string;
  ticket_number: string;
  branch_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  received_by: string | null;
  received_by_name: string | null;
  assigned_to_name: string | null;
  item_code: string | null;
  item_name: string;
  karat: string | null;
  weight_in_grams: number | null;
  weight_out_grams: number | null;
  problem_description: string | null;
  work_done: string | null;
  estimated_cost: number | null;
  final_cost: number | null;
  status: string;
  received_at: string;
  promised_at: string | null;
  delivered_at: string | null;
  synced_at: string;
  branch?: { name: string } | null;
}

const isOverdue = (t: RepairTicket) =>
  OPEN.includes(t.status) && !!t.promised_at && new Date(t.promised_at).getTime() < Date.now();

export default function Repairs() {
  const { roles } = useAuth();
  const isAdmin = roles.includes("admin");
  const [q, setQ] = useState("");
  const [branchFilter, setBranchFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("open");
  const [staffFilter, setStaffFilter] = useState("all");

  const { data: branches = [] } = useQuery({
    queryKey: ["repairs-branches"],
    queryFn: async () => (await supabase.from("branches").select("id,name").order("name")).data ?? [],
  });

  const { data: tickets = [], isLoading, error } = useQuery({
    queryKey: ["repair-tickets"],
    queryFn: async () => {
      const { data, error } = await db
        .from("repair_tickets")
        .select("*, branch:branches(name)")
        .order("received_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as RepairTicket[];
    },
  });

  // الموظفون كما ظهروا في التذاكر نفسها — قائمة الفلتر لا تعرض من لم يستلم شيئاً.
  const staffOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tickets) if (t.received_by_name) m.set(t.received_by ?? t.received_by_name, t.received_by_name);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "ar"));
  }, [tickets]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return tickets.filter((t) => {
      if (branchFilter !== "all" && t.branch_id !== branchFilter) return false;
      if (staffFilter !== "all" && (t.received_by ?? t.received_by_name) !== staffFilter) return false;
      if (statusFilter === "open" && !OPEN.includes(t.status)) return false;
      if (statusFilter === "overdue" && !isOverdue(t)) return false;
      if (!["all", "open", "overdue"].includes(statusFilter) && t.status !== statusFilter) return false;
      if (!term) return true;
      return (
        t.ticket_number.toLowerCase().includes(term) ||
        t.item_name.toLowerCase().includes(term) ||
        (t.item_code ?? "").toLowerCase().includes(term) ||
        (t.customer_name ?? "").toLowerCase().includes(term) ||
        (t.customer_phone ?? "").includes(term)
      );
    });
  }, [tickets, q, branchFilter, staffFilter, statusFilter]);

  // الإحصاءات تتبع فلتر الفرع فقط، لا الحالة ولا البحث.
  const scoped = useMemo(
    () => tickets.filter((t) => branchFilter === "all" || t.branch_id === branchFilter),
    [tickets, branchFilter],
  );
  const lastSynced = useMemo(
    () => tickets.reduce<string | null>((m, t: any) => (!m || t.synced_at > m ? t.synced_at : m), null),
    [tickets],
  );
  const stats = {
    open: scoped.filter((t) => OPEN.includes(t.status)).length,
    ready: scoped.filter((t) => t.status === "ready").length,
    overdue: scoped.filter(isOverdue).length,
    delivered: scoped.filter((t) => t.status === "delivered").length,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Wrench className="size-5 text-primary" />
        <h1 className="text-xl font-bold">الصيانة</h1>
        {lastSynced && <span className="mr-auto text-xs text-muted-foreground">آخر مزامنة: {formatDate(lastSynced)}</span>}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={<Clock className="size-4" />} label="مفتوحة" value={stats.open} />
        <StatCard icon={<CheckCircle2 className="size-4" />} label="جاهزة للتسليم" value={stats.ready} />
        <StatCard icon={<AlertTriangle className="size-4" />} label="متأخرة" value={stats.overdue} danger={stats.overdue > 0} />
        <StatCard icon={<PackageCheck className="size-4" />} label="مسلّمة" value={stats.delivered} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="relative col-span-2 sm:col-span-1">
          <SearchIcon className="absolute right-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="رقم التذكرة، الزبون، الهاتف…" className="pr-8" />
        </div>
        {isAdmin && (
          <Select value={branchFilter} onValueChange={setBranchFilter}>
            <SelectTrigger><SelectValue placeholder="الفرع" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الفروع</SelectItem>
              {branches.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Select value={staffFilter} onValueChange={setStaffFilter}>
          <SelectTrigger><SelectValue placeholder="الموظف" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الموظفين</SelectItem>
            {staffOptions.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger><SelectValue placeholder="الحالة" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="open">المفتوحة</SelectItem>
            <SelectItem value="overdue">المتأخرة</SelectItem>
            <SelectItem value="all">الكل</SelectItem>
            {Object.entries(STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <Card className="p-6 text-center text-destructive text-sm">تعذّر تحميل تذاكر الصيانة</Card>
      ) : isLoading ? (
        <Card className="p-6 text-center text-muted-foreground text-sm">جارٍ التحميل…</Card>
      ) : filtered.length === 0 ? (
        <Card className="p-6 text-center text-muted-foreground text-sm">
          {tickets.length === 0 ? "لا توجد تذاكر مزامنة بعد" : "لا توجد تذاكر مطابقة"}
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => {
            const st = STATUS[t.status] ?? STATUS.received;
            const overdue = isOverdue(t);
            const cost = t.final_cost ?? t.estimated_cost;
            return (
              <Card key={t.id} className={`p-3 space-y-2 ${overdue ? "border-destructive/50" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold truncate">{t.item_name}{t.karat ? ` · ${t.karat}` : ""}</p>
                    <p className="text-xs text-muted-foreground font-mono" dir="ltr">{t.ticket_number}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge variant="outline" className={st.className}>{st.label}</Badge>
                    {overdue && <Badge variant="outline" className="bg-destructive/15 text-destructive border-destructive/30">متأخرة</Badge>}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <Info label="الزبون" value={t.customer_name} />
                  <Info label="الهاتف" value={t.customer_phone} ltr />
                  <Info label="الفرع" value={t.branch?.name} />
                  <Info label="استلمها" value={t.received_by_name} />
                  <Info label="المنفّذ" value={t.assigned_to_name} />
                  <Info label="الوزن" value={t.weight_in_grams != null ? `${formatWeight(t.weight_in_grams)}${t.weight_out_grams != null ? ` ← ${formatWeight(t.weight_out_grams)}` : ""}` : null} />
                  <Info label="الاستلام" value={formatDate(t.received_at)} />
                  <Info label="الموعد" value={t.promised_at ? formatDate(t.promised_at) : null} />
                  <Info label={t.final_cost != null ? "التكلفة" : "التقدير"} value={cost != null ? formatCurrency(cost) : null} />
                  <Info label="التسليم" value={t.delivered_at ? formatDate(t.delivered_at) : null} />
                </div>

                {t.problem_description && <p className="text-xs text-muted-foreground">العطل: {t.problem_description}</p>}
                {t.work_done && <p className="text-xs text-muted-foreground">المنجز: {t.work_done}</p>}
              </Card>
            );
          })}
          {tickets.length >= 500 && (
            <p className="text-xs text-center text-muted-foreground">تُعرض آخر ٥٠٠ تذكرة فقط.</p>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, danger }: { icon: React.ReactNode; label: string; value: number; danger?: boolean }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">{icon}{label}</div>
      <p className={`text-xl font-extrabold ${danger ? "text-destructive" : "text-gold-gradient"}`}>{value}</p>
    </Card>
  );
}

function Info({ label, value, ltr }: { label: string; value: string | null | undefined; ltr?: boolean }) {
  if (!value || value === "—") return null;
  return (
    <p className="truncate">
      <span className="text-muted-foreground">{label}: </span>
      <span dir={ltr ? "ltr" : undefined}>{value}</span>
    </p>
  );
}
