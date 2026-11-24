// العملات من «بكم» (تتقرا وحدها كل 10 دقايق): الدولار واليورو والإسترليني نقداً، الصكوك، والحوالات.
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { sb } from "@/lib/amarsoft";

type Row = { page: string; item: string; sell: number | null; buy: number | null; value: number | null; unit: string | null; bekam_at: string | null };

const n = (v: number | null) => (v == null ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 3 }));
const when = (t: string | null) => (t ? t.slice(5, 16).replace("-", "/") : "");

export default function BekamRates() {
  const { data, error } = useQuery({
    queryKey: ["bekam-prices"],
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await sb.from("bekam_prices").select("page,item,sell,buy,value,unit,bekam_at").in("page", ["cash", "cheque", "transfer"]);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });
  if (error || !data?.length) return null; // قبل ملف التحديث ولا قبل أول قراءة

  // المهم أول: العملات اللي عندها بيع/شراء. السحب والحوالات لدول بعيدة تحت.
  const pick = (page: string) => data.filter((r) => r.page === page && r.sell != null).sort((a, b) => (b.bekam_at ?? "").localeCompare(a.bekam_at ?? ""));
  const groups: [string, Row[]][] = [["نقداً", pick("cash")], ["صكوك", pick("cheque")], ["حوالات", pick("transfer")]];
  return (
    <Card className="space-y-2 p-3">
      <h2 className="text-lg font-bold">العملات في السوق الموازي</h2>
      {groups.filter(([, rows]) => rows.length).map(([title, rows]) => (
        <div key={title}>
          <p className="mb-1 text-xs font-bold text-muted-foreground">{title}</p>
          <div className="divide-y rounded-xl border">
            {rows.map((r) => (
              <div key={r.item} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-sm">
                <span className="min-w-0 truncate">{r.item.replace(/\s+/g, " ")}</span>
                <span className="shrink-0 tabular-nums">
                  <b>{n(r.sell)}</b><span className="text-[11px] text-muted-foreground"> / {n(r.buy)} · {when(r.bekam_at)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <p className="text-[11px] text-muted-foreground">بيع / شراء بالدينار — من «بكم»، يتحدّث وحده.</p>
    </Card>
  );
}
