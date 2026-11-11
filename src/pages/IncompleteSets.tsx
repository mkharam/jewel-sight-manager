// الأطقم الناقصة: أطقم بيعت منها قطعة أو أكثر منفردة (فُوترت بالكود العام 18K GEN) — يبقى
// الطاقم في أمارسوفت بوزنه الكامل، فهذه القائمة تذكّر بتعديل وزنه هناك وتُظهر ما بقي منه.
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Layers, Loader2 } from "lucide-react";
import { getThumbUrl, formatDate } from "@/lib/constants";
import type { IncompleteSet } from "@/components/SetPartsCard";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type Row = IncompleteSet & {
  product: { id: string; name: string; barcode_value: string | null; weight_grams: number | null; branch: { name: string } | null;
    images: { storage_path: string; thumb_path: string | null; is_primary: boolean }[] } | null;
};

export default function IncompleteSets() {
  const { data, isLoading } = useQuery({
    queryKey: ["incomplete-sets-page"],
    queryFn: async (): Promise<Row[]> => {
      const { data: sets, error } = await db.from("incomplete_sets").select("*").order("last_sold_at", { ascending: false });
      if (error) throw error;
      const ids = (sets ?? []).map((s: IncompleteSet) => s.product_id);
      if (!ids.length) return [];
      const { data: products } = await db.from("products")
        .select("id,name,barcode_value,weight_grams,branch:branches(name),images:product_images(storage_path,thumb_path,is_primary)")
        .in("id", ids);
      const byId = new Map((products ?? []).map((p: { id: string }) => [p.id, p]));
      return (sets as IncompleteSet[]).map((s) => ({ ...s, product: (byId.get(s.product_id) as Row["product"]) ?? null }));
    },
  });

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center gap-2">
        <Layers className="size-6 text-primary" />
        <h1 className="text-xl font-bold">الأطقم الناقصة</h1>
        {data && <Badge variant="secondary">{data.length}</Badge>}
      </div>
      <p className="text-sm text-muted-foreground">
        أطقم بيعت منها قطعة منفردة. عدّل وزن كل طاقم في أمارسوفت ليطابق الوزن الباقي.
      </p>
      {isLoading && <Loader2 className="mx-auto size-6 animate-spin" />}
      {data?.length === 0 && <p className="py-12 text-center text-sm text-muted-foreground">لا توجد أطقم ناقصة.</p>}
      <div className="space-y-2">
        {data?.map((r) => {
          const p = r.product;
          const img = p?.images?.find((i) => i.is_primary) ?? p?.images?.[0];
          const remaining = p?.weight_grams != null ? p.weight_grams - Number(r.sold_grams) : null;
          return (
            <Link key={r.product_id} to={`/products/${r.product_id}`}>
              <Card className="flex items-center gap-3 p-3 hover:bg-muted/50">
                {img ? <img src={getThumbUrl(img)!} alt="" className="size-16 rounded-lg object-cover" /> : <div className="size-16 rounded-lg bg-muted" />}
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="truncate font-semibold">{p?.name ?? "طاقم"}</p>
                  <p className="text-xs text-muted-foreground" dir="ltr">{p?.barcode_value ?? ""}</p>
                  <p className="text-xs">
                    بيعت <b>{r.sold_parts}</b> من {r.total_parts} قطع
                    {remaining != null && <> — الوزن الباقي تقريباً <b>{remaining.toFixed(2)}</b> من {p?.weight_grams} جم</>}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {p?.branch?.name ?? ""}{r.last_sold_at ? ` · آخر بيع ${formatDate(r.last_sold_at)}` : ""}
                  </p>
                </div>
                <Badge className="bg-amber-500 text-white">ناقص</Badge>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
