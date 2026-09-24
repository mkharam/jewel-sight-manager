import { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Camera, Loader2, Sparkles, Upload, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { compressImage } from "@/lib/image-compress";
import { cn } from "@/lib/utils";
import { clearResume, readResume, saveResume } from "@/lib/resume";
import type { PhotoMatchTier } from "@/components/ProductCard";

interface Analysis {
  name_ar?: string;
  category_name?: string | null;
  category_id?: string | null;
  item_type?: string | null;
  karat?: string | null;
  style?: string[];
  gemstones?: string[];
  description_ar?: string;
}

export interface PhotoMatch {
  product_id: string;
  /** الدرجة المركّبة (بصري + وصفي) — تُستخدم للترتيب. */
  similarity: number;
  /** تشابه الصورة بالصورة — شكل القطعة نفسها. */
  visual?: number | null;
  /** تشابه وصف الذكاء الاصطناعي — لون الحجر ونوع القطعة والشكل. */
  textual?: number | null;
  /** مستوى جاهز من الخادم، نسبةً لبقية المخزون لا بعتبة ثابتة. راجع match_products_tiered. */
  kind?: PhotoMatchTier;
  /** أسباب قصيرة بالعربية ("نفس لون الذهب"، "نفس الأحجار: خضراء"). */
  reasons?: string[];
}

interface Props {
  categories?: { id: string; name: string }[];
  /** Called with matches ordered best first, plus the customer's photo to pin above the results. */
  onResults: (payload: { matches: PhotoMatch[]; analysis: Analysis; photo: string | null }) => void;
  /** "icon" = زر دائري صغير بأيقونة الكاميرا فقط (يُستخدم ملاصقاً لمربع البحث). */
  variant?: "button" | "icon";
  className?: string;
}

// الموظف يلتقط صورة من الواتساب ثم يعود ليبحث — وقد يخرج للواتساب مجدداً أثناء البحث (~15 ثانية).
// نحفظ الصورة ونتيجتها ليجد النافذة كما تركها حتى لو قتل آيفون التطبيق، ونعيد المحاولة
// بصمت إن انقطع الطلب بسبب الخروج بدل إظهار خطأ أحمر. راجع src/lib/resume.ts.
const RESUME_KEY = "imageSearch";
const TIER_SHORT: Record<PhotoMatchTier, string> = {
  exact: "🎯 مطابقة",
  very_close: "✨ قريبة جداً",
  similar_look: "👀 شكل مشابه",
  same_attributes: "🎨 نفس الأوصاف",
};
type Saved = { base64: string; mimeType: string; analysis: Analysis | null; matches: PhotoMatch[] | null };

// انقطاع الشبكة/تعليق التطبيق في الخلفية — لا خطأ حقيقي من الخادم. Safari: "Load failed".
const isNetworkError = (e: unknown) => {
  const err = e as { name?: string; message?: string } | null;
  return /load failed|failed to fetch|network|FunctionsFetchError/i.test(`${err?.name ?? ""} ${err?.message ?? ""}`);
};

export default function ImageSearchButton({ categories, onResults, variant = "button", className }: Props) {
  const saved = useRef(readResume<Saved>(RESUME_KEY)).current;
  const [open, setOpen] = useState(!!saved);
  const [previewUrl, setPreviewUrl] = useState<string | null>(saved ? `data:${saved.mimeType};base64,${saved.base64}` : null);
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(saved?.analysis ?? null);
  const [matches, setMatches] = useState<PhotoMatch[] | null>(saved?.matches ?? null);
  // آخر صورة أُرسلت — لإعادة المحاولة بعد انقطاع دون أن يختارها الموظف من جديد.
  const current = useRef<{ base64: string; mimeType: string } | null>(saved ? { base64: saved.base64, mimeType: saved.mimeType } : null);
  const [interrupted, setInterrupted] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setPreviewUrl(null);
    setAnalysis(null);
    setMatches(null);
    setLoading(false);
    setInterrupted(false);
    current.current = null;
    clearResume(RESUME_KEY);
    if (uploadRef.current) uploadRef.current.value = "";
    if (cameraRef.current) cameraRef.current.value = "";
  };

  const runSearch = async (base64: string, mimeType: string) => {
    setLoading(true);
    setInterrupted(false);
    setAnalysis(null);
    setMatches(null);
    try {
      const { data, error } = await supabase.functions.invoke("image-search", {
        body: { imageBase64: base64, mimeType, categories, matchCount: 60 },
      });

      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);

      const a = (data as any).analysis ?? {};
      const m = (data as any).matches ?? [];
      // الصورة أُلغيت أو استُبدلت أثناء الانتظار — لا نكتب نتيجة قديمة فوق الجديدة.
      if (current.current?.base64 !== base64) return;
      setAnalysis(a);
      setMatches(m);
      saveResume<Saved>(RESUME_KEY, { base64, mimeType, analysis: a, matches: m });
    } catch (e: any) {
      if (current.current?.base64 !== base64) return;
      if (isNetworkError(e)) {
        // غالباً خرج الموظف من التطبيق فعلّقه النظام — نعيد المحاولة تلقائياً عند العودة.
        setInterrupted(true);
      } else {
        toast({ title: "تعذّر التحليل", description: e.message ?? "حاول مجدداً", variant: "destructive" });
      }
    } finally {
      setLoading(false);
    }
  };

  // عودة للتطبيق بعد انقطاع البحث: نعيده تلقائياً.
  useEffect(() => {
    if (!interrupted) return;
    const retry = () => {
      if (document.visibilityState === "visible" && current.current) {
        void runSearch(current.current.base64, current.current.mimeType);
      }
    };
    document.addEventListener("visibilitychange", retry);
    return () => document.removeEventListener("visibilitychange", retry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interrupted]);

  // فُتح التطبيق من جديد (قُتل أثناء البحث) وفيه صورة بلا نتيجة — نكمل البحث.
  useEffect(() => {
    if (saved && !saved.matches) void runSearch(saved.base64, saved.mimeType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFile = async (original: File) => {
    if (!original.type.startsWith("image/")) {
      toast({ title: "ملف غير صالح", description: "اختر صورة", variant: "destructive" });
      return;
    }
    if (original.size > 25 * 1024 * 1024) {
      toast({ title: "الصورة كبيرة", description: "الحد الأقصى 25 ميغابايت", variant: "destructive" });
      return;
    }
    // ضغط قبل الإرسال — بحث أسرع بكثير على شبكة المحل
    const file = await compressImage(original, { maxDimension: 1280, quality: 0.8 });
    const dataUrl: string = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    const base64 = dataUrl.split(",")[1];
    const mimeType = file.type || "image/jpeg";
    setPreviewUrl(dataUrl);
    current.current = { base64, mimeType };
    // نحفظ الصورة قبل الطلب: إن قُتل التطبيق أثناء البحث نكمله عند الفتح بلا اختيار الصورة مجدداً.
    saveResume<Saved>(RESUME_KEY, { base64, mimeType, analysis: null, matches: null });
    await runSearch(base64, mimeType);
  };

  const apply = () => {
    if (!matches || !analysis) return;
    onResults({ matches, analysis, photo: previewUrl });
    setOpen(false);
    reset();
    if (!matches.length) toast({ title: "لا توجد نتائج", description: "لم نجد قطعاً مشابهة بالصورة" });
  };

  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="بحث بالصورة"
          aria-label="بحث بالصورة"
          className={cn(
            "flex items-center justify-center rounded-xl bg-gold-gradient text-primary-foreground shadow-gold transition-transform active:scale-95",
            className,
          )}
        >
          <Camera className="size-5" />
        </button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="lg"
          className={cn("h-12 w-full", className)}
          onClick={() => setOpen(true)}
          title="بحث بالصورة"
        >
          <Camera className="size-4 ml-1" />
          <span className="hidden xs:inline">بالصورة</span>
        </Button>
      )}

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              بحث بالصورة
            </DialogTitle>
            <DialogDescription>
              ارفع صورة قطعة من العميل وسنبحث عن أقرب القطع في المخزون.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {!previewUrl ? (
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => uploadRef.current?.click()}
                  className="aspect-square rounded-xl border-2 border-dashed border-border hover:border-primary hover:bg-muted/30 transition flex flex-col items-center justify-center gap-2 text-muted-foreground"
                >
                  <Upload className="size-8" />
                  <span className="text-sm font-medium">رفع صورة</span>
                  <span className="text-xs">من المعرض</span>
                </button>
                <button
                  type="button"
                  onClick={() => cameraRef.current?.click()}
                  className="aspect-square rounded-xl border-2 border-dashed border-border hover:border-primary hover:bg-muted/30 transition flex flex-col items-center justify-center gap-2 text-muted-foreground"
                >
                  <Camera className="size-8" />
                  <span className="text-sm font-medium">التقاط صورة</span>
                  <span className="text-xs">من الكاميرا</span>
                </button>
              </div>
            ) : (
              <div className="relative">
                <img src={previewUrl} alt="preview" className="w-full aspect-video object-contain rounded-xl bg-muted" />
                <Button
                  size="icon"
                  variant="secondary"
                  className="absolute top-2 left-2 size-8"
                  onClick={reset}
                >
                  <X className="size-4" />
                </Button>
              </div>
            )}

            <input
              ref={uploadRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />

            {interrupted && !loading && (
              <div className="flex flex-col items-center gap-2 py-3 text-sm text-muted-foreground">
                <p>انقطع البحث — سيُستأنف تلقائياً عند عودتك.</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => current.current && runSearch(current.current.base64, current.current.mimeType)}
                >
                  إعادة البحث الآن
                </Button>
              </div>
            )}

            {loading && (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="size-4 animate-spin" />
                جارٍ تحليل الصورة والبحث…
              </div>
            )}

            {analysis && matches && (
              <div className="rounded-xl bg-gold-soft border border-primary/20 p-3 space-y-2">
                <p className="text-xs font-semibold text-primary">نتيجة التحليل</p>
                {analysis.description_ar && <p className="text-sm">{analysis.description_ar}</p>}
                <div className="flex flex-wrap gap-1.5">
                  {analysis.category_name && (
                    <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">
                      {analysis.category_name}
                    </span>
                  )}
                  {analysis.item_type && (
                    <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">
                      {analysis.item_type}
                    </span>
                  )}
                  {analysis.karat && (
                    <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">
                      {analysis.karat}
                    </span>
                  )}
                  {analysis.style?.map((s, i) => (
                    <span key={"s" + i} className="px-2 py-0.5 rounded-full bg-muted text-foreground text-[11px]">
                      {s}
                    </span>
                  ))}
                  {analysis.gemstones?.map((g, i) => (
                    <span key={"g" + i} className="px-2 py-0.5 rounded-full bg-accent text-accent-foreground text-[11px]">
                      💎 {g}
                    </span>
                  ))}
                </div>
                {matches.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
                    {(["exact", "very_close", "similar_look", "same_attributes"] as const).map((k) => {
                      const n = matches.filter((m) => m.kind === k).length;
                      return n ? (
                        <span key={k} className="px-2 py-0.5 rounded-full bg-card border border-border">
                          {TIER_SHORT[k]} {n}
                        </span>
                      ) : null;
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    لا توجد قطع مشابهة في المخزون بعد. تأكد من تحليل الصور عند إضافة القطع.
                  </p>
                )}
                <Button onClick={apply} className="w-full h-12 text-base bg-gold-gradient text-primary-foreground shadow-gold mt-2">
                  عرض {matches.length} قطعة
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
