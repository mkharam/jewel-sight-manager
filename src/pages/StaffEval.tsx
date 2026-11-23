// تقييم البائعين والفروع (للمدير العام فقط) — مصمّم ليكون واضحاً لأي أحد يقراه:
// أقسام منفصلة، كل قسم جدول يقارن الكل جنب بعض، وتحت كل جدول شرح بسيط لكل عمود.
// النقاط: كل مقياس يُقيَّم بترتيب البائع بين زملائه (الأحسن 100، الأضعف 0، الوسط 50)،
// ثم مجموع موزون حسب أهمية كل مقياس. هكي النقاط عادلة ولا تتأثر بحجم الأرقام.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ClipboardList, SlidersHorizontal, Info } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { sb, periodDays, daysToRange, addDays, type Period } from "@/lib/amarsoft";
import MarketRatesCard from "@/components/MarketRatesCard";

type Raw = {
  branch_code: string; branch_name: string; sman: string; salesman_name: string;
  invoices: number; returns: number; return_grams: number; lines: number; pieces: number; grams: number; pure_grams: number;
  light_inv: number; mid_inv: number; heavy_inv: number; max_inv_grams: number;
  amount: number; making: number; discount: number; grams_21: number; untagged_lines: number; low_price_lines: number; active_days: number;
};
type Extra = {
  branch_code: string; sman: string; price_index: number | null; typed_grams: number;
  phone_invoices: number; new_customers: number; repeat_customers: number;
  avg_age_days: number | null; old_pieces: number; aged_lines: number;
};

type Gold = { branch_code: string; sman: string; valued_grams: number; amount_lyd: number; gold_lyd: number; old_grams: number; old_amount_lyd: number; old_gold_lyd: number };
/** تسجيل الزبون في فواتير البيع: اسم حقيقي، ورقم موبايل صحيح (amarsoft_customer_capture). */
type Capture = { branch_code: string; sman: string; invoices: number; with_name: number; with_phone: number; with_both: number };

/** كل المقاييس لشخص أو فرع — محسوبة من المجاميع بنفس الطريقة للجميع. */
type M = {
  grams: number; invoices: number; pieces: number; avgInv: number; light: number; mid: number; heavy: number; lightPct: number; heavyPct: number;
  pricePerGram: number; priceIndex: number | null; discountPct: number; lowPricePct: number; lowLines: number;
  phonePct: number; newCust: number; repeatCust: number; oldPieces: number; avgAge: number | null;
  /** % فواتير فيها اسم الزبون، وفيها الاسم والرقم مع بعض (null لو ملف التحديث ما تشغّلش). */
  namePct: number | null; custPct: number | null;
  untaggedPct: number; returns: number; returnPct: number; days: number;
  /** فوق سعر الذهب يوم البيع: د.ل لكل جرام، ونسبة مئوية — وللقطع القديمة (أكثر من 6 شهور) نسبة لحالها. */
  abovePerGram: number | null; abovePct: number | null; oldAbovePct: number | null;
};

const n = (v: unknown) => Number(v ?? 0);
const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);

function measure(rs: Raw[], xs: Extra[], gs: Gold[] = [], cs: Capture[] = []): M {
  const t = (k: keyof Raw) => rs.reduce((a, r) => a + n(r[k]), 0);
  const tx = (k: keyof Extra) => xs.reduce((a, r) => a + n(r[k]), 0);
  const g = t("grams"), inv = t("invoices"), lines = t("lines");
  const tg = tx("typed_grams"), al = tx("aged_lines");
  return {
    grams: g, invoices: inv, pieces: t("pieces"), avgInv: inv ? g / inv : 0,
    light: t("light_inv"), mid: t("mid_inv"), heavy: t("heavy_inv"),
    lightPct: pct(t("light_inv"), inv), heavyPct: pct(t("heavy_inv"), inv),
    pricePerGram: g ? t("amount") / 1000 / g : 0,
    priceIndex: tg ? xs.reduce((a, x) => a + n(x.price_index) * n(x.typed_grams), 0) / tg : null,
    discountPct: pct(t("discount"), t("amount") + t("discount")),
    lowLines: t("low_price_lines"), lowPricePct: pct(t("low_price_lines"), lines),
    newCust: tx("new_customers"), repeatCust: tx("repeat_customers"),
    ...(() => {
      const ci = cs.reduce((a, c) => a + n(c.invoices), 0);
      if (!ci) return { phonePct: pct(tx("phone_invoices"), inv), namePct: null, custPct: null };
      const c = (k: keyof Capture) => cs.reduce((a, x) => a + n(x[k]), 0);
      return { phonePct: pct(c("with_phone"), ci), namePct: pct(c("with_name"), ci), custPct: pct(c("with_both"), ci) };
    })(),
    oldPieces: tx("old_pieces"), avgAge: al ? xs.reduce((a, x) => a + n(x.avg_age_days) * n(x.aged_lines), 0) / al : null,
    untaggedPct: pct(t("untagged_lines"), lines), returns: t("returns"), returnPct: pct(t("returns"), inv + t("returns")),
    days: t("active_days"),
    ...(() => {
      const vg = gs.reduce((a, x) => a + n(x.valued_grams), 0);
      const amt = gs.reduce((a, x) => a + n(x.amount_lyd), 0);
      const gold = gs.reduce((a, x) => a + n(x.gold_lyd), 0);
      const oa = gs.reduce((a, x) => a + n(x.old_amount_lyd), 0);
      const og = gs.reduce((a, x) => a + n(x.old_gold_lyd), 0);
      return {
        abovePerGram: vg > 0 && gold > 0 ? (amt - gold) / vg : null,
        abovePct: gold > 0 ? (amt / gold - 1) * 100 : null,
        oldAbovePct: og > 0 ? (oa / og - 1) * 100 : null,
      };
    })(),
  };
}

// ===== النقاط =====
type ScoreKey = "grams" | "abovePct" | "priceIndex" | "avgInv" | "discountPct" | "lowPricePct" | "custPct" | "returnPct" | "untaggedPct";
const SCORE_PARTS: { key: ScoreKey; label: string; lowerBetter?: boolean; def: number }[] = [
  { key: "grams", label: "الوزن المباع", def: 30 },
  { key: "abovePct", label: "الربح فوق سعر الذهب", def: 10 },
  { key: "priceIndex", label: "سعر البيع", def: 15 },
  { key: "avgInv", label: "وزن الفاتورة", def: 10 },
  { key: "lowPricePct", label: "قلة البيع تحت السعر", lowerBetter: true, def: 10 },
  { key: "discountPct", label: "قلة الخصم", lowerBetter: true, def: 10 },
  { key: "custPct", label: "تسجيل اسم ورقم الزبون", def: 5 },
  { key: "returnPct", label: "قلة المرتجعات", lowerBetter: true, def: 5 },
  { key: "untaggedPct", label: "قلة البيع بلا باركود", lowerBetter: true, def: 5 },
];
const WEIGHTS_KEY = "staffEval.weights.v2";
const defaults = () => Object.fromEntries(SCORE_PARTS.map((p) => [p.key, p.def])) as Record<ScoreKey, number>;
const loadWeights = (): Record<ScoreKey, number> => {
  try {
    const saved = JSON.parse(localStorage.getItem(WEIGHTS_KEY) ?? "{}");
    // «رقم الزبون» صار «اسم ورقم الزبون» — نفس الوزن اللي حطيته.
    if (saved.phonePct !== undefined && saved.custPct === undefined) saved.custPct = saved.phonePct;
    delete saved.phonePct;
    return { ...defaults(), ...saved };
  } catch { return defaults(); }
};

/** نقاط كل واحد من 100: ترتيبه بين زملائه في كل مقياس (الأحسن 100، الأضعف 0)، مجموع موزون. */
function scoreAll(list: M[], w: Record<ScoreKey, number>): number[] {
  const out = list.map(() => 0);
  if (list.length <= 1) return list.map(() => 50);
  let wsum = 0;
  for (const p of SCORE_PARTS) {
    const wt = w[p.key] ?? 0;
    if (!wt) continue;
    wsum += wt;
    // «اسم ورقم الزبون» قبل ما يتشغّل ملف التحديث: نحسبو بالرقم بس زي قبل.
    const vals = list.map((m) => (p.key === "custPct" ? m.custPct ?? m.phonePct : m[p.key]));
    list.forEach((m, i) => {
      const v = vals[i];
      if (v === null || v === undefined) { out[i] += 50 * wt; return; }
      const valid = vals.filter((x): x is number => x !== null && x !== undefined);
      // كم واحد هو أحسن منهم (والتعادل نص)
      let better = 0;
      for (const o of valid) {
        if (o === v) better += 0.5;
        else if (p.lowerBetter ? v < o : v > o) better += 1;
      }
      better -= 0.5; // نفسه
      out[i] += (valid.length > 1 ? (better / (valid.length - 1)) * 100 : 50) * wt;
    });
  }
  return out.map((x) => (wsum ? Math.round(x / wsum) : 50));
}

const f = (v: number | null | undefined, d = 0) => (v === null || v === undefined ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: d }));

// ===== أعمدة الجداول وشرحها =====
type Col = { key: string; label: string; explain: string; get: (m: M) => number | null; fmt: (m: M) => string; lowerBetter?: boolean; neutral?: boolean };
const SECTIONS: { key: string; label: string; intro: string; cols: Col[] }[] = [
  {
    key: "sales", label: "المبيعات", intro: "قدّاش باع كل واحد، وهل يبيع قطع ثقيلة ولا خفيفة.",
    cols: [
      { key: "grams", label: "الوزن", explain: "مجموع جرامات الذهب اللي باعها. هذا أهم رقم لأن الوزن هو الربح.", get: (m) => m.grams, fmt: (m) => `${f(m.grams, 1)} جم` },
      { key: "invoices", label: "الفواتير", explain: "عدد الفواتير — يعني كم زبون خدم.", get: (m) => m.invoices, fmt: (m) => f(m.invoices) },
      { key: "avgInv", label: "وزن الفاتورة", explain: "معدل الجرامات في الفاتورة الوحدة. الأعلى يعني يقنع الزبون بقطع أثقل.", get: (m) => m.avgInv, fmt: (m) => `${f(m.avgInv, 1)} جم` },
      { key: "heavyPct", label: "فواتير ثقيلة", explain: "نسبة الفواتير اللي وزنها 20 جرام أو أكثر.", get: (m) => m.heavyPct, fmt: (m) => `${f(m.heavyPct)}% (${m.heavy})` },
      { key: "lightPct", label: "فواتير خفيفة", explain: "نسبة الفواتير اللي وزنها أقل من 5 جرام (حلق، خواتم صغار…). مش عيب، لكن الكثير منها يعني ربح أقل.", get: (m) => m.lightPct, fmt: (m) => `${f(m.lightPct)}% (${m.light})`, lowerBetter: true },
    ],
  },
  {
    key: "price", label: "الأسعار", intro: "هل يبيع بالسعر الصحيح ولا يكسر السعر؟",
    cols: [
      { key: "priceIndex", label: "سعر البيع", explain: "يقارن سعر الجرام عنده بسعر نفس نوع القطعة في فرعه (خاتم بخاتم، طقم بطقم). 100 = نفس الفرع، 110 = يبيع أغلى بـ10%، 90 = أرخص بـ10%.", get: (m) => m.priceIndex, fmt: (m) => f(m.priceIndex) },
      { key: "abovePerGram", label: "فوق الذهب للجرام", explain: "كم دينار ربح على كل جرام فوق قيمة الذهب الخام يوم البيع (سعر الأونصة العالمي × الدولار في السوق الموازي). هذا الربح الحقيقي: المصنعية + هامش المحل.", get: (m) => m.abovePerGram, fmt: (m) => (m.abovePerGram === null ? "—" : `${f(m.abovePerGram)} د.ل`) },
      { key: "abovePct", label: "% فوق الذهب", explain: "نفس الشي كنسبة: 40% يعني باع بسعر أعلى من قيمة الذهب الخام بـ40%.", get: (m) => m.abovePct, fmt: (m) => (m.abovePct === null ? "—" : `${f(m.abovePct)}%`) },
      { key: "pricePerGram", label: "سعر الجرام", explain: "قيمة المبيعات ÷ الوزن بالدينار. للمعلومة فقط — يتأثر بنوع البضاعة، فالمقارنة الصحيحة هي «سعر البيع».", get: (m) => m.pricePerGram, fmt: (m) => `${f(m.pricePerGram)} د.ل`, neutral: true },
      { key: "lowPricePct", label: "تحت السعر", explain: "نسبة القطع اللي باعها بسعر جرام أقل من المعتاد في فرعه لنفس العيار (أقل من 95%). الأقل أحسن.", get: (m) => m.lowPricePct, fmt: (m) => `${f(m.lowPricePct)}% (${m.lowLines})`, lowerBetter: true },
      { key: "discountPct", label: "الخصم", explain: "نسبة الخصم المكتوب في الفواتير من قيمة البيع. الأقل أحسن.", get: (m) => m.discountPct, fmt: (m) => `${f(m.discountPct, 1)}%`, lowerBetter: true },
    ],
  },
  {
    key: "care", label: "الزبائن والبضاعة", intro: "الاهتمام بالزبون، تصريف البضاعة القديمة، والالتزام بالنظام.",
    cols: [
      { key: "custPct", label: "اسم ورقم الزبون", explain: "نسبة الفواتير اللي فيها اسم الزبون الحقيقي ورقم تلفونه مع بعض. هذا اللي يدخل في النقاط — باش نتواصلوا مع الزبون ونعرفوا مين يرجع.", get: (m) => m.custPct ?? m.phonePct, fmt: (m) => `${f(m.custPct ?? m.phonePct)}%` },
      { key: "namePct", label: "اسم الزبون", explain: "نسبة الفواتير اللي فيها اسم الزبون (مش «ذهب مسبوك» ولا حرف واحد).", get: (m) => m.namePct, fmt: (m) => (m.namePct === null ? "—" : `${f(m.namePct)}%`) },
      { key: "phonePct", label: "رقم الزبون", explain: "نسبة الفواتير اللي فيها رقم موبايل صحيح للزبون.", get: (m) => m.phonePct, fmt: (m) => `${f(m.phonePct)}%` },
      { key: "newCust", label: "زبائن جدد", explain: "زبائن أول مرة يشروا من المحل (حسب رقم التلفون).", get: (m) => m.newCust, fmt: (m) => f(m.newCust) },
      { key: "repeatCust", label: "زبائن رجعوا", explain: "زبائن شروا قبل ورجعوا يشروا.", get: (m) => m.repeatCust, fmt: (m) => f(m.repeatCust) },
      { key: "oldAbovePct", label: "القديمة فوق الذهب", explain: "القطع اللي قعدت أكثر من 6 شهور: باعها بكم فوق قيمة الذهب يوم البيع. لو أقل بكثير من «% فوق الذهب» يعني باعها بسعرها القديم وما حسبش غلاء الذهب.", get: (m) => m.oldAbovePct, fmt: (m) => (m.oldAbovePct === null ? "—" : `${f(m.oldAbovePct)}%`) },
      { key: "oldPieces", label: "قطع قديمة باعها", explain: "قطع قعدت في المخزون أكثر من 6 شهور وهو باعها — شطارة في تصريف البضاعة.", get: (m) => m.oldPieces, fmt: (m) => f(m.oldPieces) },
      { key: "untaggedPct", label: "بلا باركود", explain: "نسبة البيع بالكود العام (18K GEN) بدل باركود القطعة. الأقل أحسن، لأن البيع بلا باركود يخرب الجرد.", get: (m) => m.untaggedPct, fmt: (m) => `${f(m.untaggedPct)}%`, lowerBetter: true },
      { key: "returnPct", label: "المرتجعات", explain: "نسبة الفواتير اللي رجعت. الأقل أحسن.", get: (m) => m.returnPct, fmt: (m) => `${f(m.returnPct)}% (${m.returns})`, lowerBetter: true },
    ],
  },
];

const PERIODS: { key: Period; label: string }[] = [
  { key: "week", label: "الأسبوع" }, { key: "month", label: "الشهر" }, { key: "year", label: "السنة" },
];

type Who = { id: string; name: string; sub: string; m: M; prev?: M; score: number; prevScore?: number };

/** لون الخلية مقارنة بمتوسط الجدول: أخضر أحسن بـ10%+، أحمر أسوأ بـ10%+. */
function tone(v: number | null, avg: number | null, lowerBetter?: boolean, neutral?: boolean) {
  if (neutral || v === null || avg === null || !avg) return "";
  const d = (v - avg) / Math.abs(avg);
  if (Math.abs(d) < 0.1) return "";
  return (lowerBetter ? d < 0 : d > 0) ? "text-green-700 bg-green-50 dark:bg-green-950/40" : "text-red-700 bg-red-50 dark:bg-red-950/40";
}

function Explain({ items }: { items: { label: string; text: string }[] }) {
  return (
    <Card className="p-3 bg-muted/30">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-bold"><Info className="size-4 text-primary" /> شن معنى كل عمود</p>
      <dl className="grid gap-2 sm:grid-cols-2 text-sm">
        {items.map((i) => (
          <div key={i.label}>
            <dt className="font-semibold">{i.label}</dt>
            <dd className="text-muted-foreground leading-relaxed">{i.text}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">🟩 أخضر = أحسن من المتوسط بـ10% أو أكثر. 🟥 أحمر = أضعف من المتوسط بـ10% أو أكثر. اضغط على اسم العمود لترتيب الجدول بيه.</p>
    </Card>
  );
}

function Table({ rows, cols, showScore }: { rows: Who[]; cols: Col[]; showScore?: boolean }) {
  const [sort, setSort] = useState<string>(showScore ? "score" : cols[0].key);
  const avg = (c: Col) => {
    const v = rows.map((r) => c.get(r.m)).filter((x): x is number => x !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const avgs = Object.fromEntries(cols.map((c) => [c.key, avg(c)]));
  const sorted = [...rows].sort((a, b) => {
    if (sort === "score") return b.score - a.score;
    const c = cols.find((x) => x.key === sort)!;
    const va = c.get(a.m) ?? -Infinity, vb = c.get(b.m) ?? -Infinity;
    return c.lowerBetter ? va - vb : vb - va;
  });
  const th = "px-2 py-2 text-xs font-semibold whitespace-nowrap cursor-pointer select-none";
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="sticky right-0 z-10 bg-muted px-2 py-2 text-right text-xs font-semibold">الاسم</th>
            {showScore && <th className={`${th} ${sort === "score" ? "text-primary" : ""}`} onClick={() => setSort("score")}>النقاط {sort === "score" && "▼"}</th>}
            {cols.map((c) => (
              <th key={c.key} className={`${th} ${sort === c.key ? "text-primary" : ""}`} onClick={() => setSort(c.key)}>{c.label} {sort === c.key && "▼"}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={r.id} className="border-t">
              <td className="sticky right-0 z-10 bg-card px-2 py-2 min-w-[120px]">
                <div className="font-semibold leading-tight">{i < 3 ? ["🥇", "🥈", "🥉"][i] : `${i + 1}.`} {r.name}</div>
                <div className="text-[11px] text-muted-foreground">{r.sub}</div>
              </td>
              {showScore && (
                <td className="px-2 py-2 text-center">
                  <div className={`text-lg font-black tabular-nums ${r.score >= 65 ? "text-green-700" : r.score < 35 ? "text-red-700" : ""}`}>{r.score}</div>
                  {r.prevScore !== undefined && (
                    <div className={`text-[10px] tabular-nums ${r.score > r.prevScore ? "text-green-700" : r.score < r.prevScore ? "text-red-700" : "text-muted-foreground"}`}>
                      {r.score === r.prevScore ? "نفس" : `${r.score > r.prevScore ? "▲" : "▼"} ${Math.abs(r.score - r.prevScore)}`}
                    </div>
                  )}
                </td>
              )}
              {cols.map((c) => (
                <td key={c.key} className={`px-2 py-2 text-center tabular-nums whitespace-nowrap ${tone(c.get(r.m), avgs[c.key], c.lowerBetter, c.neutral)}`}>
                  {c.fmt(r.m)}
                </td>
              ))}
            </tr>
          ))}
          <tr className="border-t bg-muted/30 text-xs text-muted-foreground">
            <td className="sticky right-0 bg-muted px-2 py-2 font-semibold">المتوسط</td>
            {showScore && <td className="text-center">50</td>}
            {cols.map((c) => <td key={c.key} className="px-2 py-2 text-center tabular-nums">{f(avgs[c.key], 1)}</td>)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** نظرة عامة: النقاط + 4 أرقام أساسية + جملة واضحة لكل واحد. */
function Overview({ rows }: { rows: Who[] }) {
  const sorted = [...rows].sort((a, b) => b.score - a.score);
  const avgG = rows.reduce((a, r) => a + r.m.grams, 0) / (rows.length || 1);
  const sentence = (r: Who) => {
    const out: string[] = [];
    if (r.m.grams > avgG * 1.2) out.push("يبيع وزن أكثر من زملائه");
    else if (r.m.grams < avgG * 0.6) out.push("وزنه المباع قليل");
    if (r.m.priceIndex !== null && r.m.priceIndex >= 105) out.push("يبيع بسعر أعلى من فرعه");
    if (r.m.priceIndex !== null && r.m.priceIndex <= 93) out.push("يبيع أرخص من فرعه");
    if (r.m.lowPricePct > 25) out.push("يكسر السعر كثير");
    if (r.m.discountPct > 3) out.push("يعطي خصومات كثيرة");
    if (r.m.invoices >= 5 && (r.m.custPct ?? r.m.phonePct) < 10) out.push("ما يسجلش اسم ورقم الزبون");
    if (r.prev && r.prev.grams > 0) {
      const ch = ((r.m.grams - r.prev.grams) / r.prev.grams) * 100;
      if (ch >= 15) out.push(`تحسّن عن الفترة اللي قبلها (+${f(ch)}%)`);
      if (ch <= -15) out.push(`نقص عن الفترة اللي قبلها (${f(ch)}%)`);
    }
    return out.length ? out.join(" · ") : "أداء قريب من المتوسط";
  };
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {sorted.map((r, i) => (
        <Card key={r.id} className="p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-bold">{i < 3 ? ["🥇", "🥈", "🥉"][i] : `${i + 1}.`} {r.name}</div>
              <div className="text-xs text-muted-foreground">{r.sub}</div>
            </div>
            <div className="text-center">
              <div className={`text-3xl font-black tabular-nums leading-none ${r.score >= 65 ? "text-green-700" : r.score < 35 ? "text-red-700" : ""}`}>{r.score}</div>
              <div className="text-[10px] text-muted-foreground">من 100</div>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-1 text-center">
            {[["الوزن", `${f(r.m.grams, 0)}`, "جم"], ["فواتير", f(r.m.invoices), ""], ["الفاتورة", f(r.m.avgInv, 1), "جم"], ["السعر", f(r.m.priceIndex), ""]].map(([l, v, u]) => (
              <div key={l} className="rounded-md bg-muted/40 py-1">
                <div className="text-[10px] text-muted-foreground">{l}</div>
                <div className="text-sm font-bold tabular-nums">{v}<span className="text-[10px] font-normal"> {u}</span></div>
              </div>
            ))}
          </div>
          <p className="text-xs leading-relaxed">{sentence(r)}</p>
        </Card>
      ))}
    </div>
  );
}

type View = "overview" | "sales" | "price" | "care" | "hours" | "guide";
const VIEWS: { key: View; label: string }[] = [
  { key: "overview", label: "النتيجة" }, { key: "sales", label: "المبيعات" }, { key: "price", label: "الأسعار" },
  { key: "care", label: "الزبائن والبضاعة" }, { key: "hours", label: "أوقات البيع" }, { key: "guide", label: "كيف تنحسب النقاط" },
];

export default function StaffEval() {
  const [period, setPeriod] = useState<Period>("month");
  const [level, setLevel] = useState<"staff" | "branches">("staff");
  const [branch, setBranch] = useState<string>("all");
  const [view, setView] = useState<View>("overview");
  const [weights, setWeights] = useState<Record<ScoreKey, number>>(loadWeights);
  const saveWeights = (w: Record<ScoreKey, number>) => { setWeights(w); try { localStorage.setItem(WEIGHTS_KEY, JSON.stringify(w)); } catch { /* ignore */ } };

  const ranges = useMemo(() => {
    const { from, to } = periodDays(period);
    const len = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1;
    return { cur: daysToRange(from, to), prev: daysToRange(addDays(from, -len), addDays(from, -1)) };
  }, [period]);
  const fetchAll = async (r: { start: string; end: string }) => {
    const [a, b, c, d] = await Promise.all([
      sb.rpc("amarsoft_staff_eval", { p_start: r.start, p_end: r.end, p_branch: null }),
      sb.rpc("amarsoft_staff_eval_extra", { p_start: r.start, p_end: r.end, p_branch: null }),
      sb.rpc("amarsoft_staff_eval_gold", { p_start: r.start, p_end: r.end, p_branch: null }),
      sb.rpc("amarsoft_customer_capture", { p_start: r.start, p_end: r.end }),
    ]);
    if (a.error) throw a.error;
    return { rows: (a.data ?? []) as Raw[], extra: (b.data ?? []) as Extra[], gold: (c.data ?? []) as Gold[], capture: (d.data ?? []) as Capture[] };
  };
  const q = useQuery({ queryKey: ["staff-eval", period], queryFn: () => fetchAll(ranges.cur) });
  const qPrev = useQuery({ queryKey: ["staff-eval-prev", period], queryFn: () => fetchAll(ranges.prev) });
  const heat = useQuery({
    queryKey: ["sales-heatmap", period, branch],
    enabled: view === "hours",
    queryFn: async () => {
      const { data, error } = await sb.rpc("amarsoft_sales_heatmap", { p_start: ranges.cur.start, p_end: ranges.cur.end, p_branch: branch === "all" ? null : branch });
      if (error) throw error;
      return (data ?? []) as { dow: number; hour: number; invoices: number; grams: number }[];
    },
  });

  const branchList = useMemo(() => {
    const m = new Map<string, string>();
    (q.data?.rows ?? []).forEach((r) => m.set(r.branch_code, r.branch_name));
    return [...m.entries()].sort();
  }, [q.data]);

  // الأشخاص أو الفروع، مع الفترة اللي قبلها، والنقاط محسوبة بين نفس المجموعة.
  const build = (data: { rows: Raw[]; extra: Extra[]; gold: Gold[]; capture: Capture[] } | undefined): { id: string; name: string; sub: string; m: M }[] => {
    if (!data) return [];
    const key = (r: { branch_code: string; sman: string }) => `${r.branch_code}|${r.sman}`;
    if (level === "branches") {
      return [...new Set(data.rows.map((r) => r.branch_code))].map((code) => {
        const rs = data.rows.filter((r) => r.branch_code === code);
        const keys = new Set(rs.map(key));
        return { id: code, name: rs[0].branch_name, sub: `${rs.length} بائع`, m: measure(rs, data.extra.filter((x) => x.branch_code === code), data.gold.filter((x) => x.branch_code === code), data.capture.filter((x) => keys.has(key(x)))) };
      });
    }
    return data.rows.filter((r) => branch === "all" || r.branch_code === branch).map((r) => ({
      id: key(r), name: r.salesman_name, sub: r.branch_name,
      m: measure([r], data.extra.filter((x) => key(x) === key(r)), data.gold.filter((x) => key(x) === key(r)), data.capture.filter((x) => key(x) === key(r))),
    }));
  };
  const who: Who[] = useMemo(() => {
    const cur = build(q.data).filter((x) => x.m.invoices > 0);
    const prev = build(qPrev.data).filter((x) => x.m.invoices > 0);
    const sc = scoreAll(cur.map((x) => x.m), weights);
    const psc = scoreAll(prev.map((x) => x.m), weights);
    return cur.map((x, i) => {
      const pi = prev.findIndex((p) => p.id === x.id);
      return { ...x, score: sc[i], prev: pi >= 0 ? prev[pi].m : undefined, prevScore: pi >= 0 ? psc[pi] : undefined };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, qPrev.data, level, branch, weights]);

  const section = SECTIONS.find((x) => x.key === view);

  return (
    <div className="mx-auto max-w-6xl space-y-4" dir="rtl">
      <div className="hub-title flex items-center gap-2">
        <ClipboardList className="size-6 text-primary" />
        <h1 className="text-xl sm:text-2xl font-bold">تقييم البائعين والفروع</h1>
      </div>

      {/* الفترة + بائعين/فروع + الفرع */}
      <div className="grid gap-2 lg:grid-cols-[1fr_auto]">
        <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <TabsList className="grid w-full grid-cols-3">{PERIODS.map((p) => <TabsTrigger key={p.key} value={p.key}>{p.label}</TabsTrigger>)}</TabsList>
        </Tabs>
        <div className="flex gap-1">
          <Button size="sm" className="flex-1" variant={level === "staff" ? "default" : "outline"} onClick={() => setLevel("staff")}>البائعين</Button>
          <Button size="sm" className="flex-1" variant={level === "branches" ? "default" : "outline"} onClick={() => setLevel("branches")}>الفروع</Button>
        </div>
      </div>
      {(level === "staff" || view === "hours") && (
        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          <Button size="sm" variant={branch === "all" ? "default" : "outline"} className="shrink-0" onClick={() => setBranch("all")}>كل الفروع</Button>
          {branchList.map(([code, name]) => (
            <Button key={code} size="sm" variant={branch === code ? "default" : "outline"} className="shrink-0" onClick={() => setBranch(code)}>{name}</Button>
          ))}
        </div>
      )}

      {/* الأقسام */}
      <div className="flex gap-1.5 overflow-x-auto border-b pb-2 [scrollbar-width:none]">
        {VIEWS.map((v) => (
          <button key={v.key} onClick={() => setView(v.key)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm transition ${view === v.key ? "bg-primary text-primary-foreground font-semibold" : "bg-muted/60 text-muted-foreground"}`}>
            {v.label}
          </button>
        ))}
      </div>

      {q.isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : q.error ? (
        <Card className="p-6 text-center text-sm text-destructive">تعذّر التحميل: {(q.error as Error).message}</Card>
      ) : view === "hours" ? (
        <Heatmap data={heat.data} loading={heat.isLoading} />
      ) : view === "guide" ? (
        <Guide weights={weights} onChange={saveWeights} />
      ) : !who.length ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">لا توجد فواتير بأسماء البائعين في هذه الفترة.</Card>
      ) : view === "overview" ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            النقاط من 100 تجمع كل شي: الوزن، السعر، الخصم، المرتجعات… كل واحد مقارن بزملائه. ٥٠ = في النص، فوق ٦٥ ممتاز 🟢، تحت ٣٥ يحتاج متابعة 🔴.
            الشرح الكامل في «كيف تنحسب النقاط».
          </p>
          <Overview rows={who} />
        </div>
      ) : section ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{section.intro}</p>
          {section.key === "price" && <MarketRatesCard />}
          <Table key={section.key} rows={who} cols={section.cols} showScore={section.key === "sales"} />
          <Explain items={section.cols.map((c) => ({ label: c.label, text: c.explain }))} />
        </div>
      ) : null}
    </div>
  );
}

function Guide({ weights, onChange }: { weights: Record<ScoreKey, number>; onChange: (w: Record<ScoreKey, number>) => void }) {
  const total = SCORE_PARTS.reduce((a, p) => a + (weights[p.key] ?? 0), 0) || 1;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card className="p-4 space-y-2 text-sm leading-relaxed">
        <p className="font-bold text-base">كيف تنحسب النقاط؟</p>
        <p>١. في كل مقياس (مثلاً الوزن) نرتّب البائعين من الأحسن للأضعف.</p>
        <p>٢. الأول ياخذ <b>100</b>، الأخير ياخذ <b>0</b>، واللي في النص ياخذ <b>50</b>.</p>
        <p>٣. نجمع نقاط كل المقاييس حسب أهميتها (النسب على اليسار)، ويطلع رقم واحد من 100.</p>
        <p>٤. المقاييس اللي «الأقل أحسن» (الخصم، المرتجعات، البيع تحت السعر…) الأقل فيها ياخذ 100.</p>
        <p className="text-muted-foreground">مثال: لو الوزن 35% من النقاط، وأحمد الأول في الوزن (100) وفي النص في الباقي (50)، نقاطه تقريباً 68.</p>
        <p className="text-muted-foreground">البائع يتقارن مع زملائه في نفس الفترة — الفروع تتقارن مع بعضها. الأسبوع فيه فواتير قليلة، فالشهر أعدل للتقييم.</p>
        <p className="text-muted-foreground">الرقم الصغير تحت النقاط (▲ أو ▼) = الفرق عن الفترة اللي قبلها.</p>
      </Card>
      <Card className="p-4 space-y-3">
        <p className="flex items-center gap-1.5 font-bold"><SlidersHorizontal className="size-4" /> أهمية كل مقياس</p>
        {SCORE_PARTS.map((p) => (
          <label key={p.key} className="flex items-center gap-2 text-sm">
            <span className="w-36 shrink-0">{p.label}</span>
            <input type="range" min={0} max={50} step={5} value={weights[p.key] ?? 0} className="flex-1 accent-primary"
              onChange={(e) => onChange({ ...weights, [p.key]: Number(e.target.value) })} />
            <span className="w-10 text-left tabular-nums">{Math.round(((weights[p.key] ?? 0) / total) * 100)}%</span>
          </label>
        ))}
        <Button size="sm" variant="outline" onClick={() => onChange(defaults())}>رجّع الافتراضي</Button>
      </Card>
    </div>
  );
}

const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
/** خريطة حرارية: كل خانة يوم × ساعة، لونها بعدد الفواتير — يوريك أوقات الذروة لكل فرع. */
function Heatmap({ data, loading }: { data?: { dow: number; hour: number; invoices: number; grams: number }[]; loading: boolean }) {
  if (loading) return <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>;
  const rows = data ?? [];
  if (!rows.length) return <Card className="p-6 text-center text-sm text-muted-foreground">لا توجد مبيعات في الفترة.</Card>;
  const hours = Array.from(new Set(rows.map((r) => r.hour))).sort((a, b) => ((a + 18) % 24) - ((b + 18) % 24)); // من الصباح لبعد نص الليل
  const max = Math.max(...rows.map((r) => Number(r.invoices)));
  const cell = (d: number, h: number) => rows.find((r) => r.dow === d && r.hour === h);
  const order = [6, 0, 1, 2, 3, 4, 5]; // السبت أولاً
  const byDay = order.map((d) => ({ d, n: rows.filter((r) => r.dow === d).reduce((a, r) => a + Number(r.invoices), 0) }));
  const byHour = hours.map((h) => ({ h, n: rows.filter((r) => r.hour === h).reduce((a, r) => a + Number(r.invoices), 0) }));
  const topDay = [...byDay].sort((a, b) => b.n - a.n)[0];
  const topHours = [...byHour].sort((a, b) => b.n - a.n).slice(0, 3).map((x) => x.h).sort((a, b) => a - b);
  const hl = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? "ص" : "م"}`;
  return (
    <Card className="p-3 space-y-3">
      <p className="text-sm">أكثر يوم بيع: <b>{DAYS[topDay.d]}</b> — وأكثر الساعات: <b>{topHours.map(hl).join("، ")}</b></p>
      <div className="overflow-x-auto">
        <table className="text-[10px] tabular-nums border-separate border-spacing-0.5">
          <thead><tr><th />{hours.map((h) => <th key={h} className="font-normal text-muted-foreground px-0.5">{hl(h)}</th>)}</tr></thead>
          <tbody>
            {order.map((d) => (
              <tr key={d}>
                <td className="pl-1 whitespace-nowrap text-muted-foreground">{DAYS[d]}</td>
                {hours.map((h) => {
                  const c = cell(d, h); const n = Number(c?.invoices ?? 0);
                  return (
                    <td key={h} title={c ? `${n} فاتورة · ${c.grams} جم` : ""}
                      className="size-7 rounded text-center" style={{ background: n ? `hsl(43 80% ${92 - (n / max) * 55}%)` : "hsl(var(--muted))", color: n / max > 0.6 ? "white" : undefined }}>
                      {n || ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">الرقم = عدد الفواتير. الساعات حسب وقت تسجيل الفاتورة في أمارسوفت (توقيت ليبيا).</p>
    </Card>
  );
}
