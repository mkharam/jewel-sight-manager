// كاميرا مستمرة داخل التطبيق: تفتح مرة واحدة وتبقى مفتوحة، فيلتقط الموظف عشرات القطع
// بضغطة زر متتالية دون إغلاق/فتح تطبيق الكاميرا في كل مرة (وهو ما يجعل رفع فرع كامل
// بطيئاً جداً مع <input capture>). بعد كل صورة يظهر حقل وزن صغير يُركَّز عليه تلقائياً
// (الميزان أمام الموظف عادة) لتسجيل الوزن فوراً قبل الانتقال للقطعة التالية.
//
// كل صورة تُرفع وتُحفظ فوراً لحظة التقاطها (وليس دفعة واحدة عند الضغط على "تم") — إن
// أُغلق التبويب أو قُفل الهاتف أثناء التصوير، كل ما التُقط فعلاً يبقى محفوظاً على الخادم.
// الوزن/الباركود يُزامَنان مع الخادم بعد كتابتهما بقليل (وفوراً إن أُغلق التركيز عن
// الحقل). "تراجع" يحذف آخر قطعة محفوظة فعلاً بدل مجرد إخفائها محلياً.
//
// الباركود التلقائي (قراءة الكاميرا المباشرة) مُعطَّل مؤقتاً (BARCODE_SCAN_ENABLED)
// بطلب صريح — يبقى الكود جاهزاً لإعادة التفعيل بتغيير قيمة واحدة.
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, X, Check, Trash2, RotateCcw, ImageOff, Scale, ScanLine, Loader2, AlertCircle } from "lucide-react";
import { useBoxedBarcodeScanner } from "@/lib/useBoxedBarcodeScanner";
import ScanBoxOverlay from "@/components/ScanBoxOverlay";
import { normalizeDecimalInput } from "@/lib/constants";
import { saveCapturedPiece, updateCapturedPiece, deleteCapturedPiece } from "@/lib/uploadRunner";
import { keepAwake } from "@/lib/keepAwake";
import { toast } from "sonner";

const BARCODE_SCAN_ENABLED = false;

type SaveState = "saving" | "saved" | "error";
type Shot = { id: string; url: string; weight: string; barcode: string; saveState: SaveState };

export type CapturedFile = File & { weightGrams?: number; barcodeValue?: string };

interface Props {
  open: boolean;
  onClose: () => void;
  userId: string;
  branchId: string | null;
  /** بثّ حصلنا عليه داخل نقرة المستخدم — يُستخدم كما هو بدل طلب جديد، راجع openCamera. */
  initialStream?: MediaStream | null;
  /**
   * يُستدعى عند الضغط على "تم" مع معرّفات كل القطع التي حُفظت فعلاً في هذه الجلسة —
   * يُستخدم لأخذ الموظف مباشرة لمراجعتها بدل تركها تُحلَّل وتُسمّى تلقائياً في الخلفية
   * بلا أي مراجعة بشرية (كان هذا يحصل حتى لمجرد تجربة الكاميرا بضغطة "تم" للخروج فقط).
   * لا تشمل صوراً ما زالت قيد الرفع لحظة الضغط على "تم" — تبقى تلك ظاهرة في صفحة
   * "مراجعة غير المسمّاة" العامة حتى تكتمل.
   */
  onFinished?: (savedProductIds: string[]) => void;
}

export default function BulkCameraCapture({ open, onClose, userId, branchId, initialStream, onFinished }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // نعرض canvas بدل video مباشرة — راجع التعليق المطوَّل عند startFramePump أدناه.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameCountRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const pumpActiveRef = useRef(false);
  // دليل فعلي على أن المُستخرَج مرئي لا مجرّد "تم الرسم" — راجع التعليق داخل pump().
  const blackFrameStreakRef = useRef(0);
  const lastPixelRef = useRef<[number, number, number] | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // خلل معروف في WebKit: التطبيق المثبَّت على الآيفون (standalone) لا يُركِّب
  // (compositing) عنصر <video> فوق الشاشة عند تشغيله من MediaStream مباشر — يبقى
  // أسود رغم أن التشغيل غير متوقّف والبثّ حيّ (تحققنا من هذا حرفياً عبر تشخيص حيّ
  // على الجهاز نفسه: paused:0 و tracks:live لكن لا صورة). نفس هذا البثّ يبقى قابلاً
  // لالتقاط إطاراته عبر drawImage إلى <canvas> رغم فشل عرضه في <video> — فنعرض
  // canvas بدل video، ونعتبر الكاميرا "جاهزة" فقط بعد نجاح رسم إطار حقيقي فعلاً،
  // لا بمجرد وصول بيانات وصفية قد تكون مضلِّلة (رأينا videoWidth يُبلَّغ رغم
  // readyState=0 وعدم وجود أي إطار فعلي).
  const startFramePump = (video: HTMLVideoElement) => {
    pumpActiveRef.current = true;
    frameCountRef.current = 0;
    blackFrameStreakRef.current = 0;
    let n = 0;
    const pump = () => {
      if (!pumpActiveRef.current) return;
      const canvas = canvasRef.current;
      const w = video.videoWidth, h = video.videoHeight;
      if (canvas && w > 0 && h > 0 && video.readyState >= 2) {
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, w, h);
          frameCountRef.current++;

          // رسم إطار لا يعني بالضرورة صورة مرئية — رأينا حالة يُسجَّل فيها نجاح الرسم
          // (frameCount>0) والشاشة تبقى سوداء رغم ذلك، أي أن المُستخرَج نفسه أسود أو
          // canvas غير مركَّب بصرياً رغم قبول الرسم برمجياً (نفس فئة خلل WebKit، طبقة
          // مختلفة). نتحقق فعلياً من المحتوى بأخذ عيّنة بكسلات كل عدّة إطارات بدل
          // افتراض أن نجاح drawImage يعني صورة ظاهرة.
          n++;
          if (n % 6 === 0) {
            try {
              const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
              const px = ctx.getImageData(cx, cy, 1, 1).data;
              const bright = px[0] + px[1] + px[2];
              lastPixelRef.current = [px[0], px[1], px[2]];
              if (bright < 6) blackFrameStreakRef.current++;
              else blackFrameStreakRef.current = 0;
            } catch { /* getImageData قد تُمنع (تصحيح خصوصية) — نتجاهل العيّنة فقط */ }
          }

          if (frameCountRef.current === 1) setReady(true);
        }
      }
      rafRef.current =
        "requestVideoFrameCallback" in video
          ? (video as any).requestVideoFrameCallback(pump)
          : requestAnimationFrame(pump);
    };
    pump();
  };

  const stopFramePump = () => {
    pumpActiveRef.current = false;
    if (rafRef.current != null) {
      const video = videoRef.current as any;
      if (video && "cancelVideoFrameCallback" in video) video.cancelVideoFrameCallback(rafRef.current);
      else cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };
  const [shots, setShots] = useState<Shot[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [pendingBarcode, setPendingBarcode] = useState<string | null>(null);
  // العيار يُختار قبل التصوير بدل ترك الذكاء الاصطناعي يخمّنه من الصورة لاحقاً — أغلب
  // المخزون 18K فهو الافتراضي، ويبقى ظاهراً وقابلاً للتبديل طوال الجلسة (القطع عادة
  // مرتّبة حسب العيار في نفس الدرج/الفاترينة فلا حاجة لتبديله كل صورة).
  const [karat, setKarat] = useState<"18K" | "21K">("18K");
  const weightInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const lastShotId = useRef<string | null>(null);

  // مراجع مرآة لقيم الوزن/الباركود ومعرّف القطعة المحفوظة — تُقرأ من مؤقّتات التزامن
  // المؤجّلة بدون الاعتماد على state قد يكون قديماً داخل closure وقت تنفيذ المؤقّت.
  const weightsRef = useRef<Record<string, string>>({});
  const barcodesRef = useRef<Record<string, string>>({});
  const productIdsRef = useRef<Record<string, string>>({});
  const pendingDeleteRef = useRef<Set<string>>(new Set());
  const weightTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const barcodeTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setReady(false);
    setError(null);
    setPendingBarcode(null);

    const start = async () => {
      try {
        // البثّ الجاهز من نقرة الفتح يُستخدم كما هو في أول تشغيل فقط؛ تبديل الكاميرا
        // لاحقاً يطلب بثّاً جديداً (وهو أيضاً ناتج عن نقرة مباشرة داخل الشاشة).
        const first = !streamRef.current;
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        const reusable = !!initialStream && initialStream.getTracks().some((t) => t.readyState === "live");
        const stream =
          first && reusable
            ? initialStream!
            : await navigator.mediaDevices.getUserMedia({
                video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1920 } },
                audio: false,
              });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;

        // عنصر <video> لا يُعرض أثناء وجود خطأ، فقد لا يكون موجوداً بعد لحظة عودة
        // getUserMedia (مثلاً عند إعادة المحاولة بعد رفض الإذن، أو عند تبديل الكاميرا).
        // كنا نضع setReady(true) رغم ذلك فتظهر شاشة سوداء بلا صورة وبلا رسالة خطأ —
        // ننتظر ظهور العنصر بضع دورات بدل الاستسلام الصامت.
        for (let i = 0; i < 20 && !videoRef.current && !cancelled; i++) {
          await new Promise((r) => setTimeout(r, 50));
        }
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (!videoRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          setError("تعذّر عرض الكاميرا — أغلق الشاشة وافتحها من جديد");
          return;
        }

        const video = videoRef.current;
        video.srcObject = stream;
        void video.play().catch(() => {});
        startFramePump(video);
      } catch (e: any) {
        setError(e?.name === "NotAllowedError" ? "تم رفض إذن الكاميرا — فعّله من إعدادات المتصفح" : "تعذّر فتح الكاميرا");
      }
    };
    void start();

    // جلسة التصوير المتتالي تطول (عشرات القطع)، وانطفاء الشاشة بين لقطة وأخرى يُجمّد
    // الرفع الجاري في الخلفية — نُبقي الجهاز مستيقظاً ما دامت الكاميرا مفتوحة.
    const releaseWakeLock = keepAwake();

    return () => {
      cancelled = true;
      releaseWakeLock();
      stopFramePump();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open, facing]);

  // تشخيص حيّ للمعاينة: الشاشة السوداء لها أسباب كثيرة متشابهة من الخارج (لا بثّ /
  // بثّ بلا إطارات / عنصر بارتفاع صفر / تشغيل متوقّف). هذا السطر يفصل بينها بدل
  // التخمين، ويظهر فقط حين لا تعمل المعاينة فعلاً فلا يزعج الاستخدام العادي.
  const [diag, setDiag] = useState("");
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => {
      const v = videoRef.current;
      const tracks = streamRef.current?.getVideoTracks() ?? [];
      const t = tracks[0];
      const r = v?.getBoundingClientRect();
      setDiag(
        [
          `standalone:${(window.navigator as any).standalone ? "1" : "0"}`,
          `tracks:${tracks.length}/${t?.readyState ?? "-"}${t?.muted ? "/muted" : ""}`,
          `enabled:${t?.enabled ? "1" : "0"}`,
          `video:${v?.videoWidth ?? 0}x${v?.videoHeight ?? 0}`,
          `rs:${v?.readyState ?? "-"}`,
          `paused:${v?.paused ? "1" : "0"}`,
          `box:${Math.round(r?.width ?? 0)}x${Math.round(r?.height ?? 0)}`,
          `srcObj:${v?.srcObject ? "1" : "0"}`,
          `frames:${frameCountRef.current}`,
          `px:${lastPixelRef.current ? lastPixelRef.current.join(",") : "-"}`,
          `blackStreak:${blackFrameStreakRef.current}`,
        ].join(" "),
      );
    }, 700);
    return () => clearInterval(id);
  }, [open]);

  // المعاينة تُعتبر معطّلة إن لم يصل أي إطار (كالسابق) — أو إن وصلت إطارات لكن محتواها
  // أسود باستمرار (≥5 عيّنات متتالية). الحالة الثانية هي بالضبط ما أبلغ عنه المستخدم:
  // frameCount>0 (الرسم "نجح" برمجياً) والشاشة سوداء رغم ذلك — نجاح drawImage لا يعني
  // صورة مرئية فعلاً، فلا نكتفي بعدّ الإطارات وحده كدليل جاهزية.
  const previewBroken = !error && (frameCountRef.current === 0 || blackFrameStreakRef.current >= 5);

  // إعادة المحاولة من نقرة المستخدم مباشرة — راجع التعليق عند زر "إعادة تشغيل الكاميرا".
  const retryCamera = async () => {
    setError(null);
    setReady(false);
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1920 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        setError("تعذّر عرض الكاميرا — أغلق الشاشة وافتحها من جديد");
        return;
      }
      video.srcObject = stream;
      void video.play().catch(() => {});
      stopFramePump();
      startFramePump(video);
    } catch (e: any) {
      setError(
        e?.name === "NotAllowedError"
          ? "تم رفض إذن الكاميرا — فعّله من إعدادات الآيفون ← مخرّم ← الكاميرا"
          : "تعذّر فتح الكاميرا",
      );
    }
  };

  // فحص مستمر للباركود/QR — معطَّل مؤقتاً (BARCODE_SCAN_ENABLED)، راجع التعليق أعلى الملف.
  useBoxedBarcodeScanner(videoRef, open && ready && BARCODE_SCAN_ENABLED, (text) => setPendingBarcode(text));

  // تحرير روابط الصور الملتقطة عند إغلاق المكوّن نهائياً لتفادي تسرّب الذاكرة
  useEffect(() => {
    if (!open) {
      shots.forEach((s) => URL.revokeObjectURL(s.url));
      Object.values(weightTimers.current).forEach(clearTimeout);
      Object.values(barcodeTimers.current).forEach(clearTimeout);
      setShots([]);
      weightInputRefs.current = {};
      weightsRef.current = {};
      barcodesRef.current = {};
      productIdsRef.current = {};
      pendingDeleteRef.current = new Set();
      weightTimers.current = {};
      barcodeTimers.current = {};
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

  const syncWeight = (id: string, weight: string) => {
    const productId = productIdsRef.current[id];
    if (!productId) return; // سيُطبَّق تلقائياً فور اكتمال الحفظ (راجع capture)
    const w = parseFloat(weight);
    void updateCapturedPiece(productId, { weight_grams: !isNaN(w) && w > 0 ? w : null });
  };

  const syncBarcode = (id: string, barcode: string) => {
    const productId = productIdsRef.current[id];
    if (!productId) return;
    void updateCapturedPiece(productId, { barcode_value: barcode.trim() || null });
  };

  const capture = () => {
    // نلتقط من نفس canvas المعروض على الشاشة (آخر إطار رسمته حلقة startFramePump)
    // بدل إعادة الرسم من video مباشرة — هذا الالتقاط يطابق ما يراه الموظف فعلاً،
    // ولا يعتمد على video.videoWidth/readyState التي أثبتنا أنها قد تُضلِّل.
    const live = canvasRef.current;
    if (!live || !ready || frameCountRef.current === 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = live.width;
    canvas.height = live.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(live, 0, 0, canvas.width, canvas.height);
    const barcodeForShot = pendingBarcode ?? "";
    setPendingBarcode(null);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        lastShotId.current = id;
        const url = URL.createObjectURL(blob);
        weightsRef.current[id] = "";
        barcodesRef.current[id] = barcodeForShot;
        setShots((prev) => [...prev, { id, url, weight: "", barcode: barcodeForShot, saveState: "saving" }]);

        // نرفع ونحفظ فوراً — لا ننتظر ضغط "تم"، حتى لا يُفقد التقاط سابق عند إغلاق التبويب
        // أو قفل الهاتف قبل إنهاء الجلسة.
        const file = new File([blob], `capture-${id}.jpg`, { type: "image/jpeg" });
        saveCapturedPiece(file, { userId, branchId, trayMode: false }, null, barcodeForShot || null, karat)
          .then(({ productId }) => {
            if (pendingDeleteRef.current.has(id)) {
              pendingDeleteRef.current.delete(id);
              void deleteCapturedPiece(productId);
              return;
            }
            productIdsRef.current[id] = productId;
            setShots((prev) => prev.map((s) => (s.id === id ? { ...s, saveState: "saved" } : s)));
            // إن كتب الموظف وزناً/باركوداً بينما كانت الصورة لا تزال تُرفع، نُطبّقه الآن فوراً
            const w = weightsRef.current[id];
            const b = barcodesRef.current[id];
            if (w || b) {
              const wNum = parseFloat(w || "");
              void updateCapturedPiece(productId, {
                weight_grams: !isNaN(wNum) && wNum > 0 ? wNum : null,
                barcode_value: (b || "").trim() || null,
              });
            }
          })
          .catch(() => {
            setShots((prev) => prev.map((s) => (s.id === id ? { ...s, saveState: "error" } : s)));
            toast.error("تعذّر حفظ إحدى الصور — تحقق من الاتصال وأعد المحاولة");
          });
      },
      "image/jpeg",
      0.9,
    );
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
    if (navigator.vibrate) navigator.vibrate(15);
  };

  const setWeight = (id: string, weight: string) => {
    weightsRef.current[id] = weight;
    setShots((prev) => prev.map((s) => (s.id === id ? { ...s, weight } : s)));
    if (weightTimers.current[id]) clearTimeout(weightTimers.current[id]);
    weightTimers.current[id] = setTimeout(() => syncWeight(id, weight), 500);
  };

  const flushWeight = (id: string) => {
    if (weightTimers.current[id]) clearTimeout(weightTimers.current[id]);
    syncWeight(id, weightsRef.current[id] ?? "");
  };

  const setBarcode = (id: string, barcode: string) => {
    barcodesRef.current[id] = barcode;
    setShots((prev) => prev.map((s) => (s.id === id ? { ...s, barcode } : s)));
    if (barcodeTimers.current[id]) clearTimeout(barcodeTimers.current[id]);
    barcodeTimers.current[id] = setTimeout(() => syncBarcode(id, barcode), 500);
  };

  const flushBarcode = (id: string) => {
    if (barcodeTimers.current[id]) clearTimeout(barcodeTimers.current[id]);
    syncBarcode(id, barcodesRef.current[id] ?? "");
  };

  /** يحذف قطعة — إن كانت محفوظة فعلاً على الخادم يحذفها هناك أيضاً، وإن كانت لا تزال قيد
   * الرفع يُعلّمها لتُحذف فور اكتمال حفظها بدل أن تبقى يتيمة. */
  const removeShot = (id: string) => {
    setShots((prev) => {
      const target = prev.find((s) => s.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((s) => s.id !== id);
    });
    if (weightTimers.current[id]) clearTimeout(weightTimers.current[id]);
    if (barcodeTimers.current[id]) clearTimeout(barcodeTimers.current[id]);
    delete weightTimers.current[id];
    delete barcodeTimers.current[id];
    delete weightsRef.current[id];
    delete barcodesRef.current[id];
    const productId = productIdsRef.current[id];
    delete productIdsRef.current[id];
    if (productId) void deleteCapturedPiece(productId);
    else pendingDeleteRef.current.add(id);
  };

  const undoLast = () => {
    if (!shots.length) return;
    removeShot(shots[shots.length - 1].id);
  };

  const finish = () => {
    const savedIds = Object.values(productIdsRef.current);
    if (shots.length) toast.success(`تم حفظ ${shots.length} قطعة`);
    onClose();
    // نأخذ الموظف لمراجعة ما صوّره في هذه الجلسة بالتحديد — بدل تركه يُحلَّل ويُسمَّى
    // تلقائياً في الخلفية بلا مراجعة، حتى لو كان مجرّد تجربة للكاميرا وضغط "تم" للخروج.
    if (savedIds.length) onFinished?.(savedIds);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* شريط علوي — بدون زر إغلاق/رجوع منفصل عمداً: "تم" هي الطريقة الوحيدة للخروج،
          حتى لا يخرج الموظف بالخطأ من الجلسة أثناء التصوير المتتالي. */}
      <div className="flex items-center justify-between px-4 py-3 safe-area-pt text-white bg-black/60">
        {/* العيار يُختار قبل التصوير ويبقى ثابتاً لكل الصور حتى يُبدَّل يدوياً — القطع
            عادة مرتّبة حسب العيار في نفس الدرج فلا حاجة لتبديله كل صورة. */}
        <div className="flex rounded-full bg-white/10 border border-white/25 p-0.5 text-xs font-bold" role="group" aria-label="العيار">
          {(["18K", "21K"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKarat(k)}
              className={`px-2.5 py-1 rounded-full transition-colors ${karat === k ? "bg-primary text-primary-foreground" : "text-white/70"}`}
            >
              {k}
            </button>
          ))}
        </div>
        <p className="text-sm font-semibold">{shots.length > 0 ? `${shots.length} صورة مُلتقطة` : "صوّر القطع واحدة تلو الأخرى"}</p>
        <button onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))} className="p-2 -m-2" aria-label="تبديل الكاميرا">
          <RotateCcw className="size-5" />
        </button>
      </div>

      {/* عرض الكاميرا */}
      <div className="relative flex-1 overflow-hidden bg-black flex items-center justify-center">
        {error ? (
          <div className="text-center text-white p-6 space-y-3">
            <ImageOff className="size-10 mx-auto text-white/70" />
            <p className="font-semibold">{error}</p>
            {/* محاولة يدوية: الطلب هنا يقع داخل نقرة المستخدم مباشرة، وهي الحالة الوحيدة
                التي يقبلها التطبيق المثبّت على iOS بشكل موثوق. */}
            <Button variant="secondary" onClick={retryCamera}>
              <RotateCcw className="size-4 ml-1" /> إعادة تشغيل الكاميرا
            </Button>
          </div>
        ) : (
          <>
            {/* video مصدر فك التشفير فقط ولا يُعرض أبداً — عرضه هو ما يظهر أسود في
                التطبيق المثبَّت على iOS (راجع تعليق startFramePump). autoPlay مع
                playsInline وmuted ضروريان رغم إخفائه لبدء فك التشفير دون إيماءة. */}
            {/* حجم حقيقي (لا 1px/opacity:0) — تصغير الفيديو لبكسل واحد مع opacity:0 هو
                بالضبط الإشارة التي تجعل WebKit على الهاتف يُعامله كـ"غير مرئي" ويُعلِّق
                فكّ تشفير إطاراته فعلياً (تحسين لتوفير الطاقة)، رغم بقاء readyState/
                videoWidth سليمين — وهذا يطابق ما رآه المستخدم: drawImage "ينجح"
                (frameCount>0) والمحتوى المرسوم أسود بالكامل. نتجنّب هذا بإبقائه بحجم
                طبيعي، ويُغطّيه canvas بصرياً بترتيب DOM فقط (canvas بعده مباشرة) بلا
                حاجة لأي z-index. */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-contain pointer-events-none"
            />
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-contain" />
          </>
        )}

        {/* شاشة سوداء بلا رسالة خطأ: نعرض حالة المعاينة الفعلية وزر إعادة تشغيل مباشر */}
        {previewBroken && (
          <div className="absolute inset-x-3 bottom-3 space-y-2 text-center">
            <p className="text-white/80 text-xs">
              {ready ? "الكاميرا مفتوحة لكن لا تصل صورة" : "جارٍ تشغيل الكاميرا…"}
            </p>
            <Button size="sm" variant="secondary" onClick={retryCamera}>
              <RotateCcw className="size-4 ml-1" /> إعادة تشغيل الكاميرا
            </Button>
            <p className="font-mono text-[9px] text-white/45 break-all leading-snug" dir="ltr">{diag}</p>
          </div>
        )}
        {flash && <div className="absolute inset-0 bg-white/80 animate-pulse" />}

        {BARCODE_SCAN_ENABLED && (
          <>
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
          </>
        )}
      </div>

      {/* شريط مصغّرات الصور الملتقطة مع حقل الوزن لكل صورة */}
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
                {/* مؤشر حالة الحفظ — يطمئن الموظف أن الصورة فعلاً وصلت الخادم */}
                <span className="absolute -bottom-1 -left-1 -right-1 flex justify-center">
                  {s.saveState === "saving" && <Loader2 className="size-3 text-white animate-spin bg-black/70 rounded-full p-0.5" />}
                  {s.saveState === "saved" && <Check className="size-3 text-status-available bg-black/70 rounded-full p-0.5" />}
                  {s.saveState === "error" && <AlertCircle className="size-3 text-destructive bg-black/70 rounded-full p-0.5" />}
                </span>
              </div>
              <input
                ref={(el) => { weightInputRefs.current[s.id] = el; }}
                type="text"
                inputMode="decimal"
                placeholder="وزن (جم)"
                value={s.weight}
                onChange={(e) => setWeight(s.id, normalizeDecimalInput(e.target.value))}
                onBlur={() => flushWeight(s.id)}
                className="w-16 h-7 rounded-md bg-white/10 border border-white/25 text-white text-[10px] text-center placeholder:text-white/40 focus:bg-white/20 focus:outline-none focus:ring-1 focus:ring-primary"
              />
              {BARCODE_SCAN_ENABLED && (
                <input
                  type="text"
                  inputMode="text"
                  placeholder="باركود"
                  value={s.barcode}
                  onChange={(e) => setBarcode(s.id, e.target.value)}
                  onBlur={() => flushBarcode(s.id)}
                  dir="ltr"
                  className="w-16 h-6 rounded-md bg-white/10 border border-white/25 text-white text-[9px] text-center font-mono placeholder:text-white/40 focus:bg-white/20 focus:outline-none focus:ring-1 focus:ring-primary"
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* أزرار التحكم */}
      <div className="flex items-center justify-center gap-8 py-6 safe-area-pb bg-black/60">
        <Button variant="ghost" className="text-white" onClick={undoLast} disabled={!shots.length}>
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
        <Button onClick={finish} className="bg-gold-gradient text-primary-foreground shadow-gold">
          <Check className="size-4 ml-1" /> تم ({shots.length})
        </Button>
      </div>

      {shots.length > 0 && (
        <p className="flex items-center justify-center gap-1 text-[11px] text-white/50 pb-2 -mt-3">
          <Scale className="size-3" /> كل صورة تُحفظ فوراً لحظة التقاطها — الوزن اختياري ويُحفظ تلقائياً أثناء الكتابة
        </p>
      )}
    </div>
  );
}
