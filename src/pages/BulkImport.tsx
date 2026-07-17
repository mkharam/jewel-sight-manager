// صفحة استيراد الصور بالجملة من الجهاز.
// - يختار الموظف مجلد/صور
// - كل صورة تُرفع لتخزين "product-images/imports/..." ثم تُحلَّل بالذكاء الاصطناعي
// - يُنشئ منتج مسودة لكل صورة بحالة "متوفر"، بدون فرع (يُصنَّف لاحقاً)
// - الاسم/الفئة/العيار/الوصف قابلة للتحرير قبل الحفظ
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Save, Sparkles, X, FolderUp, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { KARAT_OPTIONS } from "@/lib/constants";

type Item = {
  previewUrl: string;
  file: File;
  status: "pending" | "uploading" | "analyzing" | "ready" | "error";
  include: boolean;
  storagePath?: string;
  name: string;
  category: string;
  karat: string;
  description: string;
  error?: string;
  provider?: string; // gemini | groq | lovable | cached
  // Full analysis kept so we can persist embedding on save (photo search).
  analysis?: any;
};


export default function BulkImport() {
  const { user, profile } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [saving, setSaving] = useState(false);
  const [processing, setProcessing] = useState(false);

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: async () =>
      (await supabase.from("categories").select("id,name").eq("is_active", true).order("sort_order")).data ?? [],
  });
  const { data: branches } = useQuery({
    queryKey: ["branches"],
    queryFn: async () =>
      (await supabase.from("branches").select("id,name").eq("is_active", true)).data ?? [],
  });

  const findCategoryId = (name: string) =>
    categories?.find((c) => c.name === name || (name && name.includes(c.name)))?.id ?? null;

  const handleFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    if (!user) return toast.error("سجّل الدخول أولاً");
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/") && f.size <= 8 * 1024 * 1024);
    if (!arr.length) return toast.error("اختر صوراً (JPG/PNG/WEBP) حجم كل صورة ≤ 8MB");

    const newItems: Item[] = arr.map((f) => ({
      previewUrl: URL.createObjectURL(f),
      file: f,
      status: "uploading",
      include: true,
      name: "",
      category: "",
      karat: "",
      description: "",
    }));
    setItems((prev) => [...prev, ...newItems]);
    toast.success(`${newItems.length} صورة — يجري الرفع أولاً ثم التحليل تلقائياً`);
    // 1) رفع الكل بالتوازي (سريع جداً)، 2) تحليل واحدة تلو الأخرى (احتراماً لحد Gemini المجاني 15 طلب/دقيقة)
    processAll(newItems);
  };

  const processAll = async (list: Item[]) => {
    setProcessing(true);

    // ===== المرحلة 1: رفع الصور مع تحديد التوازي (6 معاً) لتفادي اختناق المتصفح =====
    const UPLOAD_CONCURRENCY = 6;
    let uploadIdx = 0;
    const uploadWorker = async () => {
      while (uploadIdx < list.length) {
        const i = uploadIdx++;
        const it = list[i];
        try {
          const ext = (it.file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
          const path = `imports/${user!.id}/${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}.${ext || "jpg"}`;
          const { error: upErr } = await supabase.storage.from("product-images").upload(path, it.file);
          if (upErr) throw upErr;
          it.storagePath = path;
          setItems((prev) => prev.map((x) => (x === it ? { ...x, storagePath: path, status: "pending" } : x)));
        } catch (e: any) {
          setError(it, e?.message ?? "فشل رفع الصورة");
        }
      }
    };
    await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, uploadWorker));

    // ===== المرحلة 2: التحليل بالتسلسل مع احترام حد المعدل =====
    for (const it of list) {
      if (it.status === "error" || !it.storagePath) continue;
      await analyzeOne(it);
      // ~24 صورة/دقيقة (أقل من حد Groq 30 و Gemini 15 مع 3 مزودين بالتناوب)
      await new Promise((r) => setTimeout(r, 2500));
    }
    setProcessing(false);
  };

  // تحليل صورة واحدة (يُستخدم للمرة الأولى وللإعادة اليدوية).
  const analyzeOne = async (it: Item) => {
    setItems((prev) => prev.map((x) => (x === it ? { ...x, status: "analyzing", error: undefined } : x)));
    let attempts = 0;
    while (attempts < 3) {
      try {
        const base64 = await fileToBase64(it.file);
        const { data, error } = await supabase.functions.invoke("analyze-product-image", {
          body: { imageBase64: base64, mimeType: it.file.type, categories: categories ?? [] },
        });
        if (error) throw error;
        if ((data as any)?.error) throw new Error((data as any).error);
        const a = data as any;
        setItems((prev) => prev.map((x) =>
          x === it
            ? {
                ...x,
                status: "ready",
                name: a.name_ar || "",
                category: a.category_name || "",
                karat: a.karat || "",
                description: a.description_ar || "",
                provider: a.provider,
                analysis: a,
              }
            : x,
        ));
        return;
      } catch (e: any) {
        const msg = e?.message ?? "فشل التحليل";
        if (msg.includes("429") || msg.toLowerCase().includes("rate") || msg.includes("مشغول") || msg.includes("AI_BUSY")) {
          attempts++;
          if (attempts >= 3) {
            setError(it, "كل المزودات مشغولة الآن — اضغط ↻ للإعادة");
            return;
          }
          await new Promise((r) => setTimeout(r, 15000));
          continue;
        }
        setError(it, msg);
        return;
      }
    }
  };

  const retryOne = async (it: Item) => {
    if (!it.storagePath) return;
    await analyzeOne(it);
  };


  const setError = (it: Item, msg: string) => {
    setItems((prev) => prev.map((x) => (x === it ? { ...x, status: "error", include: false, error: msg } : x)));
  };


  const updateItem = (i: number, patch: Partial<Item>) =>
    setItems((prev) => prev.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const removeItem = (i: number) => setItems((prev) => prev.filter((_, j) => j !== i));

  const saveAll = async () => {
    const ready = items.filter((it) => it.include && it.status === "ready" && it.storagePath);
    if (!ready.length) return toast.error("لا توجد قطع جاهزة للحفظ");
    if (!user) return toast.error("سجّل الدخول أولاً");

    setSaving(true);
    let ok = 0, failed = 0;
    // إبقاء الفرع فارغاً افتراضياً — الموظف يوزّع لاحقاً يدوياً
    const defaultBranch: string | null = null;

    for (const it of ready) {
      try {
        const { data: prod, error: e1 } = await supabase
          .from("products")
          .insert({
            name: it.name.trim() || "قطعة جديدة",
            category_id: findCategoryId(it.category),
            karat: it.karat || null,
            description: it.description || null,
            branch_id: defaultBranch,
            status: "available",
            created_by: user.id,
          })
          .select("id")
          .single();
        if (e1 || !prod) { failed++; continue; }
        const { data: img, error: e2 } = await supabase
          .from("product_images")
          .insert({
            product_id: prod.id,
            storage_path: it.storagePath!,
            is_primary: true,
            uploaded_by: user.id,
          })
          .select("id")
          .single();
        if (e2 || !img) { failed++; continue; }
        ok++;
        // Persist embedding so the photo is searchable via image-search later.
        // Fire-and-forget with the pre-computed analysis (no extra Gemini cost).
        if (it.analysis) {
          supabase.functions
            .invoke("analyze-product-image", {
              body: {
                imageId: img.id,
                analysis: it.analysis,
                categories: categories ?? [],
              },
            })
            .catch((err) => console.warn("embed failed", err));
        }
      } catch {
        failed++;
      }
    }
    setSaving(false);
    toast.success(`تم حفظ ${ok} قطعة كمسودة` + (failed ? ` (${failed} فشل)` : ""));
    if (ok) setItems([]);
    void branches; // للاحتفاظ بالاستعلام جاهزاً
  };


  const readyCount = items.filter((it) => it.include && it.status === "ready").length;

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Sparkles className="size-6 text-primary" />
          استيراد صور بالجملة
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          ارفع مجلد/صور دفعة واحدة. النظام يرفع كل الصور فوراً بالتوازي، ثم يحلّلها بالذكاء الاصطناعي (Gemini المجاني)
          ويقترح اسم/فئة/عيار/وصف لكل قطعة. تُحفظ كمسودات بدون فرع — تُصنّفها لاحقاً وتضيف SKU من صفحة التعديل.
        </p>

      </div>

      <Card className="p-4">
        <label className="flex flex-col sm:flex-row sm:items-center gap-3 cursor-pointer">
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <span className="inline-flex items-center justify-center gap-2 rounded-md bg-gold-gradient text-primary-foreground px-4 py-2 text-sm font-semibold">
            <FolderUp className="size-4" />
            اختيار صور من الجهاز
          </span>
          <span className="text-xs text-muted-foreground">
            يمكنك اختيار عشرات الصور دفعة واحدة. الجودة ≤ 8MB لكل صورة.
          </span>
        </label>
      </Card>

      {items.length > 0 && (
        <div className="flex items-center justify-between sticky top-14 sm:top-16 z-20 bg-background/95 backdrop-blur py-2 -mx-3 px-3 border-b border-border">
          <p className="font-semibold text-sm">
            {readyCount} / {items.length} جاهز
            {processing && <span className="text-muted-foreground mr-2">— جارٍ المعالجة…</span>}
          </p>
          <Button
            onClick={saveAll}
            disabled={saving || !readyCount}
            className="bg-gold-gradient text-primary-foreground"
          >
            {saving ? <Loader2 className="size-4 animate-spin ml-1" /> : <Save className="size-4 ml-1" />}
            حفظ {readyCount} قطعة
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.map((it, i) => (
          <Card key={i} className="overflow-hidden">
            <div className="flex gap-3 p-3">
              <div className="relative shrink-0">
                <img src={it.previewUrl} alt="" className="size-28 rounded-lg object-cover bg-muted" />
                <button
                  onClick={() => removeItem(i)}
                  className="absolute -top-1 -right-1 size-6 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow"
                  aria-label="إزالة"
                >
                  <X className="size-3" />
                </button>
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                {(it.status === "uploading" || it.status === "analyzing" || it.status === "pending") && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Loader2 className="size-3 animate-spin" />
                    {it.status === "uploading" ? "جارٍ الرفع…" : it.status === "pending" ? "بانتظار التحليل…" : "جارٍ التحليل…"}
                  </p>
                )}
                {it.status === "error" && <p className="text-xs text-destructive">⚠️ {it.error}</p>}
                {it.status === "ready" && (
                  <>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={`inc-${i}`}
                        checked={it.include}
                        onCheckedChange={(v) => updateItem(i, { include: !!v })}
                      />
                      <label htmlFor={`inc-${i}`} className="text-xs text-muted-foreground">
                        تضمين في الحفظ
                      </label>
                    </div>
                    <Input
                      value={it.name}
                      onChange={(e) => updateItem(i, { name: e.target.value })}
                      placeholder="اسم القطعة"
                      className="text-sm font-semibold"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Select value={it.category} onValueChange={(v) => updateItem(i, { category: v })}>
                        <SelectTrigger className="text-xs h-9">
                          <SelectValue placeholder="الفئة" />
                        </SelectTrigger>
                        <SelectContent>
                          {categories?.map((c) => (
                            <SelectItem key={c.id} value={c.name}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select value={it.karat} onValueChange={(v) => updateItem(i, { karat: v })}>
                        <SelectTrigger className="text-xs h-9">
                          <SelectValue placeholder="العيار" />
                        </SelectTrigger>
                        <SelectContent>
                          {KARAT_OPTIONS.map((k) => (
                            <SelectItem key={k} value={k}>
                              {k}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Textarea
                      value={it.description}
                      onChange={(e) => updateItem(i, { description: e.target.value })}
                      placeholder="وصف"
                      rows={2}
                      className="text-xs resize-none"
                    />
                  </>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {items.length === 0 && (
        <p className="text-center text-sm text-muted-foreground py-12">
          لم تختر أي صور بعد. اضغط الزر أعلاه لبدء الاستيراد.
        </p>
      )}
    </div>
  );
}

async function fileToBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || "").split(",")[1] ?? "");
    r.onerror = reject;
    r.readAsDataURL(f);
  });
}
