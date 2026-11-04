// يطابق الباركود المكتوب في نموذج القطعة مع مخزون أمارسوفت ويعرض النتيجة تحته مباشرة.
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { sb } from "@/lib/amarsoft";

type Lookup = {
  found: boolean; in_stock: boolean; branch_name: string | null; type_name: string | null; karat: string | null;
  grams: number | null; sold_on: string | null; existing_product_id: string | null; existing_product_name: string | null;
};

export default function AmarsoftTagCheck({ barcode, productId }: { barcode: string; productId?: string }) {
  const tag = barcode.replace(/\D/g, "");
  const { data, isFetching } = useQuery({
    queryKey: ["amarsoft-lookup", tag],
    enabled: tag.length >= 6,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await sb.rpc("amarsoft_lookup_tag", { p_code: tag });
      if (error) throw error;
      return ((data ?? [])[0] ?? null) as Lookup | null;
    },
  });
  if (tag.length < 6) return null;
  if (isFetching && !data) {
    return <p className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> جارٍ التحقق من أمارسوفت…</p>;
  }
  if (!data) return null;
  const duplicate = data.existing_product_id && data.existing_product_id !== productId;
  return (
    <div className="space-y-1 text-xs">
      {!data.found ? (
        <p className="rounded-md border border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-2 py-1.5">
          غير موجودة في مخزون أمارسوفت — ستُحفظ «بانتظار أمارسوفت» وتُطابَق تلقائياً عند تسجيلها هناك.
        </p>
      ) : !data.in_stock ? (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 text-destructive px-2 py-1.5">
          مباعة في أمارسوفت{data.sold_on ? ` بتاريخ ${data.sold_on}` : ""} · {data.branch_name}
        </p>
      ) : (
        <p className="rounded-md border border-status-available/50 bg-status-available/10 text-status-available px-2 py-1.5">
          ✓ في مخزون أمارسوفت: {data.type_name} · {data.karat}K · {Number(data.grams ?? 0)} جم · {data.branch_name}
        </p>
      )}
      {duplicate && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 text-destructive px-2 py-1.5">
          مضافة مسبقاً في التطبيق: {data.existing_product_name}
        </p>
      )}
    </div>
  );
}
