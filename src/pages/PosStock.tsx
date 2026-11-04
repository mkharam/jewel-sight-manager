import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Boxes, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth, hasRole } from "@/hooks/useAuth";
import { sb, formatLD } from "@/lib/amarsoft";

type Piece = {
  branch_code: string; tag: string; item_code: string | null; type_code: string | null; type_name: string | null;
  karat: string | null; purity: number | null; grams_in: number | null; pure_grams_in: number | null;
  grams: number | null; pure_grams: number | null; in_stock: boolean; making_cost_rate: number | null;
  making_sale_rate: number | null; cost_dirhams: number | null; supplier_name: string | null;
  received_on: string | null; sold_on: string | null;
};
type SummaryRow = { branch_code: string; branch_name: string; karat: string | null; pieces: number; grams: number; pure_grams: number };

const PAGE = 50;
const ALL = "all";
// أنواع القطع كما في جدول mst_type في أمارسوفت.
const TYPES: [string, string][] = [
  ["RN", "خاتم"], ["ER", "حلق"], ["BN", "سوار"], ["BR", "إسورة"], ["NK", "عقد"], ["PN", "تعليقة"],
  ["CN", "سلسال"], ["CR", "مزنط"], ["SD", "دبلة سوليتير"], ["ND", "دبلة عملية"], ["KL", "خلخال"],
  ["RBR", "حديدة وخاتم"], ["LB", "حديدة جلد"], ["MB", "حديدة مطروحة"], ["FS", "طقم كامل"], ["MS", "طقم صغير"],
  ["ZL", "زلباحة"], ["CH", "سلسلة حجاب"], ["EC", "سلسلة فاضية"], ["RH", "رشقة"], ["HR", "طرحة راس"],
  ["HA", "يد جريحة"], ["CW", "تاج"], ["MC", "مدالية سيارة"], ["GS", "ملعقة ذهب"], ["PG", "ثقب صرة"],
  ["GCAP", "وشاح ذهب"], ["KF", "KUFF"], ["BH", "BROOCH"], ["BT", "BELT"], ["USED", "ذهب مستعمل"], ["GEN", "عام"],
];

function g(v?: number | null) {
  return `${Number(v ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} جم`;
}

export default function PosStock() {
  const { roles } = useAuth();
  const isAdmin = hasRole(roles, "admin");
  const [branch, setBranch] = useState(ALL);
  const [karat, setKarat] = useState(ALL);
  const [type, setType] = useState(ALL);
  const [status, setStatus] = useState<"in" | "sold" | "all">("in");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Piece | null>(null);

  const summary = useQuery({
    queryKey: ["amarsoft-stock-summary"],
    queryFn: async () => {
      const { data, error } = await sb.rpc("amarsoft_stock_summary");
      if (error) throw error;
      return (data ?? []) as SummaryRow[];
    },
  });
  const branches = useMemo(() => {
    const m = new Map<string, { name: string; pieces: number; grams: number; byKarat: string[] }>();
    for (const r of summary.data ?? []) {
      const b = m.get(r.branch_code) ?? { name: r.branch_name, pieces: 0, grams: 0, byKarat: [] };
      b.pieces += Number(r.pieces); b.grams += Number(r.grams);
      b.byKarat.push(`${r.karat ?? "?"}K: ${r.pieces}`);
      m.set(r.branch_code, b);
    }
    return m;
  }, [summary.data]);
  const totals = useMemo(() => {
    let pieces = 0, grams = 0;
    for (const b of branches.values()) { pieces += b.pieces; grams += b.grams; }
    return { pieces, grams };
  }, [branches]);


  const term = search.trim();
  const list = useInfiniteQuery({
    queryKey: ["amarsoft-stock", branch, karat, type, status, term],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      let q = sb.from("amarsoft_stock").select("*");
      if (branch !== ALL) q = q.eq("branch_code", branch);
      if (karat !== ALL) q = q.eq("karat", karat);
      if (type !== ALL) q = q.eq("type_code", type);
      if (status !== "all") q = q.eq("in_stock", status === "in");
      if (term) q = q.ilike("tag", `%${term}%`);
      q = status === "sold" ? q.order("sold_on", { ascending: false, nullsFirst: false }) : q.order("received_on", { ascending: false, nullsFirst: false });
      const { data, error } = await q.order("tag", { ascending: false }).range(pageParam, pageParam + PAGE - 1);
      if (error) throw error;
      return (data ?? []) as Piece[];
    },
    getNextPageParam: (last, all) => (last.length < PAGE ? undefined : all.length * PAGE),
  });
  const rows = useMemo(() => list.data?.pages.flat() ?? [], [list.data]);
  const branchName = (c: string) => branches.get(c)?.name ?? c;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Boxes className="size-6 text-primary" />مخزون أمارسوفت</h1>
        <p className="text-xs text-muted-foreground mt-1">القطع المكوّدة كما في أمارسوفت، تتحدّث كل 5 دقائق.</p>
      </div>

      <AppVsAmarsoft />

      <div className="grid grid-cols-2 gap-2">
        <Card className="p-3 col-span-2 bg-gold-soft border-primary/20">
          <div className="text-xs text-muted-foreground">كل الفروع</div>
          <div className="text-lg font-bold mt-1">{summary.data ? `${totals.pieces.toLocaleString("en-US")} قطعة · ${g(totals.grams)}` : "…"}</div>
        </Card>
        {[...branches.entries()].map(([code, b]) => (
          <button key={code} className="text-right" onClick={() => setBranch(branch === code ? ALL : code)}>
            <Card className={`p-3 h-full ${branch === code ? "border-primary" : ""}`}>
              <div className="text-xs text-muted-foreground">{b.name}</div>
              <div className="font-bold mt-1">{b.pieces.toLocaleString("en-US")} قطعة</div>
              <div className="text-xs text-muted-foreground">{g(b.grams)} · {b.byKarat.join(" · ")}</div>
            </Card>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Select value={branch} onValueChange={setBranch}>
          <SelectTrigger><SelectValue placeholder="الفرع" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>كل الفروع</SelectItem>
            {[...branches.entries()].map(([code, b]) => <SelectItem key={code} value={code}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="in">في المخزون</SelectItem>
            <SelectItem value="sold">مباعة</SelectItem>
            <SelectItem value="all">الكل</SelectItem>
          </SelectContent>
        </Select>
        <Select value={karat} onValueChange={setKarat}>
          <SelectTrigger><SelectValue placeholder="العيار" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>كل العيارات</SelectItem>
            <SelectItem value="18">18</SelectItem>
            <SelectItem value="21">21</SelectItem>
            <SelectItem value="24">24</SelectItem>
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger><SelectValue placeholder="النوع" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>كل الأنواع</SelectItem>
            {TYPES.map(([code, name]) => <SelectItem key={code} value={code}>{name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input className="col-span-2" placeholder="بحث برقم القطعة (التاغ)" value={search} onChange={(e) => setSearch(e.target.value)} inputMode="numeric" dir="ltr" />
      </div>

      {list.isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : list.error ? (
        <Card className="p-6 text-center text-sm text-destructive">تعذّر تحميل المخزون: {(list.error as Error).message}</Card>
      ) : !rows.length ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">لا توجد قطع مطابقة.</Card>
      ) : (
        <div className="space-y-2">
          {rows.map((p) => (
            <button key={`${p.branch_code}-${p.tag}`} onClick={() => setOpen(p)} className="w-full text-right">
              <Card className="p-3 flex items-center gap-3 hover:border-primary/40 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="font-bold flex items-center gap-2">
                    <span dir="ltr">{p.tag}</span>
                    {!p.in_stock && <Badge variant="secondary" className="text-[10px]">مباعة {p.sold_on ?? ""}</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {p.type_name ?? p.type_code ?? "—"} · {p.karat}K · {branchName(p.branch_code)} · دخلت {p.received_on ?? "—"}
                  </div>
                </div>
                <div className="font-bold whitespace-nowrap text-primary">{g(p.in_stock ? p.grams : p.grams_in)}</div>
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
          {open && <PieceDetails p={open} branchName={branchName(open.branch_code)} isAdmin={isAdmin} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

type AppPiece = { id: string; name: string; sku: string | null; barcode_value: string | null; amarsoft_status: string; created_at: string };

// قطع أُضيفت في التطبيق بباركود لا يطابق مخزون أمارسوفت: «بانتظار أمارسوفت» (لم تُسجّل هناك
// بعد — تُطابَق تلقائياً عند تسجيلها) و«مباعة في أمارسوفت» وهي ما زالت معروضة في التطبيق.
function AppVsAmarsoft() {
  const [open, setOpen] = useState<"pending" | "sold" | null>(null);
  const { data } = useQuery({
    queryKey: ["app-vs-amarsoft"],
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const [pending, sold] = await Promise.all([
        sb.from("products").select("id, name, sku, barcode_value, amarsoft_status, created_at").eq("amarsoft_status", "pending")
          .neq("status", "archived").order("created_at", { ascending: false }).limit(200),
        sb.from("products").select("id, name, sku, barcode_value, amarsoft_status, created_at").eq("amarsoft_status", "sold")
          .eq("status", "available").order("created_at", { ascending: false }).limit(200),
      ]);
      return { pending: (pending.data ?? []) as AppPiece[], sold: (sold.data ?? []) as AppPiece[] };
    },
  });
  if (!data || (!data.pending.length && !data.sold.length)) return null;
  const list = open === "pending" ? data.pending : open === "sold" ? data.sold : [];
  return (
    <Card className="p-3 space-y-2">
      <div className="flex gap-2 flex-wrap">
        {data.pending.length > 0 && (
          <Button size="sm" variant={open === "pending" ? "default" : "outline"} onClick={() => setOpen(open === "pending" ? null : "pending")}>
            بانتظار أمارسوفت ({data.pending.length})
          </Button>
        )}
        {data.sold.length > 0 && (
          <Button size="sm" variant={open === "sold" ? "destructive" : "outline"} onClick={() => setOpen(open === "sold" ? null : "sold")}>
            مباعة في أمارسوفت ومعروضة في التطبيق ({data.sold.length})
          </Button>
        )}
      </div>
      {open && (
        <>
          <p className="text-xs text-muted-foreground">
            {open === "pending"
              ? "سجّل هذه القطع في أمارسوفت بنفس رقم الوسم — تتحوّل إلى «مطابقة» تلقائياً خلال ساعة."
              : "أمارسوفت يقول إن هذه القطع بيعت، لكنها ما زالت «متاحة» في التطبيق — راجعها."}
          </p>
          <div className="divide-y">
            {list.map((p) => (
              <Link key={p.id} to={`/products/${p.id}`} className="flex justify-between gap-2 py-2 text-sm hover:bg-muted/30 rounded px-1">
                <span className="truncate">{p.name}</span>
                <span className="text-xs text-muted-foreground shrink-0" dir="ltr">{p.barcode_value} · {p.sku}</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </Card>
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

function PieceDetails({ p, branchName, isAdmin }: { p: Piece; branchName: string; isAdmin: boolean }) {
  // الفاتورة التي بيعت بها القطعة (للمدير العام فقط — صلاحية قراءة الفواتير).
  const sale = useQuery({
    queryKey: ["amarsoft-piece-sale", p.branch_code, p.tag],
    enabled: !p.in_stock && isAdmin,
    queryFn: async () => {
      const { data, error } = await sb.from("amarsoft_invoices").select("invoice_no, invoice_date, net_dirhams, details")
        .eq("branch_code", p.branch_code).eq("is_deleted", false)
        // contains() sends arrays as a Postgres array literal; items is jsonb, so send JSON.
        .filter("items", "cs", JSON.stringify([{ tag: p.tag }]))
        .order("sold_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data as { invoice_no: string; invoice_date: string; net_dirhams: number; details: { customer?: string } | null } | null;
    },
  });

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <span dir="ltr">{p.tag}</span> — {p.type_name ?? p.type_code}
          <Badge variant={p.in_stock ? "default" : "secondary"}>{p.in_stock ? "في المخزون" : "مباعة"}</Badge>
        </SheetTitle>
      </SheetHeader>
      <div className="mt-3 rounded-lg border p-3 divide-y">
        <Row label="الفرع" value={branchName} />
        <Row label="الكود" value={p.item_code} />
        <Row label="العيار" value={p.karat ? `${p.karat}K` : null} />
        <Row label="الوزن القائم" value={g(p.grams_in)} />
        <Row label="الوزن الصافي" value={p.pure_grams_in ? g(p.pure_grams_in) : null} />
        {p.in_stock && p.grams !== p.grams_in && <Row label="الوزن الحالي" value={g(p.grams)} />}
        <Row label="مصنعية البيع/جم" value={p.making_sale_rate ? p.making_sale_rate.toLocaleString("en-US") : null} />
        {isAdmin && <Row label="مصنعية الشراء/جم" value={p.making_cost_rate ? p.making_cost_rate.toLocaleString("en-US") : null} />}
        {isAdmin && <Row label="تكلفة المصنعية" value={p.cost_dirhams ? formatLD(p.cost_dirhams) : null} />}
        <Row label="المورّد" value={p.supplier_name} />
        <Row label="تاريخ الدخول" value={p.received_on} />
        <Row label="تاريخ البيع" value={p.sold_on} />
      </div>
      {!p.in_stock && isAdmin && (
        <div className="mt-3 rounded-lg border p-3 text-sm">
          {sale.isLoading ? <Loader2 className="size-4 animate-spin" /> : sale.data ? (
            <Link to={`/pos-sales?q=${encodeURIComponent(p.tag)}`} className="flex justify-between text-primary">
              <span>فاتورة البيع #{sale.data.invoice_no} · {sale.data.invoice_date}{sale.data.details?.customer ? ` · ${sale.data.details.customer}` : ""}</span>
              <span className="font-bold">{formatLD(sale.data.net_dirhams)}</span>
            </Link>
          ) : <span className="text-muted-foreground">لم تُعثر على فاتورة البيع.</span>}
        </div>
      )}
    </>
  );
}
