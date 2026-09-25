// مسح باركود وسم القطعة من شاشة البحث — يُحمَّل عند الحاجة فقط (React.lazy): مكتبة القراءة
// ~100KB مضغوطة ولا داعي لتحميلها مع كل فتح للتطبيق. نفس إطار التصويب وقارئ المنطقة
// المحصورة المستخدمين في كاميرا الإضافة (useBoxedBarcodeScanner) — يقرأ الوسم المصوَّب عليه
// فقط لا وسوم القطع المجاورة في نفس الخزانة.
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import ScanBoxOverlay from "@/components/ScanBoxOverlay";
import { useBoxedBarcodeScanner } from "@/lib/useBoxedBarcodeScanner";

export default function BarcodeScanDialog({
  open,
  onOpenChange,
  onDetect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDetect: (text: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState(false);

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    setError(null);
    setFound(false);
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) return;
        // الـDialog يرسم محتواه بعد لحظة من الفتح — ننتظر ظهور عنصر الفيديو.
        for (let i = 0; i < 20 && !videoRef.current && !cancelled; i++) {
          await new Promise((r) => setTimeout(r, 50));
        }
        if (cancelled || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      } catch {
        setError("تعذّر فتح الكاميرا — اسمح للتطبيق باستخدام الكاميرا من الإعدادات");
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open]);

  useBoxedBarcodeScanner(videoRef, open && !found && !error, (text) => {
    setFound(true);
    if (navigator.vibrate) navigator.vibrate([15, 40, 15]);
    onDetect(text.trim());
    onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 gap-0 overflow-hidden bg-black border-0 max-w-md [&>button]:hidden">
        <DialogTitle className="sr-only">مسح باركود القطعة</DialogTitle>
        <div className="relative aspect-[3/4] w-full">
          <video ref={videoRef} playsInline muted className="absolute inset-0 size-full object-cover" />
          {!error && <ScanBoxOverlay active={found} />}
          {error && (
            <p className="absolute inset-x-4 top-1/2 -translate-y-1/2 text-center text-sm text-white">{error}</p>
          )}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="absolute top-3 left-3 size-10 rounded-full bg-black/60 text-white flex items-center justify-center"
            aria-label="إغلاق"
          >
            <X className="size-5" />
          </button>
          <p className="absolute inset-x-0 bottom-4 text-center text-sm font-semibold text-white drop-shadow">
            وجّه الإطار نحو باركود الوسم
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
