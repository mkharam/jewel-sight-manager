// آخر سعر أُعطي لزبون في كل قطعة معروضة.
//
// زبون يدخل فرعاً ويسأل عن قطعة رآها في فرع آخر، فيقعد الموظف يتّصل ويسأل: عند مين
// القطعة؟ وكم وزنها؟ وبكم أعطاها زميلي للزبون قبل؟ الفرع والوزن على البطاقة أصلاً،
// وهذا يضيف الثالث — فيرى الموظف السعر الذي سبق أن أُعطي قبل أن يفتح القطعة، ولا
// يعطي الزبون رقماً يخالف ما سمعه في الفرع الآخر.
//
// استعلام واحد لكل الصفحة المعروضة لا استعلام لكل بطاقة، ويُعاد استعماله من الكاش بين
// البحث العادي والبحث بالصورة ما دامت القطع نفسها.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface LatestQuote {
  price: number;
  created_at: string;
  branch_name: string | null;
}

export function useLatestQuotes(productIds: string[]) {
  // مفتاح مستقر: ترتيب البطاقات قد يتغيّر (فرز، تشابه الصورة) والقطع هي هي.
  const key = [...productIds].sort().join(",");

  return useQuery({
    queryKey: ["latest-quotes", key],
    enabled: productIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_quotes")
        .select("product_id, price, created_at, branch:branches(name)")
        .in("product_id", productIds)
        .order("created_at", { ascending: false });
      if (error) throw error;

      // الصفوف مرتّبة تنازلياً، فأول ظهور لكل قطعة هو آخر سعر فيها.
      const map = new Map<string, LatestQuote>();
      for (const row of data ?? []) {
        const pid = (row as any).product_id as string;
        if (map.has(pid)) continue;
        map.set(pid, {
          price: Number((row as any).price),
          created_at: (row as any).created_at,
          branch_name: (row as any).branch?.name ?? null,
        });
      }
      return map;
    },
  });
}
