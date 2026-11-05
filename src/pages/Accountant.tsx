// صفحة المحاسب: الفلوس من أمارسوفت كيف دخلت — نقدي، مصرف، بطاقة، آجل… لكل فرع ولكل يوم، والمرتجعات،
// وفواتير الآجل بأسماء الزبائن، وتنزيل الأرقام ملف يفتح في Excel. الأرقام نفسها اللي في أمارسوفت.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarRange, Download, Loader2, Wallet } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sb, formatLD, periodDays, tripoliToday, type Period } from "@/lib/amarsoft";

type Day = { day: string; branch_code: string; branch_name: string; invoices: number; sales_dirhams: number; returns_dirhams: number; grams: number; payments: Record<string, number> };
type Acct = { branch_code: string; branch_name: string; account: string; n: number; amount: number };
type Credit = { branch_code: string; branch_name: string; invoice_no: string; invoice_date: string; customer: string | null; phone: string | null; net_dirhams: number; credit_dirhams: number };
type Data = { days: Day[]; accounts: Acct[]; credit: Credit[] };

// أسماء طرق الدفع كيف يكتبها أمارسوفت. SELL و C مش واضحين من أمارسوفت — نسأل المحاسب.
const ACCOUNT: Record<string, string> = { CASH: "نقدي", BANK: "مصرف / تحويل", CARD: "بطاقة", CRE: "آجل (دين)", SELL: "حساب SELL (؟)", C: "حساب C (؟)" };
const UNKNOWN = ["SELL", "C"];
const ORDER = ["CASH", "BANK", "CARD", "CRE", "SELL", "C"];
const label = (a: string) => ACCOUNT[a] ?? a;
const PERIODS: { key: Period | "custom"; label: string }[] = [
  { key: "today", label: "اليوم" }, { key: "yesterday", label: "أمس" }, { key: "week", label: "الأسبوع" }, { key: "month", label: "الشهر" }, { key: "custom", label: "من… لـ…" },
];
const short = (name: string) => name.replace(/^\d+\s*-\s*/, "");
const ld = (d: number) => Math.round(Number(d) / 1000);

export default function Accountant() {
  const [period, setPeriod] = useState<Period | "custom">("month");
  const [custom, setCustom] = useState(() => periodDays("month"));
  const { from, to } = period === "custom" ? custom : periodDays(period);
  const [branch, setBranch] = useState("all");

  const { data, isLoading } = useQuery({
    queryKey: ["accounting", from, to],
    enabled: !!from && !!to && from <= to,
    queryFn: async () => {
      const { data, error } = await sb.rpc("amarsoft_accounting", { p_start: from, p_end: to });
      if (error) throw error;
      return data as Data;
    },
  });

  const v = useMemo(() => {
    if (!data) return null;
    const days = data.days.filter((d) => branch === "all" || d.branch_code === branch);
    const accounts = new Set<string>();
    days.forEach((d) => Object.keys(d.payments).forEach((a) => accounts.add(a)));
    const rank = (a: string) => (ORDER.includes(a) ? ORDER.indexOf(a) : 99);
    const cols = [...accounts].sort((a, b) => rank(a) - rank(b));
    const total = (pick: (d: Day) => number) => days.reduce((t, d) => t + Number(pick(d) || 0), 0);
    const byAcct = Object.fromEntries(cols.map((a) => [a, total((d) => d.payments[a])]));
    const branches = [...new Map(data.days.map((d) => [d.branch_code, d.branch_name])).entries()].sort();
    const perBranch = branches.map(([code, name]) => {
      const ds = data.days.filter((d) => d.branch_code === code);
      return { code, name, sales: ds.reduce((t, d) => t + Number(d.sales_dirhams), 0), invoices: ds.reduce((t, d) => t + Number(d.invoices), 0),
        pay: Object.fromEntries(cols.map((a) => [a, ds.reduce((t, d) => t + Number(d.payments[a] ?? 0), 0)])) };
    });
    const sales = total((d) => d.sales_dirhams), paid = Object.values(byAcct).reduce((t, x) => t + x, 0);
    return { days, cols, byAcct, branches, perBranch, sales, paid, returns: total((d) => d.returns_dirhams), invoices: total((d) => d.invoices),
      credit: data.credit.filter((c) => branch === "all" || c.branch_code === branch) };
  }, [data, branch]);

  // ملف CSV يفتح في Excel (مع BOM باش العربي يطلع صح).
  const download = () => {
    if (!v) return;
    const head = ["اليوم", "الفرع", "الفواتير", "المبيعات", ...v.cols.map(label), "المرتجعات"];
    const rows = v.days.map((d) => [d.day, d.branch_name, d.invoices, ld(d.sales_dirhams), ...v.cols.map((a) => ld(d.payments[a] ?? 0)), ld(d.returns_dirhams)]);
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `حسابات-${from}-${to}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Wallet className="size-7 text-primary" />صفحة المحاسب</h1>
        <p className="text-sm text-muted-foreground">الفلوس من فواتير أمارسوفت: قداش دخل، وكيف تدفع، لكل فرع ولكل يوم.</p>
      </div>

      <div className="grid grid-cols-5 gap-1.5">
        {PERIODS.map((p) => (
          <Button key={p.key} variant={period === p.key ? "default" : "outline"} onClick={() => setPeriod(p.key)} className="px-1 text-sm gap-1">
            {p.key === "custom" && <CalendarRange className="size-4" />}{p.label}
          </Button>
        ))}
      </div>
      {period === "custom" && (
        <Card className="p-3 grid grid-cols-2 gap-2">
          <label className="text-sm font-semibold">من يوم<Input type="date" value={custom.from} max={tripoliToday()} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className="h-11 mt-1" /></label>
          <label className="text-sm font-semibold">لين يوم<Input type="date" value={custom.to} max={tripoliToday()} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className="h-11 mt-1" /></label>
        </Card>
      )}

      {isLoading || !v ? (
        <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : (
        <>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            <Button size="sm" variant={branch === "all" ? "secondary" : "ghost"} onClick={() => setBranch("all")} className="shrink-0">كل الفروع</Button>
            {v.branches.map(([code, name]) => (
              <Button key={code} size="sm" variant={branch === code ? "secondary" : "ghost"} onClick={() => setBranch(code)} className="shrink-0">{short(name)}</Button>
            ))}
          </div>

          <Card className="p-3 flex gap-2 items-start border-amber-500/40 bg-amber-500/5 text-sm">
            <AlertTriangle className="size-5 shrink-0 text-amber-600 mt-0.5" />
            <span>فروع القادسية والجرابة والنوفليين يدخلوا الفواتير متأخر (أيام وأسابيع)، فأرقام الأيام الأخيرة ناقصة وتزيد لما يدخلوها.</span>
          </Card>

          {/* الإجمالي */}
          <Card className="p-4 bg-gold-soft border-primary/30 space-y-3">
            <div className="text-center">
              <div className="text-xs text-muted-foreground">المبيعات</div>
              <div className="text-3xl font-bold">{formatLD(v.sales)}</div>
              <div className="text-xs text-muted-foreground">{v.invoices} فاتورة{v.returns ? ` · مرتجعات ${formatLD(v.returns)}` : ""}</div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {v.cols.map((a) => (
                <div key={a} className="rounded-lg bg-background/70 p-2 text-center">
                  <div className="text-xs text-muted-foreground">{label(a)}</div>
                  <div className="font-bold">{formatLD(v.byAcct[a])}</div>
                  <div className="text-[11px] text-muted-foreground">{v.paid ? Math.round((v.byAcct[a] / v.paid) * 100) : 0}%</div>
                </div>
              ))}
            </div>
            {Math.abs(v.paid - v.sales) > 1000 && (
              <p className="text-xs text-center text-destructive">مجموع طرق الدفع ({formatLD(v.paid)}) مختلف على المبيعات بـ {formatLD(v.sales - v.paid)}.</p>
            )}
            {v.cols.some((a) => UNKNOWN.includes(a)) && (
              <p className="text-xs text-center text-muted-foreground">«SELL» و«C» حسابات في أمارسوفت مش معروف معناها — اسأل المحاسب وين تمشي الفلوس هذي.</p>
            )}
          </Card>

          {/* الفروع */}
          {branch === "all" && v.perBranch.length > 1 && (
            <Card className="p-3">
              <h2 className="text-lg font-bold mb-1">كل فرع كيف تدفعله</h2>
              <div className="overflow-x-auto -mx-3 px-3">
                <table className="w-full text-sm border-collapse min-w-[480px]">
                  <thead><tr className="text-xs text-muted-foreground">
                    <th className="text-right py-1.5 font-normal">الفرع</th><th className="py-1.5 font-normal">المبيعات</th>
                    {v.cols.map((a) => <th key={a} className="py-1.5 font-normal">{label(a)}</th>)}
                  </tr></thead>
                  <tbody>
                    {v.perBranch.map((b) => (
                      <tr key={b.code} className="border-t">
                        <td className="py-1.5 font-bold whitespace-nowrap">{short(b.name)}</td>
                        <td className="py-1.5 text-center font-bold">{ld(b.sales).toLocaleString("en-US")}</td>
                        {v.cols.map((a) => <td key={a} className="py-1.5 text-center">{b.pay[a] ? ld(b.pay[a]).toLocaleString("en-US") : "—"}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">بالدينار.</p>
            </Card>
          )}

          {/* يوم بيوم */}
          <Card className="p-3">
            <div className="flex justify-between items-center mb-1">
              <h2 className="text-lg font-bold">يوم بيوم</h2>
              <Button size="sm" variant="outline" onClick={download} disabled={!v.days.length}><Download className="size-4" />تنزيل Excel</Button>
            </div>
            {!v.days.length ? <p className="text-center text-muted-foreground py-4">ما فيش فواتير في الفترة هذي.</p> : (
              <div className="overflow-x-auto -mx-3 px-3">
                <table className="w-full text-sm border-collapse min-w-[520px]">
                  <thead><tr className="text-xs text-muted-foreground">
                    <th className="text-right py-1.5 font-normal">اليوم</th>{branch === "all" && <th className="text-right py-1.5 font-normal">الفرع</th>}
                    <th className="py-1.5 font-normal">المبيعات</th>{v.cols.map((a) => <th key={a} className="py-1.5 font-normal">{label(a)}</th>)}
                  </tr></thead>
                  <tbody>
                    {v.days.map((d) => (
                      <tr key={`${d.day}-${d.branch_code}`} className="border-t">
                        <td className="py-1.5 whitespace-nowrap" dir="ltr">{d.day.slice(5)}</td>
                        {branch === "all" && <td className="py-1.5 whitespace-nowrap">{short(d.branch_name)}</td>}
                        <td className="py-1.5 text-center font-bold">{ld(d.sales_dirhams).toLocaleString("en-US")}<span className="text-[10px] text-muted-foreground font-normal"> ({d.invoices})</span></td>
                        {v.cols.map((a) => <td key={a} className="py-1.5 text-center">{d.payments[a] ? ld(d.payments[a]).toLocaleString("en-US") : "—"}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* الآجل */}
          <Card className="p-3">
            <h2 className="text-lg font-bold">فواتير الآجل ({v.credit.length})</h2>
            <p className="text-xs text-muted-foreground mb-1">زبائن خذوا ذهب وجزء من الفلوس (ولا كلها) عليهم. أمارسوفت ما يورّيش قداش دفعوا من بعد.</p>
            {!v.credit.length ? <p className="text-center text-muted-foreground py-3">ما فيش آجل في الفترة هذي.</p> : v.credit.map((c) => (
              <div key={`${c.branch_code}-${c.invoice_no}`} className="flex justify-between items-center gap-2 py-2 border-b last:border-0 text-sm">
                <span className="min-w-0">
                  <span className="block font-bold truncate">{c.customer || "بلا اسم"}{c.phone ? <span className="font-normal text-muted-foreground" dir="ltr"> · {c.phone}</span> : ""}</span>
                  <span className="block text-xs text-muted-foreground">{short(c.branch_name)} · فاتورة {c.invoice_no} · {c.invoice_date}</span>
                </span>
                <span className="shrink-0 text-left"><span className="block font-bold text-destructive">{formatLD(c.credit_dirhams)}</span><span className="block text-xs text-muted-foreground">من {formatLD(c.net_dirhams)}</span></span>
              </div>
            ))}
          </Card>

          <div className="grid grid-cols-2 gap-2">
            <Button asChild variant="outline"><Link to="/pos-sales?tab=log">الفواتير الممسوحة والمعدّلة</Link></Button>
            <Button asChild variant="outline"><Link to="/gram-price">سعر الغرام في الفروع</Link></Button>
          </div>
        </>
      )}
    </div>
  );
}
