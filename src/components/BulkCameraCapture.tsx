// كاميرا مستمرة داخل التطبيق: تفتح مرة واحدة وتبقى مفتوحة، فيلتقط الموظف عشرات القطع
// بضغطة زر متتالية دون إغلاق/فتح تطبيق الكاميرا في كل مرة (وهو ما يجعل رفع فرع كامل
// بطيئاً جداً مع <input capture>). بعد كل صورة يظهر حقل وزن صغير يُركَّز عليه تلقائياً
// (الميزان أمام الموظف عادة) لتسجيل الوزن فوراً قبل الانتقال للقطعة التالية. وبينما
// الكاميرا مفتوحة، تُفحص كل إطارات الفيديو تلقائياً بحثاً عن باركود/QR عبر واجهة
// BarcodeDetector المدمجة في المتصفح (بدون مكتبة خارجية) — بمجرد اكتشاف باركود يظهر
// شريط أخضر أعلى الشاشة، ويُرفق تلقائياً بالصورة القادمة التي تُلتقط. كل الصور (مع
// أوزانها وباركوداتها) تُرسَل دفعة واحدة لنفس خط الرفع والتحليل الخلفي الحالي
// (runUploadBatch) عند الضغط على "تم" — يبقى تحليل الذكاء الاصطناعي فقط لتحديد
// الاسم/الفئة/العيار والوصف.
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, X, Check, Trash2, RotateCcw, ImageOff, Scale, ScanLine } from "lucide-react";
import { useBoxedBarcodeScanner } from "@/lib/useBoxedBarcodeScanner";
import ScanBoxOverlay from "@/components/ScanBoxOverlay";

type Shot = { id: string; url: string; blob: Blob; weight: string; barcode: string };

export type CapturedFile = File & { weightGrams?: number; barcodeValue?: string };

interface Props {
  open: boolean;
  onClose: () => void;
  onDone: (files: CapturedFile[]) => void;
}

export default function BulkCameraCapture({ open, onClose, onDone }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [pendingBarcode, setPendingBarcode] = useState<string | null>(null);
  const weightInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const lastShotId = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setReady(false);
    setError(null);
    setPendingBarcode(null);

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
  }, [open, facing]);

  // فحص مستمر للباركود/QR — محصور بمنطقة إطار التصويب الظاهر على الشاشة فقط (وليس
  // الصورة كاملة)، فيقرأ تحديداً الباركود الذي يُحوَّم فوقه الموظف بدل أي باركود آخر
  // ظاهر بالخطأ في زاوية الصورة (شائع في خزائن العرض المزدحمة). يبقى "بانتظار" حتى
  // يُرفق تلقائياً بالصورة القادمة.
  useBoxedBarcodeScanner(videoRef, open && ready, (text) => setPendingBarcode(text));

  // تحرير روابط الصور الملتقطة عند إغلاق المكوّن نهائياً لتفادي تسرّب الذاكرة
  useEffect(() => {
    if (!open) {
      shots.forEach((s) => URL.revokeObjectURL(s.url));
      setShots([]);
      weightInputRefs.current = {};
      lastShotId.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // تركيز تلقائي على حقل وزن آخر صورة مُلتقطة — الميزان أمام الموظف عادة فور تصوير القطعة
  useEffect(() => {
    if (!lastShotId.current) return;
    const el = weightInputRefs.current[lastShotId.current];
    if (el) {
      el.focus();
      el.select();
    }
  }, [shots.length]);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !ready) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const barcodeForShot = pendingBarcode ?? "";
    setPendingBarcode(null);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        lastShotId.current = id;
        setShots((prev) => [...prev, { id, url: URL.createObjectURL(blob), blob, weight: "", barcode: barcodeForShot }]);
      },
      "image/jpeg",
      0.9,
    );
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
    if (navigator.vibrate) navigator.vibrate(15);
  };

  const setWeight = (id: string, weight: string) => {
    setShots((prev) => prev.map((s) => (s.id === id ? { ...s, weight } : s)));
  };

  const setBarcode = (id: string, barcode: string) => {
    setShots((prev) => prev.map((s) => (s.id === id ? { ...s, barcode } : s)));
  };

  const removeShot = (id: string) => {
    setShots((prev) => {
      const target = prev.find((s) => s.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((s) => s.id !== id);
    });
  };

  const finish = () => {
    if (!shots.length) return onClose();
    const files: CapturedFile[] = shots.map((s, i) => {
      const file = new File([s.blob], `capture-${Date.now()}-${i}.jpg`, { type: "image/jpeg" }) as CapturedFile;
      const w = parseFloat(s.weight);
      if (!isNaN(w) && w > 0) file.weightGrams = w;
      if (s.barcode.trim()) file.barcodeValue = s.barcode.trim();
      return file;
    });
    onDone(files);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* شريط علوي */}
      <div className="flex items-center justify-between px-4 py-3 safe-area-pt text-white bg-black/60">
        <button onClick={onClose} className="p-2 -m-2" aria-label="إغلاق">
          <X className="size-6" />
        </button>
        <p className="text-sm font-semibold">{shots.length > 0 ? `${shots.length} صورة مُلتقطة` : "صوّر القطع واحدة تلو الأخرى"}</p>
        <button onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))} className="p-2 -m-2" aria-label="تبديل الكاميرا">
          <RotateCcw className="size-5" />
        </button>
      </div>

      {/* عرض الكاميرا */}
      <div className="relative flex-1 overflow-hidden bg-black flex items-center justify-center">
        {error ? (
          <div className="text-center text-white p-6 space-y-2">
            <ImageOff className="size-10 mx-auto text-white/70" />
            <p className="font-semibold">{error}</p>
          </div>
        ) : (
          <video ref={videoRef} playsInline muted className="w-full h-full object-contain" />
        )}
        {flash && <div className="absolute inset-0 bg-white/80 animate-pulse" />}

        {/* إطار تصويب يحدّد بدقة المنطقة التي يُقرأ منها الباركود فقط */}
        <ScanBoxOverlay active={!!pendingBarcode} />

        {/* شريط الباركود المكتشَف — سيُرفق تلقائياً بالصورة القادمة */}
        {pendingBarcode && (
          <div className="absolute top-3 inset-x-3 flex items-center gap-2 bg-status-available/90 text-white rounded-xl px-3 py-2 shadow-lg">
            <ScanLine className="size-4 shrink-0" />
            <span className="text-xs font-mono truncate flex-1" dir="ltr">{pendingBarcode}</span>
            <span className="text-[10px] shrink-0">سيُرفق بالصورة القادمة</span>
            <button onClick={() => setPendingBarcode(null)} className="shrink-0 p-1 -m-1" aria-label="تجاهل الباركود">
              <X className="size-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* شريط مصغّرات الصور الملتقطة مع حقلي وزن وباركود لكل صورة */}
      {shots.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-3 py-2 bg-black/60">
          {shots.map((s) => (
            <div key={s.id} className="relative shrink-0 flex flex-col items-center gap-1">
              <div className="relative">
                <img src={s.url} alt="" className="size-14 rounded-lg object-contain bg-black border border-white/20" />
                <button
                  onClick={() => removeShot(s.id)}
                  className="absolute -top-1.5 -left-1.5 size-5 rounded-full bg-destructive flex items-center justify-center"
                  aria-label="حذف الصورة"
                >
                  <Trash2 className="size-3 text-white" />
                </button>
                {s.barcode && (
                  <span className="absolute -bottom-1 -left-1 -right-1 flex justify-center">
                    <ScanLine className="size-3 text-status-available bg-black/70 rounded-full p-0.5" />
                  </span>
                )}
              </div>
              <input
                ref={(el) => { weightInputRefs.current[s.id] = el; }}
                type="number"
                inputMode="decimal"
                step="0.01"
                placeholder="وزن (جم)"
                value={s.weight}
                onChange={(e) => setWeight(s.id, e.target.value)}
                className="w-16 h-7 rounded-md bg-white/10 border border-white/25 text-white text-[10px] text-center placeholder:text-white/40 focus:bg-white/20 focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <input
                type="text"
                inputMode="text"
                placeholder="باركود"
                value={s.barcode}
                onChange={(e) => setBarcode(s.id, e.target.value)}
                dir="ltr"
                className="w-16 h-6 rounded-md bg-white/10 border border-white/25 text-white text-[9px] text-center font-mono placeholder:text-white/40 focus:bg-white/20 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          ))}
        </div>
      )}

      {/* أزرار التحكم */}
      <div className="flex items-center justify-center gap-8 py-6 safe-area-pb bg-black/60">
        <Button
          variant="ghost"
          className="text-white"
          onClick={() => shots.length && setShots((prev) => { const [last, ...rest] = [...prev].reverse(); if (last) URL.revokeObjectURL(last.url); return rest.reverse(); })}
          disabled={!shots.length}
        >
          تراجع
        </Button>
        <button
          onClick={capture}
          disabled={!ready}
          className="size-16 rounded-full border-4 border-white flex items-center justify-center disabled:opacity-40"
          aria-label="التقاط صورة"
        >
          <div className="size-12 rounded-full bg-white" />
        </button>
        <Button onClick={finish} className="bg-gold-gradient text-primary-foreground shadow-gold" disabled={!shots.length}>
          <Check className="size-4 ml-1" /> تم ({shots.length})
        </Button>
      </div>

      {shots.length > 0 && (
        <p className="flex items-center justify-center gap-1 text-[11px] text-white/50 pb-2 -mt-3">
          <Scale className="size-3" /> الوزن والباركود اختياريان ويُحفظان مباشرة مع القطعة
        </p>
      )}
    </div>
  );
}
