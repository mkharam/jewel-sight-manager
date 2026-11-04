import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import SalesAnalytics from "@/components/amarsoft/SalesAnalytics";
import DocLog from "@/components/amarsoft/DocLog";
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

type Item = {
  code?: string; tag?: string; desc?: string; pcs?: number; grams?: number; pure_grams?: number; purity?: number;
  gold_rate?: number; making_rate?: number; rate_per_gram?: number; metal_dirhams?: number; making_dirhams?: number;
  discount_dirhams?: number; vat_percent?: number; vat_dirhams?: number; sman?: string; amount_dirhams?: number;
};
type Details = {
  customer?: string | null; phone?: string | null; guest_code?: string | null; id_no?: string | null; ref_no?: string | null;
  gold_rate?: number; silver_rate?: number; grams?: number; pure_grams?: number; metal_dirhams?: number;
  making_dirhams?: number; gross_dirhams?: number; discount_dirhams?: number; vat_dirhams?: number;
  payments?: { account: string; amount_dirhams: number }[]; printed?: boolean; entered?: string | null;
};
type Invoice = {
  id: number; branch_code: string; kind: string; invoice_no: string; invoice_date: string;
  invoice_time: string | null; sold_at: string | null; sman: string | null; net_dirhams: number; items: Item[] | null;
  details: Details | null;
};
type Salesman = { branch_code: string; sman: string; name: string | null; is_active: boolean; profile_id: string | null };

const TABS = [
  { key: "invoices", label: "الفواتير" },
  { key: "profit", label: "الأرباح" },
  { key: "log", label: "السجل" },
] as const;
const PAGE = 50;
const NONE = "__none__";
const ALL = "all";
// رموز حسابات الدفع في أمارسوفت؛ أي رمز غير معروف يظهر كما هو.
const PAY_LABELS: Record<string, string> = { CASH: "نقداً", BANK: "مصرف", CARD: "بطاقة", CRE: "آجل" };
const KARATS: Record<string, string> = { "0.999": "24", "0.875": "21", "0.75": "18", "0.585": "14" };

function karat(purity?: number) {
  if (!purity) return null;
  return KARATS[String(Number(purity))] ?? `${Math.round(purity * 1000)}`;
}

function grams(v?: number) {
  return `${Number(v ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} جم`;
}

function rate(v?: number) {
  return Number(v ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}
const CHIPS: { key: Period; label: string }[] = [
  { key: "today", label: "اليوم" }, { key: "yesterday", label: "أمس" },
  { key: "week", label: "هذا الأسبوع" }, { key: "month", label: "هذا الشهر" },
];

export default function PosSales() {
  const today = tripoliToday();
  // ?q= من صفحات أخرى (المخزون، العملاء): ابحث في كل التاريخ بدل اليوم فقط.
  const [params] = useSearchParams();
  const initialQ = params.get("q") ?? "";
  // ?sman=<branch>|<code> من لوحة المتصدرين: فواتير بائع واحد لهذا الشهر.
  const initialSman = params.get("sman") ?? ALL;
  const [from, setFrom] = useState(initialQ ? "2024-01-01" : initialSman !== ALL ? periodDays("month").from : today);
  const [to, setTo] = useState(today);
  const [branch, setBranch] = useState(ALL);
  const [sman, setSman] = useState(initialSman);
  const [search, setSearch] = useState(initialQ);
  const [tab, setTab] = useState<"invoices" | "profit" | "log">(
    params.get("tab") === "log" ? "log" : params.get("tab") === "profit" ? "profit" : "invoices",
  );
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
  const profiles = useQuery({
    queryKey: ["profiles-min"],
    queryFn: async () => {
      const { data, error } = await sb.from("profiles").select("id, full_name").order("full_name");
      if (error) throw error;
      return (data ?? []) as { id: string; full_name: string }[];
    },
  });
  // البائع المربوط بموظف في التطبيق يظهر باسمه في التطبيق، وإلا باسمه في أمارسوفت.
  const smanName = (bc: string, s: string | null) => {
    if (!s) return "—";
    const m = salesmen.data?.find((x) => x.branch_code === bc && x.sman === s);
    const linked = m?.profile_id ? profiles.data?.find((p) => p.id === m.profile_id)?.full_name : null;
    return linked || m?.name || s;
  };

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
    // بحث برقم الفاتورة أو اسم الزبون أو هاتفه، أو برقم القطعة (التاغ) مطابقاً تماماً.
    const term = search.trim().replace(/[,()"]/g, " ").trim();
    if (term) {
      const or = [`invoice_no.ilike.%${term}%`, `details->>customer.ilike.%${term}%`, `details->>phone.ilike.%${term}%`];
      if (/^\d{6,}$/.test(term)) or.push(`items.cs.[{"tag":"${term}"}]`);
      q = q.or(or.join(","));
    }
    return q;
  };
  const filterKey = [from, to, branch, sman, search.trim()];

  const list = useInfiniteQuery({
    queryKey: ["amarsoft-invoices", ...filterKey],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await applyFilters(sb.from("amarsoft_invoices").select("id, branch_code, kind, invoice_no, invoice_date, invoice_time, sold_at, sman, net_dirhams, items, details"))
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

      <div className="grid grid-cols-3 gap-1.5">
        {TABS.map((t) => (
          <Button key={t.key} size="lg" variant={tab === t.key ? "default" : "outline"} onClick={() => setTab(t.key)} className="text-base">{t.label}</Button>
        ))}
      </div>

      {tab === "profit" ? <SalesAnalytics /> : tab === "log" ? <DocLog branchName={branchName} /> : (<>
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
        <Input className="col-span-2" placeholder="بحث: رقم الفاتورة، رقم القطعة، اسم الزبون أو هاتفه" value={search} onChange={(e) => setSearch(e.target.value)} />
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
                  <div className="text-xs text-muted-foreground truncate">
                    {[r.details?.customer, grams(r.details?.grams ?? r.items?.reduce((s, it) => s + Number(it.grams ?? 0), 0)),
                      r.items?.map((it) => it.tag).filter(Boolean).join("، ")].filter(Boolean).join(" · ")}
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
      </>)}

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto" dir="rtl">
          {open && (
            <InvoiceDetails
              inv={open}
              branchName={branchName(open.branch_code)}
              salesman={smanName(open.branch_code, open.sman)}
              onSalesman={open.sman ? () => { setBranch(ALL); setSman(`${open.branch_code}|${open.sman}`); setOpen(null); } : undefined}
            />
          )}
        </SheetContent>
      </Sheet>

      <SalesmenDialog open={smenOpen} onOpenChange={setSmenOpen} salesmen={salesmen.data ?? []} branchName={branchName} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex justify-between gap-3 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-left">{value}</span>
    </div>
  );
}

function InvoiceDetails({ inv, branchName, salesman, onSalesman }: {
  inv: Invoice; branchName: string; salesman: string; onSalesman?: () => void;
}) {
  const d = inv.details ?? {};
  const items = inv.items ?? [];
  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          فاتورة #{inv.invoice_no} — {branchName}
          {inv.kind === "return" && <Badge variant="destructive">مرتجع</Badge>}
        </SheetTitle>
      </SheetHeader>

      <div className="mt-3 rounded-lg border p-3 divide-y">
        <Row label="التاريخ والوقت" value={`${inv.invoice_date} ${inv.invoice_time ?? ""}`} />
        <Row label="البائع" value={onSalesman
          ? <button className="text-primary underline underline-offset-2" onClick={onSalesman}>{salesman} (كل فواتيره)</button>
          : salesman} />
        <Row label="الزبون" value={d.customer} />
        <Row label="الهاتف" value={d.phone ? <a className="text-primary" href={`tel:${d.phone}`} dir="ltr">{d.phone}</a> : null} />
        <Row label="رقم الهوية" value={d.id_no} />
        <Row label="الرقم المرجعي" value={d.ref_no} />
        <Row label="سعر الذهب" value={d.gold_rate ? `${rate(d.gold_rate)} د.ل/جم` : null} />
      </div>

      <h3 className="mt-4 mb-2 text-sm font-bold">القطع ({items.length})</h3>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="rounded-lg border p-3 text-sm">
            <div className="flex justify-between gap-2">
              <div className="min-w-0">
                <div className="font-bold">{it.desc || "—"}</div>
                <div className="text-xs text-muted-foreground" dir="ltr" style={{ textAlign: "right" }}>
                  {it.code}{it.tag ? ` · ${it.tag}` : ""}
                </div>
              </div>
              <div className={`font-bold whitespace-nowrap ${Number(it.amount_dirhams) < 0 ? "text-destructive" : "text-primary"}`}>
                {formatLD(it.amount_dirhams)}
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-4 text-xs">
              <Row label="العيار" value={karat(it.purity)} />
              <Row label="العدد" value={it.pcs} />
              <Row label="الوزن القائم" value={grams(it.grams)} />
              <Row label="الوزن الصافي" value={it.pure_grams ? grams(it.pure_grams) : null} />
              <Row label="سعر الغرام" value={it.rate_per_gram ? rate(it.rate_per_gram) : null} />
              <Row label="سعر الذهب" value={it.gold_rate ? rate(it.gold_rate) : null} />
              <Row label="المصنعية/جم" value={it.making_rate ? rate(it.making_rate) : null} />
              <Row label="قيمة المصنعية" value={it.making_dirhams ? formatLD(it.making_dirhams) : null} />
              <Row label="قيمة الذهب" value={it.metal_dirhams ? formatLD(it.metal_dirhams) : null} />
              <Row label="الخصم" value={it.discount_dirhams ? formatLD(it.discount_dirhams) : null} />
              <Row label="الضريبة" value={it.vat_dirhams ? `${formatLD(it.vat_dirhams)} (${it.vat_percent}%)` : null} />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-lg border p-3 divide-y">
        <Row label="الوزن القائم الإجمالي" value={d.grams ? grams(d.grams) : null} />
        <Row label="الوزن الصافي الإجمالي" value={d.pure_grams ? grams(d.pure_grams) : null} />
        <Row label="قيمة الذهب" value={d.metal_dirhams ? formatLD(d.metal_dirhams) : null} />
        <Row label="المصنعية" value={d.making_dirhams ? formatLD(d.making_dirhams) : null} />
        <Row label="الإجمالي" value={d.gross_dirhams ? formatLD(d.gross_dirhams) : null} />
        <Row label="الخصم" value={d.discount_dirhams ? formatLD(d.discount_dirhams) : null} />
        <Row label="الضريبة" value={d.vat_dirhams ? formatLD(d.vat_dirhams) : null} />
        {(d.payments ?? []).map((p, i) => (
          <Row key={i} label={`الدفع: ${PAY_LABELS[p.account] ?? p.account}`} value={formatLD(p.amount_dirhams)} />
        ))}
        <div className="flex justify-between font-bold pt-2 text-base">
          <span>الصافي</span>
          <span className={inv.net_dirhams < 0 ? "text-destructive" : "text-primary"}>{formatLD(inv.net_dirhams)}</span>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        أُدخلت في أمارسوفت: {d.entered ?? "—"}{d.printed ? " · طُبعت" : ""}
      </p>
    </>
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
