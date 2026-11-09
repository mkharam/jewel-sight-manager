// صفحة الولاء: كل حاجة تخص الولاء في مكان واحد، وكل واحد يشوف الخانات اللي تخص دوره:
//   خصم الزبون (الكل) · الأعضاء والقواعد (المشرفين فما فوق؛ القواعد يعدّلها المدير العام بس)
//   · بطاقات Wallet والفروع وفواتير الولاء (شن وصل للبطاقة والخصم) مع MSTRMND (المدير العام). النقاط تنحسب من فواتير أمارسوفت المربوطة بالزبون.
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, Copy, Loader2, MessageCircle, Search, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { sb, formatLD } from "@/lib/amarsoft";
import { TIERS, Tier, cardUrl, waPhone } from "@/lib/loyalty";
import LoyaltyCheck from "@/pages/LoyaltyCheck";
import { WalletCards } from "@/pages/WalletCustomers";
import LoyaltyBranches from "@/components/loyalty/LoyaltyBranches";
import LoyaltyInvoices from "@/components/loyalty/LoyaltyInvoices";
import LoyaltyOutreach from "@/components/loyalty/LoyaltyOutreach";

const TABS = [
  { key: "discount", label: "خصم الزبون", who: "all" },
  { key: "members", label: "الأعضاء", who: "managers" },
  { key: "wallet", label: "بطاقات Wallet", who: "admin" },
  { key: "outreach", label: "التواصل", who: "admin" },
  { key: "branches", label: "الفروع", who: "admin" },
  { key: "activity", label: "الفواتير", who: "admin" },
  { key: "rules", label: "القواعد", who: "managers" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

type Member = {
  customer_id: string; full_name: string; phone: string | null; loyalty_code: string;
  spend_dirhams: number; invoices: number; last_at: string | null; points: number; tier: Tier;
};
type Settings = {
  program_name: string; ld_per_point: number; window_months: number; silver_points: number; gold_points: number;
  bronze_discount: number; silver_discount: number; gold_discount: number;
};

export default function Loyalty() {
  const { roles } = useAuth();
  const isAdmin = roles.includes("admin");
  const isManager = isAdmin || roles.includes("manager") || roles.includes("supervisor");
  const tabs = TABS.filter((t) => t.who === "all" || (t.who === "managers" && isManager) || (t.who === "admin" && isAdmin));
  // الخانة في الرابط (?tab=wallet) باش الروابط القديمة (/discount و /wallet-customers) تفتح على خانتها.
  const [params, setParams] = useSearchParams();
  const asked = params.get("tab") as TabKey | null;
  const tab: TabKey = tabs.some((t) => t.key === asked) ? asked! : tabs[0].key;
  const setTab = (k: TabKey) => setParams({ tab: k }, { replace: true });

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <h1 className="text-xl font-bold flex items-center gap-2"><Award className="size-5 text-primary" /> الولاء</h1>
      {tabs.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {tabs.map((t) => (
            <Button key={t.key} variant={tab === t.key ? "default" : "outline"} onClick={() => setTab(t.key)} className="flex-1 min-w-[6.5rem]">
              {t.label}
            </Button>
          ))}
        </div>
      )}
      {tab === "discount" && <LoyaltyCheck />}
      {tab === "members" && <Members />}
      {tab === "wallet" && <WalletCards />}
      {tab === "outreach" && <LoyaltyOutreach />}
      {tab === "branches" && <LoyaltyBranches />}
      {tab === "activity" && <LoyaltyInvoices />}
      {tab === "rules" && <Rules canEdit={isAdmin} />}
    </div>
  );
}

function Members() {
  const [q, setQ] = useState("");
  const [tier, setTier] = useState<Tier | "all">("all");
  const { data, isLoading } = useQuery({
    queryKey: ["loyalty-members"],
    queryFn: async () => {
      const { data, error } = await sb.rpc("loyalty_members");
      if (error) throw error;
      return (data ?? []) as Member[];
    },
  });
  const counts = useMemo(() => {
    const c: Record<Tier, number> = { bronze: 0, silver: 0, gold: 0 };
    (data ?? []).forEach((m) => { c[m.tier]++; });
    return c;
  }, [data]);
  const list = useMemo(() => {
    const term = q.trim();
    return (data ?? []).filter((m) => (tier === "all" || m.tier === tier)
      && (!term || m.full_name.includes(term) || (m.phone ?? "").includes(term))).slice(0, 200);
  }, [data, q, tier]);

  const copy = async (m: Member) => {
    try { await navigator.clipboard.writeText(cardUrl(m.loyalty_code)); toast.success("تم نسخ رابط البطاقة"); }
    catch { toast.error("ما قدرتش ننسخ الرابط"); }
  };
  const whatsapp = (m: Member) => {
    const ph = waPhone(m.phone);
    if (!ph) return toast.error("الزبون ما عندهش رقم صالح");
    const text = `مرحبا ${m.full_name}، هذي بطاقة الولاء متاعك في مخرّم للذهب: مستواك ${TIERS[m.tier].label} وعندك ${m.points} نقطة.\n${cardUrl(m.loyalty_code)}`;
    window.open(`https://wa.me/${ph}?text=${encodeURIComponent(text)}`, "_blank");
  };

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {(["gold", "silver", "bronze"] as Tier[]).map((t) => (
          <button key={t} onClick={() => setTier(tier === t ? "all" : t)}
            className={`rounded-xl p-3 text-center border transition ${tier === t ? "ring-2 ring-primary" : ""}`}>
            <p className="text-2xl font-black tabular-nums">{counts[t]}</p>
            <p className="text-sm text-muted-foreground">{TIERS[t].label}</p>
          </button>
        ))}
      </div>
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالاسم أو الهاتف" className="pr-9" />
      </div>
      {!list.length ? <Card className="p-8 text-center text-muted-foreground">ما فيش زبون مطابق</Card> : list.map((m) => (
        <Card key={m.customer_id} className="p-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-bold truncate">{m.full_name}</p>
              <span className={`text-xs px-2 py-0.5 rounded-full ${TIERS[m.tier].badge}`}>{TIERS[m.tier].label}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {m.points.toLocaleString("en-US")} نقطة · {formatLD(m.spend_dirhams)} · {m.invoices} فاتورة
            </p>
          </div>
          <Button size="icon" variant="ghost" onClick={() => whatsapp(m)} aria-label="إرسال البطاقة على واتساب"><MessageCircle className="size-4" /></Button>
          <Button size="icon" variant="ghost" onClick={() => copy(m)} aria-label="نسخ رابط البطاقة"><Copy className="size-4" /></Button>
          <Button size="icon" variant="ghost" asChild aria-label="فتح البطاقة">
            <a href={cardUrl(m.loyalty_code)} target="_blank" rel="noreferrer"><ExternalLink className="size-4" /></a>
          </Button>
        </Card>
      ))}
    </div>
  );
}

const FIELDS: { key: keyof Settings; label: string; hint?: string }[] = [
  { key: "program_name", label: "اسم البطاقة" },
  { key: "ld_per_point", label: "كل كم دينار = نقطة" },
  { key: "window_months", label: "النقاط من آخر كم شهر", hint: "المشتريات الأقدم ما تنحسبش، باش المستوى يعكس الزبون توا" },
  { key: "silver_points", label: "نقاط المستوى الفضي" },
  { key: "gold_points", label: "نقاط المستوى الذهبي" },
  { key: "bronze_discount", label: "خصم البرونزي على الفاتورة %" },
  { key: "silver_discount", label: "خصم الفضي على الفاتورة %" },
  { key: "gold_discount", label: "خصم الذهبي على الفاتورة %" },
];

function Rules({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["loyalty-settings"],
    queryFn: async () => {
      const { data, error } = await sb.from("loyalty_settings").select("*").eq("id", 1).single();
      if (error) throw error;
      return data as Settings;
    },
  });
  const [form, setForm] = useState<Settings | null>(null);
  useEffect(() => { if (data) setForm(data); }, [data]);
  const [saving, setSaving] = useState(false);
  if (!form) return <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-primary" /></div>;

  const save = async () => {
    setSaving(true);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    FIELDS.forEach(({ key }) => { patch[key] = key === "program_name" ? String(form[key]).trim() : Number(form[key]); });
    const { error } = await sb.from("loyalty_settings").update(patch).eq("id", 1);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("تم حفظ القواعد");
    qc.invalidateQueries({ queryKey: ["loyalty-settings"] });
    qc.invalidateQueries({ queryKey: ["loyalty-members"] });
  };

  return (
    <Card className="p-4 space-y-3">
      <p className="text-sm text-muted-foreground">
        الزبون ياخذ نقطة على كل {form.ld_per_point} دينار يشريها في آخر {form.window_months} شهر.
        يولّي فضي من {form.silver_points} نقطة، وذهبي من {form.gold_points}. نفس مستويات بطاقة MSTRMND، فلو بدّلتها هنا بدّلها غادي زادة.
        الخصم على الفاتورة كاملة، ويطبّقه الموظف في أمارسوفت.
      </p>
      {FIELDS.map(({ key, label, hint }) => (
        <div key={key} className="space-y-1">
          <Label>{label}</Label>
          <Input value={String(form[key] ?? "")} disabled={!canEdit} inputMode={key === "program_name" ? "text" : "decimal"}
            onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
      ))}
      {canEdit && <Button onClick={save} disabled={saving} className="w-full bg-gold-gradient text-primary-foreground">حفظ</Button>}
    </Card>
  );
}
