// قارئ باركود حيّ بالكاميرا: يُفتح فوق شاشة المراجعة ليمسح الموظف ليبل قطعة لم يُقرأ كودها من
// الصور (أو انقرا غلط). أول كود يُقرأ داخل الإطار يُعاد للمستدعي وتُغلق النافذة.
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import ScanBoxOverlay from "@/components/ScanBoxOverlay";
import { useBoxedBarcodeScanner } from "@/lib/useBoxedBarcodeScanner";

export default function TagScanDialog({ onDetect, onClose }: { onDetect: (tag: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [found, setFound] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => {
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        if (videoRef.current) { videoRef.current.srcObject = s; void videoRef.current.play().catch(() => {}); setReady(true); }
      })
      .catch(() => { toast.error("تعذّر فتح الكاميرا — اكتب الكود يدوياً"); onClose(); });
    return () => { cancelled = true; stream?.getTracks().forEach((t) => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useBoxedBarcodeScanner(videoRef, ready && !found, (tag) => {
    setFound(tag);
    if (navigator.vibrate) navigator.vibrate(40);
    // لحظة قصيرة ليرى الموظف الكود بالأخضر قبل الإغلاق.
    setTimeout(() => onDetect(tag), 450);
  });

  return (
    <div className="fixed inset-0 z-[70] bg-black flex flex-col" dir="rtl">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <p className="font-semibold text-sm">وجّه الكاميرا على ليبل القطعة</p>
        <button onClick={onClose} aria-label="إغلاق"><X className="size-6" /></button>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-cover" />
        <ScanBoxOverlay active={!!found} />
        {found && (
          <p dir="ltr" className="absolute bottom-10 inset-x-0 mx-auto w-fit rounded-full bg-green-600 px-4 py-2 font-mono text-lg font-bold text-white">{found}</p>
        )}
      </div>
    </div>
  );
}
