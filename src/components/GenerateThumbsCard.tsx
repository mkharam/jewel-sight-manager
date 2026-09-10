// لوحة المدير: توليد نسخ مصغّرة للصور المرفوعة قبل تفعيل المصغّرات.
// الصور المخزّنة ~250KB وسطياً، وشبكة الكتالوج تعرض عشرات القطع دفعة واحدة — أي عدة
// ميغابايت لمجرّد فتح الصفحة على بيانات الهاتف. المصغّرة ~25KB. التوليد يتم هنا في
// المتصفح عبر canvas لأن تحويل الصور في Supabase Storage ميزة مدفوعة غير مفعّلة.
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ImageDown, Loader2, StopCircle } from "lucide-react";
import { getImageUrl } from "@/lib/constants";
import { makeThumbnail } from "@/lib/image-compress";
import { toast } from "sonner";

const BATCH = 6;
// عدد ثوانٍ كنص — هذا ما يتوقّعه supabase-js. راجع التعليق المطوّل في uploadRunner.ts.
const IMMUTABLE_CACHE = "31536000";

export default function GenerateThumbsCard() {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState(0);
  const [total, setTotal] = useState(0);
  const stopRef = useRef(false);

  const { data: pending, refetch } = useQuery({
    queryKey: ["thumbs-pending"],
    queryFn: async () => {
      const { count } = await supabase
        .from("product_images")
        .select("id", { count: "exact", head: true })
        .is("thumb_path", null);
      return count ?? 0;
    },
  });

  const start = async () => {
    setRunning(true);
    stopRef.current = false;
    setDone(0);
    setFailed(0);
    setTotal(pending ?? 0);

    let localDone = 0;
    let localFailed = 0;

    try {
      while (!stopRef.current) {
        const { data: rows, error } = await supabase
          .from("product_images")
          .select("id,storage_path")
          .is("thumb_path", null)
          .limit(BATCH);
        if (error) throw error;
        if (!rows?.length) break;

        for (const row of rows) {
          if (stopRef.current) break;
          try {
            const url = getImageUrl(row.storage_path);
            if (!url) throw new Error("مسار غير صالح");
            const res = await fetch(url);
            if (!res.ok) throw new Error(`تعذّر تحميل الصورة (${res.status})`);
            const blob = await res.blob();
            const file = new File([blob], "src.jpg", { type: blob.type || "image/jpeg" });

            const thumb = await makeThumbnail(file);
            if (!thumb) throw new Error("تعذّر توليد المصغّرة");

            const thumbPath = `${row.storage_path.replace(/\.[^.]+$/, "")}-thumb.jpg`;
            const { error: upErr } = await supabase.storage
              .from("product-images")
              .upload(thumbPath, thumb, { cacheControl: IMMUTABLE_CACHE, upsert: true });
            if (upErr) throw upErr;

            const { error: dbErr } = await supabase
              .from("product_images")
              .update({ thumb_path: thumbPath } as any)
              .eq("id", row.id);
            if (dbErr) throw dbErr;

            localDone++;
            setDone(localDone);
          } catch (e) {
            localFailed++;
            setFailed(localFailed);
            console.error("thumb failed", row.id, e);
            // نضع مساراً فارغاً؟ لا — نتركها ليعاد المحاولة لاحقاً، لكن نخرج إن فشل الكل.
          }
        }

        // كل الدفعة فشلت — الاستمرار سيعيد نفس الصفوف بلا نهاية.
        if (localFailed > 0 && localDone === 0 && localFailed >= BATCH) break;
      }

      toast.success(`تم توليد ${localDone} مصغّرة` + (localFailed ? ` (${localFailed} فشل)` : ""));
    } catch (e: any) {
      toast.error(e?.message ?? "تعذّر توليد المصغّرات");
    } finally {
      setRunning(false);
      stopRef.current = false;
      refetch();
    }
  };

  const pct = total > 0 ? Math.min(100, Math.round(((done + failed) / total) * 100)) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ImageDown className="size-4 text-primary" />
          تسريع تحميل الصور
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          صفحات القطع كانت تحمّل الصورة بحجمها الكامل (~250 كيلوبايت للصورة) في كل مكان، حتى في الشبكة
          المصغّرة. هذه العملية تولّد نسخة صغيرة (~25 كيلوبايت) لكل صورة قديمة، فتفتح الصفحات أسرع بكثير
          على بيانات الهاتف. الصور الجديدة تُولّد مصغّرتها تلقائياً عند الرفع.
        </p>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold">
            صور بلا نسخة مصغّرة: <span className="text-primary">{pending ?? "…"}</span>
          </span>
          {!running ? (
            <Button size="sm" onClick={start} disabled={!pending} className="bg-gold-gradient text-primary-foreground">
              <ImageDown className="size-4 ml-1" /> توليد المصغّرات
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => { stopRef.current = true; }}>
              <StopCircle className="size-4 ml-1" /> إيقاف
            </Button>
          )}
          {running && <Loader2 className="size-4 animate-spin text-primary" />}
        </div>

        {(running || done > 0 || failed > 0) && (
          <div className="space-y-1">
            <Progress value={pct} />
            <p className="text-[11px] text-muted-foreground">
              {done} من {total}
              {failed > 0 && <span className="text-destructive"> · {failed} فشل</span>}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
