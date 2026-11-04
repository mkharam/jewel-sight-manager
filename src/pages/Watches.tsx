// الساعات: كل الساعات الموجودة في الفروع بصورتها وسعرها، باش الموظف يجاوب الزبون بسرعة.
// أمارسوفت ما فيهش مخزون ساعات، فالساعات قطع في التطبيق تحت تصنيف «ساعات».
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus, Search, Watch } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PRODUCT_STATUS, formatCurrency, getThumbUrl, type ProductStatus } from "@/lib/constants";

type WatchRow = {
  id: string; name: string; sku: string | null; description: string | null; search_tags: string[] | null;
  sale_price: number | null; promo_price: number | null; quantity: number | null; status: ProductStatus;
  branch_id: string | null; branch: { name: string } | null;
  images: { storage_path: string | null; thumb_path: string | null; is_primary: boolean | null }[];
};

const SORTS = [
  { key: "new", label: "الأحدث" }, { key: "low", label: "الأرخص" }, { key: "high", label: "الأغلى" },
] as const;

const price = (w: WatchRow) => Number(w.promo_price ?? w.sale_price ?? 0);

export default function Watches() {
  const { roles } = useAuth();
  const canAdd = roles.includes("admin") || roles.includes("manager");
  const [q, setQ] = useState("");
  const [branch, setBranch] = useState<string>("all");
  const [sort, setSort] = useState<(typeof SORTS)[number]["key"]>("new");

  const { data, isLoading } = useQuery({
    queryKey: ["watches"],
    queryFn: async () => {
      const { data: cat } = await supabase.from("categories").select("id").eq("name", "ساعات").maybeSingle();
      if (!cat) return { categoryId: null, rows: [] as WatchRow[] };
      const { data, error } = await supabase
        .from("products")
        .select("id,name,sku,description,search_tags,sale_price,promo_price,quantity,status,branch_id,created_at,branch:branches(name),images:product_images(storage_path,thumb_path,is_primary)")
        .eq("category_id", cat.id)
        .in("status", ["available", "reserved", "in_transfer"])
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return { categoryId: cat.id as string, rows: (data ?? []) as unknown as WatchRow[] };
    },
  });

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const branches = useMemo(() => {
    const m = new Map<string, { name: string; n: number }>();
    for (const w of rows) if (w.branch_id) m.set(w.branch_id, { name: w.branch?.name ?? "—", n: (m.get(w.branch_id)?.n ?? 0) + 1 });
    return [...m.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [rows]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    let out = rows.filter((w) => branch === "all" || w.branch_id === branch);
    if (term) {
      out = out.filter((w) => [w.name, w.sku, w.description, ...(w.search_tags ?? [])].some((s) => s?.toLowerCase().includes(term)));
    }
    if (sort === "low") out = [...out].sort((a, b) => price(a) - price(b));
    if (sort === "high") out = [...out].sort((a, b) => price(b) - price(a));
    return out;
  }, [rows, q, branch, sort]);

  return (
    <div className="max-w-3xl mx-auto space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Watch className="size-7 text-primary" />الساعات</h1>
        {canAdd && data?.categoryId && (
          <Button asChild>
            <Link to={`/products/new?category=${data.categoryId}`}><Plus className="size-4" />إضافة ساعة</Link>
          </Button>
        )}
      </div>

      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-5 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالماركة أو الموديل أو الرقم" className="h-12 pr-10 text-base" />
      </div>

      {branches.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <Button size="sm" variant={branch === "all" ? "default" : "outline"} onClick={() => setBranch("all")} className="shrink-0">كل الفروع ({rows.length})</Button>
          {branches.map(([id, b]) => (
            <Button key={id} size="sm" variant={branch === id ? "default" : "outline"} onClick={() => setBranch(id)} className="shrink-0">{b.name} ({b.n})</Button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-3 gap-1.5">
        {SORTS.map((s) => (
          <Button key={s.key} size="sm" variant={sort === s.key ? "secondary" : "ghost"} onClick={() => setSort(s.key)}>{s.label}</Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : !rows.length ? (
        <Card className="p-6 text-center space-y-2">
          <Watch className="size-10 mx-auto text-muted-foreground" />
          <p className="font-bold">ما فيش ساعات مسجّلة لين توا</p>
          <p className="text-sm text-muted-foreground">
            {canAdd ? "اضغط «إضافة ساعة» وصوّرها واكتب سعرها، وتطلع هنا لكل الموظفين." : "المشرف أو المدير يضيف الساعات بصورها وأسعارها، وتطلع هنا."}
          </p>
        </Card>
      ) : !shown.length ? (
        <p className="text-center text-muted-foreground py-8">ما فيش ساعة تطابق البحث</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{shown.length} ساعة</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {shown.map((w) => {
              const img = w.images.find((i) => i.is_primary) ?? w.images[0];
              const url = getThumbUrl(img);
              const promo = w.promo_price != null && w.sale_price != null && Number(w.promo_price) < Number(w.sale_price);
              return (
                <Link key={w.id} to={`/products/${w.id}`} className="block">
                  <Card className="overflow-hidden h-full active:bg-muted/40">
                    <div className="aspect-square bg-muted relative">
                      {url ? <img src={url} alt={w.name} loading="lazy" className="w-full h-full object-cover" />
                        : <Watch className="size-10 text-muted-foreground absolute inset-0 m-auto" />}
                      {w.status !== "available" && (
                        <span className={`absolute top-1.5 right-1.5 rounded-full px-2 py-0.5 text-[11px] ${PRODUCT_STATUS[w.status]?.color}`}>
                          {PRODUCT_STATUS[w.status]?.label}
                        </span>
                      )}
                    </div>
                    <div className="p-2 space-y-0.5">
                      <div className="font-bold text-sm leading-tight line-clamp-2">{w.name}</div>
                      {w.sale_price == null && w.promo_price == null ? (
                        <div className="text-sm text-muted-foreground">السعر مش مسجّل</div>
                      ) : (
                        <div className="flex items-baseline gap-1.5 flex-wrap">
                          <span className="text-lg font-bold text-primary">{formatCurrency(price(w))}</span>
                          {promo && <span className="text-xs text-muted-foreground line-through">{formatCurrency(w.sale_price)}</span>}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground truncate">
                        {w.branch?.name ?? "—"}{Number(w.quantity ?? 1) > 1 ? ` · ${w.quantity} حبات` : ""}
                      </div>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
