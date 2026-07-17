import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search as SearchIcon, Plus, SlidersHorizontal, X, Sparkles, Store } from "lucide-react";
import ProductCard from "@/components/ProductCard";
import ImageSearchButton from "@/components/ImageSearchButton";
import { PRODUCT_STATUS, KARAT_OPTIONS, ProductStatus } from "@/lib/constants";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";

interface Filters {
  q: string;
  karat: string;
  branchId: string;
  categoryId: string;
  status: string;
  minWeight: string;
  maxWeight: string;
}

const initialFilters: Filters = {
  q: "", karat: "all", branchId: "all", categoryId: "all", status: "all", minWeight: "", maxWeight: "",
};

const SAVED_FILTERS_KEY = "lamaa.lastSearch.v1";

function loadSavedFilters(): Filters {
  try {
    const raw = localStorage.getItem(SAVED_FILTERS_KEY);
    if (!raw) return initialFilters;
    const p = JSON.parse(raw);
    return { ...initialFilters, ...p };
  } catch {
    return initialFilters;
  }
}

export default function ProductSearch() {
  const { profile, roles } = useAuth();
  const [filters, setFilters] = useState<Filters>(loadSavedFilters);
  const [debounced, setDebounced] = useState(filters);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 5) return "ساعة طيبة";
    if (h < 12) return "صباح الخير";
    if (h < 18) return "مساء الخير";
    return "مساء النور";
  }, []);
  const roleLabel = roles.includes("admin") ? "مدير عام" : roles.includes("manager") ? "مدير فرع" : "موظف";

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(filters);
      try { localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(filters)); } catch {}
    }, 250);
    return () => clearTimeout(t);
  }, [filters]);

  const { data: branches } = useQuery({
    queryKey: ["branches"],
    queryFn: async () => (await supabase.from("branches").select("id,name").order("name")).data ?? [],
  });

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await supabase.from("categories").select("id,name").order("sort_order")).data ?? [],
  });

  // Image-search results — when set, overrides normal query with similarity-ranked matches.
  const [similarMatches, setSimilarMatches] = useState<{ product_id: string; similarity: number }[] | null>(null);
  const similarIds = useMemo(() => similarMatches?.map((m) => m.product_id) ?? null, [similarMatches]);

  const { data: products, isLoading } = useQuery({
    queryKey: ["products", debounced, similarIds],
    queryFn: async () => {
      let q = supabase
        .from("products")
        .select("id,name,sku,karat,weight_grams,ring_size,sale_price,promo_price,status,branch_id,branch:branches(name),category:categories(name),images:product_images(storage_path,is_primary)")
        .limit(120);

      if (similarIds && similarIds.length > 0) {
        q = q.in("id", similarIds);
      } else {
        q = q.order("created_at", { ascending: false });
        if (debounced.q) q = q.or(`name.ilike.%${debounced.q}%,sku.ilike.%${debounced.q}%,description.ilike.%${debounced.q}%`);
        if (debounced.karat !== "all") q = q.eq("karat", debounced.karat);
        if (debounced.branchId !== "all") q = q.eq("branch_id", debounced.branchId);
        if (debounced.categoryId !== "all") q = q.eq("category_id", debounced.categoryId);
        if (debounced.status !== "all") q = q.eq("status", debounced.status as ProductStatus);
        if (debounced.minWeight) q = q.gte("weight_grams", parseFloat(debounced.minWeight));
        if (debounced.maxWeight) q = q.lte("weight_grams", parseFloat(debounced.maxWeight));
      }

      const { data, error } = await q;
      if (error) throw error;

      // Preserve similarity order returned by the AI search.
      if (similarIds && data) {
        const idx = new Map(similarIds.map((id, i) => [id, i]));
        return [...data].sort((a: any, b: any) => (idx.get(a.id) ?? 999) - (idx.get(b.id) ?? 999));
      }
      return data ?? [];
    },
  });

  // Group products by similarity bucket when in photo-search mode
  const similarityBuckets = useMemo(() => {
    if (!similarMatches || !products) return null;
    const simMap = new Map(similarMatches.map((m) => [m.product_id, m.similarity]));
    const exact: any[] = [], veryHigh: any[] = [], similar: any[] = [];
    for (const p of products as any[]) {
      const s = simMap.get(p.id) ?? 0;
      if (s >= 0.92) exact.push({ ...p, _sim: s });
      else if (s >= 0.80) veryHigh.push({ ...p, _sim: s });
      else similar.push({ ...p, _sim: s });
    }
    return { exact, veryHigh, similar };
  }, [similarMatches, products]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.karat !== "all") n++;
    if (filters.branchId !== "all") n++;
    if (filters.categoryId !== "all") n++;
    if (filters.status !== "all") n++;
    if (filters.minWeight) n++;
    if (filters.maxWeight) n++;
    return n;
  }, [filters]);

  const myBranchName = useMemo(
    () => branches?.find((b) => b.id === profile?.branch_id)?.name ?? null,
    [branches, profile?.branch_id]
  );

  return (
    <div className="space-y-4">
      {/* Luxury welcome + search */}
      <div className="relative overflow-hidden rounded-3xl bg-gold-gradient shadow-gold p-5 md:p-8">
        <div className="absolute -top-12 -left-12 size-40 rounded-full bg-white/10 blur-2xl pointer-events-none" />
        <div className="absolute -bottom-16 -right-10 size-44 rounded-full bg-white/10 blur-2xl pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-2 text-primary-foreground/85 text-xs font-medium mb-1">
            <Sparkles className="size-3.5" />
            <span>{greeting}</span>
          </div>
          <h2 className="text-xl md:text-3xl font-extrabold text-primary-foreground leading-tight">
            أهلاً بك، {profile?.full_name ?? "—"}
          </h2>
          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary-foreground/15 backdrop-blur text-primary-foreground text-[11px] font-semibold border border-primary-foreground/20">
              <Store className="size-3" />
              {myBranchName ?? "بدون فرع محدد"}
            </span>
            <span className="text-[11px] text-primary-foreground/80">{roleLabel} · لمعة</span>
          </div>

          <div className="flex gap-2 mt-4">
            <div className="relative flex-1">
              <SearchIcon className="absolute right-3 top-1/2 -translate-y-1/2 size-5 text-muted-foreground" />
              <Input
                placeholder="ابحث: خاتم، سلسلة، 21K..."
                value={filters.q}
                onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
                className="pr-10 pl-10 h-12 text-base bg-card border-0 shadow-card"
              />
              {filters.q && (
                <button
                  type="button"
                  onClick={() => setFilters((f) => ({ ...f, q: "" }))}
                  className="absolute left-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-muted text-muted-foreground"
                  aria-label="مسح البحث"
                >
                  <X className="size-4" />
                </button>
              )}
          </div>
          <ImageSearchButton
            categories={categories ?? undefined}
            onResults={({ matches }) => {
              setSimilarMatches(matches.length > 0 ? matches : []);
            }}
          />
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="lg" className="relative h-12">
                <SlidersHorizontal className="size-4 ml-1" />
                فلترة
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1 -right-1 size-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-full sm:max-w-md overflow-y-auto">
              <SheetHeader>
                <SheetTitle>فلترة المنتجات</SheetTitle>
              </SheetHeader>
              <div className="space-y-4 mt-6">
                <FilterField label="الفئة">
                  <Select value={filters.categoryId} onValueChange={(v) => setFilters((f) => ({ ...f, categoryId: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">كل الفئات</SelectItem>
                      {categories?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FilterField>
                <FilterField label="القيراط">
                  <Select value={filters.karat} onValueChange={(v) => setFilters((f) => ({ ...f, karat: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">كل القيراطات</SelectItem>
                      {KARAT_OPTIONS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FilterField>
                <FilterField label="الفرع">
                  <Select value={filters.branchId} onValueChange={(v) => setFilters((f) => ({ ...f, branchId: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">كل الفروع</SelectItem>
                      {branches?.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FilterField>
                <FilterField label="الحالة">
                  <Select value={filters.status} onValueChange={(v) => setFilters((f) => ({ ...f, status: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">كل الحالات</SelectItem>
                      {Object.entries(PRODUCT_STATUS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FilterField>
                <div className="grid grid-cols-2 gap-3">
                  <FilterField label="وزن من (غ)">
                    <Input type="number" step="0.001" value={filters.minWeight} onChange={(e) => setFilters((f) => ({ ...f, minWeight: e.target.value }))} />
                  </FilterField>
                  <FilterField label="وزن إلى (غ)">
                    <Input type="number" step="0.001" value={filters.maxWeight} onChange={(e) => setFilters((f) => ({ ...f, maxWeight: e.target.value }))} />
                  </FilterField>
                </div>
                <Button variant="outline" className="w-full" onClick={() => setFilters(initialFilters)}>
                  <X className="size-4 ml-1" /> مسح الفلاتر
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
        </div>
      </div>

      {/* فلاتر سريعة Chips */}
      <div className="flex gap-2 overflow-x-auto -mx-3 px-3 pb-1 scrollbar-none">
        {KARAT_OPTIONS.map((k) => (
          <Chip
            key={k}
            active={filters.karat === k}
            onClick={() => setFilters((f) => ({ ...f, karat: f.karat === k ? "all" : k }))}
          >{k}</Chip>
        ))}
        <div className="w-px bg-border mx-1 shrink-0" />
        {categories?.slice(0, 6).map((c) => (
          <Chip
            key={c.id}
            active={filters.categoryId === c.id}
            onClick={() => setFilters((f) => ({ ...f, categoryId: f.categoryId === c.id ? "all" : c.id }))}
          >{c.name}</Chip>
        ))}
        {(filters.karat !== "all" || filters.categoryId !== "all" || filters.branchId !== "all" || filters.status !== "all" || filters.minWeight || filters.maxWeight) && (
          <Chip onClick={() => setFilters(initialFilters)} active={false}>
            <X className="size-3 inline" /> مسح
          </Chip>
        )}
      </div>

      {similarIds !== null && similarityBuckets && (
        <div className="flex items-center justify-between rounded-xl bg-gold-soft border border-primary/20 px-3 py-2">
          <div className="flex items-center gap-2 text-sm flex-wrap">
            <Sparkles className="size-4 text-primary" />
            <span className="font-semibold">بحث بالصورة</span>
            {similarityBuckets.exact.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-green-600 text-white text-[10px] font-bold">
                🎯 {similarityBuckets.exact.length} مطابقة
              </span>
            )}
            {similarityBuckets.veryHigh.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-primary/20 text-primary text-[10px] font-bold">
                ✨ {similarityBuckets.veryHigh.length} شبه مطابقة
              </span>
            )}
            {similarityBuckets.similar.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-muted text-foreground text-[10px] font-semibold">
                📌 {similarityBuckets.similar.length} مقاربة
              </span>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={() => setSimilarMatches(null)}>
            <X className="size-4 ml-1" /> إلغاء
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {isLoading ? "جارٍ..." : `${products?.length ?? 0} نتيجة`}
        </p>
        <Link to="/products/new">
          <Button size="sm" className="bg-gold-gradient text-primary-foreground shadow-gold">
            <Plus className="size-4 ml-1" /> إضافة قطعة
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-square rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : similarityBuckets ? (
        <div className="space-y-5">
          {similarityBuckets.exact.length > 0 && (
            <SimilaritySection
              title="🎯 قطع مطابقة تماماً"
              subtitle="نفس القطعة موجودة في مخزون آخر"
              tone="success"
              products={similarityBuckets.exact}
            />
          )}
          {similarityBuckets.veryHigh.length > 0 && (
            <SimilaritySection
              title="✨ قطع شبه مطابقة"
              subtitle="تصميم قريب جداً — قد يهم العميل"
              tone="primary"
              products={similarityBuckets.veryHigh}
            />
          )}
          {similarityBuckets.similar.length > 0 && (
            <SimilaritySection
              title="📌 قطع مقاربة في الشكل"
              subtitle="بديل محتمل"
              tone="muted"
              products={similarityBuckets.similar}
            />
          )}
          {similarityBuckets.exact.length === 0 && similarityBuckets.veryHigh.length === 0 && similarityBuckets.similar.length === 0 && (
            <div className="text-center py-16 bg-muted/30 rounded-xl">
              <p className="text-muted-foreground">لم نعثر على قطع مشابهة. جرّب صورة أوضح أو أضف القطعة.</p>
            </div>
          )}
        </div>
      ) : products && products.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {products.map((p: any) => <ProductCard key={p.id} product={p} />)}
        </div>
      ) : (
        <div className="text-center py-16 bg-muted/30 rounded-xl">
          <p className="text-muted-foreground">لا توجد نتائج. جرّب تعديل البحث أو إضافة منتج جديد.</p>
        </div>
      )}
    </div>
  );
}

function SimilaritySection({
  title,
  subtitle,
  tone,
  products,
}: {
  title: string;
  subtitle: string;
  tone: "success" | "primary" | "muted";
  products: any[];
}) {
  const badgeCls =
    tone === "success"
      ? "bg-green-600 text-white"
      : tone === "primary"
      ? "bg-gold-gradient text-primary-foreground"
      : "bg-muted text-foreground";
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2 px-1">
        <h3 className="text-sm font-bold flex items-center gap-2">
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${badgeCls}`}>{products.length}</span>
          {title}
        </h3>
        <span className="text-[11px] text-muted-foreground">{subtitle}</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {products.map((p: any) => (
          <div key={p.id} className="relative">
            <ProductCard product={p} />
            {typeof p._sim === "number" && (
              <span className="absolute top-1 left-1 z-10 text-[10px] font-bold px-1.5 py-0.5 rounded bg-black/60 text-white backdrop-blur">
                {Math.round(p._sim * 100)}%
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "shrink-0 px-3 h-8 rounded-full text-xs font-semibold border transition-colors whitespace-nowrap " +
        (active
          ? "bg-gold-gradient text-primary-foreground border-transparent shadow-gold"
          : "bg-card text-foreground border-border hover:bg-secondary")
      }
    >
      {children}
    </button>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold">{label}</Label>
      {children}
    </div>
  );
}
