// كاميرا مستمرة داخل التطبيق: تفتح مرة واحدة وتبقى مفتوحة، فيلتقط الموظف عشرات القطع
// بضغطة زر متتالية دون إغلاق/فتح تطبيق الكاميرا في كل مرة (وهو ما يجعل رفع فرع كامل
// بطيئاً جداً مع <input capture>). كل الصور المُلتقطة تُرسَل دفعة واحدة لنفس خط الرفع
// والتحليل الخلفي الحالي (runUploadBatch) عند الضغط على "تم".
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, X, Check, Trash2, RotateCcw, ImageOff } from "lucide-react";
import { toast } from "sonner";

type Shot = { id: string; url: string; blob: Blob };

interface Props {
  open: boolean;
  onClose: () => void;
  onDone: (files: File[]) => void;
}

export default function BulkCameraCapture({ open, onClose, onDone }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [facing, setFacing] = useState<"environment" | "user">("environment");

  useEffect(() => {
    if (!open) return;
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
  }, [open, facing]);

  // تحرير روابط الصور الملتقطة عند إغلاق المكوّن نهائياً لتفادي تسرّب الذاكرة
  useEffect(() => {
    if (!open) {
      shots.forEach((s) => URL.revokeObjectURL(s.url));
      setShots([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const capture = () => {
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
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setShots((prev) => [...prev, { id, url: URL.createObjectURL(blob), blob }]);
      },
      "image/jpeg",
      0.9,
    );
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
    if (navigator.vibrate) navigator.vibrate(15);
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
    const files = shots.map(
      (s, i) => new File([s.blob], `capture-${Date.now()}-${i}.jpg`, { type: "image/jpeg" }),
    );
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
      </div>

      {/* شريط مصغّرات الصور الملتقطة */}
      {shots.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-3 py-2 bg-black/60">
          {shots.map((s) => (
            <div key={s.id} className="relative shrink-0">
              <img src={s.url} alt="" className="size-14 rounded-lg object-cover border border-white/20" />
              <button
                onClick={() => removeShot(s.id)}
                className="absolute -top-1.5 -left-1.5 size-5 rounded-full bg-destructive flex items-center justify-center"
                aria-label="حذف الصورة"
              >
                <Trash2 className="size-3 text-white" />
              </button>
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
    </div>
  );
}
