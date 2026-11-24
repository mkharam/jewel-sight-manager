// خانة «الفروع» في صفحة الولاء: كل فرع كم زبون عنده بطاقة (حسب فرع البطاقة)، مستوياتهم وأختامهم، ونشاط الفرع
// في الفترة — بطاقات جديدة، مسح الموظفين، فواتير بعتها الربط، وكم فاتورة فيها رقم الزبون. باش يبان أنهي فرع ناشط.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { sb } from "@/lib/amarsoft";

type Row = {
  branch_code: string; branch_name: string; members: number; installed: number; bronze: number; silver: number; gold: number;
  stamp_holders: number; stamps_in_progress: number; rewards_unused: number; new_cards: number; scans: number; link_sent: number;
  sales: number; sales_with_phone: number; member_sales: number;
};

const PERIODS = [{ days: 30, label: "آخر 30 يوم" }, { days: 90, label: "آخر 3 شهور" }, { days: 3650, label: "من البداية" }] as const;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const name = (r: Row) => r.branch_name.replace(/^\d+\s*-\s*/, "");

// نشيط: عنده أعضاء وصار فيه حاجة في الفترة. ضعيف: عنده أعضاء وما صار شي، أو الأرقام ما تتسجّلش. واقف: ما عندهش أعضاء.
function status(r: Row) {
  const activity = r.new_cards + r.scans + r.link_sent;
  if (!r.members) return { label: "واقف", cls: "bg-red-100 text-red-900", note: "ولا زبون طلّع بطاقة من الفرع هذا." };
  if (activity > 0 && pct(r.sales_with_phone, r.sales) >= 50) return { label: "نشيط", cls: "bg-emerald-100 text-emerald-900", note: "" };
  return {
    label: "ضعيف", cls: "bg-amber-100 text-amber-900",
    note: activity ? "الموظفين ما يكتبوش رقم الزبون في أغلب الفواتير." : "عنده أعضاء لكن ما صار شي في الفترة هذي.",
  };
}

export default function LoyaltyBranches() {
  const [days, setDays] = useState<number>(30);
  const { data, isLoading } = useQuery({
    queryKey: ["loyalty-branch-report", days],
    queryFn: async () => {
      const { data, error } = await sb.rpc("loyalty_branch_report", { p_days: days });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const { branches, unknown } = useMemo(() => {
    const all = data ?? [];
    return { branches: all.filter((r) => r.branch_code !== "—"), unknown: all.find((r) => r.branch_code === "—") };
  }, [data]);

  const summary = useMemo(() => {
    if (!branches.length) return "";
    const ranked = [...branches].sort((a, b) => (b.members * 2 + b.new_cards * 5 + b.scans + b.link_sent * 3) - (a.members * 2 + a.new_cards * 5 + a.scans + a.link_sent * 3));
    const stopped = branches.filter((r) => !r.members).map(name);
    const best = ranked[0];
    return [
      best.members ? `أنشط فرع: ${name(best)} (${best.members} زبون عنده بطاقة).` : "",
      (() => {
        const used = [...branches].filter((r) => r.sales).sort((a, b) => b.member_sales / b.sales - a.member_sales / a.sales)[0];
        return used?.member_sales ? `أكثر فرع يستعمل البطاقة في البيع: ${name(used)} (${pct(used.member_sales, used.sales)}% من فواتيره لأعضاء).` : "";
      })(),
      stopped.length ? `فروع ما طلّعتش حتى بطاقة: ${stopped.join("، ")}.` : "",
    ].filter(Boolean).join(" ");
  }, [branches]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-1.5">
        {PERIODS.map((p) => (
          <Button key={p.days} size="sm" variant={days === p.days ? "default" : "outline"} onClick={() => setDays(p.days)}>{p.label}</Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        فرع البطاقة: الفرع اللي شرى منه الزبون يوم ما طلّعها، ولا أول فرع مسح بطاقته، ولا الفرع اللي يشري منه أكثر. الأعضاء والمستويات
        والأختام هي الوضع توا؛ الباقي في الفترة اللي اخترتها.
      </p>
      {isLoading ? <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-primary" /></div> : (
        <>
          {summary && <Card className="p-3 text-sm font-medium">{summary}</Card>}
          {branches.map((r) => {
            const s = status(r);
            return (
              <Card key={r.branch_code} className="p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-bold text-lg">{name(r)}</p>
                  <span className={`text-xs rounded-full px-2.5 py-0.5 ${s.cls}`}>{s.label}</span>
                </div>
                {s.note && <p className="text-xs text-muted-foreground">{s.note}</p>}
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
                  <Stat n={r.members} label="عنده بطاقة" />
                  <Stat n={r.installed} label="مركّبها" />
                  <Stat n={r.gold} label="ذهبي" />
                  <Stat n={r.silver} label="فضي" />
                  <Stat n={r.bronze} label="برونزي" />
                  <Stat n={r.stamp_holders} label="بطاقة أختام" />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-sm">
                  <Line k="بطاقات جديدة" v={r.new_cards} />
                  <Line k="مسح بالماسح" v={r.scans} />
                  <Line k="فواتير بعتها الربط" v={r.link_sent} />
                  <Line k="أختام في الطريق" v={r.stamps_in_progress} />
                  <Line k="مكافآت ما استعملتش" v={r.rewards_unused} />
                  <Line k="فواتير لأعضاء" v={r.member_sales} />
                </div>
                <div>
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>فواتير فيها رقم الزبون</span>
                    <span className="tabular-nums">{r.sales_with_phone} من {r.sales} ({pct(r.sales_with_phone, r.sales)}%)</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${pct(r.sales_with_phone, r.sales)}%` }} />
                  </div>
                </div>
              </Card>
            );
          })}
          <StaffUsage days={days} />
          {unknown && unknown.members > 0 && (
            <Card className="p-3 text-sm text-muted-foreground">
              {unknown.members} زبون عندهم بطاقة لكن ما نعرفوش فرعهم: ما شروش برقمهم في أمارسوفت وعمر بطاقتهم ما تمسحت.
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="rounded-lg bg-muted/40 py-1.5">
      <p className="text-xl font-black tabular-nums">{n}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function Line({ k, v }: { k: string; v: number }) {
  return (<div className="flex justify-between"><span className="text-muted-foreground">{k}</span><span className="tabular-nums font-medium">{v}</span></div>);
}

type StaffRow = { branch_code: string; sman: string | null; salesman_name: string | null; sales: number; with_phone: number; member_sales: number };

/** كل بائع: كم فاتورة باعها لزبون عنده بطاقة — من رقم الزبون في فاتورة أمارسوفت. يدخل في تقييم البائعين. */
function StaffUsage({ days }: { days: number }) {
  const { data, error } = useQuery({
    queryKey: ["loyalty-staff-report", days],
    queryFn: async () => {
      const end = new Date();
      const start = new Date(end.getTime() - days * 86_400_000);
      const { data, error } = await sb.rpc("loyalty_staff_report", { p_start: start.toISOString(), p_end: end.toISOString() });
      if (error) throw error;
      return ((data ?? []) as StaffRow[]).filter((r) => r.sman && r.sales >= 3)
        .sort((a, b) => b.member_sales / b.sales - a.member_sales / a.sales || b.sales - a.sales);
    },
  });
  if (error) return <Card className="p-3 text-xs text-muted-foreground">استعمال البطاقة لكل بائع يبان بعد ما يتشغّل ملف التحديث (RUN_ONCE_2026-11-24b.sql).</Card>;
  if (!data?.length) return null;
  return (
    <Card className="p-3 space-y-2">
      <p className="font-bold">مين يستعمل البطاقة من البائعين</p>
      <p className="text-xs text-muted-foreground">فواتيره اللي كانت لزبون عنده بطاقة ولاء (من رقم الزبون في الفاتورة). نفس الرقم يدخل في «تقييم البائعين».</p>
      {data.map((r) => (
        <div key={`${r.branch_code}|${r.sman}`}>
          <div className="flex justify-between gap-2 text-sm">
            <span className="truncate">{r.salesman_name} <span className="text-xs text-muted-foreground">· فرع {r.branch_code}</span></span>
            <span className="tabular-nums shrink-0">{r.member_sales} من {r.sales} ({pct(r.member_sales, r.sales)}%)</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary" style={{ width: `${pct(r.member_sales, r.sales)}%` }} />
          </div>
        </div>
      ))}
    </Card>
  );
}
