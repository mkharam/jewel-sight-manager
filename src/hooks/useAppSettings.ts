// إعدادات يتحكّم بها المالك، متاحة لكل الشاشات.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const SHOW_PRICES = "show_prices_to_staff";
const PRICE_RANGE = "price_range_filter";

export interface PriceRange {
  enabled: boolean;
  min: number | null;
  max: number | null;
}
const NO_RANGE: PriceRange = { enabled: false, min: null, max: null };

function readRange(v: any): PriceRange {
  if (!v || typeof v !== "object") return NO_RANGE;
  const num = (x: any) => (x === null || x === undefined || x === "" || isNaN(Number(x)) ? null : Number(x));
  return { enabled: v.enabled === true, min: num(v.min), max: num(v.max) };
}

function useSettings() {
  return useQuery({
    queryKey: ["app-settings"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("app_settings").select("key, value");
      if (error) throw error;
      const map = new Map<string, any>();
      for (const r of (data ?? []) as any[]) map.set(r.key, r.value);
      return map;
    },
  });
}

/**
 * هل يُعرض سعر القطعة المحسوب تلقائياً (وزنها × سعر الغرام) لهذا المستخدم؟
 *
 * مطفأ افتراضاً بطلب المالك: الزبون يقف بجانب الموظف وقد يرى شاشته، فتسعيرة البضاعة
 * لا تُعرض إلا حين يُشغّلها المالك من صفحة سعر الذهب. المالك نفسه يراها دائماً.
 *
 * هذا لا يشمل السعر الذي سجّله موظف لزبون — ذاك يبقى ظاهراً دائماً لأنه يمنع تخبّط
 * الأسعار بين الفروع، ولا يبقى سعر الغرام مخفياً أيضاً (راجع الترحيب في ProductSearch).
 */
export function usePricesVisible(): boolean {
  const { roles } = useAuth();
  const { data } = useSettings();
  if (roles.includes("admin")) return true;
  // الافتراض عند غياب الإعداد أو تعذّر جلبه: الإخفاء — لا نكشف التسعيرة بالخطأ.
  return data?.get(SHOW_PRICES) === true;
}

/**
 * هل يُعرض سعر هذه القطعة بالذات؟ يجمع مفتاح الإظهار العام ونطاق الأسعار الذي يحدّده
 * المالك (يعرض الموظف الأسعار ضمن نطاق معيّن فقط). المالك يرى كل شيء دائماً.
 */
export function usePriceVisibleFor(price: number | null | undefined): boolean {
  const { roles } = useAuth();
  const { data } = useSettings();
  const visible = usePricesVisible();
  if (!visible) return false;
  if (roles.includes("admin")) return true;
  const r = readRange(data?.get(PRICE_RANGE));
  if (!r.enabled || price == null) return true;
  return (r.min == null || price >= r.min) && (r.max == null || price <= r.max);
}

const SPOT_RATE = "spot_usd_lyd_rate";
const SPOT_MARGIN = "spot_margin_percent";

/** سعر الدولار بالدينار وهامش الربح % لاقتراح سعر الذهب من السوق العالمي. */
export function useSpotSettings() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data } = useSettings();
  const numOrNull = (v: any) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v));

  const save = async (rate: number | null, marginPercent: number) => {
    const now = new Date().toISOString();
    const rows = [
      { key: SPOT_RATE, value: rate as any, updated_by: user?.id, updated_at: now },
      { key: SPOT_MARGIN, value: marginPercent as any, updated_by: user?.id, updated_at: now },
    ];
    const { error } = await supabase.from("app_settings").upsert(rows);
    if (error) throw error;
    await qc.invalidateQueries({ queryKey: ["app-settings"] });
  };

  return { rate: numOrNull(data?.get(SPOT_RATE)), marginPercent: numOrNull(data?.get(SPOT_MARGIN)) ?? 0, save };
}

/** نطاق الأسعار المسموح للموظف برؤيته — لشاشة المالك. */
export function usePriceRangeSetting() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data, isLoading } = useSettings();
  const range = readRange(data?.get(PRICE_RANGE));

  const mutation = useMutation({
    mutationFn: async (next: PriceRange) => {
      const { error } = await supabase
        .from("app_settings")
        .upsert({ key: PRICE_RANGE, value: next as any, updated_by: user?.id, updated_at: new Date().toISOString() });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["app-settings"] }),
  });

  return { range, isLoading, setRange: mutation.mutateAsync, saving: mutation.isPending };
}

/** قراءة/كتابة الإعداد نفسه — لشاشة المالك. */
export function useShowPricesSetting() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data, isLoading } = useSettings();
  const enabled = data?.get(SHOW_PRICES) === true;

  const mutation = useMutation({
    mutationFn: async (next: boolean) => {
      const { error } = await supabase
        .from("app_settings")
        .upsert({ key: SHOW_PRICES, value: next as any, updated_by: user?.id, updated_at: new Date().toISOString() });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["app-settings"] }),
  });

  return { enabled, isLoading, setEnabled: mutation.mutateAsync, saving: mutation.isPending };
}
