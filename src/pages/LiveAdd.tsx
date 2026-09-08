// إضافة مباشرة: شاشة واحدة مستمرة بدل خطوات متتالية منفصلة — الكاميرا تعمل كقارئ
// باركود تلقائي طوال الوقت: بمجرد أن "ترى" الباركود تكتبه في الحقل من تلقاء نفسها بلا
// أي ضغطة تأكيد. الموظف يبقى فقط بحاجة لإدخال الوزن (يدوياً، أو تلقائياً من صورة وسم
// البيانات) والتقاط صورة القطعة. بمجرد اكتمال الحقول الثلاثة (باركود أو تخطّيه/وزن/صورة)
// يظهر زر تأكيد واحد يحفظ القطعة فوراً ويعيد الشاشة جاهزة للقطعة التالية تلقائياً —
// لا تنقّل بين شاشات، لا خطوات إضافية، فقط: صوّب → اكتب الوزن → صوّر → أكّد.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, Camera, Check, X, ScanLine, RotateCcw, ImageOff, CheckCircle2, ScanText, Loader2, FolderUp, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { runUploadBatch } from "@/lib/uploadRunner";
import { useBoxedBarcodeScanner } from "@/lib/useBoxedBarcodeScanner";
import { decodeBarcodeFromFile } from "@/lib/decodeBarcodeFromImage";
import { readInfoTagLocally } from "@/lib/readInfoTag";
import ScanBoxOverlay from "@/components/ScanBoxOverlay";
import type { CapturedFile } from "@/components/BulkCameraCapture";

const NO_BRANCH = "__none__";
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
  const tagFilesRef = useRef<HTMLInputElement>(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [flash, setFlash] = useState(false);

  // الحقول الثلاثة المطلوبة قبل الحفظ
  const [barcode, setBarcode] = useState<string | null>(null);
  const [barcodeSkipped, setBarcodeSkipped] = useState(false);
  const [weight, setWeight] = useState("");
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);

  const [karat, setKarat] = useState<string | null>(null);
  const [itemType, setItemType] = useState<string | null>(null);

  const [tagUploadLoading, setTagUploadLoading] = useState(false);
  const [tagLoading, setTagLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<SavedItem[]>([]);

  const { data: branches } = useQuery({
    queryKey: ["branches"],
    queryFn: async () => (await supabase.from("branches").select("id,name,code").eq("is_active", true)).data ?? [],
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

  // الكاميرا تعمل كقارئ باركود دائم: تفحص باستمرار طالما لم يُكتب الباركود بعد ولم
  // تُلتقط صورة القطعة بعد (بعدها لا داعي للفحص). بمجرد رؤية باركود صالح يُكتب في الحقل
  // تلقائياً فوراً — بلا أي ضغطة تأكيد من الموظف.
  const scanning = ready && !barcode && !barcodeSkipped && !capturedBlob;
  useBoxedBarcodeScanner(videoRef, scanning, (text) => {
    setBarcode(text);
    if (navigator.vibrate) navigator.vibrate([15, 40, 15]);
    toast.success("تم التقاط الباركود تلقائياً: " + text, { duration: 2500 });
  });

  useEffect(() => {
    return () => { if (capturedUrl) URL.revokeObjectURL(capturedUrl); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearBarcode = () => { setBarcode(null); setBarcodeSkipped(false); };

  // يطابق رمز الفرع المقروء من الوسم (BRANCH: 01...) مع قائمة الفروع عبر عمود code —
  // ويختار الفرع تلقائياً بدل اختياره يدوياً في كل مرة. لا يفعل شيئاً إن كان الرمز غير
  // معروف (لا فرع بهذا الكود بعد) فيبقى الاختيار اليدوي كما هو دائماً كخيار آمن.
  const applyBranchCode = (code: string | null | undefined) => {
    if (!code) return;
    const match = (branches ?? []).find((b: any) => b.code === code);
    if (match) setBranchId(match.id);
  };

  const fileToDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  // يستدعي قراءة وسم الذكاء الاصطناعي فقط، بلا تحديث حالة ولا toast — يُستخدم من كل من
  // اللقطة الحية (تحديث فوري + toast خاص بها) ورفع الملفات المتعددة (تجميع النتائج
  // وtoast واحد في النهاية).
  // محاولتان قبل الاستسلام — الفشل العابر (ازدحام مؤقت لمزوّدات الذكاء الاصطناعي) شائع
  // ولا يجب أن يُفسَّر خطأً بأن الصورة "لا تحتوي بيانات وسم" (كان هذا سبب تصنيف وجه
  // البيانات خطأً كصورة قطعة عند فشل النداء الأول فقط).
  const fetchTagInfo = async (dataUrl: string): Promise<{ weight_grams: number | null; karat_raw: string | null; type_raw: string | null; barcode: string | null; branch_code?: string | null } | null> => {
    const base64 = dataUrl.split(",")[1] ?? "";
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { data, error: fnError } = await supabase.functions.invoke("analyze-tag", {
          body: { imageBase64: base64, mimeType: "image/jpeg" },
        });
        if (fnError) throw fnError;
        if ((data as any)?.error) throw new Error((data as any).error);
        return (data as any)?.tag ?? null;
      } catch (e) {
        lastErr = e;
        if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
      }
    }
    throw lastErr;
  };

  // يشغّل القارئ المحلي المخصّص لوجه البيانات (Tesseract.js OCR — فوري، بلا شبكة) بالتوازي
  // مع نداء الذكاء الاصطناعي بدل التسلسل — الخط النقطي (dot-matrix) على وسوم المحل صغير
  // ومائل غالباً، فالـOCR المحلي البسيط لا ينجح دائماً؛ التوازي يعني أن فشله لا يُكلّف أي
  // وقت إضافي (المدة الكلية = الأبطأ بينهما، لا مجموعهما)، بينما نجاحه السريع يُغني فوراً
  // عن انتظار الشبكة أصلاً.
  const resolveInfoTag = async (
    source: Blob,
    dataUrl: string,
  ): Promise<{ weight_grams: number | null; karat_raw: string | null; type_raw: string | null; barcode: string | null; branch_code?: string | null } | null> => {
    const localPromise = readInfoTagLocally(source).catch(() => null);
    const aiPromise = fetchTagInfo(dataUrl);
    const local = await localPromise;
    if (local) return { ...local, barcode: null };
    return aiPromise;
  };

  // قراءة وجه بيانات الوسم (BRANCH/KARAT/TYPE/WEIGHT) من الكاميرا الحية — تملأ الوزن
  // والعيار تلقائياً بدل الكتابة اليدوية.
  const captureTagFromCamera = async () => {
    const video = videoRef.current;
    if (!video || !ready) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
    if (navigator.vibrate) navigator.vibrate(15);

    setTagLoading(true);
    try {
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
      const tag = blob ? await resolveInfoTag(blob, dataUrl) : await fetchTagInfo(dataUrl);
      const normalizedKarat = normalizeKarat(tag?.karat_raw ?? null);
      if (tag?.weight_grams != null) setWeight(String(tag.weight_grams));
      if (normalizedKarat) setKarat(normalizedKarat);
      if (tag?.type_raw) setItemType(tag.type_raw);
      applyBranchCode(tag?.branch_code);
      if (!barcode && tag?.barcode) { setBarcode(tag.barcode); setBarcodeSkipped(false); }
      const gotSomething = tag?.weight_grams != null || normalizedKarat || tag?.type_raw;
      toast[gotSomething ? "success" : "error"](
        gotSomething ? "تم قراءة بيانات الوسم" : "لم يتّضح شيء في الصورة — اكتب الوزن يدوياً",
      );
    } catch (e: any) {
      toast.error(e?.message ?? "تعذّرت قراءة الوسم — اكتب الوزن يدوياً");
    } finally {
      setTagLoading(false);
    }
  };

  // رفع عدة صور دفعة واحدة (وجه الباركود، وجه بيانات الوسم، وصورة القطعة نفسها — أي
  // مزيج منها بأي عدد) والتعرّف تلقائياً على كل صورة بلا حاجة لتحديد أيّها: كل صورة
  // تُفحص أولاً كوجه باركود (ZXing)، ثم كوجه بيانات (BRANCH/KARAT/TYPE/WEIGHT عبر
  // الذكاء الاصطناعي) — وأي صورة لا تُطابق أياً من الوجهين تُعتبر تلقائياً صورة القطعة
  // نفسها (أول صورة غير مُتعرَّف عليها فقط، إن كانت صورة القطعة غير مُلتقطة بعد).
  const handleUploadFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    setTagUploadLoading(true);
    let gotBarcode = false;
    let gotInfo = false;
    let gotPhoto = false;
    let unclear = 0;
    try {
      for (const file of files) {
        let isBarcodeFace = false;
        let isInfoFace = false;
        let ocrFailed = false;

        try {
          const zxingText = await decodeBarcodeFromFile(file);
          if (zxingText) {
            isBarcodeFace = true;
            if (!barcode) { setBarcode(zxingText); setBarcodeSkipped(false); gotBarcode = true; }
          }
        } catch { /* هذه الصورة على الأرجح ليست وجه الباركود */ }

        let dataUrl: string | null = null;
        try {
          dataUrl = await fileToDataUrl(file);
          const tag = await resolveInfoTag(file, dataUrl);
          const normalizedKarat = normalizeKarat(tag?.karat_raw ?? null);
          if (tag?.weight_grams != null || normalizedKarat || tag?.type_raw) isInfoFace = true;
          if (tag?.weight_grams != null) { setWeight(String(tag.weight_grams)); gotInfo = true; }
          if (normalizedKarat) { setKarat(normalizedKarat); gotInfo = true; }
          if (tag?.type_raw) setItemType(tag.type_raw);
          applyBranchCode(tag?.branch_code);
          if (!barcode && !gotBarcode && tag?.barcode) { setBarcode(tag.barcode); setBarcodeSkipped(false); gotBarcode = true; isBarcodeFace = true; }
        } catch {
          // فشل نداء الذكاء الاصطناعي فعلياً (شبكة/ازدحام) — هذا لا يعني إطلاقاً أن
          // الصورة خالية من بيانات الوسم، فلا نُصنّفها كصورة قطعة أبداً في هذه الحالة.
          ocrFailed = true;
        }

        // نضعها كصورة القطعة فقط عندما نتأكد فعلاً أنها ليست أياً من وجهي الوسم: فشل فك
        // تشفير الباركود، ونجحت قراءة الذكاء الاصطناعي لكنها لم تجد فيها أي بيانات وسم.
        if (!isBarcodeFace && !isInfoFace && !ocrFailed && !gotPhoto && !capturedBlob) {
          setCapturedBlob(file);
          setCapturedUrl(dataUrl ?? URL.createObjectURL(file));
          gotPhoto = true;
        } else if (ocrFailed && !isBarcodeFace) {
          unclear++;
        }
      }

      const found = [gotBarcode && "الباركود", gotInfo && "بيانات الوسم", gotPhoto && "صورة القطعة"].filter(Boolean);
      if (found.length) toast.success("تم التعرّف على: " + found.join("، "));
      if (unclear > 0) toast.error(`تعذّرت قراءة ${unclear > 1 ? "صورتين أو أكثر" : "صورة واحدة"} بسبب ازدحام مؤقت — أعد رفعها`);
      if (!found.length && !unclear) toast.error("تعذّرت قراءة أي شيء من الصور — جرّب صوراً أوضح أو أدخل البيانات يدوياً");
    } finally {
      setTagUploadLoading(false);
    }
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
      },
      "image/jpeg",
      0.9,
    );
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
    if (navigator.vibrate) navigator.vibrate(15);
  };

  const retakePhoto = () => {
    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    setCapturedBlob(null);
    setCapturedUrl(null);
  };

  const resetForNext = () => {
    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    setCapturedBlob(null);
    setCapturedUrl(null);
    setWeight("");
    setKarat(null);
    setItemType(null);
    setBarcode(null);
    setBarcodeSkipped(false);
  };

  // الحقول الثلاثة المطلوبة: باركود (أو تخطّيه صراحة) + وزن + صورة — بمجرد اكتمالها
  // الثلاثة يظهر زر التأكيد الوحيد.
  const hasBarcodeStep = !!barcode || barcodeSkipped;
  const hasWeight = weight.trim() !== "" && !isNaN(parseFloat(weight)) && parseFloat(weight) > 0;
  const hasPhoto = !!capturedBlob;
  const canConfirm = hasBarcodeStep && hasWeight && hasPhoto;

  const confirmAndSave = async () => {
    if (!canConfirm || !capturedBlob || !user) return;
    setSaving(true);
    const file = new File([capturedBlob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" }) as CapturedFile & { karat?: string; itemType?: string };
    const w = parseFloat(weight);
    if (!isNaN(w) && w > 0) file.weightGrams = w;
    if (barcode) file.barcodeValue = barcode;
    if (karat) file.karat = karat;
    if (itemType) file.itemType = itemType;

    try {
      await runUploadBatch([file], {
        userId: user.id,
        branchId: branchId === NO_BRANCH ? null : branchId,
        trayMode: false,
      });
      setSaved((prev) => [{ id: file.name, url: capturedUrl!, weight, barcode }, ...prev].slice(0, 20));
      toast.success("تم حفظ القطعة — جاهز للتالية");
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
          <p className="text-sm font-semibold">إضافة مباشرة</p>
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

      {/* منطقة الكاميرا/المعاينة */}
      <div className="relative flex-1 overflow-hidden bg-black flex items-center justify-center">
        {error ? (
          <div className="text-center text-white p-6 space-y-2">
            <ImageOff className="size-10 mx-auto text-white/70" />
            <p className="font-semibold">{error}</p>
          </div>
        ) : capturedUrl ? (
          <img src={capturedUrl} alt="" className="w-full h-full object-contain" />
        ) : (
          <video ref={videoRef} playsInline muted className="w-full h-full object-contain" />
        )}
        {flash && <div className="absolute inset-0 bg-white/80 animate-pulse" />}

        {(tagLoading || tagUploadLoading) && (
          <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-2 text-white">
            <Loader2 className="size-8 animate-spin" />
            <p className="text-sm">{tagUploadLoading ? "جارٍ قراءة الصور المرفوعة…" : "جارٍ قراءة الوسم…"}</p>
          </div>
        )}

        {/* إطار التصويب + رقم الباركود يظهران فوق الكاميرا مباشرة أثناء الفحص وبعده */}
        {scanning && (
          <>
            <ScanBoxOverlay active={false} />
            <div className="absolute top-3 inset-x-3 flex items-center gap-2 bg-white/10 text-white/70 rounded-xl px-3 py-2 text-xs justify-center">
              <ScanLine className="size-4 shrink-0 animate-pulse" /> وجّه الكاميرا نحو الباركود…
            </div>
          </>
        )}
        {barcode && !capturedUrl && (
          <div className="absolute top-3 inset-x-3 flex items-center gap-2 bg-status-available/90 text-white rounded-xl px-3 py-2.5 shadow-lg">
            <ScanLine className="size-5 shrink-0" />
            <span className="text-base font-mono font-bold flex-1 text-center tracking-wider" dir="ltr">{barcode}</span>
            <button onClick={clearBarcode} className="shrink-0 p-1 -m-1" aria-label="مسح الباركود وإعادة المسح">
              <X className="size-4" />
            </button>
          </div>
        )}

        {/* صورة القطعة مُلتقطة — زر إعادة تصوير صغير */}
        {capturedUrl && (
          <button
            onClick={retakePhoto}
            className="absolute top-3 left-3 flex items-center gap-1.5 bg-white/15 text-white text-xs rounded-full px-3 py-1.5"
          >
            <RefreshCw className="size-3.5" /> إعادة التصوير
          </button>
        )}
      </div>

      {/* شريط الحقول الثلاثة — دائماً ظاهر، تُملأ بأي ترتيب */}
      <input ref={tagFilesRef} type="file" accept="image/*" multiple className="hidden" onChange={handleUploadFiles} />

      <div className="bg-black/70 safe-area-pb">
        {/* حالة الباركود */}
        <div className="flex items-center gap-2 px-4 pt-3">
          {barcode ? (
            <button onClick={clearBarcode} className="flex-1 flex items-center gap-2 bg-status-available/20 border border-status-available/60 text-status-available rounded-lg px-3 py-2">
              <ScanLine className="size-4 shrink-0" />
              <span className="text-xs font-mono truncate flex-1 text-right" dir="ltr">{barcode}</span>
              <X className="size-3.5 shrink-0" />
            </button>
          ) : barcodeSkipped ? (
            <button onClick={clearBarcode} className="flex-1 flex items-center gap-2 bg-white/10 text-white/70 rounded-lg px-3 py-2">
              <span className="text-xs flex-1">بدون باركود</span>
              <X className="size-3.5 shrink-0" />
            </button>
          ) : (
            <>
              <div className="flex-1 flex items-center gap-2 bg-white/10 text-white/60 rounded-lg px-3 py-2">
                <ScanLine className="size-4 shrink-0 animate-pulse" />
                <span className="text-xs">وجّه الكاميرا نحو الباركود…</span>
              </div>
              <button onClick={() => setBarcodeSkipped(true)} className="shrink-0 text-[11px] text-white/50 underline underline-offset-2 px-1">
                تخطّي
              </button>
            </>
          )}
        </div>

        {/* رفع عدة صور دفعة واحدة (باركود/وسم/صورة القطعة بأي عدد وترتيب) — يتعرّف
            النظام تلقائياً على كل صورة بلا حاجة لتحديد أيّها */}
        <div className="px-4 pt-1.5">
          <button
            onClick={() => tagFilesRef.current?.click()}
            disabled={tagUploadLoading}
            className="w-full flex items-center justify-center gap-1.5 text-xs text-white/70 underline underline-offset-2 disabled:opacity-50 py-0.5"
          >
            <FolderUp className="size-3.5" /> أو ارفع الصور (باركود / وسم / صورة القطعة — بأي عدد)
          </button>
        </div>

        {/* الوزن + قراءة تلقائية من الوسم بالكاميرا */}
        <div className="flex items-center gap-2 px-4 pt-2">
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            placeholder="الوزن (جم) *"
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
          <button onClick={() => void captureTagFromCamera()} disabled={!ready} className="shrink-0 h-11 w-11 flex items-center justify-center bg-white/10 rounded-lg text-white disabled:opacity-40" aria-label="قراءة الوزن من صورة الوسم">
            <ScanText className="size-5" />
          </button>
        </div>

        {/* التقاط صورة القطعة + زر التأكيد */}
        <div className="flex items-center justify-center gap-6 py-4">
          <button
            onClick={capturePhoto}
            disabled={!ready}
            className="relative size-16 rounded-full border-4 flex items-center justify-center disabled:opacity-40"
            style={{ borderColor: hasPhoto ? "#22c55e" : "white" }}
            aria-label="التقاط صورة القطعة"
          >
            <Camera className="size-6 text-white" />
            {hasPhoto && <CheckCircle2 className="absolute -top-1 -left-1 size-5 text-status-available bg-black rounded-full" />}
          </button>
          <Button
            onClick={confirmAndSave}
            disabled={!canConfirm || saving}
            className="h-14 px-8 text-base bg-gold-gradient text-primary-foreground shadow-gold disabled:opacity-30"
          >
            {saving ? "جارٍ الحفظ…" : <><Check className="size-5 ml-2" /> تأكيد وحفظ</>}
          </Button>
        </div>

        {!canConfirm && (
          <p className="text-center text-[11px] text-white/40 pb-2">
            {!hasBarcodeStep ? "امسح الباركود أو اضغط تخطّي" : !hasWeight ? "اكتب الوزن" : "صوّر القطعة"}
          </p>
        )}
      </div>

      {/* شريط القطع المُضافة هذه الجلسة */}
      {saved.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-3 pb-3 bg-black/70">
          {saved.map((s) => (
            <div key={s.id} className="relative shrink-0">
              <img src={s.url} alt="" className="size-12 rounded-lg object-contain bg-black border border-status-available/60" />
              <CheckCircle2 className="absolute -top-1.5 -left-1.5 size-4 text-status-available bg-black rounded-full" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
