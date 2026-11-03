import { useMemo, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Receipt, Users } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { sb, periodDays, daysToRange, formatLD, formatTripoli, tripoliToday, type Period } from "@/lib/amarsoft";

type Item = { code?: string; desc?: string; pcs?: number; grams?: number; amount_dirhams?: number };
type Invoice = {
  id: number; branch_code: string; kind: string; invoice_no: string; invoice_date: string;
  invoice_time: string | null; sold_at: string | null; sman: string | null; net_dirhams: number; items: Item[] | null;
};
type Salesman = { branch_code: string; sman: string; name: string | null; is_active: boolean; profile_id: string | null };

const PAGE = 50;
const NONE = "__none__";
const ALL = "all";
const CHIPS: { key: Period; label: string }[] = [
  { key: "today", label: "اليوم" }, { key: "yesterday", label: "أمس" },
  { key: "week", label: "هذا الأسبوع" }, { key: "month", label: "هذا الشهر" },
];

export default function PosSales() {
  const today = tripoliToday();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [branch, setBranch] = useState(ALL);
  const [sman, setSman] = useState(ALL);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Invoice | null>(null);
  const [smenOpen, setSmenOpen] = useState(false);

  const branchMap = useQuery({
    queryKey: ["amarsoft-branch-map"],
    queryFn: async () => {
      const { data, error } = await sb.from("amarsoft_branch_map").select("code, amarsoft_name, branch_id, branches(name)");
      if (error) throw error;
      return (data ?? []) as { code: string; amarsoft_name: string | null; branches: { name: string } | null }[];
    },
  });
  const branchName = (code: string) => {
    const b = branchMap.data?.find((x) => x.code === code);
    return b?.branches?.name ?? b?.amarsoft_name ?? code;
  };

  const salesmen = useQuery({
    queryKey: ["amarsoft-salesmen"],
    queryFn: async () => {
      const { data, error } = await sb.from("amarsoft_salesmen").select("*").order("branch_code").order("sman");
      if (error) throw error;
      return (data ?? []) as Salesman[];
    },
  });
  const smanName = (bc: string, s: string | null) =>
    s ? salesmen.data?.find((x) => x.branch_code === bc && x.sman === s)?.name ?? s : "—";

  const lastSync = useQuery({
    queryKey: ["amarsoft-last-sync"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data } = await sb.from("amarsoft_sync_log").select("received_at").order("received_at", { ascending: false }).limit(1).maybeSingle();
      return (data?.received_at as string | undefined) ?? null;
    },
  });
  const stale = !lastSync.data || Date.now() - new Date(lastSync.data).getTime() > 15 * 60_000;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyFilters = (q: any) => {
    const { start, end } = daysToRange(from, to);
    q = q.eq("is_deleted", false).gte("sold_at", start).lt("sold_at", end);
    if (branch !== ALL) q = q.eq("branch_code", branch);
    if (sman === NONE) q = q.is("sman", null);
    else if (sman !== ALL) { const [bc, s] = sman.split("|"); q = q.eq("branch_code", bc).eq("sman", s); }
    if (search.trim()) q = q.ilike("invoice_no", `%${search.trim()}%`);
    return q;
  };
  const filterKey = [from, to, branch, sman, search.trim()];

  const list = useInfiniteQuery({
    queryKey: ["amarsoft-invoices", ...filterKey],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await applyFilters(sb.from("amarsoft_invoices").select("id, branch_code, kind, invoice_no, invoice_date, invoice_time, sold_at, sman, net_dirhams, items"))
        .order("sold_at", { ascending: false }).range(pageParam, pageParam + PAGE - 1);
      if (error) throw error;
      return (data ?? []) as Invoice[];
    },
    getNextPageParam: (last, all) => (last.length < PAGE ? undefined : all.length * PAGE),
  });

  // ملخّص النطاق كاملاً (أعمدة خفيفة فقط، بدفعات من 1000)
  const summary = useQuery({
    queryKey: ["amarsoft-summary", ...filterKey],
    queryFn: async () => {
      let total = 0, sales = 0, returns = 0, noSman = 0, n = 0;
      for (let off = 0; ; off += 1000) {
        const { data, error } = await applyFilters(sb.from("amarsoft_invoices").select("kind, sman, net_dirhams")).range(off, off + 999);
        if (error) throw error;
        for (const r of data ?? []) {
          total += Number(r.net_dirhams ?? 0); n++;
          if (r.kind === "return") returns++; else sales++;
          if (!r.sman) noSman++;
        }
        if (!data || data.length < 1000) break;
      }
      return { total, sales, returns, noSmanPct: n ? Math.round((noSman / n) * 100) : 0 };
    },
  });

  const rows = useMemo(() => list.data?.pages.flat() ?? [], [list.data]);
  const pick = (p: Period) => { const r = periodDays(p); setFrom(r.from); setTo(r.to); };
  const activeChip = CHIPS.find((c) => { const r = periodDays(c.key); return r.from === from && r.to === to; })?.key;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Receipt className="size-6 text-primary" />مبيعات أمارسوفت</h1>
          <p className={`text-xs mt-1 flex items-center gap-1 ${stale ? "text-amber-600" : "text-muted-foreground"}`}>
            {stale && <AlertTriangle className="size-3.5" />}
            آخر مزامنة: {formatTripoli(lastSync.data)}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setSmenOpen(true)}><Users className="size-4 ml-1" />البائعون</Button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {CHIPS.map((c) => (
          <Button key={c.key} size="sm" variant={activeChip === c.key ? "default" : "outline"} onClick={() => pick(c.key)}>{c.label}</Button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        <Input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
        <Select value={branch} onValueChange={(v) => { setBranch(v); setSman(ALL); }}>
          <SelectTrigger><SelectValue placeholder="الفرع" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>كل الفروع</SelectItem>
            {branchMap.data?.map((b) => <SelectItem key={b.code} value={b.code}>{branchName(b.code)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sman} onValueChange={setSman}>
          <SelectTrigger><SelectValue placeholder="البائع" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>كل البائعين</SelectItem>
            <SelectItem value={NONE}>بدون بائع</SelectItem>
            {salesmen.data?.filter((s) => branch === ALL || s.branch_code === branch).map((s) => (
              <SelectItem key={`${s.branch_code}|${s.sman}`} value={`${s.branch_code}|${s.sman}`}>
                {s.name || s.sman} · {branchName(s.branch_code)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input className="col-span-2" placeholder="بحث برقم الفاتورة" value={search} onChange={(e) => setSearch(e.target.value)} inputMode="numeric" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="صافي المبيعات" value={summary.data ? formatLD(summary.data.total) : "…"} />
        <Stat label="عدد المبيعات" value={summary.data?.sales ?? "…"} />
        <Stat label="المرتجعات" value={summary.data?.returns ?? "…"} />
        <Stat label="بدون بائع" value={summary.data ? `${summary.data.noSmanPct}%` : "…"} />
      </div>

      {list.isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : list.error ? (
        <Card className="p-6 text-center text-sm text-destructive">تعذّر تحميل الفواتير: {(list.error as Error).message}</Card>
      ) : !rows.length ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">لا توجد فواتير في هذه الفترة.</Card>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <button key={r.id} onClick={() => setOpen(r)} className="w-full text-right">
              <Card className="p-3 flex items-center gap-3 hover:border-primary/40 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="font-bold flex items-center gap-2">
                    #{r.invoice_no}
                    {r.kind === "return" && <Badge variant="destructive" className="text-[10px]">مرتجع</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {branchName(r.branch_code)} · {r.invoice_date} {r.invoice_time ?? ""} · {smanName(r.branch_code, r.sman)}
                  </div>
                </div>
                <div className={`font-bold whitespace-nowrap ${r.net_dirhams < 0 ? "text-destructive" : "text-primary"}`}>{formatLD(r.net_dirhams)}</div>
              </Card>
            </button>
          ))}
          {list.hasNextPage && (
            <Button variant="outline" className="w-full" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
              {list.isFetchingNextPage ? <Loader2 className="size-4 animate-spin" /> : "تحميل المزيد"}
            </Button>
          )}
        </div>
      )}

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto" dir="rtl">
          {open && (
            <>
              <SheetHeader><SheetTitle>فاتورة #{open.invoice_no} — {branchName(open.branch_code)}</SheetTitle></SheetHeader>
              <p className="text-xs text-muted-foreground mt-1">{open.invoice_date} {open.invoice_time ?? ""} · البائع: {smanName(open.branch_code, open.sman)}</p>
              <div className="mt-3 space-y-2">
                {(open.items ?? []).map((it, i) => (
                  <div key={i} className="rounded-lg border p-2 text-sm flex justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{it.desc || "—"}</div>
                      <div className="text-xs text-muted-foreground">كود {it.code ?? "—"} · {it.pcs ?? 0} قطعة · {it.grams ?? 0} جم</div>
                    </div>
                    <div className={`font-bold whitespace-nowrap ${Number(it.amount_dirhams) < 0 ? "text-destructive" : ""}`}>{formatLD(it.amount_dirhams)}</div>
                  </div>
                ))}
                <div className="flex justify-between font-bold border-t pt-2">
                  <span>الصافي</span>
                  <span className={open.net_dirhams < 0 ? "text-destructive" : "text-primary"}>{formatLD(open.net_dirhams)}</span>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <SalesmenDialog open={smenOpen} onOpenChange={setSmenOpen} salesmen={salesmen.data ?? []} branchName={branchName} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-bold mt-1">{value}</div>
    </Card>
  );
}

function SalesmenDialog({ open, onOpenChange, salesmen, branchName }: {
  open: boolean; onOpenChange: (o: boolean) => void; salesmen: Salesman[]; branchName: (c: string) => string;
}) {
  const qc = useQueryClient();
  const profiles = useQuery({
    queryKey: ["profiles-min"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await sb.from("profiles").select("id, full_name").order("full_name");
      if (error) throw error;
      return (data ?? []) as { id: string; full_name: string }[];
    },
  });
  const link = useMutation({
    mutationFn: async ({ s, profile_id }: { s: Salesman; profile_id: string | null }) => {
      const { error } = await sb.from("amarsoft_salesmen").update({ profile_id })
        .eq("branch_code", s.branch_code).eq("sman", s.sman);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("تم الحفظ"); qc.invalidateQueries({ queryKey: ["amarsoft-salesmen"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto" dir="rtl">
        <DialogHeader><DialogTitle>البائعون في أمارسوفت</DialogTitle></DialogHeader>
        {!salesmen.length ? (
          <p className="text-sm text-muted-foreground">لا يوجد بائعون بعد.</p>
        ) : (
          <div className="space-y-2">
            {salesmen.map((s) => (
              <div key={`${s.branch_code}|${s.sman}`} className="rounded-lg border p-2 space-y-2">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <div className="font-bold truncate">{s.name || "—"}</div>
                    <div className="text-xs text-muted-foreground">{branchName(s.branch_code)} · كود {s.sman}</div>
                  </div>
                  <Badge variant={s.is_active ? "default" : "secondary"}>{s.is_active ? "نشط" : "غير نشط"}</Badge>
                </div>
                <Select value={s.profile_id ?? NONE} onValueChange={(v) => link.mutate({ s, profile_id: v === NONE ? null : v })}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="ربط بموظف" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>غير مربوط</SelectItem>
                    {profiles.data?.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
