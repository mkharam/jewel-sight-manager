// إعدادات يتحكّم بها المالك، متاحة لكل الشاشات.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const SHOW_PRICES = "show_prices_to_staff";

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
