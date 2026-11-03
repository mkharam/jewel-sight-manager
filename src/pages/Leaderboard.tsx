import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Trophy } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { sb, periodDays, daysToRange, formatLD, type Period } from "@/lib/amarsoft";

type Row = {
  rank: number; branch_code: string; branch_name: string | null; sman: string;
  salesman_name: string | null; invoices: number; net_dirhams: number | null;
};

const MEDALS = ["🥇", "🥈", "🥉"];

export default function Leaderboard() {
  const [period, setPeriod] = useState<Period>("today");
  const { data, isLoading, error } = useQuery({
    queryKey: ["amarsoft-leaderboard", period],
    queryFn: async () => {
      const { from, to } = periodDays(period);
      const { start, end } = daysToRange(from, to);
      const { data, error } = await sb.rpc("amarsoft_leaderboard", { p_start: start, p_end: end });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Trophy className="size-6 text-primary" />
        <h1 className="text-2xl font-bold">لوحة المتصدرين</h1>
      </div>
      <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="today">اليوم</TabsTrigger>
          <TabsTrigger value="week">هذا الأسبوع</TabsTrigger>
          <TabsTrigger value="month">هذا الشهر</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : error ? (
        <Card className="p-6 text-center text-sm text-destructive">تعذّر تحميل اللوحة: {(error as Error).message}</Card>
      ) : !data?.length ? (
        <Card className="p-6 text-center text-sm text-muted-foreground leading-relaxed">
          لم يتم تسجيل أي بائع على الفواتير بعد. اختر اسم الموظف في خانة "الناقل" في أمارسوفت عند كل بيع.
        </Card>
      ) : (
        <div className="space-y-2">
          {data.map((r) => (
            <Card key={`${r.branch_code}-${r.sman}`} className={`p-3 flex items-center gap-3 ${r.rank <= 3 ? "border-primary/40" : ""}`}>
              <div className="w-10 text-center text-2xl font-bold shrink-0">
                {r.rank <= 3 ? MEDALS[r.rank - 1] : <span className="text-base text-muted-foreground">{r.rank}</span>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold truncate">{r.salesman_name || r.sman}</div>
                <div className="text-xs text-muted-foreground">{r.branch_name ?? r.branch_code} · {r.invoices} فاتورة</div>
              </div>
              {r.net_dirhams != null && (
                <div className="font-bold text-primary whitespace-nowrap">{formatLD(r.net_dirhams)}</div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
