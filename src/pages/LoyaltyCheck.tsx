// «خصم الزبون» (كل الموظفين): شاشة الكاونتر.
//   فوق: آخر فاتورة في الفرع، وقداش لازم يكون الخصم عليها، وأختامه وهديته، وهل وصلت لبطاقته.
//   في النص: زبون قبل الفاتورة — برقمه ولا اسمه وقيمة الفاتورة، يطلعلك قداش تخصم.
//   تحت: فواتير الفرع الأخيرة، وكيف يشتغل الولاء.
// المستوى والخصم من بطاقة MSTRMND اللي في موبايل الزبون. الخصم يدوي: الموظف يحطه في خانة الخصم في أمارسوفت.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { CircleCheck, CircleX, Clock, Gift, Info, Loader2, QrCode, Search, Smartphone } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { sb } from "@/lib/amarsoft";
import { normalizeDecimalInput } from "@/lib/constants";
import { INSTALL_URL, STAMP_REWARD, SYNC_REASON_AR, TIERS, Tier, tierOfLevel } from "@/lib/loyalty";

type Branch = { code: string; name: string; mine: boolean };
type Inv = {
  invoice_id: number; branch_code: string; branch_name: string; invoice_no: string; kind: "sale" | "return"; sold_at: string;
  net_ld: number; grams: number; discount_ld: number; customer_name: string | null; phone9: string | null; is_deleted: boolean;
  has_card: boolean; card_level: string | null; card_installed: boolean | null; pct_due: number | null;
  stamps_now: number | null; rewards_unused: number | null; to_next: number | null;
  on_card: string | null; on_card_reason: string | null; stamp_on_card: string | null;
  tier_if_joined: Tier | null; pct_if_joined: number | null;
};
type Person = {
  name: string | null; phone9: string; has_card: boolean; card_level: string | null; card_pct: number | null;
  card_installed: boolean | null; to_next: number | null; stamps_now: number | null; rewards_unused: number | null;
  last_at: string | null; last_branch: string | null; tier_if_joined: Tier | null; pct_if_joined: number | null;
};
type Settings = {
  ld_per_point: number; silver_points: number; gold_points: number;
  bronze_discount: number; silver_discount: number; gold_discount: number;
};
type Tone = "ok" | "bad" | "warn" | "info" | "muted";

const n0 = (n: number) => Math.round(n).toLocaleString("en-US");
const clock = (iso: string) => new Date(iso).toLocaleTimeString("ar-LY", { timeZone: "Africa/Tripoli", hour: "numeric", minute: "2-digit" });
const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Tripoli" });
const NEXT: Record<Tier, string | null> = { bronze: "الفضي", silver: "الذهبي", gold: null };
const TONE: Record<Tone, string> = {
  ok: "border-emerald-300 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-100",
  bad: "border-red-300 bg-red-50 text-red-950 dark:bg-red-950/40 dark:text-red-100",
  warn: "border-amber-300 bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100",
  info: "border-sky-300 bg-sky-50 text-sky-950 dark:bg-sky-950/40 dark:text-sky-100",
  muted: "bg-muted/50",
};

const rewardText = (grams: number) => grams > 0
  ? `خصم ${n0(STAMP_REWARD.invoice + STAMP_REWARD.perGram * grams)} د.ل (${n0(STAMP_REWARD.invoice)} + ${STAMP_REWARD.perGram} × ${grams} جم)`
  : `خصم ${n0(STAMP_REWARD.invoice)} على الفاتورة + ${STAMP_REWARD.perGram} على كل قرام`;
const joinText = (tier: Tier | null, pct: number | null) =>
  `خليه يمسح الـ QR ويسجّل بنفس رقمه. شرياته القديمة تنحسبله${tier ? ` ويطلع ${TIERS[tier].label} بخصم ${pct ?? 0}%` : ""}.`;

// شن لازم يصير في الفاتورة: الخصم المستحق مقابل المسجّل في أمارسوفت، ولا ليش ما فيهاش خصم.
function advice(i: Inv): { tone: Tone; title: string; text?: string } {
  const given = Number(i.discount_ld), net = Number(i.net_ld);
  if (i.is_deleted) return { tone: "muted", title: "الفاتورة انحذفت من أمارسوفت", text: "لو كانت على بطاقته، تنقص وحدها." };
  if (i.kind === "return") return { tone: "muted", title: "مرتجع", text: "قيمته تنقص من بطاقته وحدها." };
  if (!i.phone9) return { tone: "warn", title: "الفاتورة بلا رقم موبايل الزبون", text: "عدّل الفاتورة في أمارسوفت وزيد رقمه، وإلا ما تنحسبلهش على بطاقته." };
  if (!i.has_card) return { tone: "info", title: "ما عندهش بطاقة ولاء", text: joinText(i.tier_if_joined, i.pct_if_joined) };
  const pct = Number(i.pct_due ?? 0);
  if (pct === 0) return { tone: "muted", title: "ركّب البطاقة بعد الفاتورة هذي", text: "الشرية تنحسبله على البطاقة، والخصم من الشرية الجاية." };
  const due = ((net + given) * pct) / 100;
  if (given >= due * 0.9) return { tone: "ok", title: `الخصم مسجّل: ${n0(given)} د.ل`, text: `${pct}% من ${n0(net + given)} د.ل` };
  if (given > 0) return { tone: "bad", title: `لازم يكون الخصم ${n0(due)} د.ل`, text: `المسجّل ${n0(given)} بس، باقي ${n0(due - given)} د.ل.` };
  return { tone: "bad", title: `لازم تخصم ${n0(due)} د.ل`, text: `${pct}% من ${n0(net)} د.ل. الخصم مش مسجّل في أمارسوفت: عدّل الفاتورة وحطه في خانة الخصم.` };
}

// وصلت الشرية لبطاقته في MSTRMND؟
function cardState(i: Inv): [LucideIcon, string, string] | null {
  if (!i.has_card || !i.phone9 || i.is_deleted) return null;
  if (i.on_card === "sent") return [CircleCheck, "text-status-available", i.kind === "return" ? "تنقص من بطاقته" : "الشرية وصلت لبطاقته"];
  if (i.on_card === "skipped" || i.on_card === "error")
    return [CircleX, "text-destructive", `ما وصلتش لبطاقته${i.on_card_reason ? `: ${SYNC_REASON_AR[i.on_card_reason] ?? i.on_card_reason}` : ""}`];
  return [Clock, "text-amber-600", "قاعدة توصل لبطاقته…"];
}

export default function LoyaltyCheck() {
  const { data: branches } = useQuery({
    queryKey: ["loyalty-counter-branches"],
    queryFn: async () => {
      const { data, error } = await sb.rpc("loyalty_counter_branches");
      if (error) throw error;
      return (data ?? []) as Branch[];
    },
  });
  const { data: s } = useQuery({
    queryKey: ["loyalty-settings"],
    queryFn: async () => {
      const { data, error } = await sb.from("loyalty_settings").select("*").eq("id", 1).single();
      if (error) throw error;
      return data as Settings;
    },
  });
  const [picked, setPicked] = useState<string | null>(null);
  const branch = picked ?? branches?.find((b) => b.mine)?.code ?? (branches?.length === 1 ? branches[0].code : "all");
  const { data: invoices, isLoading } = useQuery({
    queryKey: ["loyalty-counter", branch],
    enabled: !!branches,
    queryFn: async () => {
      const { data, error } = await sb.rpc("loyalty_counter_invoices", { p_branch: branch === "all" ? null : branch, p_limit: 15 });
      if (error) throw error;
      return (data ?? []) as Inv[];
    },
    refetchInterval: 10_000,
  });
  const [latest, ...rest] = invoices ?? [];

  return (
    <div className="max-w-lg mx-auto space-y-5">
      {(branches?.length ?? 0) > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {[{ code: "all", name: "كل الفروع" }, ...(branches ?? [])].map((b) => (
            <button key={b.code} onClick={() => setPicked(b.code)}
              className={`text-xs rounded-full border px-2.5 py-1 ${branch === b.code ? "bg-primary text-primary-foreground border-primary" : ""}`}>
              {b.name}
            </button>
          ))}
        </div>
      )}

      <section className="space-y-2">
        <h2 className="font-bold">آخر فاتورة{branch !== "all" && branches ? ` في ${branches.find((b) => b.code === branch)?.name ?? ""}` : ""}</h2>
        {isLoading || !branches ? <div className="flex justify-center py-8"><Loader2 className="size-6 animate-spin text-primary" /></div>
          : !latest ? (
            <Card className="p-6 text-center text-muted-foreground">
              {branches.length ? "ما فيش فواتير في آخر 3 أيام." : "حسابك مش مربوط بفرع. كلّم المدير العام."}
            </Card>
          ) : <LatestInvoice i={latest} />}
      </section>

      <section className="space-y-2">
        <h2 className="font-bold">زبون قبل الفاتورة</h2>
        <Lookup />
      </section>

      {rest.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-bold">فواتير قبلها</h2>
          <Card className="divide-y">{rest.map((i) => <InvoiceRow key={i.invoice_id} i={i} />)}</Card>
        </section>
      )}

      <HowItWorks s={s} />
    </div>
  );
}

function TierBadge({ level, pct, big }: { level: string | null; pct?: number | null; big?: boolean }) {
  const t = tierOfLevel(level);
  if (!level) return null;
  return (
    <span className={`${big ? "text-sm px-2.5 py-1" : "text-xs px-2 py-0.5"} rounded-full whitespace-nowrap ${t ? TIERS[t].badge : "bg-muted"}`}>
      {level}{pct != null ? ` ${pct}%` : ""}
    </span>
  );
}

function StampDots({ n }: { n: number }) {
  return (
    <span className="flex items-center gap-1" aria-label={`${n} من 5 أختام`}>
      {[0, 1, 2, 3, 4].map((k) => <span key={k} className={`size-3 rounded-full ${k < n ? "bg-primary" : "bg-muted-foreground/25"}`} />)}
      <span className="mr-1 text-xs text-muted-foreground">{n}/5</span>
    </span>
  );
}

function LatestInvoice({ i }: { i: Inv }) {
  const a = advice(i);
  const state = cardState(i);
  const StateIcon = state?.[0];
  const tier = tierOfLevel(i.card_level);
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-lg font-bold truncate">{i.customer_name || "زبون"}</p>
          <p className="text-xs text-muted-foreground">
            فاتورة {i.branch_code}-{i.invoice_no} · {clock(i.sold_at)}{i.phone9 ? <> · <span dir="ltr">0{i.phone9}</span></> : ""}
          </p>
        </div>
        <TierBadge level={i.card_level} big />
      </div>
      <p className="text-2xl font-black tabular-nums">
        {i.kind === "return" ? "مرتجع " : ""}{n0(Math.abs(Number(i.net_ld)))} د.ل
        {Number(i.grams) > 0 && <span className="text-sm font-normal text-muted-foreground"> · {Number(i.grams)} جم</span>}
      </p>

      <div className={`rounded-lg border p-3 ${TONE[a.tone]}`}>
        <p className="text-lg font-black">{a.title}</p>
        {a.text && <p className="text-sm mt-0.5">{a.text}</p>}
      </div>

      {!!i.rewards_unused && i.kind === "sale" && !i.is_deleted && (
        <div className={`rounded-lg border p-3 flex gap-2 ${TONE.ok}`}>
          <Gift className="size-5 shrink-0" />
          <div className="text-sm">
            <p className="font-bold">عنده هدية الأختام{i.rewards_unused > 1 ? ` (${i.rewards_unused})` : ""}: {rewardText(Number(i.grams))}</p>
            <p>لو حب يستعملها في الشرية هذي، سجّل استعمالها في تطبيق الماسح.</p>
          </div>
        </div>
      )}

      {(i.has_card || i.stamps_now != null) && (
        <div className="space-y-1.5 text-sm">
          {i.stamps_now != null && <div className="flex items-center justify-between"><span className="text-muted-foreground">الأختام</span><StampDots n={i.stamps_now} /></div>}
          {i.to_next != null && tier && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">المستوى الجاي</span>
              <span>{NEXT[tier] && i.to_next > 0 ? `باقيله ${n0(i.to_next)} د.ل لـ${NEXT[tier]}` : "في أعلى مستوى"}</span>
            </div>
          )}
          {state && StateIcon && <p className={`flex items-center gap-1.5 ${state[1]}`}><StateIcon className="size-4" />{state[2]}</p>}
          {i.card_installed === false && (
            <p className="flex items-center gap-1.5 text-amber-700"><Smartphone className="size-4" /> البطاقة مسجّلة بس مش مركّبة في موبايله: خليه يركّبها.</p>
          )}
        </div>
      )}
    </Card>
  );
}

function InvoiceRow({ i }: { i: Inv }) {
  const a = advice(i);
  const chip = a.tone === "ok" ? "bg-emerald-100 text-emerald-900" : a.tone === "bad" ? "bg-red-100 text-red-900"
    : a.tone === "warn" ? "bg-amber-100 text-amber-900" : a.tone === "info" ? "bg-sky-100 text-sky-900" : "bg-muted";
  return (
    <div className={`p-3 flex items-center gap-2 ${i.is_deleted ? "opacity-60" : ""}`}>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold truncate">{i.customer_name || "زبون"}</p>
        <p className="text-xs text-muted-foreground">
          {clock(i.sold_at)} · {i.branch_code}-{i.invoice_no} · {i.kind === "return" ? "مرتجع " : ""}{n0(Math.abs(Number(i.net_ld)))} د.ل
        </p>
      </div>
      {i.stamps_now != null && <span className="text-xs text-muted-foreground">{i.stamps_now}/5</span>}
      <span className={`text-xs rounded-full px-2 py-0.5 max-w-[11rem] truncate ${chip}`}>{a.title}</span>
    </div>
  );
}

function Lookup() {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [value, setValue] = useState("");
  const [grams, setGrams] = useState("");
  const [qr, setQr] = useState(false);
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const digits = term.replace(/\D/g, "");
  const ready = digits.length >= 4 || (!digits && term.length >= 2);
  const { data, isFetching } = useQuery({
    queryKey: ["loyalty-lookup", term],
    enabled: ready,
    queryFn: async () => {
      const { data, error } = await sb.rpc("loyalty_lookup", { p_q: term });
      if (error) throw error;
      return (data ?? []) as Person[];
    },
  });
  const v = Number(normalizeDecimalInput(value)) || 0;
  const g = Number(normalizeDecimalInput(grams)) || 0;

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="رقم موبايل الزبون أو اسمه" className="pr-9 h-12 text-lg" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label>قيمة الفاتورة (د.ل)</Label>
          <Input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" dir="ltr" placeholder="0" />
        </div>
        <div className="space-y-1">
          <Label>الوزن (جم) للهدية</Label>
          <Input value={grams} onChange={(e) => setGrams(e.target.value)} inputMode="decimal" dir="ltr" placeholder="0" />
        </div>
      </div>

      {!ready ? null : isFetching && !data ? <div className="flex justify-center py-4"><Loader2 className="size-5 animate-spin text-primary" /></div>
        : !data?.length ? (
          <Card className="p-4 space-y-2 text-sm">
            <p className="font-bold">ما لقيناش الزبون.</p>
            <p className="text-muted-foreground">لو أول مرة يشري: خليه يركّب بطاقة الولاء من الـ QR ويسجّل برقم موبايله، واكتب نفس الرقم في فاتورة أمارسوفت.</p>
            <Button size="sm" variant="outline" onClick={() => setQr(!qr)}><QrCode className="size-4 ml-1" /> {qr ? "خبّي الـ QR" : "اعرض الـ QR للزبون"}</Button>
          </Card>
        ) : data.map((p) => <PersonCard key={p.phone9} p={p} value={v} grams={g} onQr={() => setQr(true)} />)}

      {qr && (
        <Card className="p-4 flex flex-col items-center gap-2">
          <div className="bg-white p-3 rounded-lg"><QRCodeSVG value={INSTALL_URL} size={180} /></div>
          <p className="text-sm text-center">الزبون يمسحه بكاميرا موبايله، يضيف البطاقة لـ Wallet، ويسجّل بنفس رقمه.</p>
          <Button size="sm" variant="ghost" onClick={() => setQr(false)}>خبّي</Button>
        </Card>
      )}
    </div>
  );
}

function PersonCard({ p, value, grams, onQr }: { p: Person; value: number; grams: number; onQr: () => void }) {
  const tier = tierOfLevel(p.card_level);
  const pct = Number(p.card_pct ?? 0);
  return (
    <Card className="p-4 space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-bold text-lg truncate">{p.name || "زبون"}</p>
          <p className="text-xs text-muted-foreground" dir="ltr" style={{ textAlign: "right" }}>0{p.phone9}</p>
        </div>
        <TierBadge level={p.card_level} big />
      </div>

      {p.has_card ? (
        <>
          <div className={`rounded-lg border p-3 ${TONE.ok}`}>
            <p className="text-2xl font-black">خصم {pct}% على الفاتورة</p>
            {value > 0 && <p className="text-lg">اخصم <b className="tabular-nums">{n0((value * pct) / 100)}</b> د.ل من {n0(value)}</p>}
          </div>
          {!!p.rewards_unused && (
            <div className={`rounded-lg border p-3 flex gap-2 text-sm ${TONE.ok}`}>
              <Gift className="size-5 shrink-0" />
              <p><b>عنده هدية الأختام{p.rewards_unused > 1 ? ` (${p.rewards_unused})` : ""}:</b> {rewardText(grams)}. لو استعملها، سجّلها في تطبيق الماسح.</p>
            </div>
          )}
          <div className="space-y-1.5 text-sm">
            {p.stamps_now != null && <div className="flex items-center justify-between"><span className="text-muted-foreground">الأختام</span><StampDots n={p.stamps_now} /></div>}
            {p.to_next != null && tier && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">المستوى الجاي</span>
                <span>{NEXT[tier] && p.to_next > 0 ? `باقيله ${n0(p.to_next)} د.ل لـ${NEXT[tier]}` : "في أعلى مستوى"}</span>
              </div>
            )}
            {p.card_installed === false && (
              <p className="flex items-center gap-1.5 text-amber-700"><Smartphone className="size-4" /> البطاقة مش مركّبة في موبايله: خليه يركّبها.</p>
            )}
          </div>
        </>
      ) : (
        <div className={`rounded-lg border p-3 text-sm space-y-2 ${TONE.info}`}>
          <p className="font-bold">ما عندهش بطاقة ولاء، فما فيش خصم لين يركّبها.</p>
          <p>{joinText(p.tier_if_joined, p.pct_if_joined)}</p>
          <Button size="sm" variant="outline" onClick={onQr}><QrCode className="size-4 ml-1" /> اعرض الـ QR للزبون</Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {p.last_at ? `آخر شرية: ${date(p.last_at)}${p.last_branch ? ` في ${p.last_branch}` : ""}` : "ما عندهش شريات في أمارسوفت برقمه."}
      </p>
    </Card>
  );
}

function HowItWorks({ s }: { s?: Settings }) {
  const at = (points: number) => s ? n0(points * s.ld_per_point) : "…";
  return (
    <details className="rounded-xl border p-3 text-sm">
      <summary className="font-bold cursor-pointer flex items-center gap-1.5"><Info className="size-4 text-primary" /> كيف يشتغل الولاء</summary>
      <ul className="mt-2 space-y-1.5 list-disc pr-5">
        <li>الزبون يمسح الـ QR، يضيف البطاقة لموبايله، ويسجّل برقم موبايله.</li>
        <li><b>اكتب رقم موبايل الزبون في كل فاتورة أمارسوفت.</b> من غيره الشرية ما تنحسبلهش.</li>
        <li>
          الخصم حسب مستواه على الفاتورة كاملة: برونزي {s?.bronze_discount ?? "…"}%،
          فضي {s?.silver_discount ?? "…"}% (من {at(s?.silver_points ?? 0)} د.ل)، ذهبي {s?.gold_discount ?? "…"}% (من {at(s?.gold_points ?? 0)} د.ل).
        </li>
        <li><b>الخصم ما يتخصمش وحده:</b> لا MSTRMND ولا أمارسوفت يخصموه. انت تحطه بيدك في خانة الخصم في أمارسوفت.</li>
        <li>قيمة الفاتورة تتزاد على بطاقته وحدها، ومستواه يطلع وحده. وختم على كل فاتورة (ختم واحد في اليوم).</li>
        <li>5 أختام = هدية: خصم {n0(STAMP_REWARD.invoice)} على الفاتورة + {STAMP_REWARD.perGram} على كل قرام. على الشراء، مش كاش.</li>
        <li>ما تكتبش مبالغ في تطبيق الماسح لبطاقة الولاء، وإلا الشرية تنحسب مرتين.</li>
      </ul>
    </details>
  );
}
