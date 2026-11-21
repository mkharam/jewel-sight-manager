// سعر الذهب والدولار اليوم (من market_rates، تتحدّث كل ساعة): الأونصة، الدولار الموازي والرسمي،
// وقيمة جرام الذهب الخام لعيار 18 و21 بالدينار — اللي تنحسب عليه الأرباح «فوق سعر الذهب».
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { sb } from "@/lib/amarsoft";

type Rate = { day: string; xau_usd_oz: number | null; usd_lyd_official: number | null; usd_lyd_market: number | null; market_source: string | null };
const f = (v: number | null | undefined, d = 0) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d }));

export function useMarketRates() {
  return useQuery({
    queryKey: ["market-rates-latest"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await sb.from("market_rates").select("*").order("day", { ascending: false }).limit(15);
      const rows = (data ?? []) as Rate[];
      const gold = rows.find((r) => r.xau_usd_oz)?.xau_usd_oz ?? null;
      const mk = rows.find((r) => r.usd_lyd_market) ?? null;
      const off = rows.find((r) => r.usd_lyd_official)?.usd_lyd_official ?? null;
      const g24 = gold && mk?.usd_lyd_market ? (Number(gold) / 31.1035) * Number(mk.usd_lyd_market) : null;
      return { gold, market: mk?.usd_lyd_market ?? null, marketDay: mk?.day ?? null, official: off, g24 };
    },
  });
}

export default function MarketRatesCard() {
  const { data } = useMarketRates();
  if (!data || (!data.gold && !data.market)) return null;
  return (
    <Card className="p-3 grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-sm">
      <div><div className="text-[11px] text-muted-foreground">أونصة الذهب</div><div className="font-bold tabular-nums">${f(data.gold)}</div></div>
      <div><div className="text-[11px] text-muted-foreground">الدولار الموازي</div><div className="font-bold tabular-nums">{f(data.market, 3)}</div><div className="text-[10px] text-muted-foreground">{data.marketDay}</div></div>
      <div><div className="text-[11px] text-muted-foreground">الدولار الرسمي</div><div className="font-bold tabular-nums">{f(data.official, 3)}</div></div>
      <div><div className="text-[11px] text-muted-foreground">جرام 18 خام</div><div className="font-bold tabular-nums">{data.g24 ? `${f(data.g24 * 0.75)} د.ل` : "—"}</div></div>
      <div><div className="text-[11px] text-muted-foreground">جرام 21 خام</div><div className="font-bold tabular-nums">{data.g24 ? `${f(data.g24 * 0.875)} د.ل` : "—"}</div></div>
      <p className="col-span-full text-[11px] text-muted-foreground">قيمة الذهب الخام = سعر الأونصة ÷ 31.1 × الدولار الموازي × العيار. تتحدّث كل ساعة.</p>
    </Card>
  );
}
