// صفحة رفع واحدة موحّدة: صورة لكل قطعة أو صورة صينية فيها عدة قطع، بالجملة أو صورة واحدة.
// - الفرع اختياري دائماً: يمكن تركه فارغاً وتوزيع القطع لاحقاً من صفحة التعديل.
// - يدعم: كاميرا، معرض/عدة صور، ملف PDF (كل صفحة تصبح قطعة).
// - وضع "صينية": يفعّله المستخدم عندما تحتوي الصورة الواحدة على أكثر من قطعة.
// - الرفع والحفظ يعملان في src/lib/uploadRunner.ts بمعزل عن هذا المكوّن، فالتنقّل لصفحة
//   أخرى داخل التطبيق لا يوقفهما — فقط إغلاق التبويب نفسه يوقفهما.
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Camera, FolderUp, Loader2, Sparkles, X, CheckCircle2, AlertCircle, Layers, ImageOff, ScanLine, Gauge, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { runUploadBatch } from "@/lib/uploadRunner";
import { useUploadQueue, uploadQueue } from "@/lib/uploadQueue";
import BulkCameraCapture from "@/components/BulkCameraCapture";

// أسماء موديلات Gemini المعروضة بالترتيب نفسه الذي يجرّبها الخادم به (الأدق أولاً) —
// راجع GEMINI_VISION_MODELS في supabase/functions/_shared/lovable-ai.ts.
const GEMINI_MODEL_LABELS: Record<string, string> = {
  "gemini-2.5-flash": "Gemini 2.5 Flash",
  "gemini-2.5-flash-lite": "Gemini 2.5 Flash-Lite",
  "gemini-3.1-flash-lite": "Gemini 3.1 Flash-Lite",
  "gemini-flash-latest": "Gemini (أحدث إصدار)",
};

type AiUsage = {
  providers: Record<string, { used: number; limit: number }>;
  geminiModels: Record<string, { used: number; limit: number | null }>;
};

const supportsInAppCamera = () =>
  typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

const NO_BRANCH = "__none__";
const PLACEHOLDER_NAME = "قطعة جديدة";

export default function Upload() {
  const { user, profile } = useAuth();
  const [trayMode, setTrayMode] = useState(false);
  const [branchId, setBranchId] = useState<string>(profile?.branch_id ?? NO_BRANCH);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const queue = useUploadQueue();
  const [bulkCameraOpen, setBulkCameraOpen] = useState(false);

  const { data: branches } = useQuery({
    queryKey: ["branches"],
    queryFn: async () => (await supabase.from("branches").select("id,name").eq("is_active", true)).data ?? [],
  });

  const { data: unnamedCount } = useQuery({
    queryKey: ["unnamed-products-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("name", PLACEHOLDER_NAME);
      return count ?? 0;
    },
    refetchInterval: 15_000,
  });

  // استهلاك اليوم التقريبي لمزوّدات التحليل المجانية — يُقرأ من نسخة دالة Edge الحالية
  // فقط (يتصفّر عند إعادة تشغيل باردة)، فهو مؤشر تقريبي لهذه الجلسة لا رقم رسمي دقيق
  // من جوجل/Groq. يتحدّث تلقائياً كلما تغيّر طول طابور الرفع (أي تحليل جديد اكتمل).
  const { data: aiUsage, refetch: refetchUsage } = useQuery<AiUsage>({
    queryKey: ["ai-usage"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("ai-usage");
      if (error) throw error;
      return data as AiUsage;
    },
    refetchOnWindowFocus: false,
    staleTime: 10_000,
  });

  const handleFiles = (files: FileList | File[] | null) => {
    if (!files || !files.length) return;
    if (!user) return toast.error("سجّل الدخول أولاً");
    void runUploadBatch(files, {
      userId: user.id,
      branchId: branchId === NO_BRANCH ? null : branchId,
      trayMode,
    }).then(() => refetchUsage());
  };

  const openCamera = () => {
    if (supportsInAppCamera()) setBulkCameraOpen(true);
    else cameraRef.current?.click();
  };

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="size-6 text-primary" />
            رفع قطع جديدة
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            صوّر أو ارفع صوراً (أو PDF) — كل صورة تُرفع وتُحلّل وتُحفظ على حدة فور اكتمالها، فيمكنك البدء بالعمل على ما
            اكتمل بينما البقية لا تزال قيد التحليل. يمكنك مغادرة هذه الصفحة والاستمرار في العمل، الرفع يستمر. الفرع
            اختياري.
          </p>
        </div>
        <Link to="/upload/review">
          <Button variant="outline" className="shrink-0 relative">
            <ImageOff className="size-4 ml-1" />
            مراجعة غير المسمّاة
            {!!unnamedCount && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                {unnamedCount > 99 ? "99+" : unnamedCount}
              </span>
            )}
          </Button>
        </Link>
      </div>

      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 p-3">
          <div className="flex items-center gap-2">
            <Layers className="size-4 text-primary shrink-0" />
            <div>
              <p className="text-sm font-semibold">وضع الصينية</p>
              <p className="text-xs text-muted-foreground">فعّله إذا كانت الصورة الواحدة تحتوي أكثر من قطعة</p>
            </div>
          </div>
          <Switch checked={trayMode} onCheckedChange={setTrayMode} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <input ref={galleryRef} type="file" accept="image/*,application/pdf,.pdf" multiple className="hidden" onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
          <Button variant="outline" className="h-12" onClick={openCamera}>
            <Camera className="size-4 ml-2" /> تصوير متتالي
          </Button>
          <Button variant="outline" className="h-12" onClick={() => galleryRef.current?.click()}>
            <FolderUp className="size-4 ml-2" /> من المعرض / PDF
          </Button>
        </div>
        {supportsInAppCamera() && (
          <p className="text-xs text-muted-foreground -mt-2">
            تفتح الكاميرا وتبقى مفتوحة — صوّر كل قطعة بضغطة ثم اضغط "تم" في النهاية لرفعها كلها دفعة واحدة.
          </p>
        )}

        {supportsInAppCamera() && (
          <Link to="/live-add">
            <Button variant="secondary" className="h-11 w-full">
              <ScanLine className="size-4 ml-2" /> إضافة مباشرة (باركود ثم صورة لكل قطعة)
            </Button>
          </Link>
        )}

        <div>
          <label className="text-xs text-muted-foreground">الفرع (اختياري — يمكن تحديده لاحقاً)</label>
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger className="h-11">
              <SelectValue placeholder="بدون فرع" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_BRANCH}>بدون فرع (لاحقاً)</SelectItem>
              {(branches ?? []).map((b: any) => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {aiUsage && (
        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Gauge className="size-4 text-primary shrink-0" />
              <p className="text-sm font-semibold">استهلاك التحليل اليوم (تقريبي)</p>
            </div>
            <button
              onClick={() => refetchUsage()}
              className="p-1.5 -m-1.5 text-muted-foreground hover:text-foreground"
              aria-label="تحديث"
            >
              <RefreshCw className="size-3.5" />
            </button>
          </div>
          <div className="space-y-1.5">
            {Object.entries(aiUsage.geminiModels)
              .filter(([, u]) => u.used > 0 || u.limit != null)
              .map(([model, u]) => (
                <UsageRow key={model} label={GEMINI_MODEL_LABELS[model] ?? model} used={u.used} limit={u.limit} />
              ))}
            {Object.entries(aiUsage.providers)
              .filter(([name]) => name !== "gemini")
              .map(([name, u]) => (
                <UsageRow key={name} label={name === "groq" ? "Groq" : "OpenRouter"} used={u.used} limit={u.limit} />
              ))}
          </div>
          <p className="text-[11px] text-muted-foreground pt-1">
            تقديري لهذه الجلسة فقط (يتصفّر عند إعادة تشغيل الخادم) — وحدود Gemini تُكتشف فعلياً من أول رفض 429 لكل
            موديل، فتبقى "؟" حتى تُصادف الحد لأول مرة.
          </p>
        </Card>
      )}

      {queue.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">{queue.length} عنصر في هذه الجلسة</p>
          <Button variant="ghost" size="sm" onClick={() => uploadQueue.clearFinished()}>
            مسح المكتمل
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {queue.map((it) => (
          <Card key={it.id} className="overflow-hidden">
            <div className="flex gap-3 p-3 items-center">
              <img src={it.previewUrl} alt="" className="size-16 rounded-lg object-contain bg-muted shrink-0" />
              <div className="flex-1 min-w-0">
                {(it.status === "uploading" || it.status === "analyzing" || it.status === "saving") && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Loader2 className="size-3 animate-spin" /> {it.label}
                  </p>
                )}
                {it.status === "done" && (
                  <p className="text-xs text-primary flex items-center gap-1">
                    <CheckCircle2 className="size-3" /> {it.label}
                  </p>
                )}
                {it.status === "error" && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertCircle className="size-3" /> {it.message ?? "فشل"}
                  </p>
                )}
              </div>
              <button
                onClick={() => uploadQueue.remove(it.id)}
                className="size-6 rounded-full bg-muted flex items-center justify-center shrink-0"
                aria-label="إزالة من القائمة"
              >
                <X className="size-3" />
              </button>
            </div>
          </Card>
        ))}
      </div>

      {queue.length === 0 && (
        <p className="text-center text-sm text-muted-foreground py-12">
          لم تختر أي صور بعد. اضغط أحد الزرين أعلاه لبدء الرفع.
        </p>
      )}

      <BulkCameraCapture
        open={bulkCameraOpen}
        onClose={() => setBulkCameraOpen(false)}
        onDone={(files) => handleFiles(files)}
      />
    </div>
  );
}

function UsageRow({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const danger = limit != null && used >= limit;
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-0.5">
        <span className={danger ? "text-destructive font-medium" : "text-foreground"}>{label}</span>
        <span className="text-muted-foreground font-mono" dir="ltr">
          {used} / {limit ?? "؟"}
        </span>
      </div>
      {limit != null && (
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full ${danger ? "bg-destructive" : "bg-primary"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
