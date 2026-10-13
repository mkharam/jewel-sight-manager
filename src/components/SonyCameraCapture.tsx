// تصوير متتالي بكاميرا خارجية: Sony a7 III عبر USB (برنامج Imaging Edge Webcam) أو أي كاميرا
// عبر كرت التقاط HDMI — كلها تظهر للمتصفح كأنها كاميرا ويب. شاشة مستقلة تماماً عن «تصوير
// متتالي» بكاميرا الجهاز (BulkCameraCapture) ولا تشاركها أي كود، حتى لا يتأثر أحدهما بالآخر.
//
// خياران: بثّ مباشر من الكاميرا (يلتقط الإطار الحيّ، وهو بدقة ما تُخرجه الكاميرا للحاسوب
// وغالباً Full HD)، أو «استيراد صور» التُقطت بالكاميرا نفسها بأعلى دقة (JPEG من بطاقة SD)،
// وتُرفع بحجمها الأصلي بترتيب أسماء الملفات. كل صورة قطعة، ثم يكتب الموظف وزنها تحتها.
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Trash2, RotateCcw, Scale, ImagePlus, Loader2, AlertCircle, Video } from "lucide-react";
import { normalizeDecimalInput } from "@/lib/constants";
import { saveCapturedPiece, updateCapturedPiece, deleteCapturedPiece, analyzeCapturedPiece } from "@/lib/uploadRunner";
import { toast } from "sonner";
import { isBuiltInCamera } from "@/lib/cameras";

const DEVICE_KEY = "sony.deviceId";
// أسماء شائعة لكاميرات Sony وكروت التقاط HDMI — للتفضيل التلقائي فقط.
const isCaptureLike = (label: string) =>
  /sony|ilce|imaging edge|alpha|cam link|elgato|capture|hdmi|usb video|magewell|avermedia|blackmagic|decklink/i.test(label);
const readSaved = () => { try { return localStorage.getItem(DEVICE_KEY) || ""; } catch { return ""; } };
const writeSaved = (id: string) => {
  try { if (id) localStorage.setItem(DEVICE_KEY, id); else localStorage.removeItem(DEVICE_KEY); } catch { /* ignore */ }
};

type SaveState = "saving" | "saved" | "error";
type Shot = { id: string; url: string; weight: string; saveState: SaveState };

interface Props {
  open: boolean;
  onClose: () => void;
  userId: string;
  branchId: string | null;
  onFinished?: (savedProductIds: string[]) => void;
}

export default function SonyCameraCapture({ open, onClose, userId, branchId, onFinished }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [karat, setKarat] = useState<"18K" | "21K">("18K");
  const [flash, setFlash] = useState(false);

  const productIds = useRef<Record<string, string>>({});
  const weights = useRef<Record<string, string>>({});
  const weightTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingDelete = useRef<Set<string>>(new Set());

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setReady(false);
  };

  const refreshDevices = async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const cams = all.filter((d) => d.kind === "videoinput" && !isBuiltInCamera(d.label));
      setDevices(cams);
      return cams;
    } catch {
      return [];
    }
  };

  const start = async (id: string) => {
    stopStream();
    setError(null);
    setDeviceId(id);
    if (!id) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: id }, width: { ideal: 3840 }, height: { ideal: 2160 } },
        audio: false,
      });
      streamRef.current = stream;
      writeSaved(id);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try { await videoRef.current.play(); } catch { /* تجاهل */ }
      }
      setReady(true);
      void refreshDevices();
    } catch (e: unknown) {
      const name = (e as { name?: string } | null)?.name;
      if (name === "OverconstrainedError" || name === "NotFoundError") {
        writeSaved("");
        setDeviceId("");
        toast.error("الكاميرا غير متصلة — وصّلها ثم اخترها من القائمة");
      } else {
        setError(name === "NotAllowedError" ? "تم رفض إذن الكاميرا — فعّله من إعدادات المتصفح" : "تعذّر فتح الكاميرا");
      }
    }
  };

  // عند الفتح: نطلب الإذن مرة (حتى تظهر أسماء الكاميرات)، ثم نشغّل آخر كاميرا محفوظة، وإلا
  // كاميرا تبدو Sony/HDMI إن وُجدت، وإلا يختار الموظف من القائمة.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        probe.getTracks().forEach((t) => t.stop());
      } catch (e: unknown) {
        if (!cancelled) setError((e as { name?: string } | null)?.name === "NotAllowedError" ? "تم رفض إذن الكاميرا — فعّله من إعدادات المتصفح" : "تعذّر فتح الكاميرا");
        return;
      }
      const cams = await refreshDevices();
      if (cancelled) return;
      const saved = readSaved();
      const pick = cams.find((d) => d.deviceId === saved)?.deviceId || cams.find((d) => isCaptureLike(d.label))?.deviceId || cams[0]?.deviceId || "";
      if (pick) await start(pick);
    })();
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshDevices);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.("devicechange", refreshDevices);
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open) return;
    shots.forEach((s) => URL.revokeObjectURL(s.url));
    Object.values(weightTimers.current).forEach(clearTimeout);
    setShots([]);
    productIds.current = {};
    weights.current = {};
    weightTimers.current = {};
    pendingDelete.current = new Set();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const markFailed = (id: string, message: string) => {
    setShots((prev) => prev.map((s) => (s.id === id ? { ...s, saveState: "error" } : s)));
    toast.error(message);
  };

  const syncWeight = (id: string) => {
    const productId = productIds.current[id];
    if (!productId) return; // يُطبَّق فور اكتمال الحفظ
    const w = parseFloat(weights.current[id] ?? "");
    updateCapturedPiece(productId, { weight_grams: !isNaN(w) && w > 0 ? w : null })
      .catch(() => markFailed(id, "تعذّر حفظ الوزن — تحقق من الاتصال وأعد كتابته"));
  };

  // كل صورة تُرفع وتُحفظ فوراً لحظة التقاطها/استيرادها، فلا يضيع شيء إن أُغلقت الصفحة.
  const saveShot = (blob: Blob | File) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    weights.current[id] = "";
    setShots((prev) => [...prev, { id, url: URL.createObjectURL(blob), weight: "", saveState: "saving" }]);
    const file = new File([blob], `capture-${id}.jpg`, { type: blob.type || "image/jpeg" });
    saveCapturedPiece(file, { userId, branchId, trayMode: false }, null, null, karat)
      .then(({ productId, imageId }) => {
        if (pendingDelete.current.has(id)) {
          pendingDelete.current.delete(id);
          deleteCapturedPiece(productId).catch(() => toast.error("تعذّر حذف القطعة — احذفها من «مراجعة غير المسمّاة»"));
          return;
        }
        productIds.current[id] = productId;
        setShots((prev) => prev.map((s) => (s.id === id ? { ...s, saveState: "saved" } : s)));
        if (weights.current[id]) syncWeight(id);
        void analyzeCapturedPiece(file, { productId, imageId }, { karat: true, itemType: false }).catch(() => {});
      })
      .catch(() => markFailed(id, "تعذّر حفظ إحدى الصور — تحقق من الاتصال وأعد المحاولة"));
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video || !ready || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => { if (blob) saveShot(blob); }, "image/jpeg", 0.92);
  };

  // استيراد صور الكاميرا (JPEG) بترتيب أسماء الملفات (DSC00001, DSC00002…)، بفاصل قصير حتى لا
  // تنطلق عشرات عمليات الرفع والتحليل معاً.
  const importFiles = async (list: FileList | null) => {
    const files = Array.from(list ?? [])
      .filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (!files.length) return toast.error("اختر صور JPEG — ملفات RAW (ARW) لا يقرؤها المتصفح");
    toast.success(`استيراد ${files.length} صورة…`);
    for (const f of files) {
      saveShot(f);
      await new Promise((r) => setTimeout(r, 250));
    }
  };

  const setWeight = (id: string, weight: string) => {
    weights.current[id] = weight;
    setShots((prev) => prev.map((s) => (s.id === id ? { ...s, weight } : s)));
    clearTimeout(weightTimers.current[id]);
    weightTimers.current[id] = setTimeout(() => syncWeight(id), 500);
  };

  const removeShot = (id: string) => {
    setShots((prev) => {
      const t = prev.find((s) => s.id === id);
      if (t) URL.revokeObjectURL(t.url);
      return prev.filter((s) => s.id !== id);
    });
    clearTimeout(weightTimers.current[id]);
    const productId = productIds.current[id];
    delete productIds.current[id];
    delete weights.current[id];
    if (productId) {
      deleteCapturedPiece(productId).catch(() => toast.error("تعذّر حذف القطعة — لا تزال في الكتالوج، احذفها من «مراجعة غير المسمّاة»"));
    } else {
      pendingDelete.current.add(id);
    }
  };

  const finish = () => {
    const saved = Object.values(productIds.current);
    if (shots.length) toast.success(`تم حفظ ${shots.length} قطعة`);
    onClose();
    if (saved.length) onFinished?.(saved);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col" dir="rtl">
      <div className="flex items-center justify-between gap-2 px-4 py-3 text-white bg-black/60">
        <div className="flex rounded-full bg-white/10 border border-white/25 p-0.5 text-xs font-bold" role="group" aria-label="العيار">
          {(["18K", "21K"] as const).map((k) => (
            <button key={k} onClick={() => setKarat(k)}
              className={`px-2.5 py-1 rounded-full transition-colors ${karat === k ? "bg-primary text-primary-foreground" : "text-white/70"}`}>
              {k}
            </button>
          ))}
        </div>
        <p className="text-sm font-semibold flex items-center gap-1.5">
          <Video className="size-4" /> {shots.length > 0 ? `${shots.length} صورة` : "كاميرا Sony / HDMI"}
        </p>
        <button onClick={() => importRef.current?.click()} className="p-1" aria-label="استيراد صور من الكاميرا" title="استيراد صور من الكاميرا">
          <ImagePlus className="size-5" />
        </button>
      </div>

      <div className="flex items-center gap-2 px-4 pb-3 bg-black/60">
        <select
          value={deviceId}
          onChange={(e) => void start(e.target.value)}
          aria-label="الكاميرا"
          className="flex-1 h-10 rounded-lg bg-white/10 border border-white/25 text-white text-sm px-2 [&>option]:text-black"
        >
          <option value="" disabled>{devices.length ? "اختر الكاميرا…" : "لا توجد كاميرا موصولة بـType-C"}</option>
          {devices.map((d, i) => (
            <option key={d.deviceId || i} value={d.deviceId}>{(d.label || `Camera ${i + 1}`) + (isCaptureLike(d.label) ? "  ★" : "")}</option>
          ))}
        </select>
        <button onClick={() => void start(deviceId)} className="p-2 text-white" aria-label="إعادة تشغيل الكاميرا" title="إعادة تشغيل الكاميرا">
          <RotateCcw className="size-5" />
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden bg-black flex items-center justify-center">
        <video ref={videoRef} playsInline muted className={`w-full h-full object-contain ${ready ? "" : "hidden"}`} />
        {!ready && (
          <div className="text-center text-white p-6 space-y-2 max-w-sm">
            <Video className="size-10 mx-auto text-white/70" />
            <p className="font-semibold text-sm">{error ?? "اختر الكاميرا من القائمة بالأعلى"}</p>
            <p className="text-xs text-white/60 leading-relaxed">
              Sony a7 III: كابل USB وبرنامج Imaging Edge Webcam. أي كاميرا عبر HDMI: كرت التقاط (مثل Cam Link) يظهر هنا كأنه كاميرا.
              ولأعلى دقة صوّر بالكاميرا ثم استورد الصور بالزر أعلى اليسار.
            </p>
          </div>
        )}
        {flash && <div className="absolute inset-0 bg-white/80 animate-pulse" />}
      </div>

      <input ref={importRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden"
        onChange={(e) => { void importFiles(e.target.files); e.target.value = ""; }} />

      {shots.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-3 py-2 bg-black/60">
          {shots.map((s) => (
            <div key={s.id} className="relative shrink-0 flex flex-col items-center gap-1">
              <div className="relative">
                <img src={s.url} alt="" className="size-14 rounded-lg object-contain bg-black border border-white/20" />
                <button onClick={() => removeShot(s.id)} className="absolute -top-1.5 -left-1.5 size-5 rounded-full bg-destructive flex items-center justify-center" aria-label="حذف الصورة">
                  <Trash2 className="size-3 text-white" />
                </button>
                <span className="absolute -bottom-1 -left-1 -right-1 flex justify-center">
                  {s.saveState === "saving" && <Loader2 className="size-3 text-white animate-spin bg-black/70 rounded-full p-0.5" />}
                  {s.saveState === "saved" && <Check className="size-3 text-status-available bg-black/70 rounded-full p-0.5" />}
                  {s.saveState === "error" && <AlertCircle className="size-3 text-destructive bg-black/70 rounded-full p-0.5" />}
                </span>
              </div>
              <input
                type="text"
                inputMode="decimal"
                placeholder="وزن (جم)"
                value={s.weight}
                onChange={(e) => setWeight(s.id, normalizeDecimalInput(e.target.value))}
                onBlur={() => { clearTimeout(weightTimers.current[s.id]); syncWeight(s.id); }}
                className="w-16 h-7 rounded-md bg-white/10 border border-white/25 text-white text-[10px] text-center placeholder:text-white/40 focus:bg-white/20 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-center gap-8 py-6 bg-black/60">
        <Button variant="ghost" className="text-white" onClick={() => shots.length && removeShot(shots[shots.length - 1].id)} disabled={!shots.length}>
          تراجع
        </Button>
        <button onClick={capture} disabled={!ready}
          className="size-16 rounded-full border-4 border-white flex items-center justify-center disabled:opacity-40" aria-label="التقاط صورة">
          <div className="size-12 rounded-full bg-white" />
        </button>
        <Button onClick={finish} className="bg-gold-gradient text-primary-foreground shadow-gold">
          <Check className="size-4 ml-1" /> تم ({shots.length})
        </Button>
      </div>

      {shots.length > 0 && (
        <p className="flex items-center justify-center gap-1 text-[11px] text-white/50 pb-2 -mt-3">
          <Scale className="size-3" /> كل صورة تُحفظ فوراً — الوزن اختياري ويُحفظ تلقائياً أثناء الكتابة
        </p>
      )}
    </div>
  );
}
