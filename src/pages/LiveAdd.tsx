// إضافة مباشرة: تدفّق صارم لكل قطعة على حدة — مسح وجه الباركود من الوسم أولاً، ثم
// مسح وجه بيانات الوسم (الوزن/العيار مطبوعان جاهزان عليه فتُقرآن تلقائياً بدل الكتابة
// اليدوية)، ثم تتحول الكاميرا تلقائياً لوضع تصوير القطعة، ثم حفظ فوري قبل الانتقال
// للقطعة التالية تلقائياً. هذا يختلف عن صفحة "رفع قطع جديدة": هناك تصوير عادي (قطعة
// واحدة بضغطة) أو تصوير متتالي (عدة قطع دفعة واحدة ثم رفعها معاً)، بينما هنا كل قطعة
// تُحفظ فوراً بمجرد اكتمال خطواتها، ما يمنع التباس أي باركود/وزن بقطعة غير قطعته.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, Camera, Check, X, ScanLine, RotateCcw, ImageOff, RefreshCw, CheckCircle2, SkipForward, ScanText, Loader2, FolderUp } from "lucide-react";
import { toast } from "sonner";
import { runUploadBatch } from "@/lib/uploadRunner";
import { useBoxedBarcodeScanner } from "@/lib/useBoxedBarcodeScanner";
import { decodeBarcodeFromFile } from "@/lib/decodeBarcodeFromImage";
import ScanBoxOverlay from "@/components/ScanBoxOverlay";
import type { CapturedFile } from "@/components/BulkCameraCapture";

const NO_BRANCH = "__none__";

type Stage = "scan" | "info" | "photo" | "review";
type SavedItem = { id: string; url: string; weight: string; barcode: string | null };

// يحوّل "18KB"/"21 K"/"18 كارات" إلى "18K"/"21K" المعروفتين في النظام — أي شكل آخر يُترك فارغاً
// ليقرره الذكاء الاصطناعي لاحقاً بدل تخمين خاطئ.
function normalizeKarat(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/(18|21)/);
  if (!m) return null;
  return `${m[1]}K`;
}

export default function LiveAdd() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [branchId, setBranchId] = useState<string>(profile?.branch_id ?? NO_BRANCH);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const weightRef = useRef<HTMLInputElement>(null);
  const barcodeFileRef = useRef<HTMLInputElement>(null);
  const infoFileRef = useRef<HTMLInputElement>(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [flash, setFlash] = useState(false);
  const [barcodeUploadLoading, setBarcodeUploadLoading] = useState(false);

  const [stage, setStage] = useState<Stage>("scan");
  const [pendingBarcode, setPendingBarcode] = useState<string | null>(null);
  const [confirmedBarcode, setConfirmedBarcode] = useState<string | null>(null);

  const [infoUrl, setInfoUrl] = useState<string | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [weight, setWeight] = useState("");
  const [karat, setKarat] = useState<string | null>(null);
  const [itemType, setItemType] = useState<string | null>(null);

  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
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

  // فحص مستمر للباركود فقط في مرحلة "scan"، ومحصور بمنطقة إطار التصويب الظاهر على
  // الشاشة فقط (وليس الصورة كاملة) — هذا يقرأ تحديداً الباركود الذي يُحوَّم فوقه
  // الموظف، لا أي باركود آخر ظاهر بالخطأ في زاوية الصورة (شائع في خزائن العرض المزدحمة).
  useBoxedBarcodeScanner(videoRef, stage === "scan" && ready, (text) => setPendingBarcode(text));

  useEffect(() => {
    if (stage === "review") setTimeout(() => weightRef.current?.focus(), 50);
  }, [stage]);

  useEffect(() => {
    return () => {
      if (capturedUrl) URL.revokeObjectURL(capturedUrl);
      if (infoUrl) URL.revokeObjectURL(infoUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirmBarcode = () => {
    setConfirmedBarcode(pendingBarcode);
    setPendingBarcode(null);
    setStage("info");
  };

  const skipBarcode = () => {
    setConfirmedBarcode(null);
    setPendingBarcode(null);
    setStage("info");
  };

  const grabFrame = (): { blob: Promise<Blob | null>; dataUrl: string } | null => {
    const video = videoRef.current;
    if (!video || !ready) return null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    const blob = new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return { blob, dataUrl };
  };

  // يقرأ وجه بيانات الوسم (BRANCH/KARAT/TYPE/WEIGHT) عبر الذكاء الاصطناعي من أي مصدر
  // صورة (لقطة كاميرا حية أو ملف مرفوع من المعرض) — يملأ الوزن والعيار تلقائياً بدل
  // الكتابة اليدوية، مع بقاء الحقول قابلة للتعديل دائماً.
  const analyzeInfoTag = async (dataUrl: string) => {
    setInfoUrl(dataUrl);
    setInfoLoading(true);
    try {
      const base64 = dataUrl.split(",")[1] ?? "";
      const { data, error: fnError } = await supabase.functions.invoke("analyze-tag", {
        body: { imageBase64: base64, mimeType: "image/jpeg" },
      });
      if (fnError) throw fnError;
      if ((data as any)?.error) throw new Error((data as any).error);
      const tag = (data as any)?.tag ?? {};
      if (tag.weight_grams != null) setWeight(String(tag.weight_grams));
      const normalizedKarat = normalizeKarat(tag.karat_raw ?? null);
      if (normalizedKarat) setKarat(normalizedKarat);
      if (tag.type_raw) setItemType(tag.type_raw);
      if (!confirmedBarcode && tag.barcode) setConfirmedBarcode(tag.barcode);
      const gotSomething = tag.weight_grams != null || normalizedKarat || tag.type_raw;
      toast[gotSomething ? "success" : "error"](
        gotSomething ? "تم قراءة بيانات الوسم — تحقّق منها قبل المتابعة" : "لم يتّضح شيء في الصورة — أدخل الوزن يدوياً أو أعد المحاولة",
      );
    } catch (e: any) {
      toast.error(e?.message ?? "تعذّرت قراءة الوسم — أدخل الوزن يدوياً");
    } finally {
      setInfoLoading(false);
    }
  };

  const captureInfoTag = () => {
    const frame = grabFrame();
    if (!frame) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
    if (navigator.vibrate) navigator.vibrate(15);
    void analyzeInfoTag(frame.dataUrl);
  };

  // رفع صورة وجه الباركود من المعرض بدل المسح الحي — يجرّب كل الزوايا تلقائياً.
  const handleBarcodeFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBarcodeUploadLoading(true);
    try {
      const text = await decodeBarcodeFromFile(file);
      if (text) {
        setConfirmedBarcode(text);
        toast.success("تم قراءة الباركود من الصورة");
        setStage("info");
      } else {
        toast.error("تعذّرت قراءة الباركود من هذه الصورة — جرّب صورة أوضح أو أدخله يدوياً");
      }
    } finally {
      setBarcodeUploadLoading(false);
    }
  };

  // رفع صورة وجه بيانات الوسم من المعرض بدل التصوير الحي.
  const handleInfoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => void analyzeInfoTag(String(reader.result));
    reader.readAsDataURL(file);
  };

  const retakeInfo = () => {
    if (infoUrl) URL.revokeObjectURL(infoUrl);
    setInfoUrl(null);
  };

  const proceedToPhoto = () => setStage("photo");
  const skipInfo = () => { setInfoUrl(null); setStage("photo"); };

  const capturePhoto = async () => {
    const frame = grabFrame();
    if (!frame) return;
    const blob = await frame.blob;
    if (!blob) return;
    setCapturedBlob(blob);
    setCapturedUrl(URL.createObjectURL(blob));
    setStage("review");
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
    if (navigator.vibrate) navigator.vibrate(15);
  };

  const retakePhoto = () => {
    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    setCapturedBlob(null);
    setCapturedUrl(null);
    setStage("photo");
  };

  const resetForNext = () => {
    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    if (infoUrl) URL.revokeObjectURL(infoUrl);
    setCapturedBlob(null);
    setCapturedUrl(null);
    setInfoUrl(null);
    setWeight("");
    setKarat(null);
    setItemType(null);
    setConfirmedBarcode(null);
    setPendingBarcode(null);
    setStage("scan");
  };

  const saveAndNext = async () => {
    if (!capturedBlob || !user) return;
    setSaving(true);
    const file = new File([capturedBlob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" }) as CapturedFile & { karat?: string; itemType?: string };
    const w = parseFloat(weight);
    if (!isNaN(w) && w > 0) file.weightGrams = w;
    if (confirmedBarcode) file.barcodeValue = confirmedBarcode;
    if (karat) file.karat = karat;
    if (itemType) file.itemType = itemType;

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
            {stage === "scan" && "١. امسح وجه الباركود"}
            {stage === "info" && "٢. صوّر وجه بيانات الوسم"}
            {stage === "photo" && "٣. صوّر القطعة"}
            {stage === "review" && "٤. تحقّق واحفظ"}
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
        ) : stage === "info" && infoUrl ? (
          <img src={infoUrl} alt="" className="w-full h-full object-contain" />
        ) : stage === "review" && capturedUrl ? (
          <img src={capturedUrl} alt="" className="w-full h-full object-contain" />
        ) : (
          <video ref={videoRef} playsInline muted className="w-full h-full object-contain" />
        )}
        {flash && <div className="absolute inset-0 bg-white/80 animate-pulse" />}

        {(infoLoading || barcodeUploadLoading) && (
          <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-2 text-white">
            <Loader2 className="size-8 animate-spin" />
            <p className="text-sm">{barcodeUploadLoading ? "جارٍ قراءة الباركود من الصورة…" : "جارٍ قراءة الوسم…"}</p>
          </div>
        )}

        {/* مرحلة المسح: إطار تصويب يحدّد بدقة المنطقة التي يُقرأ منها الباركود فقط،
            بالإضافة لشريط الباركود المكتشَف */}
        {stage === "scan" && (
          <>
            <ScanBoxOverlay active={!!pendingBarcode} />
            <div className="absolute top-3 inset-x-3 space-y-2">
              {pendingBarcode ? (
                <div className="flex items-center gap-2 bg-status-available/90 text-white rounded-xl px-3 py-2 shadow-lg">
                  <ScanLine className="size-4 shrink-0" />
                  <span className="text-xs font-mono truncate flex-1" dir="ltr">{pendingBarcode}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 bg-white/10 text-white/80 rounded-xl px-3 py-2 text-xs justify-center">
                  <ScanLine className="size-4 shrink-0 animate-pulse" /> ضع الباركود داخل الإطار وحوّم فوقه بثبات
                </div>
              )}
            </div>
          </>
        )}

        {stage === "info" && !infoUrl && (
          <div className="absolute top-3 inset-x-3">
            <div className="flex items-center gap-2 bg-white/10 text-white/80 rounded-xl px-3 py-2 text-xs justify-center text-center">
              <ScanText className="size-4 shrink-0" /> صوّر الوجه المطبوع عليه BRANCH/KARAT/TYPE/WEIGHT
            </div>
          </div>
        )}
      </div>

      {/* أزرار كل مرحلة */}
      <input ref={barcodeFileRef} type="file" accept="image/*" className="hidden" onChange={handleBarcodeFileChange} />
      <input ref={infoFileRef} type="file" accept="image/*" className="hidden" onChange={handleInfoFileChange} />

      {stage === "scan" && (
        <div className="flex flex-col items-center gap-3 py-6 safe-area-pb bg-black/60">
          <div className="flex items-center justify-center gap-4">
            <Button variant="outline" className="text-white border-white/30 bg-transparent" onClick={skipBarcode}>
              <SkipForward className="size-4 ml-1" /> تخطّي (بدون باركود)
            </Button>
            <Button onClick={confirmBarcode} disabled={!pendingBarcode} className="bg-gold-gradient text-primary-foreground shadow-gold">
              <Check className="size-4 ml-1" /> تأكيد ومتابعة
            </Button>
          </div>
          <button
            onClick={() => barcodeFileRef.current?.click()}
            disabled={barcodeUploadLoading}
            className="flex items-center gap-1.5 text-xs text-white/70 underline underline-offset-2 disabled:opacity-50"
          >
            <FolderUp className="size-3.5" /> أو ارفع صورة الباركود من المعرض
          </button>
        </div>
      )}

      {stage === "info" && !infoUrl && (
        <div className="flex flex-col items-center gap-3 py-6 safe-area-pb bg-black/60">
          <Button variant="outline" className="text-white border-white/30 bg-transparent" onClick={skipInfo}>
            <SkipForward className="size-4 ml-1" /> تخطّي (إدخال يدوي لاحقاً)
          </Button>
          <button
            onClick={captureInfoTag}
            disabled={!ready}
            className="size-16 rounded-full border-4 border-white flex items-center justify-center disabled:opacity-40"
            aria-label="التقاط صورة الوسم"
          >
            <ScanText className="size-6 text-white" />
          </button>
          <button
            onClick={() => infoFileRef.current?.click()}
            className="flex items-center gap-1.5 text-xs text-white/70 underline underline-offset-2"
          >
            <FolderUp className="size-3.5" /> أو ارفع صورة وجه البيانات من المعرض
          </button>
        </div>
      )}

      {stage === "info" && infoUrl && !infoLoading && (
        <div className="flex flex-col items-center gap-3 py-5 safe-area-pb bg-black/60 px-4">
          <div className="flex items-center gap-2 w-full max-w-xs">
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              placeholder="الوزن (جم)"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              className="flex-1 h-11 rounded-lg bg-white/10 border border-white/25 text-white text-center placeholder:text-white/40 focus:bg-white/20 focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <input
              type="text"
              placeholder="العيار (18K)"
              value={karat ?? ""}
              onChange={(e) => setKarat(e.target.value || null)}
              dir="ltr"
              className="w-24 h-11 rounded-lg bg-white/10 border border-white/25 text-white text-center placeholder:text-white/40 focus:bg-white/20 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          {confirmedBarcode && <p className="text-[11px] text-white/60 font-mono" dir="ltr">باركود: {confirmedBarcode}</p>}
          <div className="flex items-center gap-3 w-full max-w-xs">
            <Button variant="outline" className="flex-1 text-white border-white/30 bg-transparent" onClick={retakeInfo}>
              <RefreshCw className="size-4 ml-1" /> إعادة
            </Button>
            <Button onClick={proceedToPhoto} className="flex-1 bg-gold-gradient text-primary-foreground shadow-gold">
              <Check className="size-4 ml-1" /> متابعة
            </Button>
          </div>
        </div>
      )}

      {stage === "photo" && (
        <div className="flex flex-col items-center gap-3 py-6 safe-area-pb bg-black/60">
          <div className="flex items-center gap-3 text-[11px] text-white/60">
            {confirmedBarcode && <span className="font-mono" dir="ltr">باركود: {confirmedBarcode}</span>}
            {weight && <span>الوزن: {weight} جم</span>}
          </div>
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
            <input
              type="text"
              placeholder="العيار"
              value={karat ?? ""}
              onChange={(e) => setKarat(e.target.value || null)}
              dir="ltr"
              className="w-20 h-11 rounded-lg bg-white/10 border border-white/25 text-white text-center placeholder:text-white/40 focus:bg-white/20 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <input
            type="text"
            placeholder="الباركود (اختياري)"
            value={confirmedBarcode ?? ""}
            onChange={(e) => setConfirmedBarcode(e.target.value || null)}
            dir="ltr"
            className="w-full max-w-xs h-9 rounded-lg bg-white/10 border border-white/25 text-white text-center text-xs font-mono placeholder:text-white/40 focus:bg-white/20 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <div className="flex items-center gap-3 w-full max-w-xs">
            <Button variant="outline" className="flex-1 text-white border-white/30 bg-transparent" onClick={retakePhoto}>
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
