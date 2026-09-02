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
import { Camera, FolderUp, Loader2, Sparkles, X, CheckCircle2, AlertCircle, Layers, ImageOff } from "lucide-react";
import { toast } from "sonner";
import { runUploadBatch } from "@/lib/uploadRunner";
import { useUploadQueue, uploadQueue } from "@/lib/uploadQueue";

const NO_BRANCH = "__none__";
const PLACEHOLDER_NAME = "قطعة جديدة";

export default function Upload() {
  const { user, profile } = useAuth();
  const [trayMode, setTrayMode] = useState(false);
  const [branchId, setBranchId] = useState<string>(profile?.branch_id ?? NO_BRANCH);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const queue = useUploadQueue();

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

  const handleFiles = (files: FileList | null) => {
    if (!files || !files.length) return;
    if (!user) return toast.error("سجّل الدخول أولاً");
    void runUploadBatch(files, {
      userId: user.id,
      branchId: branchId === NO_BRANCH ? null : branchId,
      trayMode,
    });
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
          <Button variant="outline" className="h-12" onClick={() => cameraRef.current?.click()}>
            <Camera className="size-4 ml-2" /> تصوير الآن
          </Button>
          <Button variant="outline" className="h-12" onClick={() => galleryRef.current?.click()}>
            <FolderUp className="size-4 ml-2" /> من المعرض / PDF
          </Button>
        </div>

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
              <img src={it.previewUrl} alt="" className="size-16 rounded-lg object-cover bg-muted shrink-0" />
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
    </div>
  );
}
