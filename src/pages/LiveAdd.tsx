// إضافة مباشرة: تدفّق صارم لكل قطعة على حدة — مسح الباركود أولاً (أو تخطّيه)، تأكيد،
// ثم تتحول الكاميرا تلقائياً لوضع تصوير القطعة، إدخال الوزن، وحفظ فوري قبل الانتقال
// للقطعة التالية تلقائياً. هذا يختلف عن صفحة "رفع قطع جديدة": هناك تصوير عادي (قطعة
// واحدة بضغطة) أو تصوير متتالي (عدة قطع دفعة واحدة ثم رفعها معاً)، بينما هنا كل قطعة
// تُحفظ فوراً بمجرد اكتمال خطواتها الثلاث، ما يمنع التباس أي باركود بقطعة غير قطعته —
// أبطأ قليلاً من التصوير المتتالي لكن أكثر أماناً لمطابقة الباركود بالصورة الصحيحة.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, Camera, Check, X, ScanLine, RotateCcw, ImageOff, RefreshCw, CheckCircle2, SkipForward } from "lucide-react";
import { toast } from "sonner";
import { runUploadBatch } from "@/lib/uploadRunner";
import type { CapturedFile } from "@/components/BulkCameraCapture";

const NO_BRANCH = "__none__";

const supportsBarcodeDetector = () => typeof (window as any).BarcodeDetector !== "undefined";

type Stage = "scan" | "photo" | "review";
type SavedItem = { id: string; url: string; weight: string; barcode: string | null };

export default function LiveAdd() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [branchId, setBranchId] = useState<string>(profile?.branch_id ?? NO_BRANCH);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<any>(null);
  const weightRef = useRef<HTMLInputElement>(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [flash, setFlash] = useState(false);

  const [stage, setStage] = useState<Stage>("scan");
  const [pendingBarcode, setPendingBarcode] = useState<string | null>(null);
  const [confirmedBarcode, setConfirmedBarcode] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [weight, setWeight] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<SavedItem[]>([]);

  const { data: branches } = useQuery({
    queryKey: ["branches"],
    queryFn: async () => (await supabase.from("branches").select("id,name").eq("is_active", true)).data ?? [],
  });

  // فتح الكاميرا مرة واحدة وإبقاؤها مفتوحة طوال الجلسة
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);

    const start = async () => {
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1920 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setReady(true);
      } catch (e: any) {
        setError(e?.name === "NotAllowedError" ? "تم رفض إذن الكاميرا — فعّله من إعدادات المتصفح" : "تعذّر فتح الكاميرا");
      }
    };
    void start();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [facing]);

  // فحص مستمر للباركود فقط في مرحلة "scan" — يتوقف تلقائياً بعد التأكيد/التخطي
  useEffect(() => {
    if (stage !== "scan" || !ready || !supportsBarcodeDetector()) return;
    if (!detectorRef.current) {
      try {
        detectorRef.current = new (window as any).BarcodeDetector({
          formats: ["qr_code", "code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e", "codabar", "itf"],
        });
      } catch {
        return;
      }
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (stopped || !videoRef.current) return;
      try {
        const codes = await detectorRef.current.detect(videoRef.current);
        if (codes?.length && codes[0].rawValue) setPendingBarcode(codes[0].rawValue);
      } catch { /* إطار غير صالح مؤقتاً */ }
      if (!stopped) timer = setTimeout(tick, 500);
    };
    timer = setTimeout(tick, 500);
    return () => { stopped = true; clearTimeout(timer); };
  }, [stage, ready]);

  // تركيز تلقائي على حقل الوزن عند الدخول لمرحلة المراجعة (الميزان أمام الموظف الآن)
  useEffect(() => {
    if (stage === "review") setTimeout(() => weightRef.current?.focus(), 50);
  }, [stage]);

  useEffect(() => {
    return () => { if (capturedUrl) URL.revokeObjectURL(capturedUrl); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirmBarcode = () => {
    setConfirmedBarcode(pendingBarcode);
    setPendingBarcode(null);
    setStage("photo");
  };

  const skipBarcode = () => {
    setConfirmedBarcode(null);
    setPendingBarcode(null);
    setStage("photo");
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video || !ready) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        setCapturedBlob(blob);
        setCapturedUrl(URL.createObjectURL(blob));
        setStage("review");
      },
      "image/jpeg",
      0.9,
    );
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
    if (navigator.vibrate) navigator.vibrate(15);
  };

  const retake = () => {
    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    setCapturedBlob(null);
    setCapturedUrl(null);
    setWeight("");
    setStage("photo");
  };

  const resetForNext = () => {
    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    setCapturedBlob(null);
    setCapturedUrl(null);
    setWeight("");
    setConfirmedBarcode(null);
    setPendingBarcode(null);
    setStage("scan");
  };

  const saveAndNext = async () => {
    if (!capturedBlob || !user) return;
    setSaving(true);
    const file = new File([capturedBlob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" }) as CapturedFile;
    const w = parseFloat(weight);
    if (!isNaN(w) && w > 0) file.weightGrams = w;
    if (confirmedBarcode) file.barcodeValue = confirmedBarcode;

    try {
      await runUploadBatch([file], {
        userId: user.id,
        branchId: branchId === NO_BRANCH ? null : branchId,
        trayMode: false,
      });
      setSaved((prev) => [{ id: file.name, url: capturedUrl!, weight, barcode: confirmedBarcode }, ...prev].slice(0, 20));
      toast.success("تم حفظ القطعة — التالية جاهزة");
    } catch (e: any) {
      toast.error(e?.message ?? "فشل حفظ القطعة");
    } finally {
      setSaving(false);
      resetForNext();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* شريط علوي */}
      <div className="flex items-center justify-between px-4 py-3 safe-area-pt text-white bg-black/60 gap-2">
        <button onClick={() => navigate("/upload")} className="p-2 -m-2" aria-label="رجوع">
          <ArrowRight className="size-6" />
        </button>
        <div className="text-center">
          <p className="text-sm font-semibold">
            {stage === "scan" && "١. امسح الباركود"}
            {stage === "photo" && "٢. صوّر القطعة"}
            {stage === "review" && "٣. أدخل الوزن واحفظ"}
          </p>
          {saved.length > 0 && <p className="text-[10px] text-white/60">{saved.length} قطعة أُضيفت هذه الجلسة</p>}
        </div>
        <button onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))} className="p-2 -m-2" aria-label="تبديل الكاميرا">
          <RotateCcw className="size-5" />
        </button>
      </div>

      {/* الفرع */}
      <div className="px-4 py-2 bg-black/60">
        <Select value={branchId} onValueChange={setBranchId}>
          <SelectTrigger className="h-9 bg-white/10 border-white/25 text-white text-xs">
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

      {/* منطقة العرض الرئيسية */}
      <div className="relative flex-1 overflow-hidden bg-black flex items-center justify-center">
        {error ? (
          <div className="text-center text-white p-6 space-y-2">
            <ImageOff className="size-10 mx-auto text-white/70" />
            <p className="font-semibold">{error}</p>
          </div>
        ) : stage === "review" && capturedUrl ? (
          <img src={capturedUrl} alt="" className="w-full h-full object-contain" />
        ) : (
          <video ref={videoRef} playsInline muted className="w-full h-full object-contain" />
        )}
        {flash && <div className="absolute inset-0 bg-white/80 animate-pulse" />}

        {/* مرحلة المسح: شريط الباركود المكتشَف + أزرار تأكيد/تخطي */}
        {stage === "scan" && (
          <div className="absolute top-3 inset-x-3 space-y-2">
            {pendingBarcode ? (
              <div className="flex items-center gap-2 bg-status-available/90 text-white rounded-xl px-3 py-2 shadow-lg">
                <ScanLine className="size-4 shrink-0" />
                <span className="text-xs font-mono truncate flex-1" dir="ltr">{pendingBarcode}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 bg-white/10 text-white/80 rounded-xl px-3 py-2 text-xs justify-center">
                <ScanLine className="size-4 shrink-0 animate-pulse" /> وجّه الكاميرا نحو الباركود…
              </div>
            )}
          </div>
        )}
      </div>

      {/* أزرار كل مرحلة */}
      {stage === "scan" && (
        <div className="flex items-center justify-center gap-4 py-6 safe-area-pb bg-black/60">
          <Button variant="outline" className="text-white border-white/30 bg-transparent" onClick={skipBarcode}>
            <SkipForward className="size-4 ml-1" /> تخطّي (بدون باركود)
          </Button>
          <Button onClick={confirmBarcode} disabled={!pendingBarcode} className="bg-gold-gradient text-primary-foreground shadow-gold">
            <Check className="size-4 ml-1" /> تأكيد ومتابعة
          </Button>
        </div>
      )}

      {stage === "photo" && (
        <div className="flex flex-col items-center gap-3 py-6 safe-area-pb bg-black/60">
          {confirmedBarcode && (
            <p className="text-[11px] text-white/60 font-mono" dir="ltr">باركود: {confirmedBarcode}</p>
          )}
          <button
            onClick={capturePhoto}
            disabled={!ready}
            className="size-16 rounded-full border-4 border-white flex items-center justify-center disabled:opacity-40"
            aria-label="التقاط صورة"
          >
            <Camera className="size-6 text-white" />
          </button>
        </div>
      )}

      {stage === "review" && (
        <div className="flex flex-col items-center gap-3 py-5 safe-area-pb bg-black/60 px-4">
          <div className="flex items-center gap-2 w-full max-w-xs">
            <input
              ref={weightRef}
              type="number"
              inputMode="decimal"
              step="0.01"
              placeholder="الوزن (جم)"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              className="flex-1 h-11 rounded-lg bg-white/10 border border-white/25 text-white text-center placeholder:text-white/40 focus:bg-white/20 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          {confirmedBarcode && <p className="text-[11px] text-white/60 font-mono" dir="ltr">باركود: {confirmedBarcode}</p>}
          <div className="flex items-center gap-3 w-full max-w-xs">
            <Button variant="outline" className="flex-1 text-white border-white/30 bg-transparent" onClick={retake}>
              <RefreshCw className="size-4 ml-1" /> إعادة التصوير
            </Button>
            <Button onClick={saveAndNext} disabled={saving} className="flex-1 bg-gold-gradient text-primary-foreground shadow-gold">
              {saving ? "جارٍ الحفظ…" : <><Check className="size-4 ml-1" /> حفظ والتالي</>}
            </Button>
          </div>
        </div>
      )}

      {/* شريط القطع المُضافة هذه الجلسة */}
      {saved.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-3 pb-3 bg-black/60">
          {saved.map((s) => (
            <div key={s.id} className="relative shrink-0">
              <img src={s.url} alt="" className="size-12 rounded-lg object-cover border border-status-available/60" />
              <CheckCircle2 className="absolute -top-1.5 -left-1.5 size-4 text-status-available bg-black rounded-full" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
