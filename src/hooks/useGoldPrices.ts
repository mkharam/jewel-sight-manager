// سعر الذهب اليومي، متاحاً لكل الشاشات لا لصفحة «سعر الذهب» وحدها.
//
// السعر كان مسجّلاً في قاعدة البيانات ومعه حاسبة، لكن الاثنين داخل صفحة يراها المدير
// فقط — فلا قطعة من القطع الـ١٤٠ لها سعر، والموظف يحسب في رأسه أو يتّصل ليسأل. هذا
// الخطّاف يجعل سعر الغرام متاحاً في الكتالوق وصفحة القطعة ونافذة تسجيل السعر.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface GoldPriceRow {
  karat: string;
  price_per_gram: number;
  making_charge: number;
  effective_date: string;
}

/** أحدث سعر لكل عيار، مفهرساً بالعيار. */
export function useGoldPrices() {
  return useQuery({
    queryKey: ["gold-prices-current"],
    // السعر يتغيّر مرة أو مرتين في اليوم — لا داعي لإعادة الجلب مع كل تنقّل.
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("gold_prices")
        .select("karat, price_per_gram, making_charge, effective_date")
        .order("effective_date", { ascending: false });
      if (error) throw error;

      // الصفوف مرتّبة تنازلياً بالتاريخ، فأول ظهور لكل عيار هو سعره الساري.
      const map = new Map<string, GoldPriceRow>();
      for (const r of (data ?? []) as any[]) {
        if (map.has(r.karat)) continue;
        map.set(r.karat, {
          karat: r.karat,
          price_per_gram: Number(r.price_per_gram),
          making_charge: Number(r.making_charge ?? 0),
          effective_date: r.effective_date,
        });
      }
      return map;
    },
  });
}
