// الملخّص اليومي — «أمارسوفت والولاء»: كل شي صار في يوم في الفروع، من فواتير أمارسوفت ومن بطاقات MSTRMND.
//   فوق: مبيعات اليوم، وتنبيهات بكل حاجة تحتاج تصرّف (فرع ما باعش، فاتورة انحذفت، خصم ولاء ما تسجّلش…).
//   تحت: كل فرع، الولاء (من دخل، من ركّب البطاقة، من طلع مستوى)، الفواتير اللي انحذفت ولا تعدّلت، وكل فاتورة.
// اليوم ولا أمس ولا أي تاريخ؛ اليوم يتحدّث كل دقيقة. كل الأرقام من daily_amarsoft في قاعدة البيانات.
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, Award, CircleCheck, Clock, Gift, Loader2, Pencil, Receipt, RefreshCw, Smartphone, Store, Trash2,
  TrendingUp, UserPlus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { periodDays, sb, tripoliToday } from "@/lib/amarsoft";
import { SYNC_REASON_AR } from "@/lib/loyalty";

type Branch = {
  code: string; name: string; sales: number; returns: number; deleted: number; net_ld: number; grams: number;
  with_phone: number; members: number; stamp_members: number; first_at: string | null; last_at: string | null;
  edited: number; deleted_today: number; pay: Record<string, number>; salesmen: { name: string; n: number; ld: number }[];
};
type Inv = {
  id: number; code: string; no: string; kind: "sale" | "return"; at: string; deleted: boolean; sman: string | null;
  customer: string | null; has_phone: boolean; internal: boolean; net_ld: number; grams: number; pcs: number; pay: string | null;
  member: boolean; stamp_card: boolean; level: string | null; stamps_now: number | null; pct: number | null; given: number;
  due: number | null; on_card: string | null; on_card_reason: string | null; stamp: string | null; stamp_reason: string | null;
};
type Ev = {
  code: string; no: string; inv_date: string; status: "D" | "E"; at: string; by: string | null; customer: string | null;
  net_ld: number | null; old_ld: number | null; new_ld: number | null; change: string | null;
};
type Joined = { name: string; branch: string | null; loyalty: boolean; stamps: boolean; installed: boolean; at: string };
type CardEv = { op: string; name: string | null; at: string; card: "loyalty" | "stamps" | "other"; level: string | null };
type Day = {
  day: string; branches: Branch[]; invoices: Inv[]; events: Ev[]; joined: Joined[]; card_events: CardEv[];
  sync: { amarsoft_at: string | null; link_at: string | null; cards_at: string | null; link_error: string | null };
};
type Tone = "ok" | "bad" | "warn" | "info" | "muted";

const n0 = (n: number | null | undefined) => Math.round(Number(n ?? 0)).toLocaleString("en-US");
const g2 = (n: number) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
const clock = (iso: string) => new Date(iso).toLocaleTimeString("ar-LY", { timeZone: "Africa/Tripoli", hour: "numeric", minute: "2-digit" });
const invs = (n: number) => (n === 1 ? "فاتورة وحدة" : n === 2 ? "فاتورتين" : n >= 3 && n <= 10 ? `${n} فواتير` : `${n} فاتورة`);
const people = (n: number) => (n === 2 ? "زبونين" : n >= 3 && n <= 10 ? `${n} زبائن` : `${n} زبون`);
const minsAgo = (iso: string | null) => (iso ? Math.round((Date.now() - new Date(iso).getTime()) / 60_000) : null);
const PAY: Record<string, string> = { CASH: "كاش", BANK: "مصرف" };
const payText = (pay: Record<string, number>) =>
  Object.entries(pay).filter(([, v]) => Math.round(v) !== 0).map(([k, v]) => `${PAY[k] ?? k} ${n0(v)}`).join(" · ");
const CHIP: Record<Tone, string> = {
  ok: "bg-emerald-100 text-emerald-900", bad: "bg-red-100 text-red-900", warn: "bg-amber-100 text-amber-900",
  info: "bg-sky-100 text-sky-900", muted: "bg-muted text-muted-foreground",
};
const CARD_EV: Record<string, { icon: LucideIcon; text: (e: CardEv) => string; tone: Tone }> = {
  "Card installed": { icon: Smartphone, tone: "ok", text: (e) => `ركّب ${e.card === "stamps" ? "بطاقة الأختام" : "بطاقة الولاء"} في موبايله` },
  "Card deleted from device": { icon: Trash2, tone: "bad", text: (e) => `شال ${e.card === "stamps" ? "بطاقة الأختام" : "بطاقة الولاء"} من موبايله` },
  "New level reached": { icon: Award, tone: "ok", text: (e) => `طلع مستوى${e.level ? `: ${e.level}` : ""}` },
  "Rewards earned": { icon: Gift, tone: "info", text: () => "كمّل 5 أختام وعنده هدية" },
  "Rewards redeemed": { icon: Gift, tone: "ok", text: () => "خدا هدية الأختام" },
};

// الخصم على فاتورة عضو: تسجّل في أمارسوفت ولا لا (نفس حساب «لوحة الولاء»).
function discount(i: Inv): [Tone, string] | null {
  if (i.kind !== "sale" || i.deleted || !i.member || i.pct == null) return null;
  if (Number(i.pct) === 0) return ["muted", "البطاقة طلعت بعد الفاتورة"];
  const due = Number(i.due ?? 0), given = Number(i.given);
  if (given >= due * 0.9) return ["ok", `الخصم مسجّل ${n0(given)}`];
  if (given > 0) return ["bad", `خصم ناقص ${n0(due - given)}`];
  return ["bad", `ما تسجّلش خصم ${i.pct}% = ${n0(due)}`];
}

// الفاتورة وصلت لبطاقة الولاء والأختام ولا لا. اللي ما عندهش بطاقة مش غلطة: فرصة يدخل.
function onCard(i: Inv, today: boolean): [Tone, string][] {
  if (i.internal) return [];
  if (!i.has_phone) return i.kind !== "sale" || i.deleted ? [] : i.customer ? [["warn", "بلا رقم زبون"]] : [["bad", "بلا اسم ولا رقم"]];
  const out: [Tone, string][] = [];
  if (i.member) {
    if (i.on_card === "sent") out.push(["ok", "وصلت لبطاقة الولاء"]);
    else if (i.on_card === "reversed") out.push(["muted", "تنقصت من البطاقة"]);
    else if (i.on_card === "skipped" || i.on_card === "error")
      out.push(["bad", `ما وصلتش للبطاقة${i.on_card_reason ? `: ${SYNC_REASON_AR[i.on_card_reason] ?? i.on_card_reason}` : ""}`]);
    else if (!i.deleted) out.push(today ? ["warn", "في الطريق للبطاقة"] : ["bad", "ما تبعتتش للبطاقة"]);
  } else if (i.kind === "sale" && !i.deleted) {
    out.push(["info", i.stamp_card ? "بطاقة أختام بس" : "ما عندهش بطاقة — يقدر يدخل"]);
  }
  if (i.stamp_card && i.kind === "sale") {
    if (i.stamp === "sent") out.push(["ok", `ختم ✓${i.stamps_now != null ? ` (${i.stamps_now}/5)` : ""}`]);
    else if (i.stamp === "reversed") out.push(["muted", "الختم تنقص"]);
    else if (i.stamp === "error") out.push(["bad", "الختم ما وصلش"]);
    else if (i.stamp === "skipped" && i.stamp_reason !== "no_mstrmnd_customer")
      out.push(["muted", `بلا ختم: ${SYNC_REASON_AR[i.stamp_reason ?? ""] ?? i.stamp_reason ?? ""}`]);
  }
  return out;
}

const isMember = (i: Inv) => i.member || i.stamp_card;

function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${CHIP[tone]}`}>{children}</span>;
}

export default function AmarsoftDay() {
  const today = tripoliToday();
  const yesterday = periodDays("yesterday").from;
  const [day, setDay] = useState(today);
  const isToday = day === today;

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["daily-amarsoft", day],
    queryFn: async () => {
      const { data, error } = await sb.rpc("daily_amarsoft", { p_day: day });
      if (error) throw error;
      return data as Day;
    },
    refetchInterval: isToday ? 60_000 : false,
    placeholderData: (prev) => prev,
  });

  const names = useMemo(() => new Map((data?.branches ?? []).map((b) => [b.code, b.name])), [data]);
  const t = useMemo(() => {
    const bs = data?.branches ?? [], inv = (data?.invoices ?? []).filter((i) => i.kind === "sale" && !i.deleted);
    const pay: Record<string, number> = {};
    bs.forEach((b) => Object.entries(b.pay).forEach(([k, v]) => { pay[k] = (pay[k] ?? 0) + Number(v); }));
    const missing = inv.filter((i) => discount(i)?.[0] === "bad");
    return {
      net: bs.reduce((s, b) => s + Number(b.net_ld), 0), sales: inv.length, grams: bs.reduce((s, b) => s + Number(b.grams), 0),
      returns: bs.reduce((s, b) => s + b.returns, 0), pay,
      idle: bs.filter((b) => !b.sales), noPhone: inv.filter((i) => !i.has_phone && !i.internal).length,
      noName: inv.filter((i) => !i.has_phone && !i.internal && !i.customer).length,
      // مين نسى الرقم: لكل بائع قداش فاتورة بلا رقم.
      noPhoneBy: Object.entries(inv.filter((i) => !i.has_phone && !i.internal)
        .reduce<Record<string, number>>((m, i) => ({ ...m, [i.sman ?? "بلا بائع"]: (m[i.sman ?? "بلا بائع"] ?? 0) + 1 }), {}))
        .sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join("، "),
      canJoin: inv.filter((i) => i.has_phone && !i.internal && !isMember(i)).length,
      members: inv.filter(isMember).length,
      byBranch: inv.reduce<Record<string, number>>((m, i) => (isMember(i) ? { ...m, [i.code]: (m[i.code] ?? 0) + 1 } : m), {}),
      missing, missingLd: missing.reduce((s, i) => s + Number(i.due ?? 0) - Number(i.given), 0),
      notOnCard: (data?.invoices ?? []).filter((i) => onCard(i, isToday).some(([tone]) => tone === "bad")),
    };
  }, [data, isToday]);

  const label = isToday ? "اليوم" : day === yesterday ? "أمس"
    : new Intl.DateTimeFormat("ar-u-nu-latn", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
  const amarsoftLag = minsAgo(data?.sync.amarsoft_at ?? null);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold text-lg flex items-center gap-2">
          <Store className="size-5 text-primary" /> أمارسوفت والولاء
          {isFetching && !isLoading && <RefreshCw className="size-3.5 animate-spin text-muted-foreground" />}
        </h2>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant={isToday ? "default" : "outline"} onClick={() => setDay(today)}>اليوم</Button>
          <Button size="sm" variant={day === yesterday ? "default" : "outline"} onClick={() => setDay(yesterday)}>أمس</Button>
          <Input type="date" value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)}
            className="h-9 w-[9.5rem]" aria-label="اختار يوم" />
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
      ) : error || !data ? (
        <Card className="p-4 text-sm text-destructive">ما قدرناش نجيبو ملخّص أمارسوفت: {(error as Error)?.message ?? "—"}</Card>
      ) : (
        <>
          <p className={`text-xs ${amarsoftLag != null && amarsoftLag > 20 ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
            {amarsoftLag != null && amarsoftLag > 20 && <AlertTriangle className="inline size-3.5 me-1" />}
            آخر مزامنة مع أمارسوفت: {data.sync.amarsoft_at ? clock(data.sync.amarsoft_at) : "—"}
            {amarsoftLag != null && amarsoftLag > 20 ? ` (واقفة من ${n0(amarsoftLag)} دقيقة، الأرقام ممكن ناقصة)` : ""}
            {" · "}آخر ربط مع بطاقات MSTRMND: {data.sync.link_at ? clock(data.sync.link_at) : "—"}
            {data.sync.link_error && <span className="text-destructive font-semibold"> · الربط فيه مشكلة: {data.sync.link_error}</span>}
          </p>

          <Card className="p-5 bg-gold-gradient text-primary-foreground shadow-gold">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm opacity-90 flex items-center gap-1.5"><TrendingUp className="size-4" /> مبيعات {label} (أمارسوفت)</p>
                <p className="text-3xl font-extrabold mt-1">{n0(t.net)} د.ل</p>
                <p className="text-xs opacity-90 mt-1">{payText(t.pay) || "—"}</p>
              </div>
              <div className="text-left space-y-0.5">
                <p className="text-2xl font-bold">{t.sales}</p>
                <p className="text-xs opacity-90">فاتورة · {g2(t.grams)} جم{t.returns ? ` · ${t.returns} مرتجع` : ""}</p>
              </div>
            </div>
          </Card>

          <Alerts t={t} events={data.events} isToday={isToday} />

          <div className="grid sm:grid-cols-2 gap-2.5">
            {data.branches.map((b) => <BranchCard key={b.code} b={b} members={t.byBranch[b.code] ?? 0} isToday={isToday} />)}
          </div>

          <LoyaltyDay data={data} names={names} members={t.members} canJoin={t.canJoin} />

          {data.events.length > 0 && <Changes events={data.events} names={names} day={day} />}

          <Invoices invoices={data.invoices} names={names} isToday={isToday} />
        </>
      )}
    </section>
  );
}

type Totals = {
  idle: Branch[]; noPhone: number; noName: number; noPhoneBy: string; canJoin: number; missing: Inv[]; missingLd: number;
  notOnCard: Inv[]; sales: number;
};

function Alerts({ t, events, isToday }: { t: Totals; events: Ev[]; isToday: boolean }) {
  const deleted = events.filter((e) => e.status === "D").length, edited = events.filter((e) => e.status === "E").length;
  const items: [Tone, string][] = [];
  if (t.idle.length) items.push([isToday ? "muted" : "warn", `${isToday ? "ما باعوش لين توا" : "ما باعوش"}: ${t.idle.map((b) => b.name).join("، ")}`]);
  if (deleted) items.push(["bad", `${invs(deleted)} انحذفت من أمارسوفت`]);
  if (edited) items.push(["warn", `${invs(edited)} تعدّلت بعد ما تسجّلت`]);
  if (t.missing.length) items.push(["bad", `${invs(t.missing.length)} لأعضاء الولاء بلا الخصم اللي يستاهلوه (${n0(t.missingLd)} د.ل)`]);
  if (t.notOnCard.length) items.push(["bad", `${invs(t.notOnCard.length)} ما وصلتش لبطاقة الزبون`]);
  if (t.noPhone) items.push([t.noName ? "bad" : "warn", `${t.noPhone} من ${t.sales} ${t.sales >= 3 && t.sales <= 10 ? "فواتير" : "فاتورة"} بلا رقم زبون`
    + `${t.noName ? `، ${t.noName} منهم بلا اسم حتى` : ""} (${t.noPhoneBy})`]);
  if (t.canJoin) items.push(["info", t.canJoin === 1 ? "زبون واحد عنده رقم وما عندهش بطاقة ولاء: فرصة يدخل"
    : `${people(t.canJoin)} عندهم أرقام وما عندهمش بطاقة ولاء: فرصة يدخلو`]);
  if (!items.length) return null;
  return (
    <Card className="p-3 space-y-1.5">
      {items.map(([tone, text]) => (
        <p key={text} className="text-sm flex items-start gap-2">
          {tone === "bad" || tone === "warn"
            ? <AlertTriangle className={`size-4 shrink-0 mt-0.5 ${tone === "bad" ? "text-destructive" : "text-amber-600"}`} />
            : <CircleCheck className="size-4 shrink-0 mt-0.5 text-muted-foreground" />}
          {text}
        </p>
      ))}
    </Card>
  );
}

function BranchCard({ b, members, isToday }: { b: Branch; members: number; isToday: boolean }) {
  if (!b.sales && !b.returns && !b.deleted && !b.edited && !b.deleted_today) {
    return (
      <Card className="p-3 flex items-center justify-between text-sm text-muted-foreground">
        <span className="font-semibold">{b.name}</span>
        <span>{isToday ? "ما فيش فواتير لين توا" : "ما باعش"}</span>
      </Card>
    );
  }
  return (
    <Card className="p-3 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold">{b.name}</span>
        <span className="font-bold tabular-nums">{n0(b.net_ld)} د.ل</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {b.sales ? `${invs(b.sales)} · ${g2(b.grams)} جم` : isToday ? "ما فيش فواتير لين توا" : "ما باعش"}{b.returns ? ` · ${b.returns} مرتجع` : ""}
        {b.first_at && b.last_at ? ` · ${b.first_at === b.last_at ? clock(b.first_at) : `من ${clock(b.first_at)} لـ ${clock(b.last_at)}`}` : ""}
      </p>
      {payText(b.pay) && <p className="text-xs text-muted-foreground">{payText(b.pay)}</p>}
      {b.salesmen.length > 0 && (
        <p className="text-xs">{b.salesmen.map((s) => `${s.name} ${s.n === 1 ? "فاتورة" : invs(s.n)} (${n0(s.ld)})`).join(" · ")}</p>
      )}
      <div className="flex flex-wrap gap-1">
        {b.sales > 0 && <Chip tone={b.with_phone === b.sales ? "ok" : "warn"}>{b.with_phone}/{b.sales} برقم زبون</Chip>}
        {members > 0 && <Chip tone="info">{members} لأعضاء الولاء</Chip>}
        {b.deleted_today > 0 && <Chip tone="bad">{b.deleted_today} انحذفت</Chip>}
        {b.edited > 0 && <Chip tone="warn">{b.edited} تعدّلت</Chip>}
      </div>
    </Card>
  );
}

function LoyaltyDay({ data, names, members, canJoin }: { data: Day; names: Map<string, string>; members: number; canJoin: number }) {
  const { joined, card_events: evs } = data;
  // اللي دخل اليوم وركّب في نفس اليوم يكفيه سطر «دخل»؛ «ركّب» تبان للي دخل قبل.
  const fresh = new Set(joined.filter((j) => j.installed).map((j) => j.name));
  const shown = evs.filter((e) => !(e.op === "Card installed" && e.name && fresh.has(e.name)));
  return (
    <Card className="p-4 space-y-3">
      <h3 className="font-bold flex items-center gap-2"><Award className="size-4 text-primary" /> الولاء</h3>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat value={joined.length} label="دخلو للولاء" />
        <Stat value={members} label="فاتورة لأعضاء" />
        <Stat value={canJoin} label="كان ممكن يدخلو" />
      </div>
      {joined.length > 0 && (
        <div className="space-y-1">
          {joined.map((j) => (
            <p key={j.name + j.at} className="text-sm flex flex-wrap items-center gap-1.5">
              <UserPlus className="size-4 text-emerald-600" />
              <span className="font-semibold">{j.name}</span>
              <span className="text-xs text-muted-foreground">
                {clock(j.at)}{j.branch ? ` · ${names.get(j.branch) ?? j.branch}` : ""}
              </span>
              {j.loyalty && <Chip tone="info">بطاقة ولاء</Chip>}
              {j.stamps && <Chip tone="info">بطاقة أختام</Chip>}
              <Chip tone={j.installed ? "ok" : "warn"}>{j.installed ? "مركّبة في موبايله" : "مش مركّبة"}</Chip>
            </p>
          ))}
        </div>
      )}
      {shown.length > 0 && (
        <div className="space-y-1">
          {shown.map((e, k) => {
            const m = CARD_EV[e.op];
            if (!m) return null;
            return (
              <p key={k} className="text-sm flex flex-wrap items-center gap-1.5">
                <m.icon className={`size-4 ${m.tone === "bad" ? "text-destructive" : "text-primary"}`} />
                <span className="font-semibold">{e.name ?? "زبون"}</span>
                <span>{m.text(e)}</span>
                <span className="text-xs text-muted-foreground">{clock(e.at)}</span>
              </p>
            );
          })}
        </div>
      )}
      {!joined.length && !shown.length && <p className="text-sm text-muted-foreground">ما دخلش حد جديد، وما تبدّلتش بطاقة.</p>}
    </Card>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-lg bg-muted/50 p-2">
      <p className="text-xl font-bold leading-none">{value}</p>
      <p className="text-[11px] text-muted-foreground mt-1">{label}</p>
    </div>
  );
}

function Changes({ events, names, day }: { events: Ev[]; names: Map<string, string>; day: string }) {
  return (
    <Card className="p-4 space-y-2">
      <h3 className="font-bold flex items-center gap-2"><Pencil className="size-4 text-primary" /> فواتير انحذفت ولا تعدّلت</h3>
      {events.map((e) => (
        <div key={`${e.code}-${e.no}-${e.inv_date}-${e.status}`}className="text-sm flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-border pt-2 first:border-0 first:pt-0">
          {e.status === "D" ? <Trash2 className="size-4 text-destructive" /> : <Pencil className="size-4 text-amber-600" />}
          <span className="font-semibold">{e.status === "D" ? "انحذفت" : "تعدّلت"}</span>
          <span>{names.get(e.code) ?? e.code} · فاتورة {e.no}{e.inv_date !== day ? ` (تاريخها ${e.inv_date})` : ""}</span>
          {e.customer && <span>· {e.customer}</span>}
          {e.status === "E" && e.change === "amount" && e.old_ld != null && e.new_ld != null
            ? <span className="font-semibold">· {n0(e.old_ld)} ← {n0(e.new_ld)} د.ل</span>
            : (e.net_ld ?? e.old_ld) != null && <span className="font-semibold">· {n0(e.net_ld ?? e.old_ld)} د.ل</span>}
          {e.status === "E" && e.change === "items" && <span className="text-xs text-muted-foreground">(تبدّلت القطع)</span>}
          <span className="text-xs text-muted-foreground">· {clock(e.at)}{e.by ? ` من حساب ${e.by}` : ""}</span>
        </div>
      ))}
    </Card>
  );
}

function Invoices({ invoices, names, isToday }: { invoices: Inv[]; names: Map<string, string>; isToday: boolean }) {
  return (
    <Card className="p-4">
      <h3 className="font-bold mb-2 flex items-center gap-2"><Receipt className="size-4 text-primary" /> كل الفواتير ({invoices.length})</h3>
      {!invoices.length ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          <Clock className="inline size-4 me-1" />{isToday ? "ما فيش فواتير لين توا" : "ما فيش فواتير في اليوم هذا"}
        </p>
      ) : (
        <div className="divide-y divide-border">
          {invoices.map((i) => {
            const d = discount(i);
            return (
              <div key={i.id} className={`py-2 space-y-1 ${i.deleted ? "opacity-60" : ""}`}>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="text-muted-foreground">{clock(i.at)} · {names.get(i.code) ?? i.code} #{i.no} · </span>
                    <span className="font-semibold">{i.customer ?? "بلا اسم"}</span>
                  </span>
                  <span className={`font-bold tabular-nums shrink-0 ${i.deleted ? "line-through" : ""}`}>{n0(i.net_ld)} د.ل</span>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-[11px] text-muted-foreground me-1">
                    {i.sman ?? "بلا بائع"} · {g2(i.grams)} جم{i.pcs > 1 ? ` · ${i.pcs} قطع` : ""}{i.pay ? ` · ${i.pay.split("+").map((p) => PAY[p] ?? p).join("+")}` : ""}
                  </span>
                  {i.kind === "return" && <Chip tone="warn">مرتجع</Chip>}
                  {i.deleted && <Chip tone="bad">انحذفت</Chip>}
                  {i.internal && <Chip tone="muted">داخلي</Chip>}
                  {i.member && <Chip tone="info">{i.level ?? "عضو"}</Chip>}
                  {onCard(i, isToday).map(([tone, text]) => <Chip key={text} tone={tone}>{text}</Chip>)}
                  {d && <Chip tone={d[0]}>{d[1]}</Chip>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
