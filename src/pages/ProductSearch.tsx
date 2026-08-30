import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search as SearchIcon, Plus, SlidersHorizontal, X, Sparkles, Store, CheckSquare, Trash2, Loader2, ScanLine } from "lucide-react";
import ProductCard from "@/components/ProductCard";
import ImageSearchButton from "@/components/ImageSearchButton";
import { PRODUCT_STATUS, KARAT_OPTIONS, ProductStatus } from "@/lib/constants";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { expandQuery, matchScore } from "@/lib/arabic-search";

interface Filters {
  q: string;
  karat: string;
  branchId: string;
  categoryId: string;
  status: string;
  minWeight: string;
  maxWeight: string;
  /** وسم من تحليل الذكاء الاصطناعي (لون المعدن، حجر، ستايل…) */
  tag: string;
}

const initialFilters: Filters = {
  q: "", karat: "all", branchId: "all", categoryId: "all", status: "all", minWeight: "", maxWeight: "", tag: "",
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

/** تنظيف نص البحث من الرموز التي تُفسد صياغة فلتر PostgREST. */
const sanitizeTerm = (s: string) => s.replace(/[,(){}"\\]/g, " ").trim();

const PAGE_SIZE = 48;

export default function ProductSearch() {
  const { profile, roles } = useAuth();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<Filters>(loadSavedFilters);
  const [debounced, setDebounced] = useState(filters);
  const [pages, setPages] = useState(1); // كم صفحة تم تحميلها
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Bulk selection mode
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<ProductStatus | "">("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const isAdmin = roles.includes("admin");

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());
  const exitSelection = () => { setSelectionMode(false); clearSelection(); };

  const refreshProducts = () => queryClient.invalidateQueries({ queryKey: ["products"] });

  const applyBulkStatus = async () => {
    if (!bulkStatus || selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      const ids = Array.from(selectedIds);
      const { error } = await supabase.from("products").update({ status: bulkStatus }).in("id", ids);
      if (error) throw error;
      toast.success(`تم تحديث ${ids.length} قطعة إلى: ${PRODUCT_STATUS[bulkStatus].label}`);
      exitSelection();
      setBulkStatus("");
      refreshProducts();
    } catch (e: any) {
      toast.error(e.message ?? "تعذّر التحديث الجماعي");
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`حذف ${selectedIds.size} قطعة نهائياً؟ لا يمكن التراجع.`)) return;
    setBulkBusy(true);
    try {
      const ids = Array.from(selectedIds);
      const { error } = await supabase.from("products").delete().in("id", ids);
      if (error) throw error;
      toast.success(`تم حذف ${ids.length} قطعة`);
      exitSelection();
      refreshProducts();
    } catch (e: any) {
      toast.error(e.message ?? "تعذّر الحذف");
    } finally {
      setBulkBusy(false);
    }
  };

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
      setPages(1); // reset pagination on filter change
      try { localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(filters)); } catch {}
    }, 250);
    return () => clearTimeout(t);
  }, [filters]);

  // اختصار: اضغط "/" لتركيز شريط البحث بسرعة
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { data: branches } = useQuery({
    queryKey: ["branches"],
    queryFn: async () => (await supabase.from("branches").select("id,name").order("name")).data ?? [],
  });

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await supabase.from("categories").select("id,name").order("sort_order")).data ?? [],
  });

  // وسوم الذكاء الاصطناعي المتاحة (لون المعدن، أحجار، ستايل…) لعرضها كفلاتر سريعة
  const { data: aiTags } = useQuery({
    queryKey: ["ai-tags"],
    queryFn: async () => {
      const { data } = await supabase
        .from("products")
        .select("search_tags")
        .not("search_tags", "eq", "{}")
        .limit(500);
      const counts = new Map<string, number>();
      for (const row of data ?? []) {
        for (const t of (row.search_tags ?? []) as string[]) {
          counts.set(t, (counts.get(t) ?? 0) + 1);
        }
      }
      return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 14)
        .map(([tag, count]) => ({ tag, count }));
    },
  });

  // Image-search results — when set, overrides normal query with similarity-ranked matches.
  const [similarMatches, setSimilarMatches] = useState<{ product_id: string; similarity: number }[] | null>(null);
  const similarIds = useMemo(() => similarMatches?.map((m) => m.product_id) ?? null, [similarMatches]);

  // "قطع مشابهة" من صفحة القطعة: /?similar=<productId> — يستخدم البصمة المحفوظة (بدون تحليل جديد)
  const [searchParams, setSearchParams] = useSearchParams();
  const similarTo = searchParams.get("similar");
  const [similarLoading, setSimilarLoading] = useState(false);
  useEffect(() => {
    if (!similarTo) return;
    let cancelled = false;
    (async () => {
      setSimilarLoading(true);
      const { data, error } = await supabase.rpc("match_similar_products", {
        _product_id: similarTo,
        match_count: 24,
      });
      if (cancelled) return;
      setSimilarLoading(false);
      if (error) {
        toast.error("تعذّر جلب القطع المشابهة");
        return;
      }
      const matches = (data ?? [])
        .filter((m: any) => m.similarity >= 0.55)
        .map((m: any) => ({ product_id: m.product_id, similarity: m.similarity }));
      setSimilarMatches(matches);
      if (!matches.length) toast.info("لا توجد قطع مشابهة مفهرسة بعد");
    })();
    return () => { cancelled = true; };
  }, [similarTo]);

  const clearSimilar = () => {
    setSimilarMatches(null);
    if (similarTo) {
      const next = new URLSearchParams(searchParams);
      next.delete("similar");
      setSearchParams(next, { replace: true });
    }
  };

  const { data: products, isLoading, isFetching } = useQuery({
    queryKey: ["products", debounced, similarIds, similarIds ? 0 : pages],
    queryFn: async () => {
      const SELECT =
        "id,name,sku,karat,weight_grams,ring_size,sale_price,promo_price,status,branch_id,search_tags,description,category_id,branch:branches(name),category:categories(name),images:product_images(storage_path,is_primary)";

      const applyFilters = (q: any) => {
        if (debounced.tag) q = q.contains("search_tags", [debounced.tag]);
        if (debounced.karat !== "all") q = q.eq("karat", debounced.karat);
        if (debounced.branchId !== "all") q = q.eq("branch_id", debounced.branchId);
        if (debounced.categoryId !== "all") q = q.eq("category_id", debounced.categoryId);
        if (debounced.status !== "all") q = q.eq("status", debounced.status as ProductStatus);
        if (debounced.minWeight) q = q.gte("weight_grams", parseFloat(debounced.minWeight));
        if (debounced.maxWeight) q = q.lte("weight_grams", parseFloat(debounced.maxWeight));
        return q;
      };

      if (similarIds && similarIds.length > 0) {
        const { data, error } = await supabase.from("products").select(SELECT).in("id", similarIds).limit(120);
        if (error) throw error;
        const idx = new Map(similarIds.map((id, i) => [id, i]));
        return [...(data ?? [])].sort((a: any, b: any) => (idx.get(a.id) ?? 999) - (idx.get(b.id) ?? 999));
      }

      const raw = sanitizeTerm(debounced.q);

      // بحث نصي ذكي: مرادفات + تسامح مع الأخطاء الإملائية واللهجة
      if (raw) {
        const { terms } = expandQuery(raw);
        const orParts: string[] = [];
        for (const t of terms) {
          if (t.length < 2) continue;
          orParts.push(`name.ilike.%${t}%`, `description.ilike.%${t}%`, `sku.ilike.%${t}%`, `serial_number.ilike.%${t}%`, `barcode_value.ilike.%${t}%`);
        }
        const tagArray = `{${terms.filter((t) => t.length >= 2).map((t) => `"${t}"`).join(",")}}`;
        if (terms.length) orParts.push(`search_tags.ov.${tagArray}`);

        const [hitRes, poolRes] = await Promise.all([
          applyFilters(supabase.from("products").select(SELECT))
            .or(orParts.join(","))
            .order("created_at", { ascending: false })
            .limit(200),
          // مجموعة احتياطية للمطابقة التقريبية (حروف ناقصة/كتابة ليبية)
          applyFilters(supabase.from("products").select(SELECT))
            .order("created_at", { ascending: false })
            .limit(800),
        ]);
        if (hitRes.error) throw hitRes.error;

        const byId = new Map<string, any>();
        for (const p of (hitRes.data ?? []) as any[]) byId.set(p.id, p);
        for (const p of ((poolRes.data ?? []) as any[])) if (!byId.has(p.id)) byId.set(p.id, p);

        const scored = Array.from(byId.values())
          .map((p) => ({ p, s: matchScore(p, raw) }))
          .filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s);

        return scored.map((x) => x.p);
      }

      const { data, error } = await applyFilters(supabase.from("products").select(SELECT))
        .order("created_at", { ascending: false })
        .range(0, pages * PAGE_SIZE - 1);
      if (error) throw error;
      return data ?? [];
    },
    placeholderData: (prev) => prev,
  });


  // هل يمكن تحميل المزيد؟ (يقتصر على البحث العادي، ليس على بحث الصورة)
  const hasMore = !similarIds && !sanitizeTerm(debounced.q) && (products?.length ?? 0) >= pages * PAGE_SIZE;

  // Infinite scroll — عند اقتراب حافة الصفحة، حمّل الصفحة التالية
  useEffect(() => {
    if (!sentinelRef.current || !hasMore || isFetching) return;
    const el = sentinelRef.current;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) setPages((p) => p + 1);
    }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, isFetching]);

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
    if (filters.tag) n++;
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
            <span className="text-[11px] text-primary-foreground/80">{roleLabel} · مخرّم</span>
          </div>

          <div className="flex gap-2 mt-4">
            <div className="relative flex-1">
              <SearchIcon className="absolute right-3 top-1/2 -translate-y-1/2 size-5 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                placeholder="ابحث: خاتم، سلسلة، 21K... (اضغط / للتركيز)"
                value={filters.q}
                onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
                className="pr-10 pl-10 h-12 text-base bg-card border-0 shadow-card"
                enterKeyHint="search"
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
        {(filters.karat !== "all" || filters.categoryId !== "all" || filters.branchId !== "all" || filters.status !== "all" || filters.minWeight || filters.maxWeight || filters.tag) && (
          <Chip onClick={() => setFilters(initialFilters)} active={false}>
            <X className="size-3 inline" /> مسح
          </Chip>
        )}
      </div>

      {/* وسوم الذكاء الاصطناعي — مستخرجة تلقائياً من تحليل صور القطع */}
      {aiTags && aiTags.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground flex items-center gap-1 px-1">
            <Sparkles className="size-3 text-primary" /> وسوم مكتشفة بالذكاء الاصطناعي
          </p>
          <div className="flex gap-2 overflow-x-auto -mx-3 px-3 pb-1 scrollbar-none">
            {aiTags.map(({ tag, count }) => (
              <Chip
                key={tag}
                active={filters.tag === tag}
                onClick={() => setFilters((f) => ({ ...f, tag: f.tag === tag ? "" : tag }))}
              >
                {tag} <span className="opacity-60">{count}</span>
              </Chip>
            ))}
          </div>
        </div>
      )}

      {similarLoading && (
        <div className="flex items-center gap-2 rounded-xl bg-gold-soft border border-primary/20 px-3 py-2 text-sm">
          <Loader2 className="size-4 animate-spin text-primary" />
          جارٍ البحث عن قطع مشابهة…
        </div>
      )}

      {similarIds !== null && similarityBuckets && (
        <div className="flex items-center justify-between rounded-xl bg-gold-soft border border-primary/20 px-3 py-2">
          <div className="flex items-center gap-2 text-sm flex-wrap">
            <Sparkles className="size-4 text-primary" />
            <span className="font-semibold">{similarTo ? "قطع مشابهة لهذه القطعة" : "بحث بالصورة"}</span>
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
          <Button size="sm" variant="ghost" onClick={clearSimilar}>
            <X className="size-4 ml-1" /> إلغاء
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {isLoading ? "جارٍ..." : `${products?.length ?? 0} نتيجة`}
          {selectionMode && selectedIds.size > 0 && (
            <span className="mr-2 text-primary font-semibold">· {selectedIds.size} محدّدة</span>
          )}
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={selectionMode ? "default" : "outline"}
            onClick={() => (selectionMode ? exitSelection() : setSelectionMode(true))}
            className={selectionMode ? "bg-primary text-primary-foreground" : ""}
          >
            <CheckSquare className="size-4 ml-1" />
            {selectionMode ? "إلغاء التحديد" : "تحديد متعدد"}
          </Button>
          <Link to="/products/new">
            <Button size="sm" className="bg-gold-gradient text-primary-foreground shadow-gold">
              <Plus className="size-4 ml-1" /> إضافة قطعة
            </Button>
          </Link>
        </div>
      </div>

      {/* Bulk actions bar — sticky when items selected */}
      {selectionMode && selectedIds.size > 0 && (
        <div className="sticky top-2 z-30 rounded-2xl bg-card border border-primary/30 shadow-elevated p-3 flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold px-2">
            {selectedIds.size} قطعة محدّدة
          </span>
          <Select value={bulkStatus} onValueChange={(v) => setBulkStatus(v as ProductStatus)}>
            <SelectTrigger className="h-9 w-40">
              <SelectValue placeholder="تغيير الحالة إلى…" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PRODUCT_STATUS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={applyBulkStatus} disabled={!bulkStatus || bulkBusy}>
            {bulkBusy ? <Loader2 className="size-4 animate-spin" /> : "تطبيق"}
          </Button>
          {isAdmin && (
            <Button size="sm" variant="destructive" onClick={bulkDelete} disabled={bulkBusy}>
              <Trash2 className="size-4 ml-1" /> حذف
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={clearSelection} disabled={bulkBusy}>
            مسح التحديد
          </Button>
        </div>
      )}

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
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {products.map((p: any) => (
              <ProductCard
                key={p.id}
                product={p}
                selectable={selectionMode}
                selected={selectedIds.has(p.id)}
                onToggleSelect={toggleSelect}
                onStatusChanged={refreshProducts}
              />
            ))}
          </div>
          {hasMore && (
            <div ref={sentinelRef} className="py-6 flex items-center justify-center text-xs text-muted-foreground">
              {isFetching ? "جارٍ تحميل المزيد…" : "مرّر للأسفل لتحميل المزيد"}
            </div>
          )}
          {!hasMore && !similarIds && (products?.length ?? 0) > PAGE_SIZE && (
            <p className="text-center text-xs text-muted-foreground py-4">— لا مزيد من النتائج —</p>
          )}
        </>
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
