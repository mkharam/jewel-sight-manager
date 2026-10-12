// اقتراح سعر الجرام من سعر الذهب العالمي الحيّ — للمالك يراجعه ويضغط «استعمل»؛ لا يُطبَّق
// شيء تلقائياً. الحساب: دولار/أونصة ÷ 31.1035 × نقاء العيار × سعر الدولار بالدينار × (1 + الهامش).
//
// سعر الدولار له وضعان لأن السعر الرسمي (يُجلب حيّاً) أقل بكثير من سعر السوق الذي يُسعَّر به
// الذهب عندكم، ولا يوجد مصدر مجاني موثوق لسعر السوق:
//  - «الرسمي + علاوة السوق»: السعر يتبع الرسمي الحيّ، والمالك يضبط العلاوة مرة (زرّ المعايرة
//    يحسبها من آخر سعر جرام محفوظ) فلا يكتب سعر الدولار كل يوم.
//  - «يدوي»: يكتب المالك سعر السوق بنفسه.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useGoldPrices } from "@/hooks/useGoldPrices";
import { useSpotSettings, type SpotRateMode } from "@/hooks/useAppSettings";
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
const CALIBRATION_KARAT = "18K"; // أكثر بضاعتكم، فسعره أوثق مرجع

interface Spot {
  usd_per_oz: number;
  updated_at: string | null;
  usd_lyd_official: number | null;
  official_updated_at: string | null;
}

export default function GoldSpotSuggestion({ onUse }: { onUse: (karat: string, price: number) => void }) {
  const { roles } = useAuth();
  const isAdmin = roles.includes("admin");
  const settings = useSpotSettings();
  const { data: saved } = useGoldPrices();
  const [rateInput, setRateInput] = useState("");
  const [marginInput, setMarginInput] = useState("");
  const [premiumInput, setPremiumInput] = useState("");
  const [modeInput, setModeInput] = useState<SpotRateMode>("manual");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRateInput(settings.rate == null ? "" : String(settings.rate));
    setMarginInput(String(settings.marginPercent));
    setPremiumInput(String(settings.premiumPercent));
    setModeInput(settings.mode);
  }, [settings.rate, settings.marginPercent, settings.premiumPercent, settings.mode]);

  const { data: spot, isFetching, isError, refetch } = useQuery({
    queryKey: ["gold-spot"],
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("gold-spot");
      if (error) throw error;
      return data as Spot;
    },
  });

  const official = spot?.usd_lyd_official ?? null;
  const num = (v: string, fallback: number | null = null) => (v.trim() === "" ? fallback : Number(v));
  const margin = num(marginInput, 0) ?? 0;
  const premium = num(premiumInput, 0) ?? 0;
  const manualRate = num(rateInput);

  // السعر المستعمل فعلاً في الاقتراح (من الحقول الحالية لا المحفوظة، فيتحدّث الاقتراح وأنت تكتب).
  const effectiveRate: number | null =
    modeInput === "official" ? (official != null && !isNaN(premium) ? official * (1 + premium / 100) : null)
    : manualRate != null && !isNaN(manualRate) && manualRate > 0 ? manualRate : null;

  const perGramUsd = (karat: string) => (spot ? (spot.usd_per_oz / GRAMS_PER_OZ) * (PURITY[karat] ?? 0) : null);

  const suggestion = (karat: string): number | null => {
    const g = perGramUsd(karat);
    if (g == null || effectiveRate == null || isNaN(margin)) return null;
    return Math.round((g * effectiveRate * (1 + margin / 100)) / ROUND_TO) * ROUND_TO;
  };

  // المعايرة: أي سعر دولار يعطي آخر سعر جرام 18K محفوظاً عندكم مع الهامش الحالي؟
  const calibrate = () => {
    const savedPrice = saved?.get(CALIBRATION_KARAT)?.price_per_gram;
    const g = perGramUsd(CALIBRATION_KARAT);
    if (!savedPrice || g == null) return toast.error("لا سعر محفوظ لـ18K أو تعذّر جلب السعر العالمي");
    const impliedRate = savedPrice / (g * (1 + margin / 100));
    if (modeInput === "official") {
      if (official == null) return toast.error("السعر الرسمي غير متاح الآن");
      setPremiumInput(((impliedRate / official - 1) * 100).toFixed(1));
    } else {
      setRateInput(impliedRate.toFixed(2));
    }
    toast.success("عُيِّر من آخر سعر 18K محفوظ — راجع ثم احفظ");
  };

  const saveSettings = async () => {
    if (isNaN(margin) || margin < -50 || margin > 100) return toast.error("الهامش غير صحيح");
    if (modeInput === "manual" && manualRate != null && (isNaN(manualRate) || manualRate <= 0)) return toast.error("سعر الدولار غير صحيح");
    if (isNaN(premium) || premium < -50 || premium > 1000) return toast.error("العلاوة غير صحيحة");
    setSaving(true);
    try {
      await settings.save({ rate: manualRate, marginPercent: margin, mode: modeInput, premiumPercent: premium });
      toast.success("تم حفظ الإعدادات");
    } catch (e: any) {
      toast.error(e.message ?? "تعذّر الحفظ");
    }
    setSaving(false);
  };

  const officialUnavailable = spot != null && official == null;

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
          <p className="text-sm text-destructive">تعذّر جلب الأسعار العالمية الآن — أدخل السعر يدوياً.</p>
        ) : !spot ? (
          <p className="text-sm text-muted-foreground">جارٍ الجلب…</p>
        ) : (
          <div className="text-sm space-y-0.5">
            <p>الذهب العالمي: <span className="font-bold" dir="ltr">${spot.usd_per_oz.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span> / أونصة</p>
            <p>
              الدولار الرسمي: {official != null ? <span className="font-bold" dir="ltr">{official.toFixed(3)} د.ل</span> : <span className="text-muted-foreground">غير متاح الآن</span>}
              {effectiveRate != null && official != null && (
                <span className="text-xs text-muted-foreground"> · سعر سوقكم المستعمل {effectiveRate.toFixed(2)} ({((effectiveRate / official - 1) * 100).toFixed(0)}% فوق الرسمي)</span>
              )}
            </p>
          </div>
        )}

        <div>
          <Label className="text-xs">مصدر سعر الدولار</Label>
          <div className="flex gap-2 mt-1">
            <Button type="button" size="sm" disabled={!isAdmin} variant={modeInput === "official" ? "default" : "secondary"} onClick={() => setModeInput("official")}>
              الرسمي الحيّ + علاوة السوق
            </Button>
            <Button type="button" size="sm" disabled={!isAdmin} variant={modeInput === "manual" ? "default" : "secondary"} onClick={() => setModeInput("manual")}>
              يدوي
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {modeInput === "official" ? (
            <div>
              <Label className="text-xs">علاوة السوق فوق الرسمي %</Label>
              <Input dir="ltr" inputMode="decimal" disabled={!isAdmin} value={premiumInput} onChange={(e) => setPremiumInput(normalizeDecimalInput(e.target.value))} />
            </div>
          ) : (
            <div>
              <Label className="text-xs">سعر الدولار بالدينار (سوقكم)</Label>
              <Input dir="ltr" inputMode="decimal" disabled={!isAdmin} value={rateInput} onChange={(e) => setRateInput(normalizeDecimalInput(e.target.value))} />
            </div>
          )}
          <div>
            <Label className="text-xs">هامش الربح %</Label>
            <Input dir="ltr" inputMode="decimal" disabled={!isAdmin} value={marginInput} onChange={(e) => setMarginInput(normalizeDecimalInput(e.target.value))} />
          </div>
        </div>

        {officialUnavailable && modeInput === "official" && (
          <p className="text-xs text-destructive">السعر الرسمي غير متاح الآن — بدّل إلى «يدوي» أو حاول لاحقاً.</p>
        )}

        {isAdmin && (
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" className="flex-1" onClick={calibrate}>
              عايِر من آخر سعر {CALIBRATION_KARAT} محفوظ
            </Button>
            <Button type="button" size="sm" variant="secondary" className="flex-1" disabled={saving} onClick={saveSettings}>حفظ الإعدادات</Button>
          </div>
        )}

        {effectiveRate == null ? (
          <p className="text-xs text-muted-foreground">
            {isAdmin ? "اضغط «عايِر» أو أدخل السعر ليظهر الاقتراح." : "لم يضبط المدير العام سعر الدولار بعد."}
          </p>
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
          اقتراح فقط: «استعمل» يملأ خانة السعر أدناه ولا يحفظ شيئاً. راجع الرقم ثم اضغط «حفظ سعر اليوم». السعر الرسمي للدولار أقل بكثير من سعر السوق — لذلك تُضبط العلاوة بالمعايرة.
        </p>
      </CardContent>
    </Card>
  );
}
