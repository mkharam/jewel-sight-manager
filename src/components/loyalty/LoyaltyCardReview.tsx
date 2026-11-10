// «مراجعة البطاقات» (المدير العام): مجموع كل بطاقة ولاء في MSTRMND مقابل فواتير الزبون في أمارسوفت.
// قبل الربط (9 نوفمبر 2026) الموظفين كانو يزيدو الشريات بالماسح بيدهم. كل مسحة لقيناها فاتورتها ولا لا،
// والزيادة يقرر فيها المدير: «خليها» ولا «نقّصها من البطاقة» (loyalty_card_review_decide).
// وتحت كل بطاقة: فواتيره برقمه من وقت البطاقة، والخصم المسجّل في أمارسوفت مقابل اللي يستاهله.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CircleCheck, Clock, Loader2, Phone, Receipt, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ConfirmDialogProvider";
import { sb } from "@/lib/amarsoft";
import { TIERS, Tier, tierOfLevel } from "@/lib/loyalty";

type Scan = {
  tx_id: number; at: string; amount: number; how: "phone" | "no_phone" | "partial" | "duplicate" | "none";
  inv: string | null; inv_date: string | null; inv_ld: number | null; inv_cust: string | null; other_phone: boolean | null;
  extra: number; decision: "keep" | "remove" | null; decided_at: string | null; removed: number | null; removal_http: number | null;
};
type Inv = { inv: string; date: string; ld: number; disc: number; pct: number | null; approx: boolean };
type CardRow = {
  customer_id: string; card_id: number; name: string | null; phone9: string | null; level: string | null; pct: number | null;
  card_at: string | null; card_total: number; by_phone: number; open_extra: number; phone_fix: number; tier_without: Tier | null;
  scans: Scan[]; invoices: Inv[];
};
type Tone = "ok" | "bad" | "warn" | "info" | "muted";

const n0 = (n: number | null | undefined) => Math.round(Number(n ?? 0)).toLocaleString("en-US");
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Tripoli", day: "2-digit", month: "2-digit", year: "numeric" });
const TONE: Record<Tone, string> = {
  ok: "text-status-available", bad: "text-destructive", warn: "text-amber-600", info: "text-sky-600", muted: "text-muted-foreground",
};
const CHIP: Record<Tone, string> = {
  ok: "bg-emerald-100 text-emerald-900", bad: "bg-red-100 text-red-900", warn: "bg-amber-100 text-amber-900",
  info: "bg-sky-100 text-sky-900", muted: "bg-muted text-muted-foreground",
};

// المسحة لقت فاتورتها؟
function scanLine(s: Scan): [Tone, string] {
  const inv = `فاتورة ${s.inv}${s.inv_date ? ` (${s.inv_date})` : ""}`;
  switch (s.how) {
    case "phone": return ["ok", `${inv} برقمه`];
    case "no_phone": return s.other_phone
      ? ["info", `${inv} بنفس المبلغ، بس مسجّلة برقم ثاني${s.inv_cust ? ` (${s.inv_cust})` : ""}`]
      : ["warn", `${inv} بنفس المبلغ بلا رقمه${s.inv_cust ? ` (${s.inv_cust})` : ""}: الشرية حقيقية، زيدو رقمه في الفاتورة في أمارسوفت`];
    case "partial": return ["bad", `${inv} بـ ${n0(s.inv_ld)} د.ل، والمسحة ${n0(s.amount)}: الفرق ${n0(s.extra)} زيادة على البطاقة`];
    case "duplicate": return ["bad", `${inv} انحسبت قبل: المسحة هذي مكررة`];
    default: return ["bad", "ما لقيناش فاتورة في أمارسوفت بالمبلغ هذا (يوم قبل ويوم بعد)"];
  }
}

// قرار المدير وحالة النقص من البطاقة.
function decisionLine(s: Scan): [Tone, string] | null {
  if (s.decision === "keep") return ["muted", `خليتها على البطاقة${s.decided_at ? ` (${day(s.decided_at)})` : ""}`];
  if (s.decision !== "remove") return null;
  if (s.removal_http == null) return ["warn", `قاعدة تنقص ${n0(s.removed)} د.ل من البطاقة…`];
  return s.removal_http >= 200 && s.removal_http < 300
    ? ["ok", `تنقصت ${n0(s.removed)} د.ل من البطاقة`]
    : ["bad", `النقص ما نجحش (MSTRMND رجّع ${s.removal_http}): كلّمنا`];
}

const needsWork = (c: CardRow) => c.open_extra > 0 || c.phone_fix > 0
  || c.scans.some((s) => s.decision === "remove" && (s.removal_http == null || s.removal_http >= 300));
const missingDisc = (i: Inv) => Number(i.pct ?? 0) > 0 && Number(i.disc) < ((Number(i.ld) + Number(i.disc)) * Number(i.pct)) / 100 * 0.9;

export default function LoyaltyCardReview() {
  const [all, setAll] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["loyalty-card-review"],
    queryFn: async () => {
      const { data, error } = await sb.rpc("loyalty_card_review");
      if (error) throw error;
      return data as { synced_at: string | null; cards: CardRow[] };
    },
    refetchInterval: 60_000,
  });

  const t = useMemo(() => {
    const cards = data?.cards ?? [];
    return {
      extraCards: cards.filter((c) => c.open_extra > 0),
      extra: cards.reduce((s, c) => s + Number(c.open_extra), 0),
      phoneFix: cards.reduce((s, c) => s + Number(c.phone_fix), 0),
      noDisc: cards.reduce((s, c) => s + c.invoices.filter(missingDisc).length, 0),
      withInv: cards.reduce((s, c) => s + c.invoices.length, 0),
    };
  }, [data]);

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-primary" /></div>;
  if (error || !data) return <Card className="p-4 text-sm text-destructive">ما قدرناش نجيبو المراجعة: {(error as Error)?.message ?? "—"}</Card>;

  const list = all ? data.cards : data.cards.filter(needsWork);
  return (
    <div className="space-y-3">
      <Card className="p-3 text-xs text-muted-foreground space-y-1">
        <p>قبل الربط الموظفين كانو يزيدو الشريات للبطاقة بالماسح بيدهم. هنا كل مسحة قدام فاتورتها في أمارسوفت (يوم قبل ويوم بعد، بنفس المبلغ).</p>
        <p>الزيادة اللي ما لقيناش فاتورتها انت تقرر فيها: «خليها» لو الشرية صحيحة، ولا «نقّصها» وتنقص من البطاقة في MSTRMND وموبايل الزبون.</p>
        {data.synced_at && <p>البطاقات محدّثة من MSTRMND: {new Date(data.synced_at).toLocaleString("ar-LY", { timeZone: "Africa/Tripoli", hour: "numeric", minute: "2-digit", day: "numeric", month: "short" })}</p>}
      </Card>

      <div className="grid grid-cols-3 gap-2">
        <Tile n={t.extraCards.length} label={`بطاقات فيها زيادة (${n0(t.extra)} د.ل)`} tone={t.extraCards.length ? "bad" : undefined} />
        <Tile n={t.phoneFix} label="فواتير يبيلها رقم الزبون" tone={t.phoneFix ? "warn" : undefined} />
        <Tile n={t.noDisc} label={`فاتورة أعضاء بلا الخصم (من ${t.withInv})`} tone={t.noDisc ? "warn" : undefined} />
      </div>

      <div className="flex gap-1.5">
        <Button size="sm" variant={!all ? "default" : "outline"} onClick={() => setAll(false)}>يبو تعديل</Button>
        <Button size="sm" variant={all ? "default" : "outline"} onClick={() => setAll(true)}>كل البطاقات ({data.cards.length})</Button>
      </div>

      {!list.length
        ? <Card className="p-8 text-center text-sm text-muted-foreground"><CircleCheck className="size-6 mx-auto mb-2 text-status-available" />كل البطاقات مطابقة لأمارسوفت.</Card>
        : list.map((c) => <ReviewCard key={c.customer_id} c={c} />)}
    </div>
  );
}

function Tile({ n, label, tone }: { n: number; label: string; tone?: Tone }) {
  return (
    <div className={`rounded-xl border p-3 text-center ${tone ? CHIP[tone] : "bg-card"}`}>
      <p className="text-2xl font-black tabular-nums">{n}</p>
      <p className="text-[11px] opacity-80">{label}</p>
    </div>
  );
}

function ReviewCard({ c }: { c: CardRow }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const tier = tierOfLevel(c.level);
  const [showInv, setShowInv] = useState(false);
  const decide = useMutation({
    mutationFn: async ({ tx, decision }: { tx: number; decision: "keep" | "remove" | "undo" }) => {
      const { data, error } = await sb.rpc("loyalty_card_review_decide", { p_tx: tx, p_decision: decision });
      if (error) throw error;
      return data as { ok: boolean; amount?: number };
    },
    onSuccess: (r, v) => {
      if (v.decision === "remove") toast.success(`تبعت النقص (${n0(r.amount)} د.ل). البطاقة تتحدّث في موبايله خلال دقايق.`);
      qc.invalidateQueries({ queryKey: ["loyalty-card-review"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = async (s: Scan) => {
    const drop = c.tier_without && tier && c.tier_without !== tier && c.open_extra === s.extra;
    const ok = await confirm({
      title: `تنقّص ${n0(s.extra)} د.ل من بطاقة ${c.name ?? "الزبون"}؟`,
      description: `تنقص من مجموع شرياته في MSTRMND (توا ${n0(c.card_total)} د.ل)، وتتحدّث بطاقته في موبايله.`
        + (drop ? ` مستواه يرجع ${TIERS[c.tier_without!].label}.` : "") + " ما ترجعش من هنا.",
      confirmLabel: "نقّصها من البطاقة",
      destructive: true,
    });
    if (ok) decide.mutate({ tx: s.tx_id, decision: "remove" });
  };

  const noDisc = c.invoices.filter(missingDisc);
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold truncate">{c.name ?? "زبون"}</p>
          <p className="text-xs text-muted-foreground">
            {c.phone9 && <span dir="ltr">0{c.phone9}</span>}
            {c.card_at ? ` · البطاقة من ${day(c.card_at)}` : ""}
          </p>
        </div>
        {c.level && <span className={`text-xs rounded-full px-2 py-0.5 whitespace-nowrap ${tier ? TIERS[tier].badge : "bg-muted"}`}>{c.level}{c.pct != null ? ` ${c.pct}%` : ""}</span>}
      </div>

      <div className="grid grid-cols-2 gap-2 text-center text-sm">
        <div className="rounded-lg bg-muted/50 p-2"><p className="font-bold tabular-nums">{n0(c.card_total)} د.ل</p><p className="text-[11px] text-muted-foreground">على البطاقة</p></div>
        <div className="rounded-lg bg-muted/50 p-2"><p className="font-bold tabular-nums">{n0(c.by_phone)} د.ل</p><p className="text-[11px] text-muted-foreground">فواتيره برقمه في أمارسوفت</p></div>
      </div>

      {c.open_extra > 0 && (
        <p className="text-sm flex items-start gap-1.5 text-destructive">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <span>
            زيادة {n0(c.open_extra)} د.ل على البطاقة ما لقيناش فاتورتها.
            {c.tier_without && tier && c.tier_without !== tier ? ` لو تنقصت يرجع ${TIERS[c.tier_without].label} (توا ${TIERS[tier].label}).` : ""}
          </span>
        </p>
      )}

      {c.scans.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">المسحات بالماسح قبل الربط</p>
          {c.scans.map((s) => {
            const [tone, text] = scanLine(s);
            const d = decisionLine(s);
            return (
              <div key={s.tx_id} className="rounded-lg border p-2.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">{day(s.at)}</span>
                  <span className="font-bold tabular-nums">{n0(s.amount)} د.ل</span>
                </div>
                <p className={`text-xs flex items-start gap-1.5 ${TONE[tone]}`}>
                  {tone === "ok" ? <CircleCheck className="size-3.5 shrink-0 mt-0.5" />
                    : s.how === "no_phone" ? <Phone className="size-3.5 shrink-0 mt-0.5" />
                    : <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />}
                  <span>{text}</span>
                </p>
                {d && (
                  <p className={`text-xs flex items-center gap-1.5 ${TONE[d[0]]}`}>
                    {d[0] === "warn" ? <Clock className="size-3.5" /> : <CircleCheck className="size-3.5" />}
                    <span className="flex-1">{d[1]}</span>
                    {s.decision === "keep" && (
                      <button className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" disabled={decide.isPending}
                        onClick={() => decide.mutate({ tx: s.tx_id, decision: "undo" })}>
                        <Undo2 className="size-3" /> رجّعها للمراجعة
                      </button>
                    )}
                  </p>
                )}
                {s.extra > 0 && !s.decision && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ tx: s.tx_id, decision: "keep" })}>
                      خليها (الشرية صحيحة)
                    </Button>
                    <Button size="sm" variant="destructive" disabled={decide.isPending} onClick={() => remove(s)}>
                      نقّص {n0(s.extra)} د.ل من البطاقة
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {c.invoices.length > 0 && (
        <div>
          <button onClick={() => setShowInv(!showInv)} className="text-xs flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
            <Receipt className="size-3.5" />
            فواتيره من وقت البطاقة: {c.invoices.length}
            {noDisc.length ? <span className={`rounded-full px-2 py-0.5 ${CHIP.warn}`}>{noDisc.length} بلا الخصم</span> : <span className={`rounded-full px-2 py-0.5 ${CHIP.ok}`}>الخصم مسجّل</span>}
          </button>
          {showInv && (
            <div className="mt-2 divide-y text-xs">
              {c.invoices.map((i) => {
                const due = ((Number(i.ld) + Number(i.disc)) * Number(i.pct ?? 0)) / 100;
                return (
                  <div key={i.inv} className="py-1.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-muted-foreground">{i.date} · {i.inv} · {n0(i.ld)} د.ل</span>
                    <span className={missingDisc(i) ? TONE.warn : Number(i.disc) > 0 ? TONE.ok : TONE.muted}>
                      {Number(i.disc) > 0 ? `خصم مسجّل ${n0(i.disc)}` : "بلا خصم مسجّل"}
                      {Number(i.pct ?? 0) > 0 ? ` · يستاهل ${i.approx ? "حوالي " : ""}${i.pct}% = ${n0(due)}` : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
