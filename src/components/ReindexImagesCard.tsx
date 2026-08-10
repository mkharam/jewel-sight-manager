// لوحة المدير: إعادة فهرسة صور القطع التي لا تحتوي تحليل ذكاء اصطناعي أو بصمة بحث.
// تعمل على دفعات صغيرة عبر edge function حتى لا تتجاوز مهلة التنفيذ.
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader2, RefreshCw, Sparkles, StopCircle } from "lucide-react";
import { toast } from "sonner";

const BATCH = 8;

export default function ReindexImagesCard() {
  const [running, setRunning] = useState(false);
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

  const start = async () => {
    setRunning(true);
    setStopFlag(false);
    setDone(0);
    setFailed(0);
    setNote(null);
    setTotal(pending ?? 0);

    let guard = 0;
    let localFailed = 0;
    let localDone = 0;

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (stopRef.current) break;
        guard++;
        if (guard > 400) break; // حماية من حلقة لا نهائية

        const { data, error } = await supabase.functions.invoke("reindex-product-images", {
          body: { limit: BATCH },
        });
        if (error) throw error;
        if ((data as any)?.error) throw new Error((data as any).error);

        const res = data as {
          processed: number;
          failed: number;
          remaining: number;
          rateLimited: boolean;
        };

        localDone += res.processed;
        setDone(localDone);
        localFailed += res.failed;
        setFailed(localFailed);

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
      stopRef.current = false;
      setStopFlag(false);
      refetch();
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
          {!running ? (
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
          {running && <Loader2 className="size-4 animate-spin text-primary" />}
        </div>

        {(running || done > 0 || failed > 0) && (
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
