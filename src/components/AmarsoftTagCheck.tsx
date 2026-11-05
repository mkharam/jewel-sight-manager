// يطابق الباركود المكتوب في نموذج القطعة مع مخزون أمارسوفت ويعرض النتيجة تحته مباشرة.
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { sb } from "@/lib/amarsoft";

type Lookup = {
  found: boolean; in_stock: boolean; branch_name: string | null; type_name: string | null; karat: string | null;
  grams: number | null; sold_on: string | null; existing_product_id: string | null; existing_product_name: string | null;
  received_on?: string | null;
};

function useLookup(tag: string) {
  return useQuery({
    queryKey: ["amarsoft-lookup", tag],
    enabled: tag.length >= 6,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await sb.rpc("amarsoft_lookup_tag", { p_code: tag });
      if (error) throw error;
      return ((data ?? [])[0] ?? null) as Lookup | null;
    },
  });
}

/** صفحة القطعة: شن يقول أمارسوفت على القطعة المربوطة — حالتها، نوعها، وزنها، وقداش لها في المحل. */
export function AmarsoftPieceInfo({ barcode, appWeight }: { barcode: string; appWeight: number | null }) {
  const tag = barcode.replace(/\D/g, "");
  const { data } = useLookup(tag);
  if (tag.length < 6 || !data) return null;
  if (!data.found) {
    return <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-3 py-2 text-xs">الرقم {tag} مش موجود في أمارسوفت — تأكد من الليبل.</p>;
  }
  const days = data.received_on ? Math.round((Date.now() - Date.parse(`${data.received_on}T12:00:00Z`)) / 86_400_000) : null;
  const weightOff = appWeight != null && data.grams != null && Math.abs(Number(appWeight) - Number(data.grams)) > 0.05;
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div className="flex justify-between gap-2 py-1 border-b border-border/50 last:border-0"><span className="text-muted-foreground">{k}</span><span className="font-semibold text-left">{v}</span></div>
  );
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
      <p className="font-bold mb-1 flex items-center justify-between">
        من أمارسوفت
        <span className={`text-xs px-2 py-0.5 rounded-full ${data.in_stock ? "bg-status-available/15 text-status-available" : "bg-destructive/15 text-destructive"}`}>
          {data.in_stock ? "في المخزون" : `مباعة${data.sold_on ? ` ${data.sold_on}` : ""}`}
        </span>
      </p>
      <Row k="الرقم" v={<span dir="ltr" className="font-mono">{tag}</span>} />
      <Row k="النوع" v={`${data.type_name ?? "—"}${data.karat ? ` · عيار ${data.karat}` : ""}`} />
      <Row k="الوزن في أمارسوفت" v={<span className={weightOff ? "text-destructive" : ""}>{data.grams ?? "—"} جم{weightOff ? ` (في التطبيق ${appWeight})` : ""}</span>} />
      <Row k="الفرع" v={data.branch_name ?? "—"} />
      {data.received_on && <Row k="دخلت" v={`${data.received_on}${days != null ? ` · من ${days} يوم` : ""}`} />}
    </div>
  );
}

export default function AmarsoftTagCheck({ barcode, productId }: { barcode: string; productId?: string }) {
  const tag = barcode.replace(/\D/g, "");
  const { data, isFetching } = useLookup(tag);
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
