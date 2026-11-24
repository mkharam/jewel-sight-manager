// للمدير العام في أول الرئيسية: «اليوم في المحلات» — مبيعات اليوم في كل فرع من أمارسوفت، وتنبيه لو انمسحت
// فاتورة، والضغط على فرع يفتح صفحته الكاملة. نفس بيانات «المحلات ← اليوم» (daily_amarsoft) ونفس الكاش،
// فلما يفتح التفاصيل ما يستناش تحميل ثاني.
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, Loader2, Store } from "lucide-react";
import { Card } from "@/components/ui/card";
import { sb, tripoliToday } from "@/lib/amarsoft";

type DayBranch = { code: string; name: string; sales: number; net_ld: number; grams: number; deleted_today: number };
type DayData = { branches?: DayBranch[]; sync?: { amarsoft_at: string | null } };

const n0 = (n: number | null | undefined) => Math.round(Number(n ?? 0)).toLocaleString("en-US");
const g1 = (n: number) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 1 });
const clock = (iso: string) => new Date(iso).toLocaleTimeString("ar-LY", { timeZone: "Africa/Tripoli", hour: "numeric", minute: "2-digit" });
const invs = (n: number) => (n === 1 ? "فاتورة" : n === 2 ? "فاتورتين" : n >= 3 && n <= 10 ? `${n} فواتير` : `${n} فاتورة`);
/** «01 - حي الأندلس» ← «الأندلس». */
const shortName = (name: string) => (name.split(" - ")[1] ?? name).replace(/^حي\s+/, "");

export default function OwnerToday() {
  const day = tripoliToday();
  const { data, isLoading, error } = useQuery({
    queryKey: ["daily-amarsoft", day],
    queryFn: async () => {
      const { data, error } = await sb.rpc("daily_amarsoft", { p_day: day });
      if (error) throw error;
      return data as DayData;
    },
    refetchInterval: 60_000,
  });

  const branches = [...(data?.branches ?? [])].sort((a, b) => Number(b.net_ld) - Number(a.net_ld));
  const total = branches.reduce((t, b) => ({ ld: t.ld + Number(b.net_ld), g: t.g + Number(b.grams), n: t.n + Number(b.sales) }), { ld: 0, g: 0, n: 0 });
  const deleted = branches.reduce((n, b) => n + Number(b.deleted_today ?? 0), 0);
  const best = Math.max(1, ...branches.map((b) => Number(b.net_ld)));

  return (
    <Card className="space-y-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 font-bold"><Store className="size-4 text-primary" />اليوم في المحلات</h2>
        {data?.sync?.amarsoft_at && <span className="text-[11px] text-muted-foreground">آخر تحديث {clock(data.sync.amarsoft_at)}</span>}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-4"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      ) : error || !data ? (
        <p className="text-sm text-muted-foreground">ما قدرناش نجيبو مبيعات اليوم من أمارسوفت — جرّب بعد شوي.</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-gold-soft p-2 text-center">
            <div><p className="text-[11px] text-muted-foreground">المبيعات</p><p className="font-extrabold tabular-nums">{n0(total.ld)} <span className="text-xs font-semibold">د.ل</span></p></div>
            <div><p className="text-[11px] text-muted-foreground">الوزن</p><p className="font-extrabold tabular-nums">{g1(total.g)} <span className="text-xs font-semibold">جم</span></p></div>
            <div><p className="text-[11px] text-muted-foreground">الفواتير</p><p className="font-extrabold tabular-nums">{n0(total.n)}</p></div>
          </div>

          <div className="divide-y">
            {branches.map((b) => (
              <Link key={b.code} to={`/branches/${b.code}`} className="flex items-center gap-2 py-2 active:bg-muted/40">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{shortName(b.name)}</span>
                    {Number(b.sales) > 0
                      ? <span className="shrink-0 text-sm font-bold tabular-nums">{n0(b.net_ld)} د.ل</span>
                      : <span className="shrink-0 text-xs font-semibold text-amber-600 dark:text-amber-400">ما باعش لليوم</span>}
                  </div>
                  {Number(b.sales) > 0 && (
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((Number(b.net_ld) / best) * 100)}%` }} />
                      </div>
                      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{g1(Number(b.grams))} جم · {invs(Number(b.sales))}</span>
                    </div>
                  )}
                </div>
                <ChevronLeft className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </div>

          {deleted > 0 && (
            <Link to="/shops?tab=log" className="flex items-center gap-1.5 rounded-lg border border-destructive/50 bg-destructive/10 px-2.5 py-1.5 text-xs font-bold text-destructive">
              <AlertTriangle className="size-3.5 shrink-0" />انمسحت {deleted} فاتورة اليوم — شوفها ←
            </Link>
          )}
          <Link to="/shops?tab=today" className="block pt-1 text-center text-sm font-semibold text-primary">كل تفاصيل اليوم ←</Link>
        </>
      )}
    </Card>
  );
}
