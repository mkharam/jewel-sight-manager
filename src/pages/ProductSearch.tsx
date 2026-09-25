import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams, useNavigationType } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { deleteProducts } from "@/lib/productImages";
import { useAuth } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search as SearchIcon, Plus, SlidersHorizontal, X, Sparkles, Store, CheckSquare, Trash2, Loader2, ArrowUpDown, ChevronDown, Coins } from "lucide-react";
import ProductCard, { MATCH_TIER_META, type PhotoMatchTier } from "@/components/ProductCard";
import { useLatestQuotes } from "@/hooks/useLatestQuotes";
import { useGoldPrices } from "@/hooks/useGoldPrices";
import ImageSearchButton from "@/components/ImageSearchButton";
import AiAssistantSheet from "@/components/AiAssistantSheet";
import MissingWeightsBanner from "@/components/MissingWeightsBanner";
import MySalesCard from "@/components/MySalesCard";
import MyWorkCard from "@/components/MyWorkCard";
import { useConfirm } from "@/components/ConfirmDialogProvider";
import { invalidateInventoryAndSales } from "@/lib/queryInvalidation";
import { PRODUCT_STATUS, KARAT_OPTIONS, ProductStatus, formatCurrency } from "@/lib/constants";
import { GOLD_COLORS, STONE_COLORS } from "@/lib/luxury";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { expandQuery, matchScore } from "@/lib/arabic-search";
import { clearResume, readResume, saveResume } from "@/lib/resume";

interface Filters {
  q: string;
  karat: string;
  goldColor: string;
  stoneColor: string;
  branchId: string;
  categoryId: string;
  status: string;
  minWeight: string;
  maxWeight: string;
  /** وسم من تحليل الذكاء الاصطناعي (لون المعدن، حجر، ستايل…) */
  tag: string;
  /** ترتيب حسب تاريخ الإضافة: الأحدث أولاً أو الأقدم أولاً */
  sortDir: "desc" | "asc";
}

const initialFilters: Filters = {
  q: "", karat: "all", goldColor: "all", stoneColor: "all", branchId: "all", categoryId: "all", status: "all", minWeight: "", maxWeight: "", tag: "", sortDir: "desc",
};

const UNASSIGNED_BRANCH = "__unassigned__";

// نحفظ مكان الموظف في نتائج البحث (الفلاتر، عدد الصفحات المحمَّلة، موضع التمرير، ونتائج
// البحث بالصورة) — بحيث لما يرجع يجد نفس مكانه بالظبط، لا أول الصفحة بفلاتر فاضية.
// نستعيد فقط عند "رجوع" (POP): زر الرجوع من قطعة، أو عودة من الواتساب حتى لو قتل آيفون
// التطبيق في الخلفية. الفتح بعد مدة طويلة يبقى بداية نظيفة — راجع src/lib/resume.ts.
type PhotoMatchState = {
  product_id: string;
  similarity: number;
  visual?: number | null;
  textual?: number | null;
  kind?: string;
  reasons?: string[];
};
type SavedScrollState = { filters: Filters; pages: number; scrollY: number };
// نتائج البحث بالصورة تُحفظ منفصلة عن موضع التمرير: صورة الزبون (~150KB) و140 نتيجة كانت
// تُعاد كتابتها مع كل إطار تمرير (حتى 60 مرة بالثانية) فتُقطّع التمرير على الآيفون. هذه
// تُكتب فقط حين تتغيّر، وموضع التمرير يبقى خفيفاً.
type SavedPhotoState = {
  similarMatches: PhotoMatchState[] | null;
  /** صورة الزبون (data URL مضغوطة) — تُثبَّت فوق النتائج للمقارنة. */
  photoQuery: string | null;
};

// ترتيب المستويات في العرض، ونصوص الأقسام. "similar" قيمة قديمة من استجابات مخزّنة قبل
// المستويات الأربعة — تُعامَل كـ"قريبة جداً".
const TIER_ORDER: PhotoMatchTier[] = ["exact", "very_close", "similar_look", "same_attributes", "might_like"];
const TIER_SECTION: Record<PhotoMatchTier, { title: string; subtitle: string }> = {
  exact: { title: "🎯 مطابقة", subtitle: "نفس التصميم — موجود في المخزون" },
  very_close: { title: "✨ قريبة جداً", subtitle: "تصميم قريب جداً — أقرب بديل للزبون" },
  similar_look: { title: "👀 شكل مشابه", subtitle: "نفس الفكرة والشكل العام" },
  same_attributes: { title: "🎨 نفس الأوصاف", subtitle: "نفس لون الذهب أو الأحجار أو الطراز — خيارات إضافية" },
  might_like: { title: "💡 قطع ممكن تعجب الزبون", subtitle: "ذوق قريب من طلبه — اقترحها إن لم يجد ما يريده بالضبط" },
};
// الأقسام الطويلة تبدأ مطوية على الآيفون: أول 12 قطعة وزر "عرض الكل" — بدل تمرير ~80 قطعة
// قبل الوصول لقسم ممكن تعجبه.
const TIER_INITIAL: Partial<Record<PhotoMatchTier, number>> = { similar_look: 12, same_attributes: 12, might_like: 12 };
const toTier = (kind: string | undefined): PhotoMatchTier =>
  kind === "exact" || kind === "very_close" || kind === "similar_look" || kind === "same_attributes" || kind === "might_like"
    ? kind
    : kind === "similar" ? "very_close" : "same_attributes";

/** تنظيف نص البحث من الرموز التي تُفسد صياغة فلتر PostgREST. */
const sanitizeTerm = (s: string) => s.replace(/[,(){}"\\]/g, " ").trim();

const PAGE_SIZE = 48;

export default function ProductSearch() {
  const { profile, roles } = useAuth();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  // "رجوع" فعلي من صفحة تفاصيل قطعة (POP) يستعيد الفلاتر/عدد الصفحات المحفوظة؛ أي دخول
  // آخر (فتح جديد، رابط مباشر) يبدأ فاضياً كالمعتاد. راجع SavedScrollState أعلى الملف.
  const navigationType = useNavigationType();
  const restoredState = useRef(navigationType === "POP" ? readResume<SavedScrollState>("search") : null).current;
  const restoredPhoto = useRef(navigationType === "POP" ? readResume<SavedPhotoState>("searchPhoto") : null).current;
  const [filters, setFilters] = useState<Filters>(restoredState?.filters ?? initialFilters);
  const [debounced, setDebounced] = useState(filters);
  const [pages, setPages] = useState(restoredState?.pages ?? 1); // كم صفحة تم تحميلها
  // موضع التمرير المطلوب استعادته بعد اكتمال تحميل نفس عدد الصفحات — يُستهلك مرة واحدة.
  const pendingScrollRestore = useRef(restoredState?.scrollY ?? null);
  const [showAiTags, setShowAiTags] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Bulk selection mode
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<ProductStatus | "">("");
  const [bulkBranch, setBulkBranch] = useState<string>("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const isAdmin = roles.includes("admin");
  const isManager = roles.includes("manager");
  // التعديل الجماعي (حالة/فرع) للمدير العام والمشرف فقط — الموظف لا يعدّل شيئاً.
  const canBulkEdit = isAdmin || isManager;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());
  const exitSelection = () => { setSelectionMode(false); clearSelection(); };

  // التعديل الجماعي يغيّر حالة/فرع عدة قطع دفعة واحدة — يستدعي نفس التحديث الشامل حتى
  // تنعكس النتيجة على تنبيه نقص المخزون وبقية الشاشات لا على هذه القائمة وحدها.
  const refreshProducts = () => invalidateInventoryAndSales(queryClient);

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

  const applyBulkBranch = async () => {
    if (!bulkBranch || selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      const ids = Array.from(selectedIds);
      const { error } = await supabase.from("products").update({ branch_id: bulkBranch }).in("id", ids);
      if (error) throw error;
      const branchName = branches?.find((b) => b.id === bulkBranch)?.name ?? "";
      toast.success(`تم تعيين ${ids.length} قطعة إلى فرع: ${branchName}`);
      exitSelection();
      setBulkBranch("");
      refreshProducts();
    } catch (e: any) {
      toast.error(e.message ?? "تعذّر تعيين الفرع");
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const ok = await confirm({
      title: `حذف ${selectedIds.size} قطعة نهائياً؟`,
      description: "لا يمكن التراجع عن هذا الإجراء.",
      confirmLabel: "حذف نهائي",
      destructive: true,
    });
    if (!ok) return;
    setBulkBusy(true);
    try {
      const ids = Array.from(selectedIds);
      await deleteProducts(ids);
      toast.success(`تم حذف ${ids.length} قطعة`);
      exitSelection();
      refreshProducts();
    } catch (e: any) {
      toast.error(e.message ?? "تعذّر الحذف");
    } finally {
      setBulkBusy(false);
    }
  };

  // سعر الغرام في صدر الصفحة: المعلومة الوحيدة التي يحتاجها الموظف طوال اليوم ليحسب
  // سعراً لزبون، وهي رقم واحد لا يكشف سعر قطعة بعينها لو نظر الزبون إلى الشاشة —
  // بخلاف عرض سعر كل قطعة في الكتالوق الذي يستطيع المالك إطفاءه.
  const { data: goldPrices } = useGoldPrices();
  const goldRates = Array.from(goldPrices?.values() ?? []).sort((a, b) => a.karat.localeCompare(b.karat));

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 5) return "ساعة طيبة";
    if (h < 12) return "صباح الخير";
    if (h < 18) return "مساء الخير";
    return "مساء النور";
  }, []);
  const roleLabel = roles.includes("admin") ? "مدير عام" : roles.includes("manager") ? "مدير فرع" : "موظف";

  // أول تشغيل بعد استعادة حالة "رجوع" لا يجب أن يصفّر pages إلى 1 — debounced وpages
  // مضبوطان مسبقاً من restoredState في التهيئة، فتصفيرهما هنا كان سيُبطل الاستعادة
  // بعد 250ms فقط من الوصول.
  const isFirstFilterRun = useRef(true);
  useEffect(() => {
    if (isFirstFilterRun.current) {
      isFirstFilterRun.current = false;
      return;
    }
    const t = setTimeout(() => {
      setDebounced(filters);
      setPages(1); // reset pagination on filter change
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
  const [similarMatches, setSimilarMatches] = useState<PhotoMatchState[] | null>(restoredPhoto?.similarMatches ?? null);
  const [photoQuery, setPhotoQuery] = useState<string | null>(restoredPhoto?.photoQuery ?? null);
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
      // نفس المستويات والأسباب التي يستخدمها البحث بالصورة (match_products_tiered) — كانت هذه
      // تستخدم عتبة ثابتة تجعل كل المخزون تقريباً "مشابهاً".
      const { data, error } = await (supabase.rpc as any)("match_products_tiered", {
        anchor_product: similarTo,
        max_results: 140,
      });
      if (cancelled) return;
      setSimilarLoading(false);
      if (error) {
        toast.error("تعذّر جلب القطع المشابهة");
        return;
      }
      const matches: PhotoMatchState[] = ((data ?? []) as any[]).map((m) => ({
        product_id: m.product_id,
        similarity: m.score,
        visual: m.visual,
        textual: m.textual,
        kind: m.kind,
        reasons: m.reasons ?? [],
      }));
      setPhotoQuery(null);
      setSimilarMatches(matches);
      if (!matches.length) toast.info("لا توجد قطع مشابهة مفهرسة بعد");
    })();
    return () => { cancelled = true; };
  }, [similarTo]);

  const clearSimilar = () => {
    setSimilarMatches(null);
    setPhotoQuery(null);
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
        "id,name,sku,barcode_value,karat,gold_color,weight_grams,ring_size,sale_price,promo_price,status,branch_id,search_tags,description,category_id,created_at,branch:branches(name),category:categories(name),images:product_images(storage_path,thumb_path,is_primary)";
      const sortAsc = debounced.sortDir === "asc";

      // لون الحجر مُخزَّن في جدول product_stones منفصل (لا عمود مباشر على products) —
      // نجلب مسبقاً معرّفات القطع المطابقة مرة واحدة ثم نستخدمها كفلتر .in() عادي.
      let stoneProductIds: string[] | null = null;
      if (debounced.stoneColor !== "all") {
        const { data: stoneRows } = await supabase
          .from("product_stones")
          .select("product_id")
          .eq("color", debounced.stoneColor);
        stoneProductIds = Array.from(new Set((stoneRows ?? []).map((r: any) => r.product_id)));
        if (!stoneProductIds.length) return [];
      }

      const applyFilters = (q: any) => {
        if (debounced.tag) q = q.contains("search_tags", [debounced.tag]);
        if (debounced.karat !== "all") q = q.eq("karat", debounced.karat);
        if (debounced.goldColor !== "all") q = q.eq("gold_color", debounced.goldColor);
        if (stoneProductIds) q = q.in("id", stoneProductIds);
        if (debounced.branchId === UNASSIGNED_BRANCH) q = q.is("branch_id", null);
        else if (debounced.branchId !== "all") q = q.eq("branch_id", debounced.branchId);
        if (debounced.categoryId !== "all") q = q.eq("category_id", debounced.categoryId);
        // المؤرشف خارج الكتالوق: الأرشفة كانت بلا أثر عملي — القطعة المؤرشفة تبقى في
        // نتائج البحث وفي البحث بالصورة كأن شيئاً لم يكن. تظهر فقط عند اختيار «مؤرشف»
        // صراحةً من فلتر الحالة، فتصير الأرشفة طريقة عكوسة لإخراج بضاعة من التداول.
        if (debounced.status !== "all") q = q.eq("status", debounced.status as ProductStatus);
        else q = q.neq("status", "archived" as ProductStatus);
        if (debounced.minWeight) q = q.gte("weight_grams", parseFloat(debounced.minWeight));
        if (debounced.maxWeight) q = q.lte("weight_grams", parseFloat(debounced.maxWeight));
        return q;
      };

      if (similarIds && similarIds.length > 0) {
        // البحث بالصورة كان يتخطّى الفلاتر كلها، فتظهر فيه القطع المؤرشفة أيضاً.
        const { data, error } = await supabase
          .from("products").select(SELECT)
          .in("id", similarIds)
          .neq("status", "archived" as ProductStatus)
          .limit(120);
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

        // بحث دلالي (معنوي) عبر Gemini بالتوازي مع البحث النصي — يمسك عبارات لا توجد
        // حرفياً في قائمة المرادفات (مثلاً "أحجار موفيا") لأنه يقارن المعنى لا الكلمة.
        // best-effort تماماً: فشله أو بطؤه لا يُبطئ ولا يُفشل البحث النصي العادي إطلاقاً.
        const semanticPromise = supabase.functions
          .invoke("text-search", { body: { query: raw, matchCount: 40 } })
          .then((r) => (r.data as any)?.results as { product_id: string; similarity: number }[] | undefined)
          .catch(() => undefined);

        const [hitRes, poolRes, semanticResults] = await Promise.all([
          applyFilters(supabase.from("products").select(SELECT))
            .or(orParts.join(","))
            .order("created_at", { ascending: sortAsc })
            .limit(200),
          // مجموعة احتياطية للمطابقة التقريبية (حروف ناقصة/كتابة ليبية)
          applyFilters(supabase.from("products").select(SELECT))
            .order("created_at", { ascending: sortAsc })
            .limit(800),
          semanticPromise,
        ]);
        if (hitRes.error) throw hitRes.error;

        const byId = new Map<string, any>();
        for (const p of (hitRes.data ?? []) as any[]) byId.set(p.id, p);
        for (const p of ((poolRes.data ?? []) as any[])) if (!byId.has(p.id)) byId.set(p.id, p);

        const semanticScore = new Map<string, number>();
        for (const r of semanticResults ?? []) semanticScore.set(r.product_id, r.similarity);

        // قطع وُجدت دلالياً فقط (لم يلتقطها البحث النصي/المرادفات إطلاقاً) — نجلبها لنعرضها أيضاً.
        const missingIds = Array.from(semanticScore.keys()).filter((id) => !byId.has(id));
        if (missingIds.length) {
          const { data: extra } = await applyFilters(supabase.from("products").select(SELECT)).in("id", missingIds);
          for (const p of (extra ?? []) as any[]) byId.set(p.id, p);
        }

        // الترتيب الأساسي حسب دقة المطابقة (نصي أو دلالي، أيهما أعلى)، وعند تساوي الدقة
        // نرجّح حسب اتجاه التاريخ المختار.
        const scored = Array.from(byId.values())
          .map((p) => {
            const textScore = matchScore(p, raw);
            const semScore = (semanticScore.get(p.id) ?? 0) * 0.9; // خصم بسيط: المطابقة النصية الصريحة أوثق
            return { p, s: Math.max(textScore, semScore) };
          })
          .filter((x) => x.s > 0)
          .sort((a, b) => {
            if (b.s !== a.s) return b.s - a.s;
            const ta = new Date(a.p.created_at ?? 0).getTime();
            const tb = new Date(b.p.created_at ?? 0).getTime();
            return sortAsc ? ta - tb : tb - ta;
          });

        return scored.map((x) => x.p);
      }

      const { data, error } = await applyFilters(supabase.from("products").select(SELECT))
        .order("created_at", { ascending: sortAsc })
        .range(0, pages * PAGE_SIZE - 1);
      if (error) throw error;
      return data ?? [];
    },
    placeholderData: (prev) => prev,
  });


  // نحفظ الفلاتر/عدد الصفحات/موضع التمرير حتى يكون آخر موضع فعلي قبل فتح أي قطعة جاهزاً
  // للاستعادة عند "رجوع". راجع SavedScrollState أعلى الملف.
  //
  // مهم: الكتابة مخنوقة بـrequestAnimationFrame لا مع كل حدث تمرير. الكتابة المباشرة
  // (JSON.stringify + localStorage.setItem وكلاهما متزامن) كانت تعمل عشرات المرات في
  // الثانية على أكثر صفحة استخداماً في التطبيق، فتُسبّب تهنيجاً محسوساً أثناء التمرير على
  // هواتف متوسطة. rAF يضمن كتابة واحدة كحد أقصى لكل إطار رسم، والقيمة المحفوظة تبقى
  // محدَّثة لحظة مغادرة الصفحة وهو كل ما يهم للاستعادة.
  useEffect(() => {
    let frame = 0;
    const write = () => {
      frame = 0;
      try {
        saveResume<SavedScrollState>("search", { filters, pages, scrollY: window.scrollY });
      } catch {}
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(write);
    };
    write();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
      // كتابة أخيرة عند التفكيك: الإطار المعلَّق يُلغى أعلاه، فبدون هذه الكتابة قد تضيع
      // آخر حركة تمرير قبل فتح القطعة مباشرة — وهي بالضبط الحالة التي نستعيدها.
      write();
    };
  }, [filters, pages]);

  // نتائج الصورة تُحفظ فقط عند تغيّرها — راجع SavedPhotoState. فتح البحث من جديد (لا رجوع)
  // يبدأ بلا نتائج فيمسح المحفوظ، فلا تعود نتائج قديمة لاحقاً بالغلط.
  useEffect(() => {
    if (!similarMatches && !photoQuery) clearResume("searchPhoto");
    else saveResume<SavedPhotoState>("searchPhoto", { similarMatches, photoQuery });
  }, [similarMatches, photoQuery]);

  // استعادة موضع التمرير مرة واحدة فقط بعد أن يحمّل عدد الصفحات المستعاد فعلياً (وإلا
  // نُمرّر لمكان لم يُحمَّل بعد المحتوى الذي يشغله). تُستهلك (تُصفَّر) فور التنفيذ.
  useEffect(() => {
    if (pendingScrollRestore.current == null) return;
    // isFetching (لا isLoading فقط) يغطي أيضاً استكمال تحميل الصفحات الإضافية
    // المستعادة (pages > 1)، لا الصفحة الأولى فقط.
    if (isLoading || isFetching || !products) return;
    const y = pendingScrollRestore.current;
    pendingScrollRestore.current = null;
    requestAnimationFrame(() => window.scrollTo(0, y));
  }, [isLoading, isFetching, products]);

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

  // آخر سعر أُعطي لزبون في كل قطعة معروضة — استعلام واحد للصفحة كلها، يغطّي النتائج
  // العادية ونتائج البحث بالصورة معاً لأن كليهما يخرج من نفس مصفوفة products.
  const visibleIds = useMemo(() => (products ?? []).map((p: any) => p.id), [products]);
  const { data: latestQuotes } = useLatestQuotes(visibleIds);

  // Group products by similarity bucket when in photo-search mode
  const similarityBuckets = useMemo(() => {
    if (!similarMatches || !products) return null;
    // التصنيف يعتمد على تصنيف الخادم (kind) المبني على التشابه البصري تحديداً، لا على
    // الدرجة المركّبة — وإلا صارت قطعة تشترك في الوصف فقط تظهر تحت "مطابقة تماماً".
    // نسقط للعتبات القديمة إن غاب kind (استجابة قديمة مخزّنة مثلاً).
    const byId = new Map(similarMatches.map((m) => [m.product_id, m]));
    const buckets: Record<PhotoMatchTier, any[]> = { exact: [], very_close: [], similar_look: [], same_attributes: [], might_like: [] };
    // products مرتّبة أصلاً بترتيب الخادم (الأقرب أولاً) — نحافظ عليه داخل كل مستوى.
    for (const p of products as any[]) {
      const m = byId.get(p.id);
      if (!m) continue;
      const tier = toTier(m.kind);
      buckets[tier].push({ ...p, _match: { tier, reasons: m.reasons ?? [] } });
    }
    // المتوفر أولاً داخل كل مستوى: الزبون يريد قطعة يأخذها اليوم، والمبيع/المحجوز يبقى ظاهراً
    // بعدها (مفيد لطلب نسخة مشابهة) بدل أن يُخفى.
    for (const t of TIER_ORDER) {
      buckets[t] = buckets[t]
        .map((p, i) => ({ p, i }))
        .sort((a, b) => Number(b.p.status === "available") - Number(a.p.status === "available") || a.i - b.i)
        .map(({ p }) => p);
    }
    return buckets;
  }, [similarMatches, products]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.karat !== "all") n++;
    if (filters.goldColor !== "all") n++;
    if (filters.stoneColor !== "all") n++;
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
      {/* بطاقة الترحيب = هوية المتجر نفسها: حرير زمرّدي وخيوط ذهبية ونص ذهبي */}
      <div className="relative overflow-hidden rounded-3xl brand-silk shadow-emerald p-3.5 md:p-6">
        <div className="absolute -top-12 -left-12 size-40 rounded-full bg-primary/10 blur-2xl pointer-events-none" />
        <div className="absolute -bottom-16 -right-10 size-44 rounded-full bg-primary/10 blur-2xl pointer-events-none" />
        {/* خيط ذهبي رفيع يعبر البطاقة كما في الشعار */}
        <div className="absolute inset-x-0 bottom-8 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent pointer-events-none" />
        <div className="relative">
          {/* الترحيب في سطر واحد بدل ثلاثة: كان يأخذ خُمس الشاشة على الهاتف بلا أي معلومة
              يحتاجها الموظف يومياً، فيُدفع أول صف قطع بالكامل خارج الشاشة. الهوية الذهبية
              محفوظة، فقط بحجم يليق بمعلومة ثانوية. */}
          <div className="flex items-center justify-between gap-2 mb-2.5 flex-wrap">
            <p className="text-sm font-bold text-gold-gradient truncate">
              {greeting}، {profile?.full_name ?? "—"}
            </p>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/15 backdrop-blur text-primary text-[10px] font-semibold border border-primary/25 shrink-0">
              <Store className="size-2.5" />
              {myBranchName ?? "بدون فرع"} · {roleLabel}
            </span>
          </div>

          {goldRates.length > 0 && (
            <div className="flex items-center gap-1.5 mb-2.5 flex-wrap">
              <Coins className="size-3.5 text-primary shrink-0" />
              <span className="text-[11px] text-muted-foreground">سعر الغرام اليوم</span>
              {goldRates.map((r) => (
                <span
                  key={r.karat}
                  className="inline-flex items-baseline gap-1 px-2 py-0.5 rounded-lg bg-gold-soft border border-primary/20 text-[11px] font-bold"
                >
                  <span className="text-muted-foreground font-semibold">{r.karat}</span>
                  <span className="text-primary" dir="ltr">{formatCurrency(r.price_per_gram)}</span>
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2.5">
            <div className="relative flex items-center gap-2">
              <div className="relative flex-1">
                <SearchIcon className="absolute right-4 top-1/2 -translate-y-1/2 size-5 text-muted-foreground" />
                <Input
                  ref={searchInputRef}
                  placeholder="ابحث: خاتم، سلسلة، 21K... (اضغط / للتركيز)"
                  value={filters.q}
                  onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
                  className="pr-11 pl-11 h-16 text-lg md:text-xl font-medium rounded-2xl bg-card text-foreground caret-primary border-0 shadow-card"
                  enterKeyHint="search"
                />
                {filters.q && (
                  <button
                    type="button"
                    onClick={() => setFilters((f) => ({ ...f, q: "" }))}
                    className="absolute left-3 top-1/2 -translate-y-1/2 p-1.5 rounded-full hover:bg-muted text-muted-foreground"
                    aria-label="مسح البحث"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
              <ImageSearchButton
                variant="icon"
                className="size-16 shrink-0"
                categories={categories ?? undefined}
                onResults={({ matches, photo }) => {
                  setPhotoQuery(photo);
                  setSimilarMatches(matches.length > 0 ? matches : []);
                  window.scrollTo({ top: 0 });
                }}
              />
            </div>
          <div className="grid grid-cols-2 gap-2">
          <AiAssistantSheet className="h-12" />
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="lg" className="relative h-12 w-full">
                <SlidersHorizontal className="size-4 ml-1.5" />
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
                <FilterField label="لون الذهب">
                  <Select value={filters.goldColor} onValueChange={(v) => setFilters((f) => ({ ...f, goldColor: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">كل الألوان</SelectItem>
                      {GOLD_COLORS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FilterField>
                <FilterField label="لون الحجر">
                  <Select value={filters.stoneColor} onValueChange={(v) => setFilters((f) => ({ ...f, stoneColor: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">كل ألوان الأحجار</SelectItem>
                      {STONE_COLORS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FilterField>
                <FilterField label="الفرع">
                  <Select value={filters.branchId} onValueChange={(v) => setFilters((f) => ({ ...f, branchId: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">كل الفروع</SelectItem>
                      <SelectItem value={UNASSIGNED_BRANCH}>بدون فرع (بانتظار التعيين)</SelectItem>
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
      </div>

      <MissingWeightsBanner />
      <MySalesCard />
      <MyWorkCard />

      {/* فلاتر سريعة Chips */}
      <div className="flex gap-2 overflow-x-auto -mx-3 px-3 pb-1 scrollbar-none">
        {/* "متوفر" أولاً: حين يقف زبون أمام الموظف لا تفيده القطع المبيعة أو المحجوزة. */}
        <Chip
          active={filters.status === "available"}
          onClick={() => setFilters((f) => ({ ...f, status: f.status === "available" ? "all" : "available" }))}
        >متوفر فقط</Chip>
        <div className="w-px bg-border mx-1 shrink-0" />
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
        {(filters.karat !== "all" || filters.goldColor !== "all" || filters.stoneColor !== "all" || filters.categoryId !== "all" || filters.branchId !== "all" || filters.status !== "all" || filters.minWeight || filters.maxWeight || filters.tag) && (
          <Chip onClick={() => setFilters(initialFilters)} active={false}>
            <X className="size-3 inline" /> مسح
          </Chip>
        )}
      </div>

      {/* وسوم الذكاء الاصطناعي — مطويّة افتراضياً: صفّان أفقيان متتاليان (الفلاتر السريعة
          ثم الوسوم) كانا يزاحمان أول صف قطع خارج الشاشة، والوسوم أداة استكشاف يُلجأ إليها
          أحياناً لا في كل فتحة. تُفتح بضغطة وتبقى مفتوحة ما دام الموظف يستخدمها، وتُفتح
          تلقائياً إن كان أحدها مُفعَّلاً فعلاً حتى لا يختفي فلتر شغّال عن عينه. */}
      {aiTags && aiTags.length > 0 && (
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => setShowAiTags((v) => !v)}
            className="text-[11px] text-muted-foreground flex items-center gap-1 px-1 hover:text-foreground transition-colors"
          >
            <Sparkles className="size-3 text-primary" />
            وسوم مكتشفة بالذكاء الاصطناعي
            <ChevronDown className={`size-3 transition-transform ${showAiTags || filters.tag ? "rotate-180" : ""}`} />
          </button>
          {(showAiTags || filters.tag) && (
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
          )}
        </div>
      )}

      {similarLoading && (
        <div className="flex items-center gap-2 rounded-xl bg-gold-soft border border-primary/20 px-3 py-2 text-sm">
          <Loader2 className="size-4 animate-spin text-primary" />
          جارٍ البحث عن قطع مشابهة…
        </div>
      )}

      {similarIds !== null && similarityBuckets && (
        // شريط ثابت أعلى الشاشة على الآيفون: صورة الزبون للمقارنة بنظرة، وأزرار المستويات
        // بعددها تنقل مباشرة لقسمها بدل التمرير الطويل بين عشرات القطع.
        <div className="sticky top-[calc(env(safe-area-inset-top)+3.5rem)] sm:top-[calc(env(safe-area-inset-top)+4rem)] z-20 -mx-3 px-3 sm:-mx-4 sm:px-4 lg:-mx-6 lg:px-6 pt-2 pb-2 bg-background/95 backdrop-blur border-b border-border/60 space-y-2">
          <div className="flex items-center gap-3">
            {photoQuery ? (
              <img src={photoQuery} alt="صورة الزبون" className="size-14 shrink-0 rounded-xl object-cover border-2 border-primary/40" />
            ) : (
              <div className="size-14 shrink-0 rounded-xl bg-gold-soft flex items-center justify-center">
                <Sparkles className="size-6 text-primary" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm">{similarTo ? "قطع مشابهة لهذه القطعة" : "نتائج البحث بالصورة"}</p>
              <p className="text-[11px] text-muted-foreground">
                {TIER_ORDER.reduce((n, t) => n + similarityBuckets[t].length, 0)} خيار — المتوفر أولاً في كل قسم
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={clearSimilar} className="shrink-0">
              <X className="size-4 ml-1" /> إلغاء
            </Button>
          </div>
          <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1">
            {TIER_ORDER.filter((t) => similarityBuckets[t].length > 0).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => document.getElementById(`tier-${t}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className={`shrink-0 h-8 px-3 rounded-full text-xs font-bold shadow-sm active:scale-95 transition-transform ${MATCH_TIER_META[t].badge}`}
              >
                {MATCH_TIER_META[t].label} {similarityBuckets[t].length}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {isLoading ? "جارٍ..." : `${products?.length ?? 0} نتيجة`}
          {selectionMode && selectedIds.size > 0 && (
            <span className="mr-2 text-primary font-semibold">· {selectedIds.size} محدّدة</span>
          )}
        </p>
        {/* نصوص مختصرة على الهاتف: الثلاثة أزرار بنصوصها الكاملة كانت تلتف لسطرين وتدفع
            القطع للأسفل. الأيقونات تكفي هنا والنص الكامل يظهر على الشاشات الأوسع. */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setFilters((f) => ({ ...f, sortDir: f.sortDir === "desc" ? "asc" : "desc" }))}
            title={filters.sortDir === "desc" ? "الأحدث أولاً" : "الأقدم أولاً"}
          >
            <ArrowUpDown className="size-4 xs:ml-1" />
            <span className="hidden xs:inline">{filters.sortDir === "desc" ? "الأحدث أولاً" : "الأقدم أولاً"}</span>
          </Button>
          {canBulkEdit && (
            <Button
              size="sm"
              variant={selectionMode ? "default" : "outline"}
              onClick={() => (selectionMode ? exitSelection() : setSelectionMode(true))}
              className={selectionMode ? "bg-primary text-primary-foreground" : ""}
              title={selectionMode ? "إلغاء التحديد" : "تحديد متعدد"}
            >
              <CheckSquare className="size-4 xs:ml-1" />
              <span className="hidden xs:inline">{selectionMode ? "إلغاء التحديد" : "تحديد متعدد"}</span>
            </Button>
          )}
          <Link to="/upload">
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
          <Select value={bulkBranch} onValueChange={setBulkBranch}>
            <SelectTrigger className="h-9 w-40">
              <SelectValue placeholder="تعيين الفرع…" />
            </SelectTrigger>
            <SelectContent>
              {branches?.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={applyBulkBranch} disabled={!bulkBranch || bulkBusy}>
            {bulkBusy ? <Loader2 className="size-4 animate-spin" /> : "تعيين"}
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
            <div key={i} className="aspect-square rounded-xl skeleton" style={{ animationDelay: `${(i % 4) * 120}ms` }} />
          ))}
        </div>
      ) : similarityBuckets ? (
        <div className="space-y-6">
          {TIER_ORDER.filter((t) => similarityBuckets[t].length > 0).map((t) => (
            <SimilaritySection
              key={t}
              tier={t}
              title={TIER_SECTION[t].title}
              subtitle={TIER_SECTION[t].subtitle}
              products={similarityBuckets[t]}
              initialVisible={TIER_INITIAL[t]}
              quotes={latestQuotes}
            />
          ))}
          {TIER_ORDER.every((t) => similarityBuckets[t].length === 0) && (
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
                lastQuote={latestQuotes?.get(p.id) ?? null}
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
  tier,
  title,
  subtitle,
  products,
  initialVisible,
  quotes,
}: {
  tier: PhotoMatchTier;
  title: string;
  subtitle: string;
  products: any[];
  initialVisible?: number;
  quotes?: Map<string, import("@/hooks/useLatestQuotes").LatestQuote>;
}) {
  const [expanded, setExpanded] = useState(false);
  const limit = !expanded && initialVisible && products.length > initialVisible + 2 ? initialVisible : products.length;
  return (
    // scroll-mt: رأس التطبيق + شريط المستويات الثابت لا يغطيان عنوان القسم عند القفز إليه.
    <section id={`tier-${tier}`} className="scroll-mt-[calc(env(safe-area-inset-top)+11rem)]">
      <div className="mb-2 px-1">
        <h3 className="text-base font-bold flex items-center gap-2">
          {title}
          <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${MATCH_TIER_META[tier].badge}`}>{products.length}</span>
        </h3>
        <p className="text-[11px] text-muted-foreground">{subtitle}</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {products.slice(0, limit).map((p: any) => (
          <ProductCard key={p.id} product={p} match={p._match} lastQuote={quotes?.get(p.id) ?? null} />
        ))}
      </div>
      {limit < products.length && (
        <Button variant="outline" className="w-full h-11 mt-3" onClick={() => setExpanded(true)}>
          عرض الكل ({products.length})
          <ChevronDown className="size-4 mr-1" />
        </Button>
      )}
    </section>
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
