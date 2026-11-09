// «خصم الزبون»: الموظف يكتب رقم الزبون أو اسمه وقت الفاتورة، يطلعله مستواه ونسبة الخصم (نفس بطاقة MSTRMND)،
// ويكتب قيمة الفاتورة يطلعله قداش يخصم بالضبط ويحطه في أمارسوفت. أمارسوفت ما فيهوش خصم على الزبون، فالخصم يدوي.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sb } from "@/lib/amarsoft";
import { normalizeDecimalInput } from "@/lib/constants";
import { TIERS, Tier } from "@/lib/loyalty";

type Member = { customer_id: string; full_name: string; phone: string | null; points: number; tier: Tier; last_at: string | null };
type Settings = { bronze_discount: number; silver_discount: number; gold_discount: number };

const digits = (s: string) => s.replace(/\D/g, "");

// خانة «خصم الزبون» داخل صفحة الولاء (كل الموظفين يشوفوها).
export default function LoyaltyCheck() {
  const [q, setQ] = useState("");
  const [making, setMaking] = useState("");
  const { data: members, isLoading } = useQuery({
    queryKey: ["loyalty-members"],
    queryFn: async () => {
      const { data, error } = await sb.rpc("loyalty_members");
      if (error) throw error;
      return (data ?? []) as Member[];
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

  const matches = useMemo(() => {
    const term = q.trim();
    const d = digits(term);
    if (d.length < 4 && term.length < 3) return [];
    return (members ?? []).filter((m) => d.length >= 4
      ? digits(m.phone ?? "").slice(-9).includes(d.slice(-9))
      : m.full_name.includes(term)).slice(0, 5);
  }, [members, q]);

  const pct = (t: Tier) => !s ? 0 : Number(t === "gold" ? s.gold_discount : t === "silver" ? s.silver_discount : s.bronze_discount);
  const mk = Number(normalizeDecimalInput(making)) || 0;

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="رقم الزبون أو اسمه" className="pr-9 h-12 text-lg" autoFocus />
      </div>
      <div className="space-y-1">
        <Label>قيمة الفاتورة (د.ل) — اختياري</Label>
        <Input value={making} onChange={(e) => setMaking(e.target.value)} inputMode="decimal" dir="ltr" placeholder="0" />
      </div>

      {isLoading ? <div className="flex justify-center py-8"><Loader2 className="size-6 animate-spin text-primary" /></div>
        : q.trim() && !matches.length ? (
          <Card className="p-6 text-center text-muted-foreground">
            ما لقيناش الزبون. لو أول مرة يشري، سجّله في «العملاء» برقمه، ومن الفاتورة الجاية تبدا تنحسبله النقاط.
          </Card>
        ) : matches.map((m) => {
          const p = pct(m.tier);
          return (
            <Card key={m.customer_id} className="p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="font-bold text-lg truncate">{m.full_name}</p>
                <span className={`text-sm px-2.5 py-0.5 rounded-full ${TIERS[m.tier].badge}`}>{TIERS[m.tier].label}</span>
              </div>
              <p className="text-3xl font-black text-primary">خصم {p}% على الفاتورة</p>
              {mk > 0 && <p className="text-lg">يخصم <b className="tabular-nums">{(mk * p / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}</b> د.ل من {mk.toLocaleString("en-US")}</p>}
              <p className="text-xs text-muted-foreground" dir="rtl">{m.points.toLocaleString("en-US")} نقطة{m.phone ? ` · ${m.phone}` : ""}</p>
            </Card>
          );
        })}
    </div>
  );
}
