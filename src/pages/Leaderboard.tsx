// لوحة المتصدرين: الترتيب بالوزن (هو الربح)، وبدل الأرقام كلام بسيط: مين الأكثر وزن، مين الأكثر
// فواتير، ومين فواتيره كثيرة بس قطعه خفيفة. الأرقام للمدير العام في صفحات أمارسوفت.
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
import { sb, periodDays, daysToRange, type Period } from "@/lib/amarsoft";

type Row = {
  branch_code: string; branch_name: string | null; sman: string; salesman_name: string | null; profile_id: string | null;
  invoices: number; returns: number; pieces: number; grams: number; pure_grams: number; net_dirhams: number | null;
};
type Tagging = { branch_code: string; branch_name: string; invoices: number; tagged: number; salesmen: number };

const MEDALS = ["🥇", "🥈", "🥉"];
const ORDINALS = ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر"];
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

const nameOf = (r: Row) => r.salesman_name || r.sman;
const sameAs = (a: Row, b: Row) => a.branch_code === b.branch_code && a.sman === b.sman;

/** ترتيب بالوزن، ومعاه ترتيب كل واحد بالفواتير — باش نكتبوا الكلام. */
function rank(list: Row[]) {
  const byGrams = [...list].sort((a, b) => Number(b.grams) - Number(a.grams));
  const byInvoices = [...list].sort((a, b) => Number(b.invoices) - Number(a.invoices) || Number(b.grams) - Number(a.grams));
  return byGrams.map((r, i) => ({ row: r, weightRank: i, invoiceRank: byInvoices.findIndex((x) => sameAs(x, r)) }));
}

/** جملة قصيرة لكل بائع: وين هو في الوزن مقارنة بالفواتير. */
function describe(weightRank: number, invoiceRank: number, n: number) {
  if (n === 1) return "الوحيد اللي باع في الفترة هذي";
  if (weightRank === 0 && invoiceRank === 0) return "الأكثر وزن والأكثر فواتير 👏";
  if (weightRank === 0) return "الأكثر وزن — باع قطع ثقيلة";
  if (invoiceRank === 0) return "الأكثر فواتير، لكن قطعه أخف";
  if (invoiceRank < weightRank) return "فواتيره كثيرة، لكن القطع خفيفة";
  if (invoiceRank > weightRank) return "فواتير أقل، لكن قطع ثقيلة";
  return `${ORDINALS[weightRank] ?? "نفس الترتيب"} في الوزن والفواتير`;
}

export default function Leaderboard() {
  const { roles, user } = useAuth();
  const isAdmin = hasRole(roles, "admin");
  const [period, setPeriod] = useState<Period>("month");
  const [branch, setBranch] = useState(ALL);
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

  const ranked = useMemo(() => rank(board.data ?? []), [board.data]);
  const topWeight = ranked[0]?.row;
  const topInvoices = ranked.find((r) => r.invoiceRank === 0)?.row;
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
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Button size="sm" variant={branch === ALL ? "default" : "outline"} onClick={() => setBranch(ALL)} className="shrink-0">كل الفروع</Button>
        {(tagging.data ?? []).map((t) => (
          <Button key={t.branch_code} size="sm" variant={branch === t.branch_code ? "default" : "outline"} onClick={() => setBranch(t.branch_code)} className="shrink-0">
            {t.branch_name}
          </Button>
        ))}
      </div>

      {board.isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : board.error ? (
        <Card className="p-6 text-center text-sm text-destructive">تعذّر تحميل اللوحة: {(board.error as Error).message}</Card>
      ) : !ranked.length ? (
        <Card className="p-6 text-center text-sm text-muted-foreground leading-relaxed">
          لم يتم تسجيل أي بائع على الفواتير في هذه الفترة. اختر اسم الموظف في خانة "الناقل" في أمارسوفت عند كل بيع.
        </Card>
      ) : (
        <>
          {topWeight && topInvoices && (
            <Card className="p-4 bg-gold-soft border-primary/30 space-y-1">
              {sameAs(topWeight, topInvoices) ? (
                <p className="text-base"><b>{nameOf(topWeight)}</b> الأول: باع أكثر وزن وعنده أكثر فواتير 👏</p>
              ) : (
                <p className="text-base">
                  <b>{nameOf(topWeight)}</b> الأول لأنه باع أكثر وزن، و<b>{nameOf(topInvoices)}</b> عنده فواتير أكثر لكن قطعه أخف.
                </p>
              )}
              <p className="text-xs text-muted-foreground">الترتيب بالوزن، لأن الوزن هو الربح.</p>
            </Card>
          )}

          <div className="space-y-2">
            {ranked.map(({ row: r, weightRank: i, invoiceRank }) => {
              const me = !!user && r.profile_id === user.id;
              const note = describe(i, invoiceRank, ranked.length);
              return (
                <button key={`${r.branch_code}-${r.sman}`} onClick={() => setOpen(r)} className="w-full text-right">
                  <Card className={`p-3 flex items-center gap-3 ${i < 3 ? "border-primary/40" : ""} ${me ? "ring-2 ring-primary" : ""}`}>
                    <div className="w-10 text-center text-2xl font-bold shrink-0">
                      {i < 3 ? MEDALS[i] : <span className="text-base text-muted-foreground">{i + 1}</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold truncate flex items-center gap-1.5">
                        {nameOf(r)}
                        {me && <Badge className="text-[10px]">أنت</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">{r.branch_name ?? r.branch_code}</div>
                      {note && <div className="text-sm mt-0.5">{note}</div>}
                    </div>
                  </Card>
                </button>
              );
            })}
          </div>
        </>
      )}

      {untaggedBranches.length > 0 && (
        <Card className="p-3 space-y-1.5 border-amber-500/40">
          <p className="text-xs font-bold flex items-center gap-1.5 text-amber-600"><AlertTriangle className="size-3.5" /> فيه فواتير بدون اسم البائع (ما تنحسبش في اللوحة)</p>
          {untaggedBranches.map((t) => (
            <div key={t.branch_code} className="text-xs">
              {t.branch_name}{Number(t.salesmen) === 0 ? " — ما فيش بائعين مسجلين في أمارسوفت" : " — اختاروا اسم البائع في كل فاتورة"}
            </div>
          ))}
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

// ترتيب موظف واحد داخل فرعه في كل الفترات — كلام بدل أرقام.
function EmployeeStats({ row, isAdmin }: { row: Row; isAdmin: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ["amarsoft-employee-stats", row.branch_code, row.sman],
    queryFn: async () => {
      const out: { period: Period; label: string; place: number | null; of: number; note: string }[] = [];
      for (const p of PERIODS) {
        const list = rank(await fetchBoard(p.key, row.branch_code));
        const me = list.find((x) => sameAs(x.row, row));
        out.push({
          period: p.key, label: p.label, place: me ? me.weightRank + 1 : null, of: list.length,
          note: me ? describe(me.weightRank, me.invoiceRank, list.length) : "",
        });
      }
      return out;
    },
  });

  return (
    <>
      <SheetHeader>
        <SheetTitle>{nameOf(row)} — {row.branch_name}</SheetTitle>
      </SheetHeader>
      <p className="text-xs text-muted-foreground mt-1">ترتيبه في فرعه بالوزن.{row.profile_id ? "" : " غير مربوط بموظف في التطبيق."}</p>
      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-primary" /></div>
      ) : (
        <div className="mt-3 space-y-2">
          {data?.map((d) => (
            <Card key={d.period} className="p-3">
              <div className="flex justify-between items-center gap-2">
                <span className="font-bold">{d.label}</span>
                {d.place
                  ? <span className="text-sm">{d.place <= 3 ? MEDALS[d.place - 1] : ""} المركز {d.place} من {d.of}</span>
                  : <span className="text-xs text-muted-foreground">ما باعش في الفترة هذي</span>}
              </div>
              {d.note && <p className="text-sm text-muted-foreground mt-1">{d.note}</p>}
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
