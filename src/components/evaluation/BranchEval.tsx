// تقييم الفروع في شهر التقييم — من فواتير أمارسوفت: كم باع كل فرع (وزن وقيمة)، سعر القرام والمصنعية
// للقرام مقارنة بباقي الفروع (18 و21 كل واحد بروحه لأن سعرهم مختلف)، تسجيل البائع واسم الزبون على
// الفواتير، الفواتير المحذوفة، خفيف/رزين، ومقارنة بالشهر اللي قبله. فوق: ترتيب الفروع بدرجة من 100،
// وقائمة الموظفين من كل الفروع مرتّبة بنصيب كل واحد من وزن فرعه.
// للمدير العام بس (الأرقام فيها فلوس).
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, Loader2, TrendingDown, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { sb, formatLD, formatGrams } from "@/lib/amarsoft";
import { monthLabel, shiftMonth } from "@/lib/evaluation";

type Row = {
  branch_code: string; branch_name: string; sman: string | null; salesman_name: string | null;
  invoices: number; returns: number; deleted: number; pieces: number; grams: number; net_dirhams: number;
  grams_18: number; amount_18: number; making_18: number; grams_21: number; amount_21: number; making_21: number;
  tagged: number; with_customer: number; active_days: number;
  light_pcs: number; mid_pcs: number; heavy_pcs: number; heavy_grams: number;
};

/** درجة من 0 لـ max حسب الفرق عن المتوسط: +10% وفوق = كاملة، -10% وتحت = صفر. */
const vsScore = (d: number | null, max: number) => (d == null ? max / 2 : Math.max(0, Math.min(max, ((d + 10) / 20) * max)));

const range = (m: string) => ({ p_start: `${m}T00:00:00+02:00`, p_end: `${shiftMonth(m, 1)}T00:00:00+02:00` });
const n = (v: unknown) => Number(v ?? 0);
const perG = (amt: unknown, g: unknown) => (n(g) > 0 ? n(amt) / n(g) : null);
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);

async function fetchEval(m: string) {
  const { data, error } = await sb.rpc("amarsoft_branch_eval", range(m));
  if (error) throw error;
  return (data ?? []) as Row[];
}

/** الفرق عن المتوسط كنسبة: +5 = أغلى من المتوسط بـ5%. */
function vsAvg(v: number | null, avg: number | null) {
  if (v == null || !avg) return null;
  return Math.round(((v - avg) / avg) * 100);
}

function Diff({ d, goodUp = true }: { d: number | null; goodUp?: boolean }) {
  if (d == null) return null;
  if (Math.abs(d) < 1) return <span className="text-[11px] text-muted-foreground">نفس المتوسط</span>;
  const up = d > 0;
  const good = up === goodUp;
  return (
    <span className={`text-[11px] font-semibold inline-flex items-center gap-0.5 ${good ? "text-emerald-600" : "text-red-600"}`}>
      {up ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
      {up ? "أغلى" : "أرخص"} بـ{Math.abs(d)}%
    </span>
  );
}

export default function BranchEval({ month }: { month: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const cur = useQuery({ queryKey: ["branch-eval", month], queryFn: () => fetchEval(month) });
  const prev = useQuery({ queryKey: ["branch-eval", shiftMonth(month, -1)], queryFn: () => fetchEval(shiftMonth(month, -1)) });

  const v = useMemo(() => {
    const rows = cur.data ?? [];
    const branches = rows.filter((r) => r.sman == null && n(r.invoices) > 0);
    const sum = (k: keyof Row) => branches.reduce((s, r) => s + n(r[k]), 0);
    const avg18 = perG(sum("amount_18"), sum("grams_18"));
    const avgMk18 = perG(sum("making_18"), sum("grams_18"));
    const avg21 = perG(sum("amount_21"), sum("grams_21"));
    const prevBy = new Map((prev.data ?? []).filter((r) => r.sman == null).map((r) => [r.branch_code, r]));
    const list = branches.map((b) => {
      const p18 = perG(b.amount_18, b.grams_18);
      const mk18 = perG(b.making_18, b.grams_18);
      const p21 = perG(b.amount_21, b.grams_21);
      const pb = prevBy.get(b.branch_code);
      const gramsChange = pb && n(pb.grams) > 0 ? Math.round(((n(b.grams) - n(pb.grams)) / n(pb.grams)) * 100) : null;
      const staff = rows.filter((r) => r.branch_code === b.branch_code && r.sman != null && n(r.invoices) > 0)
        .sort((a, c) => n(c.grams) - n(a.grams));
      const d18 = vsAvg(p18, avg18), dMk18 = vsAvg(mk18, avgMk18);
      const tagPct = pct(n(b.tagged), n(b.invoices)), custPct = pct(n(b.with_customer), n(b.invoices));
      const heavyPct = pct(n(b.heavy_pcs), n(b.pieces)), lightPct = pct(n(b.light_pcs), n(b.pieces));
      // الدرجة من 100: الوزن المباع 35 · سعر القرام 20 · المصنعية 15 · تسجيل البائع 15 · تسجيل الزبون 10 · بلا حذف 5
      const parts = {
        sales: (n(b.grams) / Math.max(1, ...branches.map((x) => n(x.grams)))) * 35,
        price: vsScore(d18, 20),
        making: vsScore(dMk18, 15),
        tag: ((tagPct ?? 0) / 100) * 15,
        cust: ((custPct ?? 0) / 100) * 10,
        clean: Math.max(0, 5 - n(b.deleted)),
      };
      const score = Math.round(Object.values(parts).reduce((s, x) => s + x, 0));
      return {
        ...b, p18, mk18, p21, d18, dMk18, d21: vsAvg(p21, avg21), tagPct, custPct, gramsChange, staff,
        heavyPct, lightPct, avgPiece: n(b.pieces) > 0 ? n(b.grams) / n(b.pieces) : null, parts, score,
      };
    }).sort((a, c) => c.score - a.score);

    // الموظفين من كل الفروع: كل واحد مقارنة بفرعه — نصيبه من وزن الفرع، وكم مرة فوق/تحت متوسط زملاءه.
    const people = list.flatMap((b) => {
      const named = b.staff.filter((s) => s.sman !== "");
      const tot = named.reduce((s, x) => s + n(x.grams), 0);
      return named.map((s) => ({
        ...s, branch: b, share: pct(n(s.grams), n(b.grams)),
        vsMates: named.length > 1 && tot > 0 ? n(s.grams) / (tot / named.length) : null,
        heavyPct: pct(n(s.heavy_pcs), n(s.pieces)),
        p18: perG(s.amount_18, s.grams_18), dP18: vsAvg(perG(s.amount_18, s.grams_18), b.p18),
      }));
    }).sort((a, c) => (c.share ?? 0) - (a.share ?? 0) || n(c.grams) - n(a.grams));

    // جمل قصيرة فوق: مين الأكثر وزن، مين أغلى/أرخص سعر قرام، وين التسجيل ضعيف.
    const notes: string[] = [];
    if (list[0]) notes.push(`أحسن فرع هذا الشهر: ${list[0].branch_name} (${list[0].score} من 100).`);
    const mostG = [...list].sort((a, c) => n(c.grams) - n(a.grams))[0];
    if (mostG) notes.push(`${mostG.branch_name} الأكثر وزن (${formatGrams(mostG.grams)}).`);
    const heavy = [...list].filter((b) => b.heavyPct != null).sort((a, c) => (c.heavyPct ?? 0) - (a.heavyPct ?? 0));
    if (heavy.length > 1) notes.push(`أكثر فرع يبيع رزين: ${heavy[0].branch_name} (${heavy[0].heavyPct}% من قطعه) — أكثر خفيف: ${[...list].sort((a, c) => (c.lightPct ?? 0) - (a.lightPct ?? 0))[0].branch_name}.`);
    const priced = list.filter((b) => b.p18 != null && n(b.grams_18) >= 50);
    if (priced.length > 1) {
      const hi = [...priced].sort((a, c) => (c.p18 ?? 0) - (a.p18 ?? 0))[0];
      const lo = [...priced].sort((a, c) => (a.p18 ?? 0) - (c.p18 ?? 0))[0];
      notes.push(`أغلى سعر قرام 18: ${hi.branch_name} (${formatLD(hi.p18)}) — أرخص: ${lo.branch_name} (${formatLD(lo.p18)}).`);
    }
    const weak = list.filter((b) => (b.tagPct ?? 0) < 50).map((b) => b.branch_name);
    if (weak.length) notes.push(`اسم البائع ناقص في أغلب فواتير: ${weak.join("، ")}.`);
    const del = list.filter((b) => n(b.deleted) > 0);
    if (del.length) notes.push(`فواتير محذوفة: ${del.map((b) => `${b.branch_name} (${b.deleted})`).join("، ")} — راجعها.`);
    const tagAll = pct(sum("tagged"), sum("invoices"));
    return { list, people, avg18, avgMk18, avg21, notes, tagAll };
  }, [cur.data, prev.data]);
  const [view, setView] = useState<"branches" | "staff">("branches");

  if (cur.isLoading) return <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>;
  if (cur.error) return <Card className="p-4 text-sm text-destructive">تعذّر التحميل: {(cur.error as Error).message}</Card>;
  if (!v.list.length) return <Card className="p-6 text-center text-muted-foreground">ما فيش مبيعات في {monthLabel(month)}.</Card>;

  return (
    <div className="space-y-3">
      <Card className="p-3 bg-gold-soft border-primary/30 space-y-1">
        {v.notes.map((t) => <p key={t} className="text-sm">{t}</p>)}
        <p className="text-[11px] text-muted-foreground pt-1">
          متوسط كل الفروع: قرام 18 {formatLD(v.avg18)} · مصنعية القرام {formatLD(v.avgMk18)}{v.avg21 ? ` · قرام 21 ${formatLD(v.avg21)}` : ""}.
          فواتير «ذهب مسبوك» والكسر مش محسوبة.
        </p>
      </Card>

      <Card className="p-3 space-y-2">
        <p className="font-bold text-sm">ترتيب الفروع</p>
        {v.list.map((b, i) => (
          <div key={b.branch_code} className="flex items-center gap-2 text-sm">
            <span className={`size-6 shrink-0 rounded-full flex items-center justify-center text-[11px] font-bold ${i === 0 ? "bg-gold-gradient text-primary-foreground" : "bg-muted"}`}>{i + 1}</span>
            <span className="flex-1 min-w-0">
              <span className="flex justify-between gap-2"><span className="font-semibold truncate">{b.branch_name}</span><span className="font-bold">{b.score}</span></span>
              <span className="block h-1.5 bg-muted rounded-full overflow-hidden"><span className="block h-full bg-primary" style={{ width: `${b.score}%` }} /></span>
              <span className="block text-[10px] text-muted-foreground">
                وزن {Math.round(b.parts.sales)}/35 · سعر {Math.round(b.parts.price)}/20 · مصنعية {Math.round(b.parts.making)}/15 · بائع {Math.round(b.parts.tag)}/15 · زبون {Math.round(b.parts.cust)}/10 · حذف {Math.round(b.parts.clean)}/5
              </span>
            </span>
          </div>
        ))}
        <div className="grid grid-cols-2 gap-1.5 pt-1">
          {(["branches", "staff"] as const).map((k) => (
            <button key={k} onClick={() => setView(k)}
              className={`rounded-md py-1.5 text-sm font-semibold ${view === k ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
              {k === "branches" ? "تفاصيل الفروع" : "الموظفين مقارنة بفروعهم"}
            </button>
          ))}
        </div>
      </Card>

      {view === "staff" && (
        <Card className="p-3 space-y-1.5">
          {(v.tagAll ?? 0) < 60 && (
            <p className="text-xs text-amber-700 bg-amber-50 dark:bg-amber-950/30 rounded p-2 flex gap-1">
              <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
              بس {v.tagAll ?? 0}% من الفواتير فيها اسم البائع — الترتيب هذا ما يصدقش إلا لما الموظفين يختاروا أساميهم في أمارسوفت.
            </p>
          )}
          {!v.people.length && <p className="text-sm text-muted-foreground text-center py-4">ما فيش فواتير مسجّلة على موظفين في {monthLabel(month)}.</p>}
          {v.people.map((s, i) => (
            <div key={`${s.branch_code}-${s.sman}`} className="flex items-center justify-between gap-2 text-sm py-1.5 border-b last:border-0">
              <span className="flex items-center gap-2 min-w-0">
                <span className="size-6 shrink-0 rounded-full bg-muted flex items-center justify-center text-[11px] font-bold">{i + 1}</span>
                <span className="min-w-0">
                  <span className="block font-semibold truncate">{s.salesman_name}</span>
                  <span className="block text-[11px] text-muted-foreground truncate">
                    {s.branch.branch_name} · {s.invoices} فاتورة{s.heavyPct != null ? ` · ${s.heavyPct}% رزين` : ""}
                  </span>
                </span>
              </span>
              <span className="text-left shrink-0">
                <span className="block font-bold">{s.share ?? 0}% من فرعه</span>
                <span className="block text-[11px]">{formatGrams(s.grams)}{s.vsMates != null ? ` · ×${s.vsMates.toFixed(1)} متوسط زملاءه` : ""}</span>
                {s.p18 != null && <span className="block text-[11px]">قرام 18 {formatLD(s.p18)} <Diff d={s.dP18} /></span>}
              </span>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground pt-1">
            الترتيب حسب نصيب الموظف من وزن فرعه — هكي اللي في فرع مبيعاته قليلة وجاب أغلبها يطلع فوق. «×2» = باع ضعف متوسط زملاءه في نفس الفرع.
          </p>
        </Card>
      )}

      {view === "branches" && v.list.map((b, i) => (
        <Card key={b.branch_code} className="p-3">
          <button className="w-full text-right" onClick={() => setOpen(open === b.branch_code ? null : b.branch_code)}>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 min-w-0">
                <span className={`size-7 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${i === 0 ? "bg-gold-gradient text-primary-foreground" : "bg-muted"}`}>{i + 1}</span>
                <span className="font-bold truncate">{b.branch_name}</span>
              </span>
              <span className="text-left shrink-0">
                <span className="block font-bold">{formatGrams(b.grams)}</span>
                {b.gramsChange != null && (
                  <span className={`text-[11px] ${b.gramsChange >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {b.gramsChange >= 0 ? "↑" : "↓"} {Math.abs(b.gramsChange)}% عن الشهر اللي فات
                  </span>
                )}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mt-2.5 text-right">
              <Cell label="المبيعات" value={formatLD(b.net_dirhams)} sub={`${b.invoices} فاتورة · ${b.active_days} يوم فيه بيع`} />
              <Cell label="سعر قرام 18" value={b.p18 != null ? formatLD(b.p18) : "—"} extra={<Diff d={b.d18} />} />
              <Cell label="مصنعية القرام 18" value={b.mk18 != null ? formatLD(b.mk18) : "—"} extra={<Diff d={b.dMk18} />} sub="هذا الربح" />
              {b.p21 != null
                ? <Cell label="سعر قرام 21" value={formatLD(b.p21)} extra={<Diff d={b.d21} />} />
                : <Cell label="متوسط الفاتورة" value={formatLD(n(b.net_dirhams) / Math.max(1, n(b.invoices)))} />}
            </div>

            <PieceMix b={b} avgPiece={b.avgPiece} />

            <div className="mt-2 space-y-1">
              <Bar label="فواتير فيها اسم البائع" v={b.tagPct} />
              <Bar label="فواتير فيها اسم/رقم الزبون" v={b.custPct} />
            </div>
            {n(b.deleted) > 0 && (
              <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1"><AlertTriangle className="size-3.5" />{b.deleted} فاتورة محذوفة في الشهر — راجعها مع الفرع.</p>
            )}
            {n(b.returns) > 0 && <p className="text-xs text-amber-600 mt-1">{b.returns} مرتجع.</p>}
            <span className="flex items-center justify-center gap-1 text-xs text-primary mt-2">
              الموظفين ({b.staff.length}) <ChevronDown className={`size-3.5 transition-transform ${open === b.branch_code ? "rotate-180" : ""}`} />
            </span>
          </button>

          {open === b.branch_code && (
            <div className="mt-2 border-t pt-2 space-y-1.5">
              {b.staff.map((s) => {
                const sp = perG(s.amount_18, s.grams_18);
                const smk = perG(s.making_18, s.grams_18);
                return (
                  <div key={s.sman} className="flex items-center justify-between gap-2 text-sm py-1 border-b last:border-0">
                    <span className="min-w-0">
                      <span className={`block font-semibold truncate ${s.sman === "" ? "text-muted-foreground" : ""}`}>{s.salesman_name}</span>
                      <span className="block text-[11px] text-muted-foreground">{s.invoices} فاتورة · {formatLD(s.net_dirhams)}</span>
                    </span>
                    <span className="text-left shrink-0">
                      <span className="block font-bold">{formatGrams(s.grams)}</span>
                      {sp != null && (
                        <span className="block text-[11px]">
                          قرام 18 {formatLD(sp)} <Diff d={vsAvg(sp, b.p18)} />
                        </span>
                      )}
                      {smk != null && <span className="block text-[11px] text-muted-foreground">مصنعية {formatLD(smk)}</span>}
                    </span>
                  </div>
                );
              })}
              <p className="text-[11px] text-muted-foreground">سعر الموظف مقارنة بمتوسط فرعه. «بدون بائع» = فواتير ما تسجّلش عليها اسم.</p>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function Cell({ label, value, sub, extra }: { label: string; value: string; sub?: string; extra?: React.ReactNode }) {
  return (
    <div className="rounded-md bg-muted/40 p-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="font-bold text-sm">{value}</div>
      {extra}
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** خفيف / متوسط / رزين كنسبة من عدد القطع. */
function PieceMix({ b, avgPiece }: { b: Row; avgPiece: number | null }) {
  const total = n(b.pieces);
  if (!total) return null;
  const seg = [
    { k: "خفيف <5ق", v: n(b.light_pcs), c: "bg-sky-400" },
    { k: "متوسط 5-40ق", v: n(b.mid_pcs), c: "bg-amber-400" },
    { k: "رزين 40ق+", v: n(b.heavy_pcs), c: "bg-primary" },
  ];
  return (
    <div className="mt-2">
      <div className="flex justify-between text-xs">
        <span>نوع القطع المباعة</span>
        {avgPiece != null && <span className="text-muted-foreground">متوسط القطعة {formatGrams(avgPiece)}</span>}
      </div>
      <div className="h-2 flex rounded-full overflow-hidden bg-muted">
        {seg.map((s) => <div key={s.k} className={s.c} style={{ width: `${(s.v / total) * 100}%` }} />)}
      </div>
      <div className="flex gap-3 text-[10px] text-muted-foreground mt-0.5">
        {seg.map((s) => <span key={s.k}><span className={`inline-block size-2 rounded-full ${s.c} ml-1`} />{s.k} {Math.round((s.v / total) * 100)}%</span>)}
      </div>
    </div>
  );
}

function Bar({ label, v }: { label: string; v: number | null }) {
  const val = v ?? 0;
  const tone = val >= 80 ? "bg-emerald-500" : val >= 50 ? "bg-amber-500" : "bg-red-500";
  return (
    <div>
      <div className="flex justify-between text-xs"><span>{label}</span><span className="font-bold">{v == null ? "—" : `${val}%`}</span></div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden"><div className={`h-full ${tone}`} style={{ width: `${val}%` }} /></div>
    </div>
  );
}
