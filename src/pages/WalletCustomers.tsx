// «بطاقات الزبائن»: كل زبون عنده بطاقة في MSTRMND (الـ Wallet) وبطاقاته — الولاء، الأختام، الهدايا —
// وشن بعتله الربط من فواتير أمارسوفت. البيانات نسخة يحدّثها mstrmnd-link كل نص ساعة، فالصفحة ما تكلّمش MSTRMND.
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CreditCard, Loader2, Search, AlertTriangle, ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { sb } from "@/lib/amarsoft";

const LOYALTY = 908119, STAMPS = 908120, GIFT = 908118;

type WCard = {
  template_id: number; card_id: number; status: string | null; expires: number | null; level: string | null;
  discount_pct: number | null; to_next: number | null; visits: number; stamps_total: number; stamps_now: number | null;
  rewards_unused: number; rewards_received: number; balance: number | null; last_money_at: number | null;
};
type WCustomer = { id: string; full_name: string | null; phone9: string | null; created_at: string | null; cards: WCard[]; synced_at: string };
type Status = { mode: string; live_start_at: string | null; last_run_at: string | null; last_result: Record<string, unknown> | null; mirror_at: string | null; auth_error: string | null };
type SyncRow = {
  invoice_id: number; template_id: number; action: string; amount_ld: number; status: string; reason: string | null;
  mstrmnd_customer_id: string | null; updated_at: string;
  amarsoft_invoices: { branch_code: string; invoice_no: string; sold_at: string; details: { customer?: string } | null } | null;
};

const STATUS_AR: Record<string, string> = { installed: "مركّبة", not_installed: "مش مركّبة", deleted: "ممسوحة" };
const MODE_AR: Record<string, string> = { live: "حقيقي", dry: "تجربة", off: "واقف" };
const SYNC_AR: Record<string, string> = {
  sent: "تبعتت", reversed: "تنقصت (حذف)", error: "خطأ", skipped: "تخطّاها", would_send: "تجربة", would_reverse: "تجربة حذف",
};
const REASON_AR: Record<string, string> = {
  no_mstrmnd_customer: "الزبون مش في MSTRMND", no_loyalty_card: "ما عندهش بطاقة ولاء", no_stamp_card: "ما عندهش بطاقة أختام",
  zero_amount: "مبلغ صفر", return_no_stamp: "مرتجع (ما ينقصش ختم)",
};

const ld = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n).toLocaleString("en-US")} د.ل`);
const day = (v: string | number | null | undefined) => {
  if (v == null) return "—";
  const d = typeof v === "number" ? new Date(v * 1000) : new Date(v);
  return d.toLocaleDateString("en-GB", { timeZone: "Africa/Tripoli" });
};
const time = (v: string | null) => (v ? new Date(v).toLocaleString("en-GB", { timeZone: "Africa/Tripoli", dateStyle: "short", timeStyle: "short" }) : "—");

export default function WalletCustomers() {
  const [tab, setTab] = useState<"customers" | "activity">("customers");
  const { data: status } = useQuery({
    queryKey: ["mstrmnd-status"],
    queryFn: async () => {
      const { data, error } = await sb.rpc("mstrmnd_link_status");
      if (error) throw error;
      return (data?.[0] ?? null) as Status | null;
    },
  });

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <h1 className="text-xl font-bold flex items-center gap-2"><CreditCard className="size-5 text-primary" /> بطاقات الزبائن</h1>
      <LinkStatus s={status ?? null} />
      <div className="grid grid-cols-2 gap-1.5">
        <Button size="lg" variant={tab === "customers" ? "default" : "outline"} onClick={() => setTab("customers")} className="text-base">الزبائن</Button>
        <Button size="lg" variant={tab === "activity" ? "default" : "outline"} onClick={() => setTab("activity")} className="text-base">نشاط الربط</Button>
      </div>
      {tab === "customers" ? <Customers /> : <Activity />}
    </div>
  );
}

function LinkStatus({ s }: { s: Status | null }) {
  if (!s) return null;
  const stale = s.last_run_at && Date.now() - new Date(s.last_run_at).getTime() > 30 * 60_000;
  return (
    <Card className="p-3 text-sm space-y-1">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span>الربط: <b>{MODE_AR[s.mode] ?? s.mode}</b></span>
        <span>آخر تشغيل: {time(s.last_run_at)}</span>
        <span>آخر تحديث للزبائن: {time(s.mirror_at)}</span>
      </div>
      {(s.auth_error || stale) && (
        <p className="flex items-center gap-1.5 text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          {s.auth_error
            ? "الربط ما قدرش يدخل لـ MSTRMND. ادخل من جديد وحط رمز جديد في السر MSTRMND_REFRESH_TOKEN."
            : "الربط ما اشتغلش من أكثر من نص ساعة."}
        </p>
      )}
    </Card>
  );
}

function Customers() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["mstrmnd-customers"],
    queryFn: async () => {
      const { data, error } = await sb.from("mstrmnd_customers").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as WCustomer[];
    },
  });

  const stats = useMemo(() => {
    const all = data ?? [];
    const by = (t: number) => all.map((c) => c.cards.find((k) => k.template_id === t)).filter(Boolean) as WCard[];
    const loyal = by(LOYALTY), stamps = by(STAMPS);
    const levels: Record<string, number> = {};
    loyal.forEach((k) => { const l = (k.level ?? "—").trim(); levels[l] = (levels[l] ?? 0) + 1; });
    return {
      members: all.length, installed: all.filter((c) => c.cards.some((k) => k.status === "installed")).length,
      levels, stampCards: stamps.length, rewardsUnused: stamps.reduce((s, k) => s + (k.rewards_unused || 0), 0),
    };
  }, [data]);

  const list = useMemo(() => {
    const term = q.trim(); const d = term.replace(/\D/g, "");
    return (data ?? []).filter((c) => !term || (c.full_name ?? "").includes(term) || (d.length >= 3 && (c.phone9 ?? "").includes(d)));
  }, [data, q]);

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-primary" /></div>;
  if (!data?.length) return <Card className="p-8 text-center text-muted-foreground">ما فيش بيانات لين توا. تجي بعد ما الربط ينسخ زبائن MSTRMND أول مرة.</Card>;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Tile n={stats.members} label="زبون في MSTRMND" />
        <Tile n={stats.installed} label="بطاقة مركّبة" />
        <Tile n={stats.stampCards} label="بطاقة أختام" />
        <Tile n={stats.rewardsUnused} label="مكافأة أختام ما استعملتش" warn={stats.rewardsUnused > 20} />
      </div>
      <p className="text-xs text-muted-foreground">
        مستويات الولاء: {Object.entries(stats.levels).map(([l, n]) => `${l} ${n}`).join(" · ") || "—"}
      </p>
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالاسم أو الهاتف" className="pr-9" />
      </div>
      {list.map((c) => {
        const loyal = c.cards.find((k) => k.template_id === LOYALTY);
        const stamps = c.cards.find((k) => k.template_id === STAMPS);
        const gift = c.cards.find((k) => k.template_id === GIFT);
        return (
          <Card key={c.id} className="p-3 space-y-2">
            <button className="w-full text-right flex items-center gap-2" onClick={() => setOpen(open === c.id ? null : c.id)}>
              <div className="flex-1 min-w-0">
                <p className="font-bold truncate">{c.full_name || "بلا اسم"}</p>
                <p className="text-xs text-muted-foreground" dir="ltr">{c.phone9 ? `0${c.phone9}` : ""}</p>
              </div>
              {loyal && <span className="text-xs rounded-full bg-amber-100 text-amber-900 px-2 py-0.5">{(loyal.level ?? "").trim()} {loyal.discount_pct ?? 0}%</span>}
              {stamps && <span className="text-xs rounded-full bg-emerald-100 text-emerald-900 px-2 py-0.5">{stamps.stamps_now ?? 0}/5{stamps.rewards_unused ? ` · ${stamps.rewards_unused} مكافأة` : ""}</span>}
              <ChevronDown className={`size-4 transition ${open === c.id ? "rotate-180" : ""}`} />
            </button>
            {open === c.id && (
              <div className="space-y-2 text-sm">
                {loyal && (
                  <Detail title="بطاقة الولاء" status={loyal.status} rows={[
                    ["المستوى", `${(loyal.level ?? "—").trim()} — خصم ${loyal.discount_pct ?? 0}%`],
                    ["باقي للمستوى الجاي", ld(loyal.to_next)], ["الزيارات", String(loyal.visits)],
                    ["آخر شرية", day(loyal.last_money_at)], ["تنتهي", day(loyal.expires)],
                  ]} />
                )}
                {stamps && (
                  <Detail title="بطاقة الأختام" status={stamps.status} rows={[
                    ["الأختام توا", `${stamps.stamps_now ?? 0} من 5`], ["مكافآت ما استعملهاش", String(stamps.rewards_unused)],
                    ["مكافآت استعملها", String(stamps.rewards_received)], ["كل الأختام", String(stamps.stamps_total)],
                  ]} warn={stamps.stamps_total > 100 ? "عدد الأختام غير طبيعي — غالباً الموظف كتب المبلغ في خانة الأختام." : undefined} />
                )}
                {gift && <Detail title="بطاقة الهدايا" status={gift.status} rows={[["الرصيد", ld(gift.balance)]]} />}
                <CustomerActivity id={c.id} />
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function Tile({ n, label, warn }: { n: number; label: string; warn?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 text-center ${warn ? "border-destructive" : ""}`}>
      <p className="text-2xl font-black tabular-nums">{n.toLocaleString("en-US")}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function Detail({ title, status, rows, warn }: { title: string; status: string | null; rows: [string, string][]; warn?: string }) {
  return (
    <div className="rounded-lg bg-muted/40 p-2.5">
      <div className="flex items-center justify-between mb-1">
        <p className="font-bold">{title}</p>
        <span className="text-xs text-muted-foreground">{STATUS_AR[status ?? ""] ?? status}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        {rows.map(([k, v]) => (<Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd>{v}</dd></Fragment>))}
      </dl>
      {warn && <p className="text-xs text-destructive mt-1">{warn}</p>}
    </div>
  );
}

const SYNC_SELECT = "invoice_id, template_id, action, amount_ld, status, reason, mstrmnd_customer_id, updated_at, amarsoft_invoices(branch_code, invoice_no, sold_at, details)";

function CustomerActivity({ id }: { id: string }) {
  const { data } = useQuery({
    queryKey: ["mstrmnd-sync-customer", id],
    queryFn: async () => {
      const { data, error } = await sb.from("mstrmnd_sync").select(SYNC_SELECT).eq("mode", "live").eq("mstrmnd_customer_id", id)
        .order("updated_at", { ascending: false }).limit(20);
      if (error) throw error;
      return (data ?? []) as SyncRow[];
    },
  });
  if (!data?.length) return <p className="text-xs text-muted-foreground">الربط ما بعتش لهذا الزبون حتى فاتورة لين توا.</p>;
  return <SyncList rows={data} />;
}

function Activity() {
  const { data, isLoading } = useQuery({
    queryKey: ["mstrmnd-sync-live"],
    queryFn: async () => {
      const { data, error } = await sb.from("mstrmnd_sync").select(SYNC_SELECT).eq("mode", "live")
        .order("updated_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []) as SyncRow[];
    },
  });
  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-primary" /></div>;
  if (!data?.length) return <Card className="p-8 text-center text-muted-foreground">ما فيش فواتير جديدة فيها رقم زبون من وقت ما اشتغل الربط.</Card>;
  return <Card className="p-3"><SyncList rows={data} showCustomer /></Card>;
}

function SyncList({ rows, showCustomer }: { rows: SyncRow[]; showCustomer?: boolean }) {
  return (
    <div className="divide-y text-sm">
      {rows.map((r) => {
        const inv = r.amarsoft_invoices;
        const what = r.template_id === STAMPS ? "ختم" : `${r.action === "subtract" ? "−" : "+"}${ld(r.amount_ld)}`;
        return (
          <div key={`${r.invoice_id}-${r.template_id}`} className="py-1.5 flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <p className="truncate">
                {r.template_id === STAMPS ? "أختام" : "ولاء"} · فاتورة {inv?.branch_code}-{inv?.invoice_no}
                {showCustomer && inv?.details?.customer ? ` · ${inv.details.customer}` : ""}
              </p>
              <p className="text-xs text-muted-foreground">{time(inv?.sold_at ?? r.updated_at)}{r.reason ? ` · ${REASON_AR[r.reason] ?? r.reason}` : ""}</p>
            </div>
            <span className="tabular-nums">{what}</span>
            <span className={`text-xs rounded-full px-2 py-0.5 ${r.status === "sent" ? "bg-emerald-100 text-emerald-900" : r.status === "error" ? "bg-red-100 text-red-900" : "bg-muted"}`}>
              {SYNC_AR[r.status] ?? r.status}
            </span>
          </div>
        );
      })}
    </div>
  );
}
