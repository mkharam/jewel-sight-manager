// «لوحة الولاء» (كل الموظفين): كل اللي يحتاجه الموظف والزبون عن الولاء في شاشة وحدة.
//   فوق: أرقام اليوم في الفرع، وقواعد الولاء دايماً قدامه.
//   الزبون: رقمه ولا اسمه وقيمة الفاتورة — ولا الضغط على فاتورة من «فواتير الفرع الآن» — يطلّع بطاقاته زي ما في
//   موبايله، الخصم اللي يتكتب في أمارسوفت، شريط مستواه وشن تديرله الشرية هذي، وأختامه وهديته.
//   «فواتير الفرع الآن» تتحدّث كل 10 ثواني: الخصم تسجّل؟ وصلت لبطاقته؟ فيها رقم الزبون؟
//   والفاتورة اللي تسجّلت بلا رقم الزبون تقعد في مربع أحمر فوق لين تتعدّل في أمارسوفت (MissingCustomerAlert).
// المستوى والخصم من بطاقة MSTRMND، والخصم يدوي في أمارسوفت. بطاقة الولاء وبطاقة الأختام بطاقتين منفصلتين.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CircleCheck, CircleX, Clock, Gift, Info, Loader2, QrCode, Receipt, Search, Smartphone, Sparkles, TrendingUp, UserRound, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { sb } from "@/lib/amarsoft";
import { normalizeDecimalInput } from "@/lib/constants";
import { daysSince, sinceText, tripoliDate } from "@/lib/customers";
import { useSearchParams } from "react-router-dom";
import { STAMP_REWARD, SYNC_REASON_AR, TIERS, Tier, tierOfLevel } from "@/lib/loyalty";
import MissingCustomerAlert from "@/components/loyalty/MissingCustomerAlert";

type Branch = { code: string; name: string; mine: boolean };
type Inv = {
  invoice_id: number; branch_code: string; branch_name: string; invoice_no: string; kind: "sale" | "return"; sold_at: string;
  net_ld: number; grams: number; discount_ld: number; customer_name: string | null; phone9: string | null; is_deleted: boolean;
  has_card: boolean; card_level: string | null; card_installed: boolean | null; pct_due: number | null;
  stamps_now: number | null; rewards_unused: number | null; to_next: number | null;
  on_card: string | null; on_card_reason: string | null; stamp_on_card: string | null;
  tier_if_joined: Tier | null; pct_if_joined: number | null; has_stamp_card: boolean; stamp_installed: boolean | null;
};
type Person = {
  name: string | null; phone9: string; has_card: boolean; card_level: string | null; card_pct: number | null;
  card_installed: boolean | null; to_next: number | null; stamps_now: number | null; rewards_unused: number | null;
  last_at: string | null; last_branch: string | null; tier_if_joined: Tier | null; pct_if_joined: number | null;
  has_stamp_card: boolean; stamp_installed: boolean | null; purchases: number | null; visits: number | null;
};
type Settings = {
  ld_per_point: number; silver_points: number; gold_points: number;
  bronze_discount: number; silver_discount: number; gold_discount: number;
};
type Tone = "ok" | "bad" | "warn" | "info" | "muted";

const n0 = (n: number) => Math.round(n).toLocaleString("en-US");
const clock = (iso: string) => new Date(iso).toLocaleTimeString("ar-LY", { timeZone: "Africa/Tripoli", hour: "numeric", minute: "2-digit" });
// الفواتير من آخر 3 أيام: الساعة بس لو اليوم، وإلا «أمس» ولا التاريخ قبلها.
const when = (iso: string) => {
  const d = tripoliDate(iso), today = tripoliDate(new Date().toISOString());
  const day = d === today ? "" : d === tripoliDate(new Date(Date.now() - 86_400_000).toISOString()) ? "أمس " : `${d.slice(8)}/${d.slice(5, 7)} `;
  return day + clock(iso);
};
const NEXT: Record<Tier, string | null> = { bronze: "للفضي", silver: "للذهبي", gold: null };
const visitsText = (n: number) => (n === 1 ? "زيارة وحدة" : n === 2 ? "زيارتين" : n <= 10 ? `${n} زيارات` : `${n} زيارة`);
const TONE: Record<Tone, string> = {
  ok: "border-emerald-300 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-100",
  bad: "border-red-300 bg-red-50 text-red-950 dark:bg-red-950/40 dark:text-red-100",
  warn: "border-amber-300 bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100",
  info: "border-sky-300 bg-sky-50 text-sky-950 dark:bg-sky-950/40 dark:text-sky-100",
  muted: "bg-muted/50",
};
const CHIP: Record<Tone, string> = {
  ok: "bg-emerald-100 text-emerald-900", bad: "bg-red-100 text-red-900", warn: "bg-amber-100 text-amber-900",
  info: "bg-sky-100 text-sky-900", muted: "bg-muted text-muted-foreground",
};

const rewardText = () => `خصم ${n0(STAMP_REWARD.invoice)} على الفاتورة + ${STAMP_REWARD.perGram} على كل قرام`;
const joinText = (tier: Tier | null, pct: number | null) =>
  `خليه يمسح الـ QR ويسجّل بنفس رقمه. شرياته القديمة تنحسبله${tier ? ` ويطلع ${TIERS[tier].label} بخصم ${pct ?? 0}%` : ""}.`;
const levels = (s: Settings) => ({ silver: s.silver_points * s.ld_per_point, gold: s.gold_points * s.ld_per_point });

// شن لازم يصير في الفاتورة: الخصم المستحق مقابل المسجّل في أمارسوفت، ولا ليش ما فيهاش خصم.
function advice(i: Inv): { tone: Tone; title: string; text?: string; short: string } {
  const given = Number(i.discount_ld), net = Number(i.net_ld);
  if (i.is_deleted) return { tone: "muted", short: "انحذفت", title: "الفاتورة انحذفت من أمارسوفت", text: "لو كانت على بطاقته، تنقص وحدها." };
  if (i.kind === "return") return { tone: "muted", short: "مرتجع", title: "مرتجع", text: "قيمته تنقص من بطاقته وحدها." };
  if (!i.phone9) return i.customer_name
    ? { tone: "warn", short: "بلا رقم زبون", title: "الفاتورة بلا رقم موبايل الزبون", text: "عدّل الفاتورة في أمارسوفت وزيد رقمه، وإلا ما تنحسبلهش على بطاقته." }
    : { tone: "bad", short: "بلا اسم ولا رقم", title: "الفاتورة بلا اسم الزبون ولا رقمه", text: "عدّل الفاتورة في أمارسوفت واختار الزبون (ولا سجّله باسمه ورقم موبايله)." };
  if (!i.has_card) return { tone: "info", short: "بلا بطاقة", title: "ما عندهش بطاقة ولاء", text: joinText(i.tier_if_joined, i.pct_if_joined) };
  const pct = Number(i.pct_due ?? 0);
  if (pct === 0) return { tone: "muted", short: "ركّب بعدها", title: "ركّب البطاقة بعد الفاتورة هذي", text: "الشرية تنحسبله على البطاقة، والخصم من الشرية الجاية." };
  const due = ((net + given) * pct) / 100;
  if (given >= due * 0.9) return { tone: "ok", short: "الخصم مسجّل", title: `الخصم مسجّل: ${n0(given)} د.ل`, text: `${pct}% من ${n0(net + given)} د.ل` };
  if (given > 0) return { tone: "bad", short: `باقي ${n0(due - given)}`, title: `لازم يكون الخصم ${n0(due)} د.ل`, text: `المسجّل ${n0(given)} بس، باقي ${n0(due - given)} د.ل.` };
  return { tone: "bad", short: `لازم خصم ${n0(due)}`, title: `لازم تخصم ${n0(due)} د.ل`, text: `${pct}% من ${n0(net)} د.ل. الخصم مش مسجّل في أمارسوفت: عدّل الفاتورة وحطه في خانة الخصم.` };
}

// وصلت الشرية لبطاقته في MSTRMND؟ (اللي عنده بطاقة أختام بس: وصل الختم؟)
function cardState(i: Inv): { icon: LucideIcon; cls: string; text: string; short: string } | null {
  if (!i.phone9 || i.is_deleted) return null;
  if (!i.has_card) {
    if (!i.has_stamp_card || i.kind === "return" || i.stamp_on_card === "skipped") return null;
    if (i.stamp_on_card === "sent") return { icon: CircleCheck, cls: "text-status-available", short: "الختم وصل", text: "الختم وصل لبطاقة الأختام" };
    if (i.stamp_on_card === "error") return { icon: CircleX, cls: "text-destructive", short: "الختم ما وصلش", text: "الختم ما وصلش لبطاقة الأختام" };
    return { icon: Clock, cls: "text-amber-600", short: "في الطريق", text: "الختم قاعد يوصل لبطاقته…" };
  }
  if (i.on_card === "sent")
    return { icon: CircleCheck, cls: "text-status-available", short: "على البطاقة", text: i.kind === "return" ? "تنقص من بطاقته" : "الشرية وصلت لبطاقته" };
  if (i.on_card === "skipped" || i.on_card === "error")
    return { icon: CircleX, cls: "text-destructive", short: "ما وصلتش", text: `ما وصلتش لبطاقته${i.on_card_reason ? `: ${SYNC_REASON_AR[i.on_card_reason] ?? i.on_card_reason}` : ""}` };
  return { icon: Clock, cls: "text-amber-600", short: "في الطريق", text: "قاعدة توصل لبطاقته…" };
}

// الزبون من الفاتورة نفسها، لين يوصل بحثه (ولا لو مش في القائمة).
const personOf = (i: Inv): Person => ({
  name: i.customer_name, phone9: i.phone9 ?? "", has_card: i.has_card, card_level: i.card_level, card_pct: i.pct_due,
  card_installed: i.card_installed, to_next: i.to_next, stamps_now: i.stamps_now, rewards_unused: i.rewards_unused,
  last_at: i.sold_at, last_branch: i.branch_name, tier_if_joined: i.tier_if_joined, pct_if_joined: i.pct_if_joined,
  has_stamp_card: i.has_stamp_card, stamp_installed: i.stamp_installed, purchases: null, visits: null,
});

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
  const [pickedBranch, setPickedBranch] = useState<string | null>(null);
  const branch = pickedBranch ?? branches?.find((b) => b.mine)?.code ?? (branches?.length === 1 ? branches[0].code : "all");
  const { data: invoices, isLoading } = useQuery({
    queryKey: ["loyalty-counter", branch],
    enabled: !!branches,
    queryFn: async () => {
      const { data, error } = await sb.rpc("loyalty_counter_invoices", { p_branch: branch === "all" ? null : branch, p_limit: 50 });
      if (error) throw error;
      return (data ?? []) as Inv[];
    },
    refetchInterval: 10_000,
  });

  const [q, setQ] = useState("");
  const [value, setValue] = useState("");
  const [pickedId, setPickedId] = useState<number | null>(null);
  const picked = invoices?.find((i) => i.invoice_id === pickedId) ?? null;
  const panelRef = useRef<HTMLDivElement>(null);
  const pick = (i: Inv) => {
    setPickedId(i.invoice_id);
    setQ(i.phone9 ? `0${i.phone9}` : "");
    setValue("");
    if (window.innerWidth < 1024) panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const reset = () => { setPickedId(null); setQ(""); setValue(""); };
  const branchName = branch !== "all" ? branches?.find((b) => b.code === branch)?.name : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold">لوحة الولاء{branchName ? ` · ${branchName}` : ""}</h2>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-status-available animate-pulse" /> مباشر: الفواتير والبطاقات تتحدّث وحدها
          </p>
        </div>
        {(branches?.length ?? 0) > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {[{ code: "all", name: "كل الفروع" }, ...(branches ?? [])].map((b) => (
              <button key={b.code} onClick={() => { setPickedBranch(b.code); setPickedId(null); }}
                className={`text-xs rounded-full border px-2.5 py-1 ${branch === b.code ? "bg-primary text-primary-foreground border-primary" : ""}`}>
                {b.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {branches && <MissingCustomerAlert branch={branch === "all" ? null : branch} />}
      <TodayStats invoices={invoices} />
      <RulesStrip s={s} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] items-start">
        <div ref={panelRef} className="space-y-3 scroll-mt-4">
          <Card className="p-3 space-y-2">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem]">
              <div className="space-y-1">
                <Label>الزبون</Label>
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input value={q} onChange={(e) => { setQ(e.target.value); setPickedId(null); }}
                    placeholder="رقم موبايله أو اسمه" className="pr-9 h-12 text-lg" autoFocus />
                </div>
              </div>
              <div className="space-y-1">
                <Label>قيمة الفاتورة (د.ل)</Label>
                <Input value={value} onChange={(e) => { setValue(e.target.value); setPickedId(null); }}
                  inputMode="decimal" dir="ltr" placeholder="0" className="h-12 text-lg" />
              </div>
            </div>
            {(q || value || picked) && (
              <button onClick={reset} className="text-xs text-muted-foreground flex items-center gap-1 hover:text-foreground">
                <X className="size-3" /> زبون جديد
              </button>
            )}
          </Card>
          <CustomerArea q={q} value={Number(normalizeDecimalInput(value)) || 0} picked={picked} s={s} onChoose={(p) => setQ(`0${p.phone9}`)} />
        </div>

        <LiveFeed invoices={invoices} loading={isLoading || !branches} noBranch={branches?.length === 0} allBranches={branch === "all"}
          pickedId={pickedId} onPick={pick} />
      </div>

      <HowItWorks s={s} />
    </div>
  );
}

function TodayStats({ invoices }: { invoices?: Inv[] }) {
  const t = useMemo(() => {
    const today = tripoliDate(new Date().toISOString());
    const sales = (invoices ?? []).filter((i) => !i.is_deleted && i.kind === "sale" && tripoliDate(i.sold_at) === today);
    return {
      all: sales.length,
      members: sales.filter((i) => i.has_card || i.has_stamp_card).length,
      missing: sales.filter((i) => advice(i).tone === "bad").length,
      noPhone: sales.filter((i) => !i.phone9).length,
    };
  }, [invoices]);
  const tiles: { n: number; label: string; tone?: Tone }[] = [
    { n: t.all, label: "فواتير اليوم" },
    { n: t.members, label: "لأعضاء الولاء" },
    { n: t.missing, label: "خصم ما تسجّلش", tone: t.missing ? "bad" : undefined },
    { n: t.noPhone, label: "بلا رقم زبون", tone: t.noPhone ? "warn" : undefined },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {tiles.map((x) => (
        <div key={x.label} className={`rounded-xl border p-3 text-center ${x.tone ? TONE[x.tone] : "bg-card"}`}>
          <p className="text-2xl font-black tabular-nums">{x.n}</p>
          <p className="text-xs opacity-80">{x.label}</p>
        </div>
      ))}
    </div>
  );
}

function RulesStrip({ s }: { s?: Settings }) {
  if (!s) return null;
  const { silver, gold } = levels(s);
  const rows: [Tier, number, number | null][] = [["bronze", s.bronze_discount, null], ["silver", s.silver_discount, silver], ["gold", s.gold_discount, gold]];
  return (
    <div className="flex flex-wrap gap-1.5 text-xs">
      {rows.map(([t, pct, at]) => (
        <span key={t} className={`rounded-full px-2.5 py-1 ${TIERS[t].badge}`}>
          {TIERS[t].label} <b>{pct}%</b>{at ? ` · من ${n0(at)} د.ل` : " · من أول شرية"}
        </span>
      ))}
      <span className="rounded-full px-2.5 py-1 bg-emerald-100 text-emerald-900 inline-flex items-center gap-1">
        <Gift className="size-3" /> 5 أختام = {n0(STAMP_REWARD.invoice)} + {STAMP_REWARD.perGram} على القرام
      </span>
    </div>
  );
}

function CustomerArea({ q, value, picked, s, onChoose }: {
  q: string; value: number; picked: Inv | null; s?: Settings; onChoose: (p: Person) => void;
}) {
  const [term, setTerm] = useState(q.trim());
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  // نفس قاعدة loyalty_lookup: الرقم يتحسب من غير 0 ولا 218 في أوله (4 أرقام على الأقل)، وغيره بحث بالاسم.
  // («0912» = 3 أرقام بس: لو بعتناها كانت تطلع «ما لقيناش الزبون» وهو موجود.)
  const phoneQuery = /^[\d\s+()-]+$/.test(term);
  const ready = phoneQuery ? term.replace(/\D/g, "").replace(/^(00218|218|0)/, "").length >= 4 : term.length >= 2;
  const { data, isFetching, isPlaceholderData } = useQuery({
    queryKey: ["loyalty-lookup", term],
    enabled: ready,
    queryFn: async () => {
      const { data, error } = await sb.rpc("loyalty_lookup", { p_q: term });
      if (error) throw error;
      return (data ?? []) as Person[];
    },
    // النتيجة القديمة تقعد لين توصل الجديدة، فالصفحة ما تقفزش وانت تكتب.
    placeholderData: (prev) => prev,
  });

  if (picked && !picked.phone9) return <Card className="p-4"><InvoiceVerdict i={picked} /></Card>;
  if (!picked && !ready) return <EmptyState />;
  const people = ready ? data ?? [] : [];
  const person = picked
    ? people.find((p) => p.phone9 === picked.phone9) ?? personOf(picked)
    : people.length === 1 ? people[0] : null;
  if (!person && isFetching && !data) return <div className="flex justify-center py-10"><Loader2 className="size-6 animate-spin text-primary" /></div>;
  // نتيجة البحث اللي قبل (لين توصل الجديدة) تبان باهتة: الموظف ما يقراش خصم زبون على زبون ثاني.
  const stale = !picked && (isPlaceholderData || term !== q.trim());
  return (
    <div className={`transition-opacity ${stale ? "opacity-40 pointer-events-none" : ""}`}>
      {person ? <CustomerDashboard p={person} value={value} inv={picked} s={s} />
        : !people.length ? <NotFound /> : <PickPerson people={people} onChoose={onChoose} />}
    </div>
  );
}

function NotFound() {
  return (
    <Card className="p-4 space-y-2 text-sm">
      <p className="font-bold">ما لقيناش الزبون.</p>
      <p className="text-muted-foreground">لو أول مرة يشري: خليه يركّب بطاقة الولاء من الـ QR ويسجّل برقم موبايله، واكتب نفس الرقم في فاتورة أمارسوفت.</p>
      <InstallQr />
    </Card>
  );
}

function PickPerson({ people, onChoose }: { people: Person[]; onChoose: (p: Person) => void }) {
  return (
    <Card className="divide-y">
      <p className="p-3 text-xs text-muted-foreground">لقينا {people.length} زبائن، اختار واحد:</p>
      {people.map((p) => (
        <button key={p.phone9} onClick={() => onChoose(p)} className="w-full text-right p-3 flex items-center gap-2 hover:bg-muted/40">
          <div className="flex-1 min-w-0">
            <p className="font-bold truncate">{p.name || "زبون"}</p>
            <p className="text-xs text-muted-foreground" dir="ltr" style={{ textAlign: "right" }}>0{p.phone9}</p>
          </div>
          {p.card_level && <LevelChip level={p.card_level} pct={p.card_pct} />}
          <BothChip loyalty={p.has_card} stamps={p.has_stamp_card} />
        </button>
      ))}
    </Card>
  );
}

function EmptyState() {
  return (
    <Card className="p-6 text-center space-y-3">
      <div className="size-14 mx-auto rounded-2xl bg-gold-gradient flex items-center justify-center shadow-gold">
        <UserRound className="size-7 text-primary-foreground" />
      </div>
      <p className="font-bold">اكتب رقم الزبون أو اسمه</p>
      <p className="text-sm text-muted-foreground">ولا اضغط على فاتورة من «فواتير الفرع الآن»، ويطلعلك مستواه وبطاقاته وقداش تخصمله.</p>
      <div className="flex justify-center"><InstallQr /></div>
    </Card>
  );
}

function CustomerDashboard({ p, value, inv, s }: { p: Person; value: number; inv: Inv | null; s?: Settings }) {
  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center gap-3">
        <div className="size-12 shrink-0 rounded-full bg-gold-gradient text-primary-foreground flex items-center justify-center text-xl font-black">
          {(p.name || "ز").trim().charAt(0)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-lg font-bold truncate">{p.name || "زبون"}</p>
          <p className="text-xs text-muted-foreground">
            <span dir="ltr">0{p.phone9}</span>
            {p.last_at ? ` · آخر شرية ${sinceText(daysSince(p.last_at))}${p.last_branch ? ` في ${p.last_branch}` : ""}` : " · ما شراش قبل برقمه"}
            {p.visits ? ` · ${visitsText(p.visits)}` : ""}
          </p>
        </div>
        <BothChip loyalty={p.has_card} stamps={p.has_stamp_card} />
      </div>

      <CustomerCards p={p} buying={!inv && value > 0} />

      {inv && <InvoiceVerdict i={inv} />}
      {!inv && p.has_card && <DiscountBox pct={Number(p.card_pct ?? 0)} value={value} />}
      {!p.has_card && <JoinBox p={p} />}
      {p.has_card && s && <LevelProgress p={p} s={s} adding={inv ? 0 : value} />}

      {!!p.rewards_unused && (
        <div className={`rounded-xl border p-3 flex gap-2 text-sm ${TONE.ok}`}>
          <Gift className="size-5 shrink-0" />
          <p>
            <b>عنده هدية الأختام{p.rewards_unused > 1 ? ` (${p.rewards_unused})` : ""}:</b> {rewardText()}، لو حب يستعملها في الشرية هذي.
            اخصمها في أمارسوفت وسجّل استعمالها في تطبيق الماسح.
          </p>
        </div>
      )}
      {(p.card_installed === false || p.stamp_installed === false) && (
        <p className="flex items-center gap-1.5 text-sm text-amber-700">
          <Smartphone className="size-4 shrink-0" /> بطاقة مسجّلة بس مش مركّبة في موبايله: خليه يفتح الرابط ويضيفها لـ Wallet.
        </p>
      )}
    </Card>
  );
}

// البطاقات اللي عند الزبون، زي ما يشوفها في موبايله. اللي عنده وحدة بس تبان وحدها.
function CustomerCards({ p, buying }: { p: Person; buying?: boolean }) {
  if (!p.has_card && !p.has_stamp_card) return null;
  const tier = tierOfLevel(p.card_level);
  const n = p.stamps_now ?? 0, left = Math.max(0, 5 - n);
  return (
    <div className={`grid gap-2 ${p.has_card && p.has_stamp_card ? "grid-cols-2" : "grid-cols-1"}`}>
      {p.has_card && (
        <div className={`rounded-xl p-3 bg-gradient-to-br shadow-sm space-y-0.5 ${tier ? TIERS[tier].card : "from-slate-500 to-slate-700 text-white"}`}>
          <p className="text-[11px] opacity-80">بطاقة الولاء</p>
          <p className="text-base font-bold">{p.card_level ?? "—"}</p>
          <p className="text-2xl font-black">خصم {p.card_pct ?? 0}%</p>
          <p className="text-[11px] opacity-90">
            {tier && NEXT[tier] && (p.to_next ?? 0) > 0 ? `باقي ${n0(p.to_next!)} د.ل ${NEXT[tier]}` : "في أعلى مستوى"}
          </p>
          {p.card_installed === false && <p className="text-[11px] font-bold">مش مركّبة في موبايله</p>}
        </div>
      )}
      {p.has_stamp_card && (
        <div className="rounded-xl p-3 bg-gradient-to-br from-emerald-800 via-emerald-600 to-teal-800 text-emerald-50 shadow-sm space-y-1">
          <p className="text-[11px] opacity-80">بطاقة الأختام</p>
          <span className="flex items-center gap-1" aria-label={`${n} من 5 أختام`}>
            {[0, 1, 2, 3, 4].map((k) => <span key={k} className={`size-3.5 rounded-full border border-white/70 ${k < n ? "bg-white" : ""}`} />)}
          </span>
          <p className="text-sm font-bold">{n}/5 · باقيله {left} للهدية</p>
          {buying && <p className="text-[11px]">{left <= 1 ? "الشرية هذي تكمّل الـ5، والهدية للشرية الجاية" : `الشرية هذي تخليه ${n + 1}/5`}</p>}
          {!!p.rewards_unused && (
            <p className="text-[11px] font-bold rounded bg-white/20 px-1.5 py-0.5 inline-flex items-center gap-1">
              <Gift className="size-3" /> عنده {p.rewards_unused === 1 ? "هدية" : `${p.rewards_unused} هدايا`}
            </p>
          )}
          {p.stamp_installed === false && <p className="text-[11px] font-bold">مش مركّبة في موبايله</p>}
        </div>
      )}
    </div>
  );
}

function DiscountBox({ pct, value }: { pct: number; value: number }) {
  const off = (value * pct) / 100;
  return (
    <div className={`rounded-xl border p-4 ${TONE.ok}`}>
      {value > 0 ? (
        <>
          <p className="text-sm">اكتب في خانة الخصم في أمارسوفت</p>
          <p className="text-4xl font-black tabular-nums">{n0(off)} <span className="text-lg">د.ل</span></p>
          <div className="grid grid-cols-3 gap-2 mt-3 text-center">
            {[["الفاتورة", n0(value)], ["الخصم", `${pct}%`], ["الصافي", n0(value - off)]].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-background/40 py-1.5">
                <p className="text-[11px] opacity-80">{k}</p>
                <p className="font-bold tabular-nums">{v}</p>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="text-3xl font-black">خصم {pct}% على الفاتورة</p>
          <p className="text-sm mt-1">اكتب قيمة الفاتورة فوق ويطلعلك الخصم بالضبط.</p>
        </>
      )}
    </div>
  );
}

function JoinBox({ p }: { p: Person }) {
  return (
    <div className={`rounded-xl border p-3 text-sm space-y-2 ${TONE.info}`}>
      <p className="font-bold">
        ما عندهش بطاقة ولاء، فما فيش خصم مستوى لين يركّبها.{p.has_stamp_card ? " بطاقة الأختام عنده وتنحسبله عادي." : ""}
      </p>
      <p>{joinText(p.tier_if_joined, p.pct_if_joined)}</p>
      <InstallQr />
    </div>
  );
}

// شريط المستوى: مجموع شرياته على البطاقة، وين الفضي والذهبي، وشن تزيده الشرية هذي.
function LevelProgress({ p, s, adding }: { p: Person; s: Settings; adding: number }) {
  const { silver, gold } = levels(s);
  const tier = tierOfLevel(p.card_level) ?? "bronze";
  const total = p.purchases ?? (tier === "bronze" ? silver - (p.to_next ?? silver) : tier === "silver" ? gold - (p.to_next ?? 0) : gold);
  const after = total + adding;
  const at = (x: number) => Math.min(100, Math.max(0, (x / gold) * 100));
  const next = tier === "bronze" ? { to: "للفضي", at: silver } : tier === "silver" ? { to: "للذهبي", at: gold } : null;
  const up = after >= gold ? { label: TIERS.gold.label, pct: s.gold_discount } : after >= silver ? { label: TIERS.silver.label, pct: s.silver_discount } : null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-bold flex items-center gap-1.5"><TrendingUp className="size-4 text-primary" /> مستواه</span>
        <span className="text-xs text-muted-foreground">مجموع شرياته {n0(total)} د.ل</span>
      </div>
      <div className="relative h-3 rounded-full bg-muted overflow-hidden">
        {adding > 0 && <div className="absolute inset-y-0 right-0 bg-primary/35" style={{ width: `${at(after)}%` }} />}
        <div className="absolute inset-y-0 right-0 bg-primary" style={{ width: `${at(total)}%` }} />
        <div className="absolute inset-y-0 w-0.5 bg-background" style={{ right: `${at(silver)}%` }} />
      </div>
      <div className="relative h-4 text-[10px] text-muted-foreground">
        <span className="absolute right-0">برونزي</span>
        <span className="absolute" style={{ right: `${at(silver)}%`, transform: "translateX(50%)" }}>فضي {n0(silver)}</span>
        <span className="absolute left-0">ذهبي {n0(gold)}</span>
      </div>
      <p className="text-xs">
        {!next ? "في أعلى مستوى: ذهبي."
          : adding > 0 && after >= next.at && up
            ? <span className="font-bold text-status-available inline-flex items-center gap-1"><Sparkles className="size-3.5" /> الشرية هذي تطلّعه {up.label}: خصم {up.pct}% من الشرية الجاية.</span>
            : `باقيله ${n0(next.at - after)} د.ل ${next.to}${adding > 0 ? " بعد الشرية هذي" : ""}.`}
      </p>
    </div>
  );
}

function InvoiceVerdict({ i }: { i: Inv }) {
  const a = advice(i);
  const st = cardState(i);
  return (
    <div className="rounded-xl border p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <Receipt className="size-4 text-primary shrink-0" />
        <span className="truncate">فاتورة {i.branch_name} #{i.invoice_no} · {when(i.sold_at)}{!i.phone9 && i.customer_name ? ` · ${i.customer_name}` : ""}</span>
        <span className="mr-auto font-bold tabular-nums whitespace-nowrap">{i.kind === "return" ? "مرتجع " : ""}{n0(Math.abs(Number(i.net_ld)))} د.ل</span>
      </div>
      {a.tone !== "info" && (
        <div className={`rounded-lg border p-3 ${TONE[a.tone]}`}>
          <p className="text-lg font-black">{a.title}</p>
          {a.text && <p className="text-sm mt-0.5">{a.text}</p>}
        </div>
      )}
      {st && <p className={`flex items-center gap-1.5 text-sm ${st.cls}`}><st.icon className="size-4" />{st.text}</p>}
    </div>
  );
}

// كل فاتورة باسم فرعها ورقمها، باش لو فيها مشكلة (بلا رقم زبون، خصم ما تسجّلش…) يبان وين صارت.
function LiveFeed({ invoices, loading, noBranch, allBranches, pickedId, onPick }: {
  invoices?: Inv[]; loading: boolean; noBranch: boolean; allBranches: boolean; pickedId: number | null; onPick: (i: Inv) => void;
}) {
  return (
    <Card className="overflow-hidden lg:sticky lg:top-4">
      <div className="px-3 py-2.5 border-b flex items-center gap-2">
        <span className="size-2 rounded-full bg-status-available animate-pulse" />
        <p className="font-bold text-sm flex-1">{allBranches ? "فواتير كل الفروع الآن" : "فواتير الفرع الآن"}</p>
        <span className="text-[11px] text-muted-foreground">آخر 3 أيام</span>
      </div>
      {loading ? <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-primary" /></div>
        : noBranch ? <p className="p-6 text-center text-sm text-muted-foreground">حسابك مش مربوط بفرع. كلّم المدير العام.</p>
        : !invoices?.length ? <p className="p-6 text-center text-sm text-muted-foreground">ما فيش فواتير في آخر 3 أيام.</p>
        : (
          <div className="divide-y lg:max-h-[75vh] lg:overflow-y-auto">
            {invoices.map((i, k) => {
              const a = advice(i);
              const st = cardState(i);
              return (
                <button key={i.invoice_id} onClick={() => onPick(i)}
                  className={`w-full text-right p-3 space-y-1 hover:bg-muted/40 transition-colors ${pickedId === i.invoice_id ? "bg-primary/10" : ""} ${i.is_deleted ? "opacity-60" : ""}`}>
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-bold truncate flex-1">{i.customer_name || "زبون"}</p>
                    {k === 0 && <span className="text-[10px] rounded bg-primary text-primary-foreground px-1.5 py-0.5">آخر فاتورة</span>}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    <span className="font-semibold text-foreground">{i.branch_name}</span> #{i.invoice_no} · {when(i.sold_at)}
                    {" · "}{i.kind === "return" ? "مرتجع " : ""}{n0(Math.abs(Number(i.net_ld)))} د.ل
                  </p>
                  <div className="flex flex-wrap items-center gap-1">
                    <span className={`text-[11px] rounded-full px-2 py-0.5 ${CHIP[a.tone]}`}>{a.short}</span>
                    {i.card_level && <LevelChip level={i.card_level} />}
                    {i.stamps_now != null && <span className="text-[11px] rounded-full px-2 py-0.5 bg-emerald-100 text-emerald-900">{i.stamps_now}/5</span>}
                    {st && <span className={`text-[11px] inline-flex items-center gap-0.5 ${st.cls}`}><st.icon className="size-3" />{st.short}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
    </Card>
  );
}

function LevelChip({ level, pct }: { level: string; pct?: number | null }) {
  const t = tierOfLevel(level);
  return (
    <span className={`text-[11px] rounded-full px-2 py-0.5 whitespace-nowrap ${t ? TIERS[t].badge : "bg-muted"}`}>
      {level}{pct != null ? ` ${pct}%` : ""}
    </span>
  );
}

function BothChip({ loyalty, stamps }: { loyalty: boolean; stamps: boolean }) {
  if (!loyalty && !stamps) return null;
  return (
    <span className="text-xs rounded-full bg-primary/10 text-primary px-2 py-0.5 whitespace-nowrap">
      {loyalty && stamps ? "عنده البطاقتين" : loyalty ? "بطاقة ولاء" : "بطاقة أختام"}
    </span>
  );
}

// الـ QR في خانة «بطاقة جديدة» بس: هناك فيه الفرع، والزبون يختار أي بطاقة من الثلاثة.
function InstallQr({ label = "زبون جديد؟ خانة «بطاقة جديدة»" }: { label?: string }) {
  const [, setParams] = useSearchParams();
  return (
    <Button size="sm" variant="outline" onClick={() => setParams({ tab: "newcard" }, { replace: true })}>
      <QrCode className="size-4 ml-1" /> {label}
    </Button>
  );
}

function HowItWorks({ s }: { s?: Settings }) {
  const lv = s ? levels(s) : null;
  return (
    <details className="rounded-xl border p-3 text-sm">
      <summary className="font-bold cursor-pointer flex items-center gap-1.5"><Info className="size-4 text-primary" /> كيف يشتغل الولاء</summary>
      <ul className="mt-2 space-y-1.5 list-disc pr-5">
        <li>الزبون يمسح الـ QR، يضيف البطاقة لموبايله، ويسجّل برقم موبايله.</li>
        <li><b>اكتب رقم موبايل الزبون في كل فاتورة أمارسوفت.</b> من غيره الشرية ما تنحسبلهش.</li>
        <li>
          الخصم حسب مستواه على الفاتورة كاملة: برونزي {s?.bronze_discount ?? "…"}%،
          فضي {s?.silver_discount ?? "…"}% (من {lv ? n0(lv.silver) : "…"} د.ل)، ذهبي {s?.gold_discount ?? "…"}% (من {lv ? n0(lv.gold) : "…"} د.ل).
        </li>
        <li><b>الخصم ما يتخصمش وحده:</b> لا MSTRMND ولا أمارسوفت يخصموه. انت تحطه بيدك في خانة الخصم في أمارسوفت.</li>
        <li>قيمة الفاتورة تتزاد على بطاقته وحدها في ثواني، ومستواه يطلع وحده. وختم على كل فاتورة (ختم واحد في اليوم).</li>
        <li>5 أختام = هدية: خصم {n0(STAMP_REWARD.invoice)} على الفاتورة + {STAMP_REWARD.perGram} على كل قرام. على الشراء، مش كاش.</li>
        <li>ما تكتبش مبالغ في تطبيق الماسح لبطاقة الولاء، وإلا الشرية تنحسب مرتين.</li>
      </ul>
    </details>
  );
}
