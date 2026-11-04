import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Trophy } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth, hasRole } from "@/hooks/useAuth";
import { sb, periodDays, daysToRange, formatLD, formatGrams, type Period } from "@/lib/amarsoft";

type Row = {
  branch_code: string; branch_name: string | null; sman: string; salesman_name: string | null; profile_id: string | null;
  invoices: number; returns: number; pieces: number; grams: number; pure_grams: number; net_dirhams: number | null;
};
type Tagging = { branch_code: string; branch_name: string; invoices: number; tagged: number; salesmen: number };
type SortKey = "amount" | "grams" | "invoices";

const MEDALS = ["🥇", "🥈", "🥉"];
const ALL = "all";
const PERIODS: { key: Period; label: string }[] = [
  { key: "today", label: "اليوم" }, { key: "week", label: "الأسبوع" },
  { key: "month", label: "الشهر" }, { key: "year", label: "السنة" },
];

async function fetchBoard(period: Period, branch: string | null) {
  const { from, to } = periodDays(period);
  const { start, end } = daysToRange(from, to);
  const { data, error } = await sb.rpc("amarsoft_leaderboard_v2", { p_start: start, p_end: end, p_branch: branch });
  if (error) throw error;
  return (data ?? []) as Row[];
}

export default function Leaderboard() {
  const { roles, user } = useAuth();
  const isAdmin = hasRole(roles, "admin");
  const [period, setPeriod] = useState<Period>("month");
  const [branch, setBranch] = useState(ALL);
  const [sort, setSort] = useState<SortKey>(isAdmin ? "amount" : "grams");
  const [open, setOpen] = useState<Row | null>(null);

  const board = useQuery({
    queryKey: ["amarsoft-leaderboard-v2", period, branch],
    queryFn: () => fetchBoard(period, branch === ALL ? null : branch),
  });
  const tagging = useQuery({
    queryKey: ["amarsoft-branch-tagging", period],
    queryFn: async () => {
      const { from, to } = periodDays(period);
      const { start, end } = daysToRange(from, to);
      const { data, error } = await sb.rpc("amarsoft_branch_tagging", { p_start: start, p_end: end });
      if (error) throw error;
      return (data ?? []) as Tagging[];
    },
  });

  const rows = useMemo(() => {
    const list = [...(board.data ?? [])];
    const val = (r: Row) => (sort === "grams" ? Number(r.grams) : sort === "invoices" ? Number(r.invoices) : Number(r.net_dirhams ?? 0));
    return list.sort((a, b) => val(b) - val(a));
  }, [board.data, sort]);
  const totals = useMemo(() => rows.reduce(
    (t, r) => ({ grams: t.grams + Number(r.grams), invoices: t.invoices + Number(r.invoices), pieces: t.pieces + Number(r.pieces) }),
    { grams: 0, invoices: 0, pieces: 0 },
  ), [rows]);
  const scopeTagging = (tagging.data ?? []).filter((t) => branch === ALL || t.branch_code === branch);
  const untaggedBranches = scopeTagging.filter((t) => Number(t.invoices) > 0 && Number(t.tagged) < Number(t.invoices));

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Trophy className="size-6 text-primary" />
        <h1 className="text-2xl font-bold">لوحة المتصدرين</h1>
      </div>

      <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
        <TabsList className="grid grid-cols-4 w-full">
          {PERIODS.map((p) => <TabsTrigger key={p.key} value={p.key}>{p.label}</TabsTrigger>)}
        </TabsList>
      </Tabs>

      {/* لوحة لكل فرع + لوحة لكل الفروع */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        <Button size="sm" variant={branch === ALL ? "default" : "outline"} onClick={() => setBranch(ALL)} className="shrink-0">كل الفروع</Button>
        {(tagging.data ?? []).map((t) => (
          <Button key={t.branch_code} size="sm" variant={branch === t.branch_code ? "default" : "outline"} onClick={() => setBranch(t.branch_code)} className="shrink-0">
            {t.branch_name}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="الوزن المباع" value={formatGrams(totals.grams)} />
        <Stat label="الفواتير" value={totals.invoices.toLocaleString("en-US")} />
        <Stat label="القطع" value={totals.pieces.toLocaleString("en-US")} />
      </div>

      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">الترتيب حسب:</span>
        {isAdmin && <SortButton k="amount" sort={sort} setSort={setSort}>المبلغ</SortButton>}
        <SortButton k="grams" sort={sort} setSort={setSort}>الوزن</SortButton>
        <SortButton k="invoices" sort={sort} setSort={setSort}>الفواتير</SortButton>
      </div>

      {board.isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : board.error ? (
        <Card className="p-6 text-center text-sm text-destructive">تعذّر تحميل اللوحة: {(board.error as Error).message}</Card>
      ) : !rows.length ? (
        <Card className="p-6 text-center text-sm text-muted-foreground leading-relaxed">
          لم يتم تسجيل أي بائع على الفواتير في هذه الفترة. اختر اسم الموظف في خانة "الناقل" في أمارسوفت عند كل بيع.
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => {
            const me = !!user && r.profile_id === user.id;
            return (
              <button key={`${r.branch_code}-${r.sman}`} onClick={() => setOpen(r)} className="w-full text-right">
                <Card className={`p-3 flex items-center gap-3 ${i < 3 ? "border-primary/40" : ""} ${me ? "ring-2 ring-primary" : ""}`}>
                  <div className="w-10 text-center text-2xl font-bold shrink-0">
                    {i < 3 ? MEDALS[i] : <span className="text-base text-muted-foreground">{i + 1}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold truncate flex items-center gap-1.5">
                      {r.salesman_name || r.sman}
                      {me && <Badge className="text-[10px]">أنت</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.branch_name ?? r.branch_code} · {r.invoices} فاتورة · {Number(r.pieces)} قطعة
                    </div>
                  </div>
                  <div className="text-left shrink-0">
                    <div className="font-bold text-primary whitespace-nowrap">{formatGrams(r.grams)}</div>
                    {r.net_dirhams != null && <div className="text-xs text-muted-foreground whitespace-nowrap">{formatLD(r.net_dirhams)}</div>}
                  </div>
                </Card>
              </button>
            );
          })}
        </div>
      )}

      {untaggedBranches.length > 0 && (
        <Card className="p-3 space-y-1.5 border-amber-500/40">
          <p className="text-xs font-bold flex items-center gap-1.5 text-amber-600"><AlertTriangle className="size-3.5" /> مبيعات بدون بائع (لا تُحسب في اللوحة)</p>
          {untaggedBranches.map((t) => {
            const missing = Number(t.invoices) - Number(t.tagged);
            return (
              <div key={t.branch_code} className="flex justify-between text-xs">
                <span>{t.branch_name}{Number(t.salesmen) === 0 ? " — لا يوجد بائعون في أمارسوفت" : ""}</span>
                <span className="text-muted-foreground">{missing} من {t.invoices} فاتورة</span>
              </div>
            );
          })}
        </Card>
      )}

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto" dir="rtl">
          {open && <EmployeeStats row={open} isAdmin={isAdmin} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SortButton({ k, sort, setSort, children }: { k: SortKey; sort: SortKey; setSort: (k: SortKey) => void; children: React.ReactNode }) {
  return (
    <Button size="sm" variant={sort === k ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => setSort(k)}>{children}</Button>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-bold mt-1">{value}</div>
    </Card>
  );
}

// أداء موظف واحد في كل الفترات، مع ترتيبه داخل فرعه.
function EmployeeStats({ row, isAdmin }: { row: Row; isAdmin: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ["amarsoft-employee-stats", row.branch_code, row.sman],
    queryFn: async () => {
      const out: { period: Period; label: string; me: Row | null; rank: number | null; of: number }[] = [];
      for (const p of PERIODS) {
        const list = await fetchBoard(p.key, row.branch_code);
        list.sort((a, b) => Number(b.grams) - Number(a.grams));
        const idx = list.findIndex((r) => r.sman === row.sman);
        out.push({ period: p.key, label: p.label, me: idx >= 0 ? list[idx] : null, rank: idx >= 0 ? idx + 1 : null, of: list.length });
      }
      return out;
    },
  });

  return (
    <>
      <SheetHeader>
        <SheetTitle>{row.salesman_name || row.sman} — {row.branch_name}</SheetTitle>
      </SheetHeader>
      <p className="text-xs text-muted-foreground mt-1">رمز البائع في أمارسوفت: {row.sman}{row.profile_id ? "" : " · غير مربوط بموظف في التطبيق"}</p>
      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-primary" /></div>
      ) : (
        <div className="mt-3 space-y-2">
          {data?.map((d) => (
            <Card key={d.period} className="p-3">
              <div className="flex justify-between items-center">
                <span className="font-bold">{d.label}</span>
                {d.rank && <span className="text-xs text-muted-foreground">المركز {d.rank} من {d.of} في الفرع (بالوزن)</span>}
              </div>
              {d.me ? (
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <span className="text-muted-foreground">الوزن المباع</span><span className="font-bold text-primary">{formatGrams(d.me.grams)}</span>
                  <span className="text-muted-foreground">الوزن الصافي</span><span>{formatGrams(d.me.pure_grams)}</span>
                  <span className="text-muted-foreground">الفواتير</span><span>{d.me.invoices}{d.me.returns ? ` (+${d.me.returns} مرتجع)` : ""}</span>
                  <span className="text-muted-foreground">القطع</span><span>{Number(d.me.pieces)}</span>
                  <span className="text-muted-foreground">متوسط الوزن للفاتورة</span>
                  <span>{formatGrams(d.me.invoices ? Number(d.me.grams) / Number(d.me.invoices) : 0)}</span>
                  {d.me.net_dirhams != null && (<><span className="text-muted-foreground">المبيعات</span><span>{formatLD(d.me.net_dirhams)}</span></>)}
                </div>
              ) : <p className="text-xs text-muted-foreground mt-1">لا مبيعات في هذه الفترة.</p>}
            </Card>
          ))}
          {isAdmin && (
            <Link to={`/pos-sales?sman=${encodeURIComponent(`${row.branch_code}|${row.sman}`)}`} className="block text-center text-sm text-primary underline underline-offset-2 py-2">
              كل فواتيره في مبيعات أمارسوفت
            </Link>
          )}
        </div>
      )}
    </>
  );
}
