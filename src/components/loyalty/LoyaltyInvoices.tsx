// خانة «الفواتير» في صفحة الولاء (المدير العام): كل فاتورة لزبون عنده بطاقة MSTRMND، وشن صار فيها —
// تزادت على بطاقة الولاء والختم ولا لا (وليش)، ومستواه وقت الشراء وقداش كان يستاهل خصم مقابل الخصم المسجّل في أمارسوفت.
// تتحدّث وحدها كل 20 ثانية، فتقدر تتابع الفاتورة لين توصل للبطاقة.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, CircleX, Clock, CreditCard, Loader2, Percent, Stamp } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { sb } from "@/lib/amarsoft";
import { SYNC_REASON_AR as REASON_AR } from "@/lib/loyalty";
import { LinkStatus } from "@/pages/WalletCustomers";

type Row = {
  invoice_id: number; branch_code: string; branch_name: string; invoice_no: string; kind: "sale" | "return";
  sold_at: string; first_seen_at: string; net_ld: number; is_deleted: boolean; customer_name: string | null; phone9: string;
  has_card: boolean; card_level: string | null; card_pct: number | null; card_installed: boolean | null;
  stamps_now: number | null; rewards_unused: number | null; pct_at_sale: number | null; discount_ld: number;
  loyalty_status: string | null; loyalty_reason: string | null; loyalty_amount: number | null; loyalty_action: string | null; loyalty_at: string | null;
  stamp_status: string | null; stamp_reason: string | null; stamp_at: string | null;
};
type Tone = "ok" | "bad" | "wait" | "muted";

const DAYS = [{ d: 1, label: "اليوم" }, { d: 7, label: "آخر أسبوع" }, { d: 30, label: "آخر شهر" }] as const;
const n0 = (n: number) => Math.round(n).toLocaleString("en-US");
const clock = (iso: string) => new Date(iso).toLocaleTimeString("ar-LY", { timeZone: "Africa/Tripoli", hour: "numeric", minute: "2-digit" });
const dayTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Tripoli", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const mins = (from: string, to: string) => Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000));
const after = (m: number) => (m < 1 ? "في أقل من دقيقة" : `بعد ${m} دقيقة`);

// بطاقة الولاء: تزادت؟ ولا ليش لا؟
function loyaltyLine(r: Row): [Tone, string] {
  if (r.is_deleted) {
    const ret = r.loyalty_action === "subtract";   // مرتجع انحذف: اللي تنقص يرجع للبطاقة
    return r.loyalty_status === "reversed" ? ["ok", ret ? "المرتجع انحذف، ورجع للبطاقة" : "الفاتورة انحذفت، وتنقصت من البطاقة"]
      : r.loyalty_status === "sent" ? ["wait", ret ? "المرتجع انحذف، وقاعد يرجع للبطاقة" : "الفاتورة انحذفت، وقاعدة تنقص من البطاقة"]
      : r.loyalty_status === "error" ? ["bad", `الفاتورة انحذفت، وما تأكدناش إنها ${ret ? "رجعت للبطاقة" : "تنقصت من البطاقة"}: شوف البطاقة`]
      : ["muted", "الفاتورة انحذفت"];
  }
  if (r.loyalty_status === "sent") {
    const sign = r.loyalty_action === "subtract" ? "−" : "+";
    const edited = r.loyalty_reason?.startsWith("تعدّلت") ? ` (${r.loyalty_reason})` : "";
    return ["ok", `${sign}${n0(r.loyalty_amount ?? 0)} على بطاقة الولاء${edited} · ${clock(r.loyalty_at!)}، ${after(mins(r.first_seen_at, r.loyalty_at!))}`];
  }
  // الربط ما يعاودش الفاتورة اللي MSTRMND رفضها (اللي ما ردّش عليها تقعد «في الطريق» وتتعاود)، ولا اللي الاتصال
  // طاح وسطها وما تأكدش (ممكن وصلت): السبب يقول يشوفو البطاقة.
  if (r.loyalty_status === "error" && r.loyalty_reason?.startsWith("انقطع الاتصال")) return ["bad", `ما ندروش وصلت ولا لا: ${r.loyalty_reason}`];
  if (r.loyalty_status === "error") return ["bad", `ما تزادتش: MSTRMND رجّع خطأ (${r.loyalty_reason ?? ""}). ما تتعاودش وحدها: زيدها من تطبيق الماسح`];
  // بطاقة أختام بس: مش غلطة، الختم في سطره.
  if (r.loyalty_status === "skipped" && r.loyalty_reason === "no_loyalty_card") return ["muted", "ما عندهش بطاقة ولاء (بطاقة أختام بس)"];
  if (r.loyalty_status === "skipped") return ["bad", `ما تزادتش: ${REASON_AR[r.loyalty_reason ?? ""] ?? r.loyalty_reason}`];
  return mins(r.first_seen_at, new Date().toISOString()) < 15 ? ["wait", "في الطريق للبطاقة…"] : ["bad", "لين توا ما تبعتتش للبطاقة"];
}

function stampLine(r: Row): [Tone, string] | null {
  if (r.kind === "return") return null;
  if (r.stamp_status === "sent") return ["ok", `ختم على بطاقة الأختام${r.stamps_now != null ? ` · عنده توا ${r.stamps_now} من 5` : ""}${r.rewards_unused ? ` · ${r.rewards_unused} هدية ما استعملهاش` : ""}`];
  if (r.stamp_status === "reversed") return ["muted", "الختم تنقص (الفاتورة انحذفت)"];
  if (r.stamp_status === "error") return ["bad", "الختم ما تزادش: MSTRMND رجّع خطأ. ما يتعاودش وحده: زيده من تطبيق الماسح"];
  if (r.stamp_status === "skipped") return ["muted", `ما فيش ختم: ${REASON_AR[r.stamp_reason ?? ""] ?? r.stamp_reason}`];
  return r.loyalty_status ? ["wait", "الختم في الطريق…"] : null;
}

// الخصم: قداش يستاهل حسب مستواه وقت الشراء، وقداش تسجّل في أمارسوفت.
function discountLine(r: Row): [Tone, string] | null {
  if (r.kind === "return" || r.pct_at_sale == null) return null;
  if (Number(r.pct_at_sale) === 0) return ["muted", "ما كانش عنده بطاقة ولاء وقت الشراء، فما يستاهلش خصم على هذي"];
  const pct = Number(r.pct_at_sale), given = Number(r.discount_ld);
  const due = ((Number(r.net_ld) + given) * pct) / 100;
  if (given >= due * 0.9) return ["ok", `انعطى خصم ${n0(given)} د.ل (يستاهل ${pct}% = ${n0(due)})`];
  if (given > 0) return ["bad", `انعطى ${n0(given)} د.ل بس، ويستاهل ${pct}% = ${n0(due)} د.ل`];
  return ["bad", `يستاهل خصم ${pct}% = ${n0(due)} د.ل · أمارسوفت ما فيهاش خصم مسجّل`];
}

const TONE: Record<Tone, { icon: LucideIcon; cls: string }> = {
  ok: { icon: CircleCheck, cls: "text-status-available" },
  bad: { icon: CircleX, cls: "text-destructive" },
  wait: { icon: Clock, cls: "text-amber-600" },
  muted: { icon: Clock, cls: "text-muted-foreground" },
};

function Line({ icon: Icon, line }: { icon: LucideIcon; line: [Tone, string] | null }) {
  if (!line) return null;
  const [tone, text] = line;
  const T = TONE[tone];
  return (
    <p className={`flex items-start gap-1.5 text-xs ${T.cls}`}>
      <Icon className="size-3.5 mt-0.5 shrink-0 text-muted-foreground" />
      <T.icon className="size-3.5 mt-0.5 shrink-0" />
      <span>{text}</span>
    </p>
  );
}

export default function LoyaltyInvoices() {
  const [days, setDays] = useState<number>(7);
  const [problems, setProblems] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["loyalty-invoice-feed", days],
    queryFn: async () => {
      const { data, error } = await sb.rpc("loyalty_invoice_feed", { p_days: days });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 20_000,
  });

  const rows = useMemo(() => (data ?? []).map((r) => ({ r, card: loyaltyLine(r), disc: discountLine(r) })), [data]);
  const stats = useMemo(() => ({
    all: rows.length,
    // «وصلت»: اللي على البطاقة توا، مش المحذوفة اللي تنقصت.
    onCard: rows.filter((x) => x.r.loyalty_status === "sent" && !x.r.is_deleted).length,
    notOnCard: rows.filter((x) => x.card[0] === "bad").length,
    noDiscount: rows.filter((x) => x.disc?.[0] === "bad").length,
  }), [rows]);
  const list = problems ? rows.filter((x) => x.card[0] === "bad" || x.disc?.[0] === "bad") : rows;

  return (
    <div className="space-y-3">
      <LinkStatus />
      <Card className="p-3 text-xs text-muted-foreground space-y-1">
        <p>كل فاتورة لزبون عنده بطاقة ولاء: هل وصلت لبطاقته، والختم، وقداش يستاهل خصم حسب مستواه وقت الشراء.</p>
        <p>الخصم يحطّه الموظف بيده في خانة الخصم في أمارسوفت. لو ما تحطّش هناك، يبان هنا «ما فيهاش خصم مسجّل».</p>
      </Card>
      <div className="grid grid-cols-4 gap-1.5">
        <Tile n={stats.all} label="فاتورة" />
        <Tile n={stats.onCard} label="وصلت للبطاقة" />
        <Tile n={stats.notOnCard} label="ما وصلتش" warn={stats.notOnCard > 0} />
        <Tile n={stats.noDiscount} label="بلا خصم مسجّل" warn={stats.noDiscount > 0} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {DAYS.map((x) => (
          <Button key={x.d} size="sm" variant={days === x.d ? "default" : "outline"} onClick={() => setDays(x.d)}>{x.label}</Button>
        ))}
        <Button size="sm" variant={problems ? "default" : "outline"} className="mr-auto" onClick={() => setProblems(!problems)}>المشاكل بس</Button>
      </div>

      {isLoading ? <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-primary" /></div>
        : !list.length ? (
          <Card className="p-8 text-center text-muted-foreground">
            {problems ? "ما فيش مشاكل في الفواتير هذي." : "ما فيش فواتير لزبائن عندهم بطاقة في الفترة هذي."}
          </Card>
        ) : list.map(({ r, card, disc }) => (
          <Card key={r.invoice_id} className={`p-3 space-y-1.5 ${r.is_deleted ? "opacity-60" : ""}`}>
            <div className="flex items-center gap-2">
              <p className="font-bold truncate flex-1">{r.customer_name || `0${r.phone9}`}</p>
              {r.card_level && (
                <span className="text-xs rounded-full bg-amber-100 text-amber-900 px-2 py-0.5">{r.card_level} {r.card_pct ?? 0}%</span>
              )}
              <span className={`font-bold tabular-nums ${r.kind === "return" ? "text-destructive" : ""}`}>
                {r.kind === "return" ? "مرتجع " : ""}{n0(Math.abs(Number(r.net_ld)))} د.ل
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {r.branch_name} · فاتورة {r.branch_code}-{r.invoice_no} · {dayTime(r.sold_at)}
              {r.card_installed === false ? " · البطاقة مش مركّبة في موبايله" : ""}
            </p>
            <Line icon={CreditCard} line={card} />
            <Line icon={Stamp} line={stampLine(r)} />
            <Line icon={Percent} line={disc} />
          </Card>
        ))}
    </div>
  );
}

function Tile({ n, label, warn }: { n: number; label: string; warn?: boolean }) {
  return (
    <div className={`rounded-xl border p-2 text-center ${warn ? "border-destructive" : ""}`}>
      <p className="text-xl font-black tabular-nums">{n}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
