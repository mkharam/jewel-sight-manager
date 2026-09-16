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
 * هل تُعرض الأسعار المحسوبة لهذا المستخدم؟
 *
 * الزبون يقف بجانب الموظف وقد يرى شاشته، فللمالك أن يُطفئ إظهار سعر كل قطعة. المالك
 * نفسه يرى الأسعار دائماً — الإعداد يخصّ الموظفين والمشرفين. وحتى حين تكون مطفأة يبقى
 * تسجيل السعر لزبون متاحاً (الموظف يكتب الرقم)، ويبقى سعر الغرام ظاهراً في الرئيسية.
 */
export function usePricesVisible(): boolean {
  const { roles } = useAuth();
  const { data } = useSettings();
  if (roles.includes("admin")) return true;
  // الافتراض عند غياب الإعداد أو تعذّر جلبه: الإظهار — كما كان الحال قبل الإعداد.
  return data?.get(SHOW_PRICES) !== false;
}

/** قراءة/كتابة الإعداد نفسه — لشاشة المالك. */
export function useShowPricesSetting() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data, isLoading } = useSettings();
  const enabled = data?.get(SHOW_PRICES) !== false;

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
