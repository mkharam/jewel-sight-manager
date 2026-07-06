import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Camera, Loader2, Sparkles, Upload, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface Analysis {
  name_ar?: string;
  category_name?: string | null;
  category_id?: string | null;
  karat?: string | null;
  style?: string[];
  gemstones?: string[];
  description_ar?: string;
}

interface Match {
  product_id: string;
  similarity: number;
}

interface Props {
  categories?: { id: string; name: string }[];
  /** Called with product IDs ordered by similarity (best first). */
  onResults: (payload: { productIds: string[]; analysis: Analysis }) => void;
}

export default function ImageSearchButton({ categories, onResults }: Props) {
  const [open, setOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setPreviewUrl(null);
    setAnalysis(null);
    setMatches(null);
    setLoading(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "ملف غير صالح", description: "اختر صورة", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "الصورة كبيرة", description: "الحد الأقصى 5 ميغابايت", variant: "destructive" });
      return;
    }
    setPreviewUrl(URL.createObjectURL(file));
    setLoading(true);
    setAnalysis(null);
    setMatches(null);

    try {
      const base64: string = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => {
          const s = r.result as string;
          resolve(s.split(",")[1]);
        };
        r.onerror = reject;
        r.readAsDataURL(file);
      });

      const { data, error } = await supabase.functions.invoke("image-search", {
        body: { imageBase64: base64, mimeType: file.type, categories, matchCount: 12 },
      });

      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);

      setAnalysis((data as any).analysis ?? {});
      setMatches((data as any).matches ?? []);
    } catch (e: any) {
      toast({ title: "تعذّر التحليل", description: e.message ?? "حاول مجدداً", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const apply = () => {
    if (!matches || !analysis) return;
    onResults({ productIds: matches.map((m) => m.product_id), analysis });
    setOpen(false);
    reset();
    const n = matches.length;
    toast({
      title: n > 0 ? `${n} قطعة مشابهة` : "لا توجد نتائج",
      description: n > 0 ? "أعلى القطع تشابهاً معروضة" : "لم نجد قطعاً مشابهة بالصورة",
    });
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="h-12"
        onClick={() => setOpen(true)}
        title="بحث بالصورة"
      >
        <Camera className="size-4 ml-1" />
        <span className="hidden sm:inline">بالصورة</span>
      </Button>

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
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="w-full aspect-video rounded-xl border-2 border-dashed border-border hover:border-primary hover:bg-muted/30 transition flex flex-col items-center justify-center gap-2 text-muted-foreground"
              >
                <Upload className="size-8" />
                <span className="text-sm font-medium">اضغط لرفع صورة أو التقاطها</span>
                <span className="text-xs">JPG / PNG · حد أقصى 5 ميغابايت</span>
              </button>
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
              ref={inputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />

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
                <p className="text-xs text-muted-foreground">
                  {matches.length > 0
                    ? `عثرنا على ${matches.length} قطعة مشابهة`
                    : "لا توجد قطع مشابهة في المخزون بعد. تأكد من تحليل الصور عند إضافة القطع."}
                </p>
                <Button onClick={apply} className="w-full bg-gold-gradient text-primary-foreground shadow-gold mt-2">
                  عرض القطع المشابهة
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
