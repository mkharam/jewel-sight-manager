// لوحة المدير: إعادة فهرسة صور القطع التي لا تحتوي تحليل ذكاء اصطناعي أو بصمة بحث.
// تعمل على دفعات صغيرة عبر edge function حتى لا تتجاوز مهلة التنفيذ.
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader2, RefreshCw, Sparkles, StopCircle, Tag } from "lucide-react";
import { toast } from "sonner";

const BATCH = 8;
// دفعة أصغر لإعادة التحليل الموجّهة — كل صورة تمرّ بنموذج رؤية كامل، والدفعة الكبيرة
// تقترب من مهلة تنفيذ الدالة.
const FIX_BATCH = 4;
const BRAND_NAMES = [
  "بولغري", "فان كليف", "كارتييه", "مسيكا", "تيفاني", "شوبارد",
  "بوشرون", "هاري وينستون", "غراف", "ديور", "شانيل", "غوتشي", "بياجيه",
];

export default function ReindexImagesCard() {
  const [running, setRunning] = useState(false);
  const [forceRunning, setForceRunning] = useState(false);
  const [brandFixing, setBrandFixing] = useState(false);
  const [stopFlag, setStopFlag] = useState(false);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState(0);
  const [total, setTotal] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const stopRef = useRef(false);

  const { data: pending, refetch } = useQuery({
    queryKey: ["reindex-pending"],
    queryFn: async () => {
      const { count } = await supabase
        .from("product_images")
        .select("id", { count: "exact", head: true })
        .or("ai_embedding.is.null,ai_labels.eq.{}");
      return count ?? 0;
    },
  });

  const { data: totalImages } = useQuery({
    queryKey: ["reindex-total"],
    queryFn: async () => {
      const { count } = await supabase.from("product_images").select("id", { count: "exact", head: true });
      return count ?? 0;
    },
  });

  // القطع التي نُسبت لعلامة تجارية عالمية في وصفها. أُضيف هذا بعد أن رصدنا أن التحليل
  // كان يمنح أسماء دور (هاري وينستون، مسيكا، غراف…) لأي طقم ألماس عرايسي فاخر بلا أي
  // توقيع شكلي فعلي — 21 قطعة من 24 كانت نسبة خاطئة، وهي تُغرق البحث بنتائج مضلّلة.
  // إعادة تحليلها بالقواعد المشدّدة تُبقي النسبة الصحيحة فقط (ألامبرا، باثر…) وتحذف الباقي.
  const { data: brandTagged, refetch: refetchBrands } = useQuery({
    queryKey: ["reindex-brand-tagged"],
    queryFn: async () => {
      const { data } = await supabase
        .from("product_images")
        .select("id")
        .or(BRAND_NAMES.map((b) => `ai_labels->>description_ar.ilike.%${b}%`).join(","));
      return (data ?? []).map((r) => r.id as string);
    },
  });

  const runLoop = async (force: boolean) => {
    setStopFlag(false);
    setDone(0);
    setFailed(0);
    setNote(null);
    setTotal(force ? totalImages ?? 0 : pending ?? 0);

    let guard = 0;
    let localFailed = 0;
    let localDone = 0;
    let offset = 0;

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (stopRef.current) break;
        guard++;
        if (guard > 400) break; // حماية من حلقة لا نهائية

        const { data, error } = await supabase.functions.invoke("reindex-product-images", {
          body: force ? { limit: BATCH, force: true, offset } : { limit: BATCH },
        });
        if (error) throw error;
        if ((data as any)?.error) throw new Error((data as any).error);

        const res = data as {
          processed: number;
          failed: number;
          remaining: number;
          rateLimited: boolean;
          nextOffset?: number;
        };

        localDone += res.processed;
        setDone(localDone);
        localFailed += res.failed;
        setFailed(localFailed);
        if (force) offset = res.nextOffset ?? offset + BATCH;

        if (res.rateLimited) {
          setNote("الذكاء الاصطناعي مشغول الآن — توقفنا مؤقتاً، أعد المحاولة بعد قليل وسيكمل من حيث توقف.");
          break;
        }
        if (res.remaining <= 0 || (res.processed === 0 && res.failed === 0)) break;
        if (res.processed === 0 && res.failed > 0) {
          setNote("تعذّر تحليل بعض الصور — أعد المحاولة لاحقاً.");
          break;
        }

        await new Promise((r) => setTimeout(r, 800));
      }

      toast.success(`تمت فهرسة ${localDone} صورة` + (localFailed ? ` (${localFailed} فشل)` : ""));
    } catch (e: any) {
      toast.error(e?.message ?? "تعذّرت إعادة الفهرسة");
    } finally {
      setRunning(false);
      setForceRunning(false);
      stopRef.current = false;
      setStopFlag(false);
      refetch();
    }
  };

  const start = () => {
    setRunning(true);
    runLoop(false);
  };

  const startForce = () => {
    setForceRunning(true);
    runLoop(true);
  };

  // إعادة تحليل موجّهة للصور المنسوبة لعلامة تجارية فقط — أسرع وأرخص بكثير من إعادة
  // فهرسة الكتالوج كله، وتُصحّح النسب الخاطئة بالقواعد المشدّدة.
  const startBrandFix = async () => {
    const ids = brandTagged ?? [];
    if (!ids.length) return;
    setBrandFixing(true);
    setStopFlag(false);
    setDone(0);
    setFailed(0);
    setNote(null);
    setTotal(ids.length);

    let localDone = 0;
    let localFailed = 0;
    try {
      for (let i = 0; i < ids.length; i += FIX_BATCH) {
        if (stopRef.current) break;
        const { data, error } = await supabase.functions.invoke("reindex-product-images", {
          body: { imageIds: ids.slice(i, i + FIX_BATCH) },
        });
        if (error) throw error;
        if ((data as any)?.error) throw new Error((data as any).error);
        localDone += (data as any).processed ?? 0;
        localFailed += (data as any).failed ?? 0;
        setDone(localDone);
        setFailed(localFailed);
        if ((data as any).rateLimited) {
          setNote("الذكاء الاصطناعي مشغول الآن — توقفنا مؤقتاً، أعد المحاولة بعد قليل.");
          break;
        }
        await new Promise((r) => setTimeout(r, 600));
      }
      toast.success(`أُعيد تحليل ${localDone} قطعة` + (localFailed ? ` (${localFailed} فشل)` : ""));
    } catch (e: any) {
      toast.error(e?.message ?? "تعذّر تصحيح نسب العلامات");
    } finally {
      setBrandFixing(false);
      stopRef.current = false;
      setStopFlag(false);
      refetchBrands();
    }
  };

  const pct = total > 0 ? Math.min(100, Math.round(((done + failed) / total) * 100)) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          إعادة فهرسة الصور
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          الصور التي رُفعت قبل تشغيل الذكاء الاصطناعي — أو فشل تحليلها — لا تظهر في البحث بالصورة ولا تحمل وسوماً.
          هذه العملية تعيد تحليلها وتوليد بصمة البحث لها (Groq ← Gemini ← Lovable).
        </p>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold">
            صور تحتاج فهرسة: <span className="text-primary">{pending ?? "…"}</span>
          </span>
          {!running && !forceRunning ? (
            <Button size="sm" onClick={start} disabled={!pending} className="bg-gold-gradient text-primary-foreground">
              <RefreshCw className="size-4 ml-1" /> بدء الفهرسة
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                stopRef.current = true;
                setStopFlag(true);
              }}
            >
              <StopCircle className="size-4 ml-1" /> إيقاف
            </Button>
          )}
          {(running || forceRunning) && <Loader2 className="size-4 animate-spin text-primary" />}
        </div>

        <div className="border-t border-border/60 pt-3 space-y-1.5">
          <p className="text-xs text-muted-foreground">
            بعد ترقية بصمة البحث لتعتمد على الصورة نفسها لا وصفها النصي، القطع القديمة (المفهرسة سابقاً)
            تحتاج إعادة فهرسة كاملة لتستفيد من الدقة الجديدة في البحث بالصورة.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={startForce}
            disabled={running || forceRunning || brandFixing || !totalImages}
          >
            <Sparkles className="size-4 ml-1" /> إعادة فهرسة كل القطع ({totalImages ?? "…"})
          </Button>
        </div>

        <div className="border-t border-border/60 pt-3 space-y-1.5">
          <p className="text-xs text-muted-foreground">
            القطع التي نُسب وصفها لعلامة عالمية (كارتييه، فان كليف، مسيكا…). التحليل القديم كان
            يمنح اسم دار لأي طقم ألماس فاخر بلا توقيع شكلي حقيقي، وهذا يُغرق البحث بنتائج مضلّلة.
            إعادة تحليلها بالقواعد المشدّدة تُبقي النسبة الصحيحة فقط وتحذف الباقي.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={startBrandFix}
            disabled={running || forceRunning || brandFixing || !brandTagged?.length}
          >
            {brandFixing ? <Loader2 className="size-4 ml-1 animate-spin" /> : <Tag className="size-4 ml-1" />}
            تصحيح نسب العلامات ({brandTagged?.length ?? "…"})
          </Button>
        </div>

        {(running || forceRunning || brandFixing || done > 0 || failed > 0) && (
          <div className="space-y-1">
            <Progress value={pct} />
            <p className="text-[11px] text-muted-foreground">
              تمت فهرسة {done} من {total}
              {failed > 0 && <span className="text-destructive"> · {failed} فشل</span>}
            </p>
          </div>
        )}

        {note && <p className="text-xs text-warning-foreground bg-warning/10 rounded-lg p-2">{note}</p>}
      </CardContent>
    </Card>
  );
}
