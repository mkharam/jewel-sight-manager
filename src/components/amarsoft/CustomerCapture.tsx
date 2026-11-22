// «تسجيل الزبائن»: كل فرع وكل بائع — كم فاتورة بيع فيها اسم الزبون، وكم فيها رقمه. الاسم الحقيقي بس
// (مش «ذهب مسبوك» ولا حرف واحد)، والرقم موبايل ليبي صحيح. نفس الأرقام تدخل في نقاط التقييم.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, UserCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { addDays, daysToRange, periodDays, sb, tripoliToday } from "@/lib/amarsoft";
import { isMissingInDb } from "@/lib/goldMarket";

type Row = {
  branch_code: string; branch_name: string; sman: string; salesman_name: string; is_store: boolean;
  invoices: number; with_name: number; with_phone: number; with_both: number;
};
type Agg = { invoices: number; name: number; phone: number; both: number };
const PERIODS = [
  { key: "week", label: "الأسبوع" }, { key: "month", label: "الشهر" }, { key: "3m", label: "3 شهور" },
] as const;
type PeriodKey = (typeof PERIODS)[number]["key"];

const sum = (rows: Row[]): Agg => rows.reduce((a, r) => ({
  invoices: a.invoices + Number(r.invoices), name: a.name + Number(r.with_name),
  phone: a.phone + Number(r.with_phone), both: a.both + Number(r.with_both),
}), { invoices: 0, name: 0, phone: 0, both: 0 });
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const short = (s: string) => s.replace(/^\d+\s*-\s*/, "");

function level(p: number) {
  return p >= 80 ? { label: "ممتاز", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" }
    : p >= 40 ? { label: "متوسط", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" }
    : { label: "ضعيف", cls: "bg-destructive/15 text-destructive" };
}

function Bar({ label, n, of }: { label: string; n: number; of: number }) {
  const p = pct(n, of);
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-xs"><span>{label}</span><span className="font-bold tabular-nums">{p}% <span className="font-normal text-muted-foreground">({n} من {of})</span></span></div>
      <div className="h-2 rounded-full bg-muted">
        <div className={cn("h-full rounded-full", p >= 80 ? "bg-emerald-500" : p >= 40 ? "bg-amber-500" : "bg-destructive")} style={{ width: `${Math.max(p, 2)}%` }} />
      </div>
    </div>
  );
}

export default function CustomerCapture() {
  const [period, setPeriod] = useState<PeriodKey>("month");
  const range = useMemo(() => {
    const today = tripoliToday();
    const r = period === "3m" ? { from: addDays(today, -89), to: today } : periodDays(period);
    return daysToRange(r.from, r.to);
  }, [period]);
  const q = useQuery({
    queryKey: ["customer-capture", period],
    retry: false,
    queryFn: async () => {
      const { data, error } = await sb.rpc("amarsoft_customer_capture", { p_start: range.start, p_end: range.end });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const branches = useMemo(() => {
    const rows = q.data ?? [];
    return [...new Set(rows.map((r) => r.branch_code))].map((code) => {
      const rs = rows.filter((r) => r.branch_code === code);
      return { code, name: short(rs[0].branch_name), t: sum(rs), people: rs.filter((r) => Number(r.invoices) > 0).sort((a, b) => Number(b.invoices) - Number(a.invoices)) };
    }).sort((a, b) => pct(b.t.both, b.t.invoices) - pct(a.t.both, a.t.invoices));
  }, [q.data]);
  const all = sum(q.data ?? []);

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <Card className="space-y-2 p-3">
        <h2 className="flex items-center gap-2 text-lg font-bold"><UserCheck className="size-5 text-primary" />تسجيل اسم ورقم الزبون</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          كل فاتورة بيع لازم يكون فيها اسم الزبون ورقم تلفونه — باش نتواصلو معاه، نعرفو مين يرجع يشري، ونبعتوله العروض.
          الاسم الحقيقي بس يتحسب (مش «ذهب مسبوك» ولا حرف واحد)، والرقم لازم يكون موبايل صحيح.
        </p>
        <div className="flex gap-1.5">
          {PERIODS.map((p) => (
            <button key={p.key} onClick={() => setPeriod(p.key)}
              className={cn("rounded-full border px-3 py-1.5 text-sm font-semibold", period === p.key ? "border-primary bg-primary text-primary-foreground" : "bg-card")}>
              {p.label}
            </button>
          ))}
        </div>
      </Card>

      {q.isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : q.error && isMissingInDb(q.error) ? (
        <Card className="p-4 text-sm">
          الخانة هذي تحتاج تحديث قاعدة البيانات مرة وحدة: شغّل ملف <b>RUN_ONCE_2026-11-22.sql</b> في Supabase ← SQL Editor.
        </Card>
      ) : q.error ? (
        <p className="text-sm text-destructive">تعذّر التحميل: {(q.error as Error).message}</p>
      ) : !all.invoices ? (
        <p className="py-6 text-center text-sm text-muted-foreground">ما فيش فواتير بيع في الفترة هذي.</p>
      ) : (
        <>
          <Card className="grid grid-cols-3 gap-2 p-3 text-center">
            <div><div className="text-[11px] text-muted-foreground">فواتير البيع</div><div className="text-xl font-extrabold tabular-nums">{all.invoices}</div></div>
            <div><div className="text-[11px] text-muted-foreground">فيها الاسم</div><div className="text-xl font-extrabold tabular-nums">{pct(all.name, all.invoices)}%</div></div>
            <div><div className="text-[11px] text-muted-foreground">فيها الرقم</div><div className="text-xl font-extrabold tabular-nums">{pct(all.phone, all.invoices)}%</div></div>
          </Card>

          {branches.map((b) => {
            const lv = level(pct(b.t.both, b.t.invoices));
            return (
              <Card key={b.code} className="space-y-2.5 p-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-bold">{b.name} <span className="text-xs font-normal text-muted-foreground">{b.t.invoices} فاتورة</span></h3>
                  <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-bold", lv.cls)}>{lv.label}</span>
                </div>
                <Bar label="فيها اسم الزبون" n={b.t.name} of={b.t.invoices} />
                <Bar label="فيها رقم الزبون" n={b.t.phone} of={b.t.invoices} />
                <div className="divide-y rounded-lg border text-sm">
                  {b.people.map((p) => (
                    <div key={p.sman || "none"} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                      <span className="min-w-0 truncate">
                        {p.sman ? p.salesman_name : <span className="text-muted-foreground">بلا اسم بائع</span>}
                        {p.is_store && <span className="mr-1 text-[10px] text-muted-foreground">(حساب المحل)</span>}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {p.invoices} فاتورة · اسم <b className="text-foreground">{pct(Number(p.with_name), Number(p.invoices))}%</b> · رقم <b className="text-foreground">{pct(Number(p.with_phone), Number(p.invoices))}%</b>
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}

          <p className="px-1 text-xs text-muted-foreground">
            «اسم ورقم الزبون» داخل في نقاط التقييم — شوف <Link to="/evaluation?tab=numbers" className="font-semibold text-primary underline">أرقام البائعين والفروع</Link>.
            الفواتير «بلا اسم بائع» ما تدخلش في تقييم أي موظف، لكنها تبان هنا في فرعها.
          </p>
        </>
      )}
    </div>
  );
}
