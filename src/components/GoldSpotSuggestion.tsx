// اقتراح سعر الجرام من سعر الذهب العالمي — للمالك يراجعه ويضغط «استعمل»؛ لا يُطبَّق شيء
// تلقائياً. الحساب: دولار/أونصة ÷ 31.1035 × نقاء العيار × سعر الدولار بالدينار × (1 + الهامش).
// سعر الدولار يدخله المالك لأن سعر سوقكم لا يأتيه أي مصدر عالمي.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSpotSettings } from "@/hooks/useAppSettings";
import { KARAT_OPTIONS, formatCurrency, normalizeDecimalInput } from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Globe, RefreshCw } from "lucide-react";
import { toast } from "sonner";

const GRAMS_PER_OZ = 31.1035;
const PURITY: Record<string, number> = { "18K": 18 / 24, "21K": 21 / 24 };
const ROUND_TO = 5; // تقريب لأقرب 5 دنانير — أسعار الجرام لا تُعلَن بكسور

export default function GoldSpotSuggestion({ onUse }: { onUse: (karat: string, price: number) => void }) {
  const { roles } = useAuth();
  const isAdmin = roles.includes("admin");
  const { rate, marginPercent, save } = useSpotSettings();
  const [rateInput, setRateInput] = useState("");
  const [marginInput, setMarginInput] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRateInput(rate == null ? "" : String(rate));
    setMarginInput(String(marginPercent));
  }, [rate, marginPercent]);

  const { data: spot, isFetching, isError, refetch } = useQuery({
    queryKey: ["gold-spot"],
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("gold-spot");
      if (error) throw error;
      return data as { usd_per_oz: number; updated_at: string | null };
    },
  });

  const saveSettings = async () => {
    const r = rateInput.trim() === "" ? null : Number(rateInput);
    const m = marginInput.trim() === "" ? 0 : Number(marginInput);
    if (r != null && (isNaN(r) || r <= 0)) return toast.error("سعر الدولار غير صحيح");
    if (isNaN(m) || m < -50 || m > 100) return toast.error("الهامش غير صحيح");
    setSaving(true);
    try { await save(r, m); toast.success("تم حفظ الإعدادات"); }
    catch (e: any) { toast.error(e.message ?? "تعذّر الحفظ"); }
    setSaving(false);
  };

  const suggestion = (karat: string): number | null => {
    if (!spot || rate == null) return null;
    const perGramUsd = (spot.usd_per_oz / GRAMS_PER_OZ) * (PURITY[karat] ?? 0);
    const lyd = perGramUsd * rate * (1 + marginPercent / 100);
    return Math.round(lyd / ROUND_TO) * ROUND_TO;
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Globe className="size-4 text-primary" /> اقتراح من السوق العالمي
          <Button type="button" size="sm" variant="ghost" className="mr-auto h-7" onClick={() => refetch()} disabled={isFetching} aria-label="تحديث">
            <RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isError ? (
          <p className="text-sm text-destructive">تعذّر جلب السعر العالمي الآن — أدخل السعر يدوياً.</p>
        ) : !spot ? (
          <p className="text-sm text-muted-foreground">جارٍ الجلب…</p>
        ) : (
          <p className="text-sm">
            الذهب العالمي: <span className="font-bold" dir="ltr">${spot.usd_per_oz.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span> / أونصة
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">سعر الدولار بالدينار (سوقكم)</Label>
            <Input dir="ltr" inputMode="decimal" disabled={!isAdmin} value={rateInput} onChange={(e) => setRateInput(normalizeDecimalInput(e.target.value))} />
          </div>
          <div>
            <Label className="text-xs">هامش الربح %</Label>
            <Input dir="ltr" inputMode="decimal" disabled={!isAdmin} value={marginInput} onChange={(e) => setMarginInput(normalizeDecimalInput(e.target.value))} />
          </div>
        </div>
        {isAdmin && <Button size="sm" variant="secondary" className="w-full" disabled={saving} onClick={saveSettings}>حفظ سعر الدولار والهامش</Button>}

        {rate == null ? (
          <p className="text-xs text-muted-foreground">{isAdmin ? "أدخل سعر الدولار بالدينار ليظهر الاقتراح." : "لم يحدّد المدير العام سعر الدولار بعد."}</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {KARAT_OPTIONS.map((k) => {
              const s = suggestion(k);
              return (
                <div key={k} className="rounded-lg bg-muted/40 p-2 text-center">
                  <p className="text-xs text-muted-foreground">{k}</p>
                  <p className="text-lg font-extrabold">{s != null ? formatCurrency(s) : "—"}</p>
                  <Button size="sm" variant="outline" className="mt-1 w-full" disabled={s == null} onClick={() => s != null && onUse(k, s)}>
                    استعمل
                  </Button>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          اقتراح فقط: «استعمل» يملأ خانة السعر أدناه ولا يحفظ شيئاً. راجع الرقم ثم اضغط «حفظ سعر اليوم».
        </p>
      </CardContent>
    </Card>
  );
}
