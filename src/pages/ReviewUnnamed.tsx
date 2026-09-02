// صفحة مراجعة القطع غير المسمّاة/غير المحلّلة — تعرض كل صورة مع نتيجة تحليلها الحالية
// (إن وُجدت) وتسمح بحفظ الاسم والحقول مباشرة، أو إعادة التحليل يدوياً إن كانت الصورة
// لم تُحلّل بعد (مثلاً بسبب انقطاع الاتصال أو فشل الذكاء الاصطناعي).
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, Loader2, RotateCw, Save, Sparkles, ExternalLink, Trash2, ArrowUpDown, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { KARAT_OPTIONS, getImageUrl } from "@/lib/constants";
import { prepareForAIBase64 } from "@/lib/image-compress";

const PLACEHOLDER_NAME = "قطعة جديدة";

type Row = {
  id: string;
  name: string;
  category_id: string | null;
  karat: string | null;
  item_type: string | null;
  description: string | null;
  images: { id: string; storage_path: string; ai_labels: any }[];
};

export default function ReviewUnnamed() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, Partial<Row>>>({});
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [reanalyzingIds, setReanalyzingIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc"); // desc = الأحدث أولاً
  // معرّفات القطع التي أُعيد تحليلها في هذه الجلسة، بترتيب الاكتمال (الأحدث اكتمالاً أولاً) —
  // نستخدمها لرفع القطعة المكتملة لأعلى القائمة فور جاهزيتها، لأن التحليل المتوازي الآن
  // لا يكتمل بنفس ترتيب البدء فيبقى الموظف تائهاً بدونها.
  const [justAnalyzedOrder, setJustAnalyzedOrder] = useState<string[]>([]);
  const [usage, setUsage] = useState<Record<string, { used: number; limit: number }> | null>(null);
  const [savingAll, setSavingAll] = useState(false);

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await supabase.from("categories").select("id,name").eq("is_active", true)).data ?? [],
  });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["unnamed-products", sortDir],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id,name,category_id,karat,item_type,description,images:product_images(id,storage_path,ai_labels)")
        .eq("name", PLACEHOLDER_NAME)
        .order("created_at", { ascending: sortDir === "asc" })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const draftFor = (row: Row): Row => ({ ...row, ...drafts[row.id] });

  const updateDraft = (id: string, patch: Partial<Row>) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));

  const save = async (row: Row) => {
    const draft = draftFor(row);
    if (!draft.name?.trim() || draft.name === PLACEHOLDER_NAME) {
      toast.error("اكتب اسماً حقيقياً للقطعة قبل الحفظ");
      return;
    }
    setSavingIds((s) => new Set(s).add(row.id));
    try {
      const { error } = await supabase
        .from("products")
        .update({
          name: draft.name.trim(),
          category_id: draft.category_id || null,
          karat: draft.karat || null,
          item_type: draft.item_type || null,
          description: draft.description || null,
        })
        .eq("id", row.id);
      if (error) throw error;
      toast.success("تم الحفظ");
      qc.setQueryData<Row[]>(["unnamed-products", sortDir], (prev) => (prev ?? []).filter((r) => r.id !== row.id));
      setJustAnalyzedOrder((prev) => prev.filter((id) => id !== row.id));
    } catch (e: any) {
      toast.error(e.message ?? "تعذّر الحفظ");
    } finally {
      setSavingIds((s) => {
        const next = new Set(s);
        next.delete(row.id);
        return next;
      });
    }
  };

  const reanalyze = async (row: Row) => {
    const img = row.images?.[0];
    if (!img) return toast.error("لا توجد صورة لهذه القطعة");
    setReanalyzingIds((s) => new Set(s).add(row.id));
    try {
      const url = getImageUrl(img.storage_path);
      if (!url) throw new Error("رابط الصورة غير صالح");
      const blob = await (await fetch(url)).blob();
      const asFile = new File([blob], "photo.jpg", { type: blob.type || "image/jpeg" });
      const { base64, mimeType } = await prepareForAIBase64(asFile);

      const { data, error } = await supabase.functions.invoke("analyze-product-image", {
        body: { imageBase64: base64, mimeType, categories: categories ?? [], imageId: img.id },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);

      const a = data as any;
      updateDraft(row.id, {
        name: a.name_ar || draftFor(row).name,
        category_id: a.category_id || draftFor(row).category_id,
        karat: KARAT_OPTIONS.includes(a.karat) ? a.karat : draftFor(row).karat,
        description: a.description_ar || draftFor(row).description,
      });
      qc.setQueryData<Row[]>(["unnamed-products", sortDir], (prev) =>
        (prev ?? []).map((r) =>
          r.id === row.id
            ? { ...r, images: r.images.map((im) => (im.id === img.id ? { ...im, ai_labels: { ...a } } : im)) }
            : r,
        ),
      );
      setJustAnalyzedOrder((prev) => [row.id, ...prev.filter((id) => id !== row.id)]);
      if (a.usage) setUsage(a.usage);
      toast.success("تم التحليل — راجع الحقول واحفظ");
    } catch (e: any) {
      toast.error(e.message ?? "تعذّر التحليل");
    } finally {
      setReanalyzingIds((s) => {
        const next = new Set(s);
        next.delete(row.id);
        return next;
      });
    }
  };

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const allSelected = !!rows?.length && selected.size === rows.length;
  const toggleSelectAll = () => {
    if (!rows?.length) return;
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  };

  const bulkDelete = async () => {
    if (!selected.size) return;
    if (!confirm(`حذف ${selected.size} قطعة نهائياً؟ لا يمكن التراجع.`)) return;
    setBulkBusy(true);
    try {
      const ids = Array.from(selected);
      const { error } = await supabase.from("products").delete().in("id", ids);
      if (error) throw error;
      toast.success(`تم حذف ${ids.length} قطعة`);
      qc.setQueryData<Row[]>(["unnamed-products", sortDir], (prev) => (prev ?? []).filter((r) => !selected.has(r.id)));
      setSelected(new Set());
    } catch (e: any) {
      toast.error(e.message ?? "تعذّر الحذف");
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkReanalyze = async () => {
    if (!selected.size || !rows) return;
    setBulkBusy(true);
    const targets = rows.filter((r) => selected.has(r.id));
    // بالتوازي بدل الواحدة تلو الأخرى — كل قطعة تحلّلها مزوّد رؤية منفصل عبر سباق متدرّج،
    // فتشغيل عدة قطع معاً يقلّل زمن الانتظار الكلي بشكل كبير دون التصادم مع حدود المعدّل.
    const CONCURRENCY = 6;
    let i = 0;
    const worker = async () => {
      while (i < targets.length) {
        const row = targets[i++];
        await reanalyze(row);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
    setBulkBusy(false);
    toast.success("اكتملت إعادة التحليل — راجع الحقول واحفظ كل قطعة");
  };

  // يحفظ كل قطعة حصلت على اسم حقيقي من التحليل (سواء أُعيد تحليلها أو حُلّلت عند الرفع)
  // دفعة واحدة، بدل الضغط على "حفظ" لكل قطعة يدوياً واحدة تلو الأخرى.
  const saveAllReanalyzed = async () => {
    if (!rows) return;
    const targets = rows.filter((r) => {
      const draft = draftFor(r);
      return draft.name?.trim() && draft.name !== PLACEHOLDER_NAME;
    });
    if (!targets.length) {
      toast.info("لا توجد قطع جاهزة للحفظ — أعد التحليل أولاً");
      return;
    }
    setSavingAll(true);
    const CONCURRENCY = 6;
    let i = 0;
    let ok = 0;
    const worker = async () => {
      while (i < targets.length) {
        const row = targets[i++];
        await save(row);
        ok++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
    setSavingAll(false);
    toast.success(`تم حفظ ${ok} قطعة`);
  };

  // القطع التي اكتمل تحليلها للتو تُرفع لأعلى القائمة بترتيب الاكتمال — لأن التحليل المتوازي
  // (عدة قطع في نفس الوقت) لا يكتمل بترتيب البدء، فبدون هذا يصعب معرفة أي قطعة جاهزة الآن.
  const sortedRows = useMemo(() => {
    if (!rows || !justAnalyzedOrder.length) return rows ?? [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const top = justAnalyzedOrder.map((id) => byId.get(id)).filter((r): r is Row => !!r);
    const topIds = new Set(top.map((r) => r.id));
    const rest = rows.filter((r) => !topIds.has(r.id));
    return [...top, ...rest];
  }, [rows, justAnalyzedOrder]);

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
        <ArrowRight className="size-4 ml-1" /> رجوع
      </Button>

      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Sparkles className="size-6 text-primary" />
          مراجعة الصور غير المسمّاة
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          القطع التي ما زالت بالاسم الافتراضي "{PLACEHOLDER_NAME}" — راجع اسم كل قطعة ونتيجة تحليلها ثم احفظ. إن لم
          يظهر تحليل، اضغط "إعادة التحليل".
        </p>
      </div>

      {usage && (
        <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground px-1">
          <span className="font-semibold">المتبقي اليوم تقريباً:</span>
          {Object.entries(usage).map(([provider, { used, limit }]) => (
            <span key={provider} className="px-2 py-0.5 rounded-full bg-muted">
              {provider === "gemini" ? "Gemini" : provider === "groq" ? "Groq" : "OpenRouter"}: {Math.max(0, limit - used)}/{limit}
            </span>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-40 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : !rows?.length ? (
        <p className="text-center text-sm text-muted-foreground py-16">
          لا توجد قطع بانتظار المراجعة — كل شيء تم تسميته 🎉
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <label className="flex items-center gap-2 text-sm font-semibold cursor-pointer">
              <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} />
              {rows.length} قطعة بانتظار المراجعة
              {selected.size > 0 && <span className="text-primary">· {selected.size} محدّدة</span>}
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
                title={sortDir === "desc" ? "الأحدث أولاً" : "الأقدم أولاً"}
              >
                <ArrowUpDown className="size-3.5 ml-1" />
                {sortDir === "desc" ? "الأحدث أولاً" : "الأقدم أولاً"}
              </Button>
              <Button size="sm" variant="outline" onClick={saveAllReanalyzed} disabled={savingAll}>
                {savingAll ? <Loader2 className="size-3.5 animate-spin ml-1" /> : <CheckCheck className="size-3.5 ml-1" />}
                حفظ الكل المُعاد تحليلها
              </Button>
              {selected.size > 0 && (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={bulkReanalyze} disabled={bulkBusy}>
                  {bulkBusy ? <Loader2 className="size-3.5 animate-spin ml-1" /> : <RotateCw className="size-3.5 ml-1" />}
                  إعادة تحليل المحدّد
                </Button>
                <Button size="sm" variant="destructive" onClick={bulkDelete} disabled={bulkBusy}>
                  <Trash2 className="size-3.5 ml-1" /> حذف المحدّد
                </Button>
              </div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {sortedRows.map((row) => {
              const draft = draftFor(row);
              const img = row.images?.[0];
              const analyzed = !!img?.ai_labels;
              const busy = savingIds.has(row.id) || reanalyzingIds.has(row.id);
              const justAnalyzed = justAnalyzedOrder.includes(row.id);
              return (
                <Card key={row.id} className={`p-3 space-y-2 ${justAnalyzed ? "ring-2 ring-primary/50" : ""}`}>
                  <div className="flex gap-3">
                    <div className="relative shrink-0">
                      {img ? (
                        <img
                          src={getImageUrl(img.storage_path)!}
                          alt=""
                          className="size-24 rounded-lg object-cover bg-muted"
                        />
                      ) : (
                        <div className="size-24 rounded-lg bg-muted flex items-center justify-center text-[10px] text-muted-foreground">
                          بدون صورة
                        </div>
                      )}
                      <Checkbox
                        checked={selected.has(row.id)}
                        onCheckedChange={() => toggleSelect(row.id)}
                        className="absolute top-1 right-1 bg-card"
                      />
                    </div>
                    <div className="flex-1 min-w-0 space-y-1.5">
                      {justAnalyzed && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">
                          <Sparkles className="size-2.5" /> حُلّلت للتو
                        </span>
                      )}
                      <Input
                        value={draft.name}
                        onChange={(e) => updateDraft(row.id, { name: e.target.value })}
                        placeholder="اسم القطعة"
                        className="text-sm font-semibold"
                      />
                      <div className="grid grid-cols-2 gap-1.5">
                        <Select value={draft.category_id ?? ""} onValueChange={(v) => updateDraft(row.id, { category_id: v })}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="الفئة" /></SelectTrigger>
                          <SelectContent>
                            {categories?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Select value={draft.karat ?? ""} onValueChange={(v) => updateDraft(row.id, { karat: v })}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="العيار" /></SelectTrigger>
                          <SelectContent>
                            {KARAT_OPTIONS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  {!analyzed && (
                    <p className="text-xs text-amber-600 dark:text-amber-500">⚠️ لم تُحلّل هذه الصورة بعد بالذكاء الاصطناعي</p>
                  )}

                  <Textarea
                    value={draft.description ?? ""}
                    onChange={(e) => updateDraft(row.id, { description: e.target.value })}
                    placeholder="الوصف"
                    rows={2}
                    className="text-xs resize-none"
                  />

                  <div className="flex items-center gap-2">
                    <Button size="sm" className="flex-1" onClick={() => save(row)} disabled={busy}>
                      {savingIds.has(row.id) ? <Loader2 className="size-3.5 animate-spin ml-1" /> : <Save className="size-3.5 ml-1" />}
                      حفظ
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => reanalyze(row)} disabled={busy}>
                      {reanalyzingIds.has(row.id) ? <Loader2 className="size-3.5 animate-spin ml-1" /> : <RotateCw className="size-3.5 ml-1" />}
                      إعادة التحليل
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => navigate(`/products/${row.id}/edit`)} title="فتح صفحة التعديل الكاملة">
                      <ExternalLink className="size-3.5" />
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
