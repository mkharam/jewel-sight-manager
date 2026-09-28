// لوحة المدير: نقل صور القطع الموجودة من تخزين Supabase (تجاوز حصة الخطة المجانية) إلى
// Cloudflare R2. النسخ نفسه يتم داخل Worker الصور (مسار /copy، للمدير العام فقط) — المتصفح
// يرسل قائمة المسارات فقط على دفعات صغيرة، فلا تمرّ الصور عبر بيانات الهاتف. ما نُسخ من قبل
// يُتخطّى، فإعادة التشغيل آمنة وتلتقط أي صورة رُفعت لـSupabase أثناء النقل.
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CloudUpload, Loader2, StopCircle } from "lucide-react";
import { r2Worker } from "@/lib/productImages";
import { toast } from "sonner";

// خطة Workers المجانية تسمح بـ50 طلباً خارجياً لكل استدعاء — كل صورة طلب، فنبقى دونها بكثير.
const BATCH = 20;
const PAGE = 1000;

async function allImagePaths(): Promise<string[]> {
  const out = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("product_images")
      .select("storage_path,thumb_path")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    data?.forEach((r) => {
      out.add(r.storage_path);
      if (r.thumb_path) out.add(r.thumb_path);
    });
    if (!data || data.length < PAGE) break;
  }
  return Array.from(out);
}

/** رفع صورة تجريبية صغيرة ثم حذفها — يتأكد أن الـWorker والحاوية والصلاحيات تعمل قبل البدء. */
async function selfTest(userId: string) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("تعذّر تجهيز صورة الاختبار");
  const route = `/o/imports/${userId}/r2-selftest-${Date.now()}.png`;
  await r2Worker("PUT", route, blob, { "Content-Type": "image/png" });
  await r2Worker("DELETE", route);
}

export default function MigrateToR2Card() {
  const { user } = useAuth();
  const [running, setRunning] = useState(false);
  const [total, setTotal] = useState(0);
  const [copied, setCopied] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  const [finished, setFinished] = useState(false);
  const stopRef = useRef(false);

  const start = async () => {
    if (!user) return;
    setRunning(true);
    setFinished(false);
    stopRef.current = false;
    setCopied(0);
    setSkipped(0);
    setFailed([]);
    let c = 0, s = 0;
    const f: string[] = [];
    try {
      await selfTest(user.id);
      const paths = await allImagePaths();
      setTotal(paths.length);
      for (let i = 0; i < paths.length && !stopRef.current; i += BATCH) {
        const res = await r2Worker("POST", "/copy", JSON.stringify({ paths: paths.slice(i, i + BATCH) }), {
          "Content-Type": "application/json",
        });
        c += res.copied ?? 0;
        s += res.skipped ?? 0;
        f.push(...(res.failed ?? []));
        setCopied(c);
        setSkipped(s);
        setFailed([...f]);
      }
      if (!stopRef.current) {
        setFinished(true);
        if (f.length) toast.warning(`اكتمل النقل مع ${f.length} صورة تعذّر نسخها`);
        else toast.success("اكتمل نقل كل الصور إلى Cloudflare");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذّر نقل الصور");
    } finally {
      setRunning(false);
      stopRef.current = false;
    }
  };

  const done = copied + skipped + failed.length;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <CloudUpload className="size-4 text-primary" />
          نقل الصور إلى Cloudflare
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          مساحة الصور في Supabase تجاوزت حدّ الخطة المجانية. هذا الزر ينسخ كل صور القطع إلى تخزين
          Cloudflare (مجاني حتى 10GB). الصور تبقى في مكانها القديم أيضاً، ولا يتغيّر شيء على الموظفين
          حتى يكتمل النقل. يمكن إعادة تشغيله بأمان — ما نُسخ يُتخطّى.
        </p>

        <div className="flex items-center gap-2 flex-wrap">
          {!running ? (
            <Button size="sm" onClick={start} className="bg-gold-gradient text-primary-foreground">
              <CloudUpload className="size-4 ml-1" /> نقل الصور
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => { stopRef.current = true; }}>
              <StopCircle className="size-4 ml-1" /> إيقاف
            </Button>
          )}
          {running && <Loader2 className="size-4 animate-spin text-primary" />}
          {finished && !failed.length && <span className="text-sm font-semibold text-primary">اكتمل ✓</span>}
        </div>

        {(running || done > 0) && (
          <div className="space-y-1">
            <Progress value={pct} />
            <p className="text-[11px] text-muted-foreground">
              {done} من {total || "…"} · نُسخ {copied}
              {skipped > 0 && <> · موجود مسبقاً {skipped}</>}
              {failed.length > 0 && <span className="text-destructive"> · {failed.length} فشل</span>}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
