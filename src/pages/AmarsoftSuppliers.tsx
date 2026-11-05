// الموردون: من كل مورد شن دخل (قطع، وزن، ذهب صافي، مصنعية)، شن تباع وبأي سرعة، شن قاعد ما تباعش،
// وحسابه: رصيد افتتاحي مرة وحدة ثم الدفعات، وكل قطعة تدخل منه في أمارسوفت تزيد اللي عليك.
// أمارسوفت ما يسجلش حسابات الموردين، فالحساب هنا في التطبيق.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Truck } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { sb, formatLD, formatGrams, tripoliToday } from "@/lib/amarsoft";

type Supplier = {
  supplier_code: string; name: string | null; internal: boolean; branches: string | null;
  received_pcs: number; received_grams: number; received_pure: number; making_cost_dirhams: number;
  sold_pcs: number; sold_grams: number; sales_dirhams: number; sale_grams: number;
  stock_pcs: number; stock_grams: number; stale_pcs: number;
  life_received_pcs: number; life_sold_pcs: number; avg_days_to_sell: number | null;
  making_rate: number | null; first_received: string | null; last_received: string | null;
  has_opening: boolean; owed_gold: number | null; owed_dirhams: number | null;
};
type Detail = {
  months: { month: string; pcs: number; grams: number; pure: number; making_cost_dirhams: number; sold_pcs: number }[];
  types: { type: string; karat: string | null; pcs: number; grams: number; sold_pcs: number; stock_pcs: number; stock_grams: number | null; days: number | null }[];
  aging: { bucket: 1 | 2 | 3 | 4; pcs: number; grams: number; making_cost_dirhams: number }[];
  stale: { tag: string; branch_code: string; branch_name: string | null; type: string; karat: string | null; grams: number; received_on: string; days: number; cost_dirhams: number }[];
  entries: { id: number; entry_date: string; kind: "opening" | "payment"; gold_pure_grams: number; money_dirhams: number; note: string | null; by_name: string | null }[];
};

const PERIODS = [
  { key: 30, label: "الشهر" }, { key: 90, label: "3 أشهر" }, { key: 365, label: "السنة" }, { key: 0, label: "الكل" },
] as const;

function startOf(days: number) {
  if (!days) return "2000-01-01";
  const d = new Date(`${tripoliToday()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
const n0 = (v: number | null | undefined) => Number(v ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const perGram = (dirhams: number, grams: number) => (Number(grams) ? Number(dirhams) / 1000 / Number(grams) : 0);

export default function AmarsoftSuppliers() {
  const [days, setDays] = useState<number>(90);
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [showInternal, setShowInternal] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["amarsoft-suppliers", days],
    queryFn: async () => {
      const { data, error } = await sb.rpc("amarsoft_suppliers", { p_start: startOf(days), p_end: tripoliToday() });
      if (error) throw error;
      return (data ?? []) as Supplier[];
    },
  });
  // المفتوح يُقرأ من آخر نتيجة، حتى يتحدّث رصيده فور تسجيل دفعة.
  const open = (data ?? []).find((s) => s.supplier_code === openCode) ?? null;

  const v = useMemo(() => {
    const all = data ?? [];
    const real = all.filter((s) => !s.internal)
      .sort((a, b) => Number(b.received_grams) - Number(a.received_grams) || Number(b.stock_grams) - Number(a.stock_grams));
    const sum = (k: keyof Supplier) => real.reduce((t, s) => t + Number(s[k] ?? 0), 0);
    const withAcct = real.filter((s) => s.has_opening);
    return {
      real, internal: all.filter((s) => s.internal),
      grams: sum("received_grams"), making: sum("making_cost_dirhams"), stock: sum("stock_grams"), stale: sum("stale_pcs"),
      owedGold: withAcct.reduce((t, s) => t + Number(s.owed_gold ?? 0), 0),
      owedMoney: withAcct.reduce((t, s) => t + Number(s.owed_dirhams ?? 0), 0),
      withAccount: withAcct.length,
    };
  }, [data]);

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold flex items-center gap-2"><Truck className="size-7 text-primary" />الموردون</h1>
      <div className="grid grid-cols-4 gap-1.5">
        {PERIODS.map((p) => (
          <Button key={p.key} size="lg" variant={days === p.key ? "default" : "outline"} onClick={() => setDays(p.key)} className="text-base">{p.label}</Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Card className="p-3"><div className="text-xs text-muted-foreground">دخل من الموردين</div><div className="text-xl font-bold">{formatGrams(v.grams)}</div></Card>
            <Card className="p-3"><div className="text-xs text-muted-foreground">تكلفة المصنعية</div><div className="text-xl font-bold">{formatLD(v.making)}</div></Card>
            <Card className="p-3"><div className="text-xs text-muted-foreground">في المخزون الآن</div><div className="text-xl font-bold">{formatGrams(v.stock)}</div></Card>
            <Card className="p-3"><div className="text-xs text-muted-foreground">قاعدة أكثر من 6 أشهر</div><div className="text-xl font-bold text-destructive">{n0(v.stale)} قطعة</div></Card>
          </div>
          {v.withAccount > 0 && (
            <Card className="p-3 bg-gold-soft border-primary/30">
              <div className="text-xs text-muted-foreground">عليك للموردين ({v.withAccount} بحساب مفتوح)</div>
              <div className="text-xl font-bold">{formatGrams(v.owedGold)} ذهب صافي · {formatLD(v.owedMoney)}</div>
            </Card>
          )}

          <div className="space-y-2">
            {v.real.map((s) => <SupplierRow key={s.supplier_code} s={s} onOpen={() => setOpenCode(s.supplier_code)} />)}
          </div>

          {!!v.internal.length && (
            <div>
              <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => setShowInternal(!showInternal)}>
                {showInternal ? "إخفاء" : "عرض"} مصادر داخلية ({v.internal.length}) — فروع وذهب زبائن
              </Button>
              {showInternal && <div className="space-y-2">{v.internal.map((s) => <SupplierRow key={s.supplier_code} s={s} onOpen={() => setOpenCode(s.supplier_code)} />)}</div>}
            </div>
          )}
          <p className="text-xs text-muted-foreground text-center">
            من مخزون أمارسوفت: المورد وتكلفة المصنعية مسجّلة على كل قطعة. «يتباع الغرام بـ» من فواتير قطع هذا المورد في الفترة.
          </p>
        </>
      )}

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpenCode(null)}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[90dvh] overflow-y-auto pb-8">
          {open && <SupplierDetail s={open} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SupplierRow({ s, onOpen }: { s: Supplier; onOpen: () => void }) {
  const sellThrough = pct(Number(s.life_sold_pcs), Number(s.life_received_pcs));
  return (
    <button onClick={onOpen} className="block w-full text-right">
      <Card className="p-3 space-y-1.5 active:bg-muted/40">
        <div className="flex justify-between items-baseline gap-2">
          <span className="text-lg font-bold truncate">{s.name ?? s.supplier_code}</span>
          <span className="shrink-0 font-bold text-primary">{formatGrams(s.received_grams)}</span>
        </div>
        <div className="text-xs text-muted-foreground truncate">{s.branches ?? "—"}{s.last_received ? ` · آخر توريد ${s.last_received}` : ""}</div>
        <div className="grid grid-cols-3 gap-1 text-sm">
          <span>دخل {n0(s.received_pcs)} قطعة</span>
          <span>تباع {n0(s.sold_pcs)}</span>
          <span>في المخزون {n0(s.stock_pcs)}</span>
          <span className={sellThrough < 30 ? "text-destructive font-bold" : ""}>انباع {sellThrough}% من الكل</span>
          <span>{s.avg_days_to_sell != null ? `يتباع في ${n0(s.avg_days_to_sell)} يوم` : "—"}</span>
          <span className="text-muted-foreground">مصنعية {s.making_rate ?? "—"}/جم</span>
        </div>
        {(Number(s.stale_pcs) > 0 || s.has_opening) && (
          <div className="flex justify-between text-sm">
            {Number(s.stale_pcs) > 0 ? <span className="text-destructive">{n0(s.stale_pcs)} قطعة قاعدة أكثر من 6 أشهر</span> : <span />}
            {s.has_opening && <span className="font-bold">عليك {formatGrams(s.owed_gold)} · {formatLD(s.owed_dirhams)}</span>}
          </div>
        )}
      </Card>
    </button>
  );
}

function SupplierDetail({ s }: { s: Supplier }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["amarsoft-supplier-detail", s.supplier_code],
    queryFn: async () => {
      const { data, error } = await sb.rpc("amarsoft_supplier_detail", { p_code: s.supplier_code });
      if (error) throw error;
      return data as Detail;
    },
  });
  const salePerGram = perGram(s.sales_dirhams, s.sale_grams);
  const maxMonth = Math.max(1, ...(data?.months ?? []).map((m) => Number(m.grams)));

  return (
    <div className="space-y-4">
      <SheetHeader className="text-right">
        <SheetTitle className="text-xl">{s.name ?? s.supplier_code}</SheetTitle>
        <p className="text-xs text-muted-foreground">رقم الحساب في أمارسوفت: {s.supplier_code} · {s.branches}</p>
      </SheetHeader>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <Card className="p-2.5"><div className="text-xs text-muted-foreground">كل اللي دخل منه</div><div className="font-bold">{n0(s.life_received_pcs)} قطعة</div></Card>
        <Card className="p-2.5"><div className="text-xs text-muted-foreground">تباع منها</div><div className="font-bold">{n0(s.life_sold_pcs)} ({pct(Number(s.life_sold_pcs), Number(s.life_received_pcs))}%)</div></Card>
        <Card className="p-2.5"><div className="text-xs text-muted-foreground">مصنعيته للغرام</div><div className="font-bold">{s.making_rate ?? "—"} د.ل</div></Card>
        <Card className="p-2.5"><div className="text-xs text-muted-foreground">يتباع الغرام بـ (الفترة)</div><div className="font-bold">{salePerGram ? `${n0(salePerGram)} د.ل` : "—"}</div></Card>
      </div>

      {data && <StaleGoods aging={data.aging ?? []} stale={data.stale ?? []} types={data.types} />}

      <Account s={s} entries={data?.entries ?? []} onSaved={() => {
        qc.invalidateQueries({ queryKey: ["amarsoft-supplier-detail", s.supplier_code] });
        qc.invalidateQueries({ queryKey: ["amarsoft-suppliers"] });
      }} />

      {!!data?.types.length && (
        <div>
          <h3 className="font-bold mb-1">حسب النوع</h3>
          {data.types.slice(0, 12).map((t) => (
            <div key={`${t.type}-${t.karat}`} className="flex justify-between py-1.5 border-b last:border-0 text-sm">
              <span>{t.type}{t.karat ? ` · ${t.karat}` : ""}</span>
              <span className="text-muted-foreground">
                {n0(t.pcs)} قطعة · تباع {pct(Number(t.sold_pcs), Number(t.pcs))}%{t.days != null ? ` · ${n0(t.days)} يوم` : ""}
              </span>
            </div>
          ))}
        </div>
      )}

      {!!data?.months.length && (
        <div>
          <h3 className="font-bold mb-1">التوريد شهراً بشهر</h3>
          {data.months.map((m) => (
            <div key={m.month} className="flex items-center gap-2 text-xs py-0.5">
              <span className="w-14 shrink-0 text-muted-foreground" dir="ltr">{m.month}</span>
              <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
                <div className="h-full bg-primary/80" style={{ width: `${Math.round((Number(m.grams) / maxMonth) * 100)}%` }} />
              </div>
              <span className="w-32 shrink-0 text-left">{formatGrams(m.grams)} · {n0(m.pcs)} ق</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const AGE_LABELS = { 1: "أقل من 3 أشهر", 2: "3–6 أشهر", 3: "6–12 شهر", 4: "أكثر من سنة" } as const;
const ageText = (d: number) => (d >= 365 ? `${(d / 365).toFixed(1)} سنة` : d >= 60 ? `${Math.round(d / 30)} أشهر` : `${d} يوم`);

// البضاعة اللي عطلت: كم قاعد من بضاعة المورد وقداش له، أي أنواع متكدسة، والقطع نفسها من الأقدم.
function StaleGoods({ aging, stale, types }: { aging: Detail["aging"]; stale: Detail["stale"]; types: Detail["types"] }) {
  const [minDays, setMinDays] = useState(180);
  const [shown, setShown] = useState(20);
  const stockPcs = aging.reduce((t, a) => t + Number(a.pcs), 0);
  if (!stockPcs) return null;
  const pieces = stale.filter((p) => p.days >= minDays);
  // الأنواع المتكدسة: الأكثر قطعاً قاعدة، مع نسبة بيعها.
  const stuck = types
    .filter((t) => Number(t.stock_pcs) > 0)
    .sort((a, b) => Number(b.stock_pcs) - Number(a.stock_pcs))
    .slice(0, 6);

  return (
    <Card className="p-3 space-y-3">
      <h3 className="font-bold text-lg">البضاعة اللي عطلت</h3>
      <div className="grid grid-cols-2 gap-2">
        {([1, 2, 3, 4] as const).map((b) => {
          const a = aging.find((x) => Number(x.bucket) === b);
          return (
            <div key={b} className={`rounded-lg p-2.5 ${b >= 3 && a ? "bg-destructive/10" : "bg-muted/50"}`}>
              <div className="text-xs text-muted-foreground">{AGE_LABELS[b]}</div>
              <div className={`font-bold ${b >= 3 && a ? "text-destructive" : ""}`}>{n0(a?.pcs)} قطعة · {formatGrams(a?.grams ?? 0)}</div>
            </div>
          );
        })}
      </div>

      {!!stuck.length && (
        <div>
          <p className="font-semibold text-sm mb-1">وين متكدس (حسب النوع)</p>
          {stuck.map((t) => {
            const sell = pct(Number(t.sold_pcs), Number(t.pcs));
            return (
              <div key={`${t.type}-${t.karat}`} className="flex justify-between py-1.5 border-b last:border-0 text-sm">
                <span>{t.type}{t.karat ? ` · ${t.karat}` : ""}</span>
                <span>
                  {n0(t.stock_pcs)} قاعدة{t.stock_grams != null ? ` · ${formatGrams(t.stock_grams)}` : ""}
                  <span className={sell < 30 ? " text-destructive font-bold" : " text-muted-foreground"}> · تباع {sell}%</span>
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div>
        <div className="grid grid-cols-3 gap-1.5 mb-2">
          {[{ d: 90, l: "+3 أشهر" }, { d: 180, l: "+6 أشهر" }, { d: 365, l: "+سنة" }].map((o) => (
            <Button key={o.d} variant={minDays === o.d ? "default" : "outline"} onClick={() => { setMinDays(o.d); setShown(20); }}>{o.l}</Button>
          ))}
        </div>
        {!pieces.length ? (
          <p className="text-sm text-muted-foreground text-center py-2">ما فيش قطع قاعدة بهذا القدر 👍</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-1">
              {n0(pieces.length)}{stale.length >= 500 ? "+" : ""} قطعة، الأقدم أولاً
            </p>
            {pieces.slice(0, shown).map((p) => (
              <div key={`${p.branch_code}-${p.tag}`} className="flex justify-between items-center gap-2 py-2 border-b last:border-0">
                <div className="min-w-0">
                  <div className="font-bold text-sm truncate">{p.type}{p.karat ? ` · ${p.karat}` : ""} · {formatGrams(p.grams)}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    <span dir="ltr">{p.tag}</span> · {p.branch_name ?? p.branch_code} · دخلت {p.received_on}
                  </div>
                </div>
                <span className={`shrink-0 text-sm font-bold ${p.days >= 365 ? "text-destructive" : ""}`}>{ageText(p.days)}</span>
              </div>
            ))}
            {shown < pieces.length && (
              <Button variant="ghost" className="w-full" onClick={() => setShown(shown + 30)}>عرض المزيد</Button>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

// الحساب: الرصيد الافتتاحي (اللي عليك يوم تبدأ) ثم الدفعات (ذهب أو فلوس تعطيها للمورد).
function Account({ s, entries, onSaved }: { s: Supplier; entries: Detail["entries"]; onSaved: () => void }) {
  const opening = entries.find((e) => e.kind === "opening");
  const kind: "opening" | "payment" = opening ? "payment" : "opening";
  const [date, setDate] = useState(tripoliToday());
  const [gold, setGold] = useState("");
  const [money, setMoney] = useState("");
  const [note, setNote] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      const g = Number(gold || 0), m = Number(money || 0);
      if (Number.isNaN(g) || Number.isNaN(m)) throw new Error("اكتب أرقام بس");
      if (!g && !m && kind === "payment") throw new Error("اكتب وزن الذهب أو المبلغ");
      const { error } = await sb.from("amarsoft_supplier_entries").insert({
        supplier_code: s.supplier_code, kind, entry_date: date, gold_pure_grams: g, money_dirhams: Math.round(m * 1000), note: note || null,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success(kind === "opening" ? "تم فتح الحساب" : "تم تسجيل الدفعة"); setGold(""); setMoney(""); setNote(""); onSaved(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await sb.from("amarsoft_supplier_entries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("انمسح"); onSaved(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-3 space-y-3">
      <h3 className="font-bold text-lg">الحساب</h3>
      {s.has_opening ? (
        <div className="rounded-lg bg-gold-soft p-3 text-center">
          <div className="text-xs text-muted-foreground">عليك للمورد الآن</div>
          <div className="text-xl font-bold">{formatGrams(s.owed_gold)} ذهب صافي</div>
          <div className="text-lg font-bold">{formatLD(s.owed_dirhams)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">= الرصيد الافتتاحي + كل قطعة دخلت منه بعد {opening?.entry_date} − الدفعات</div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          أمارسوفت ما فيهش حساب هذا المورد. اكتب كم عليك له اليوم (ذهب صافي وفلوس) مرة وحدة، ومن بعدها كل قطعة تدخل منه تنزاد تلقائياً، وأنت تسجل الدفعات.
        </p>
      )}

      <div className="space-y-2">
        <p className="font-semibold">{kind === "opening" ? "الرصيد الافتتاحي — كم عليك له اليوم" : "دفعة للمورد — شن عطيته"}</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-muted-foreground">ذهب صافي (جم)
            <Input inputMode="decimal" value={gold} onChange={(e) => setGold(e.target.value)} className="h-12 text-lg" placeholder="0" />
          </label>
          <label className="text-xs text-muted-foreground">فلوس (د.ل)
            <Input inputMode="decimal" value={money} onChange={(e) => setMoney(e.target.value)} className="h-12 text-lg" placeholder="0" />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-muted-foreground">التاريخ
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-12" />
          </label>
          <label className="text-xs text-muted-foreground">ملاحظة
            <Input value={note} onChange={(e) => setNote(e.target.value)} className="h-12" placeholder="اختياري" />
          </label>
        </div>
        <Button size="lg" className="w-full h-12 text-base" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? <Loader2 className="size-5 animate-spin" /> : kind === "opening" ? "فتح الحساب" : "تسجيل الدفعة"}
        </Button>
      </div>

      {!!entries.length && (
        <div>
          {entries.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-2 py-2 border-b last:border-0 text-sm">
              <div className="min-w-0">
                <div className="font-bold">{e.kind === "opening" ? "رصيد افتتاحي" : "دفعة"} · {e.entry_date}</div>
                <div className="text-xs text-muted-foreground truncate">{e.by_name ?? ""}{e.note ? ` · ${e.note}` : ""}</div>
              </div>
              <div className="shrink-0 text-left">
                {!!Number(e.gold_pure_grams) && <div>{formatGrams(e.gold_pure_grams)}</div>}
                {!!Number(e.money_dirhams) && <div>{formatLD(e.money_dirhams)}</div>}
              </div>
              <button className="text-xs text-destructive underline shrink-0" onClick={() => { if (confirm("مسح هذا القيد؟")) remove.mutate(e.id); }}>مسح</button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
