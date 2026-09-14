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
//
// ⚠️ لا تستدعِ keepAwake() (Screen Wake Lock) داخل هذا المكوّن.
//
// هذا سبب مؤكَّد بالتوقيت لعطل "شاشة سوداء داخل التطبيق المثبَّت على iOS":
//   • 9 سبتمبر 05:17 (aafc748) — بلا Wake Lock.
//   • 9 سبتمبر 17:59–18:27 — صُوّرت 11 قطعة فعلياً بهذه النسخة (موجودة في قاعدة البيانات).
//   • 10 سبتمبر 04:24 (076f069) — أُضيف keepAwake() هنا لإبقاء الشاشة صاحية أثناء الرفع.
//   • 10 سبتمبر 05:16 — أول بلاغ شاشة سوداء، ولم تعمل الكاميرا بعدها إطلاقاً.
//
// قفل الشاشة يمرّ عبر نفس طبقة إدارة الطاقة/الوسائط في iOS (mediaserverd) المسؤولة عن
// جلسة الكاميرا، والتشخيص الحيّ على الجهاز كان يُظهر المسار حيّاً لكن muted:true — أي
// أن النظام يعامل الجلسة كأنها في الخلفية. إبقاء الشاشة صاحية أثناء التصوير ليس ضرورياً
// أصلاً (الشاشة تبقى مضاءة ما دام الموظف يضغط زر الالتقاط).
//
// القفل ما زال مستخدَماً في الرفع بالجملة (مهم هناك: انطفاء الشاشة يُجمّد الرفع)، لذلك
// لا يكفي ألا تطلبه الكاميرا لنفسها — قد يكون الرفع شغّالاً بالفعل وقت فتح الكاميرا
// (resumePendingUploads يبدأ دفعة بعد ثوانٍ من فتح التطبيق). لهذا تستدعي الكاميرا
// suspendWakeLock() التي تُعلّق أي قفل قائم طوال فتحها وتستعيده عند الإغلاق.
//
// ملاحظة ثانية: أُبقي جزء تشغيل الكاميرا هنا أبسط ما يمكن عمداً (getUserMedia + <video>
// عادي) — جُرِّبت طبقات "إصلاح" كثيرة للعطل نفسه (رسم canvas، إخفاء/تكبير الفيديو، إعادة
// طلب الجلسة تلقائياً، كاميرا نظام احتياطية) ولم يحل أيٌّ منها شيئاً لأن السبب لم يكن
// هناك. لا تُضف أي طبقة جديدة بدون دليل فعلي من جهاز حقيقي.
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, X, Check, Trash2, RotateCcw, SwitchCamera, ImageOff, Scale, ScanLine, Loader2, AlertCircle } from "lucide-react";
import { useBoxedBarcodeScanner } from "@/lib/useBoxedBarcodeScanner";
import ScanBoxOverlay from "@/components/ScanBoxOverlay";
import { normalizeDecimalInput } from "@/lib/constants";
import { saveCapturedPiece, updateCapturedPiece, deleteCapturedPiece, analyzeCapturedPiece } from "@/lib/uploadRunner";
import { suspendWakeLock } from "@/lib/keepAwake";
import { loadDebugConsole } from "@/lib/debugConsole";
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
  /**
   * بثّ حصل عليه المستدعي داخل نقرة المستخدم نفسها (راجع openCamera في Upload.tsx) —
   * يُستخدم كما هو في أول تشغيل بدل طلب جديد من useEffect. السبب موثّق بتشخيص حيّ على
   * جهاز حقيقي: getUserMedia من useEffect (خارج نافذة "تفعيل المستخدم") يعمل في سفاري
   * العادي لكن التطبيق المثبَّت على iOS يكتم المسار بعده بثانية تقريباً وبثبات تام —
   * جُرِّب هذا مرتين بأدلة مطابقة (نفس التوقيت بالضبط) فلا يبدو أنه تزامن عشوائي. طلب
   * الجلسة من نقرة مباشرة (هنا، أو من زر "إعادة المحاولة"/"تبديل الكاميرا" أدناه) هو
   * الاحتمال الوحيد المتبقي غير المجرَّب فعلياً في هذا الملف كما هو مبنيّ الآن.
   */
  initialStream?: MediaStream | null;
}

export default function BulkCameraCapture({ open, onClose, userId, branchId, initialStream }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // النظام (iOS) بيكتم مسار الفيديو أحياناً بعد بدء الجلسة مباشرة — تأكّدنا منه فعلياً
  // بتشخيص حيّ على الجهاز مرتين (mute event يتلوه بثانية تقريباً وبثبات تام في المرتين).
  // تأخير/إعادة محاولة تلقائية من useEffect جُرِّبا ولم يُغيّرا شيئاً — راجع تعليق
  // initialStream في تعريف الـProps أعلى الملف: السبب الأرجح المتبقي غير المجرَّب هو
  // نافذة "تفعيل المستخدم"، فكل إعادة محاولة هنا الآن مباشرة من نقرة الزر بلا أي تأخير.
  const [videoMuted, setVideoMuted] = useState(false);
  // كاميرا الجهاز الاحتياطية — راجع تعليقها المفصّل عند saveShot/capture أدناه.
  const [useNativeCamera, setUseNativeCamera] = useState(false);
  const nativeCameraRef = useRef<HTMLInputElement>(null);
  const [flash, setFlash] = useState(false);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [pendingBarcode, setPendingBarcode] = useState<string | null>(null);
  // العيار يُختار قبل التصوير بدل ترك الذكاء الاصطناعي يخمّنه من الصورة لاحقاً — أغلب
  // المخزون 18K فهو الافتراضي، ويبقى ظاهراً وقابلاً للتبديل طوال الجلسة (القطع عادة
  // مرتّبة حسب العيار في نفس الدرج/الفاترينة فلا حاجة لتبديله كل صورة).
  const [karat, setKarat] = useState<"18K" | "21K">("18K");
  const weightInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const lastShotId = useRef<string | null>(null);
  // 5 ضغطات متتالية (خلال ثانيتين) على شريط الحالة تفتح كونسول تشخيص فوراً — مفيد هنا
  // تحديداً لأن الشاشة السودة تمنع الوصول لشعار الهيدر خلف هذه الشاشة الملء.
  const debugTaps = useRef<number[]>([]);
  const onDebugTap = () => {
    const now = Date.now();
    debugTaps.current = [...debugTaps.current.filter((t) => now - t < 2000), now];
    if (debugTaps.current.length >= 5) {
      debugTaps.current = [];
      loadDebugConsole();
    }
  };

  // مراجع مرآة لقيم الوزن/الباركود ومعرّف القطعة المحفوظة — تُقرأ من مؤقّتات التزامن
  // المؤجّلة بدون الاعتماد على state قد يكون قديماً داخل closure وقت تنفيذ المؤقّت.
  const weightsRef = useRef<Record<string, string>>({});
  const barcodesRef = useRef<Record<string, string>>({});
  const productIdsRef = useRef<Record<string, string>>({});
  const pendingDeleteRef = useRef<Set<string>>(new Set());
  const weightTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const barcodeTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // يُوصِّل بثّاً حاصلاً عليه بالفعل (من نقرة مباشرة دائماً — راجع كل نقاط الاستدعاء)
  // بعنصر الفيديو، مع كل تشخيص/حماية جُرِّبا سابقاً: انتظار ظهور العنصر، تجاهل رفض
  // play()، ومراقبة mute/unmute. مُشترك بين التشغيل الأول وإعادة المحاولة وتبديل الكاميرا
  // حتى لا يتكرر نفس المنطق الحسّاس في ثلاث نسخ مختلفة قد تنحرف عن بعضها بمرور الوقت.
  const activeDiagIntervals = useRef<ReturnType<typeof setInterval>[]>([]);
  const attachStream = async (stream: MediaStream) => {
    activeDiagIntervals.current.forEach(clearInterval);
    activeDiagIntervals.current = [];
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = stream;
    setError(null);
    setVideoMuted(false);

    const track = stream.getVideoTracks()[0];
    console.info("[cam-debug] track", {
      muted: track?.muted,
      readyState: track?.readyState,
      settings: track?.getSettings(),
      displayMode: window.matchMedia("(display-mode: standalone)").matches ? "standalone" : "browser",
    });
    track?.addEventListener("mute", () => { console.info("[cam-debug] track muted event"); setVideoMuted(true); });
    track?.addEventListener("unmute", () => { console.info("[cam-debug] track unmuted event"); setVideoMuted(false); });
    if (track?.muted) setVideoMuted(true);

    // عنصر <video> لا يُعرض أثناء وجود خطأ، فقد لا يكون موجوداً بعد لحظة عودة
    // getUserMedia — ننتظر ظهوره بضع دورات بدل الاستسلام الصامت (شاشة سوداء بلا صورة
    // وبلا رسالة خطأ).
    for (let i = 0; i < 20 && !videoRef.current; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (!videoRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      setError("تعذّر عرض الكاميرا — أغلق الشاشة وافتحها من جديد");
      return;
    }

    videoRef.current.srcObject = stream;
    // play() قد يُرفض على iOS إن لم تكن الإيماءة معتبرة — لا نُسقط الجلسة لأجله.
    try { await videoRef.current.play(); } catch { /* تجاهل */ }
    setReady(true);

    // تشخيص مستمر كل ثانية: نرسم الفيديو فعلياً على canvas ونقرأ متوسط سطوع البكسلات —
    // هذا يفصل احتمالين مختلفين قد يبدوان متطابقين ظاهرياً (شاشة سوداء): (أ) المسار
    // فعلاً بلا بيانات إطلاقاً (سطوع صفر تماماً باستمرار)، أو (ب) البيانات موجودة فعلاً
    // وتُقرأ عبر drawImage رغم أن <video> نفسه لا يعرضها (خلل تركيب/عرض فقط — كان هذا
    // أول تفسير جُرِّب في هذا الملف تاريخياً قبل أن يُستبعد لصالح نظرية الكتم، دون دليل
    // canvas فعلي في حينها يحسم الأمر). يستمر طالما الشاشة مفتوحة وليس بها خطأ صريح.
    // أبعاد ثابتة من إعدادات الـtrack نفسه (لا من video.videoWidth الذي رأيناه يبقى 0
    // باستمرار في آخر تشخيص) — إن كانت نظرية "التركيب/العرض فقط" صحيحة فقد تُقرأ صورة
    // حقيقية عبر drawImage رغم أن video.videoWidth يُبلَّغ صفراً طوال الوقت.
    const settings = track?.getSettings();
    const canvas = document.createElement("canvas");
    canvas.width = settings?.width || 1280;
    canvas.height = settings?.height || 1280;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const diagInterval = setInterval(() => {
      const video = videoRef.current;
      if (!video || !ctx) return;
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let sum = 0;
        for (let i = 0; i < data.length; i += 4 * 97) sum += data[i] + data[i + 1] + data[i + 2];
        const sampleCount = Math.ceil(data.length / (4 * 97));
        console.info("[cam-debug] canvas-sample", {
          avgBrightness: Math.round(sum / sampleCount),
          videoWidth: video.videoWidth,
          readyStateEl: video.readyState,
          paused: video.paused,
          trackMuted: track?.muted,
          trackReadyState: track?.readyState,
        });
      } catch (e: any) {
        console.info("[cam-debug] canvas-sample threw", e?.name, e?.message);
      }
    }, 1000);
    activeDiagIntervals.current.push(diagInterval);
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setReady(false);
    setError(null);
    setVideoMuted(false);
    setPendingBarcode(null);

    (async () => {
      try {
        // بثّ جاهز من نقرة الفتح نفسها (راجع initialStream في تعريف الـProps) —
        // نستخدمه كما هو ولا نطلب جديداً من هذا الـuseEffect (خارج نافذة الإيماءة).
        const reusable = initialStream && initialStream.getVideoTracks().some((t) => t.readyState === "live");
        const stream = reusable
          ? initialStream!
          : await navigator.mediaDevices.getUserMedia({
              video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1920 } },
              audio: false,
            });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        await attachStream(stream);
      } catch (e: any) {
        console.info("[cam-debug] getUserMedia threw", e?.name, e?.message);
        setError(e?.name === "NotAllowedError" ? "تم رفض إذن الكاميرا — فعّله من إعدادات المتصفح" : "تعذّر فتح الكاميرا");
      }
    })();

    // نُعلّق أي قفل شاشة قائم (قد يكون الرفع شغّالاً في الخلفية) طوال فتح الكاميرا —
    // راجع التحذير أعلى الملف وتعليق suspendWakeLock. يُستعاد تلقائياً عند الإغلاق.
    const resumeWakeLock = suspendWakeLock();

    return () => {
      cancelled = true;
      resumeWakeLock();
      activeDiagIntervals.current.forEach(clearInterval);
      activeDiagIntervals.current = [];
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // إعادة محاولة مباشرة من نقرة الزر — بلا أي تأخير أو useEffect وسيط، حتى تبقى داخل
  // نافذة "تفعيل المستخدم" التي يشترطها التطبيق المثبَّت على iOS. راجع تعليق
  // initialStream في تعريف الـProps أعلى الملف لتفاصيل الدليل.
  const retryCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1920 } },
        audio: false,
      });
      await attachStream(stream);
    } catch (e: any) {
      setError(e?.name === "NotAllowedError" ? "تم رفض إذن الكاميرا — فعّله من إعدادات المتصفح" : "تعذّر فتح الكاميرا");
    }
  };

  // تبديل أمامية/خلفية — طلب مباشر من نقرة الزر لنفس سبب retryCamera، بدل الاعتماد على
  // useEffect يتفاعل مع تغيّر facing (كان هذا هو المسار غير المدعوم على iOS المثبَّت).
  const switchCamera = async () => {
    const next = facing === "environment" ? "user" : "environment";
    setFacing(next);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: next, width: { ideal: 1920 }, height: { ideal: 1920 } },
        audio: false,
      });
      await attachStream(stream);
    } catch (e: any) {
      setError(e?.name === "NotAllowedError" ? "تم رفض إذن الكاميرا — فعّله من إعدادات المتصفح" : "تعذّر فتح الكاميرا");
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
      setUseNativeCamera(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // لا داعي لإبقاء بثّ الفيديو المباشر شغّالاً بعد التحوّل لكاميرا الجهاز الاحتياطية
  useEffect(() => {
    if (useNativeCamera) streamRef.current?.getTracks().forEach((t) => t.stop());
  }, [useNativeCamera]);

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

  // منطق الحفظ مشترك بين الالتقاط الحيّ (canvas من الفيديو المباشر) والتقاط كاميرا
  // الجهاز الاحتياطية (input capture) — الاثنان ينتهيان بنفس Blob فيُحفَّظان بنفس
  // الطريقة، فيظهران في نفس شريط المصغّرات وحقول الوزن بلا أي فرق. راجع useNativeCamera.
  const saveShot = (blob: Blob) => {
    const barcodeForShot = pendingBarcode ?? "";
    setPendingBarcode(null);
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
      .then(({ productId, imageId }) => {
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
        // تحليل فوري تلقائي — القطعة تخرج من هذه الشاشة مُسمّاة ومصنّفة فعلاً بدل
        // انتظار مراجعة يدوية لاحقة. العيار مضبوط دائماً من الموظف قبل التصوير (لا
        // يُكتب فوقه)، والنوع متروك للذكاء الاصطناعي. فشل التحليل هنا صامت تماماً —
        // القطعة تبقى محفوظة وتلتقطها الطابور الخلفي لاحقاً كالمعتاد.
        void analyzeCapturedPiece(file, { productId, imageId }, { karat: true, itemType: false }).catch(() => {});
      })
      .catch(() => {
        setShots((prev) => prev.map((s) => (s.id === id ? { ...s, saveState: "error" } : s)));
        toast.error("تعذّر حفظ إحدى الصور — تحقق من الاتصال وأعد المحاولة");
      });

    setFlash(true);
    setTimeout(() => setFlash(false), 120);
    if (navigator.vibrate) navigator.vibrate(15);
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video || !ready) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => { if (blob) saveShot(blob); }, "image/jpeg", 0.9);
  };

  // كاميرا الجهاز الاحتياطية: تُستخدم بدل الفيديو المباشر لما نظام آيفون يكتم مسار
  // الكاميرا (خلل موثّق لا يُصلَح من الكود، راجع videoMuted) — كل ضغطة تفتح تطبيق
  // الكاميرا الأصلي مرة، فتُحفَّظ الصورة الناتجة بنفس منطق saveShot أعلاه فتظهر في نفس
  // الشريط وحقل الوزن. أبطأ قليلاً من الفيديو المباشر (فتح/إغلاق لكل صورة) لكنه موثوق
  // مئة بالمئة لأنه لا يمرّ بـgetUserMedia إطلاقاً.
  const onNativeCapture = (file: File | undefined) => {
    if (file) saveShot(file);
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

  // كل قطعة تُحلَّل وتُسمّى تلقائياً فور رفعها (راجع analyzeCapturedPiece في saveShot)،
  // فلم تعد هناك حاجة لأخذ الموظف لمراجعة يدوية بعد "تم" — يرجع مباشرة لصفحة الرفع.
  const finish = () => {
    if (shots.length) toast.success(`تم حفظ ${shots.length} قطعة`);
    onClose();
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
        <p className="text-sm font-semibold" onClick={onDebugTap}>{shots.length > 0 ? `${shots.length} صورة مُلتقطة` : "صوّر القطع واحدة تلو الأخرى"}</p>
        <div className="flex items-center gap-3">
          {!useNativeCamera && (
            <>
              <button onClick={retryCamera} className="p-1" aria-label="إعادة تشغيل الكاميرا" title="إعادة تشغيل الكاميرا">
                <RotateCcw className="size-5" />
              </button>
              <button onClick={switchCamera} className="p-1" aria-label="تبديل الكاميرا" title="تبديل الكاميرا">
                <SwitchCamera className="size-5" />
              </button>
            </>
          )}
          <button
            onClick={() => setUseNativeCamera((v) => !v)}
            className={`p-1 ${useNativeCamera ? "text-primary" : ""}`}
            aria-label="كاميرا الجهاز العادية"
            title="كاميرا الجهاز العادية"
          >
            <Camera className="size-5" />
          </button>
        </div>
      </div>

      {/* عرض الكاميرا */}
      <div className="relative flex-1 overflow-hidden bg-black flex items-center justify-center">
        {useNativeCamera ? (
          // كاميرا الجهاز الاحتياطية — لا معاينة حيّة، فقط زر يفتح تطبيق الكاميرا الأصلي
          // في كل مرة. راجع تعليق useNativeCamera أعلى الملف.
          <div className="text-center text-white p-6 space-y-3">
            <Camera className="size-10 mx-auto text-white/70" />
            <p className="font-semibold text-sm">كاميرا الجهاز العادية</p>
            <p className="text-xs text-white/60 max-w-xs">اضغط "التقاط" بالأسفل، صوّر القطعة من تطبيق الكاميرا، ثم ارجع هنا تلقائياً للقطعة التالية.</p>
          </div>
        ) : error ? (
          <div className="text-center text-white p-6 space-y-2">
            <ImageOff className="size-10 mx-auto text-white/70" />
            <p className="font-semibold">{error}</p>
          </div>
        ) : (
          <video ref={videoRef} playsInline muted className="w-full h-full object-contain" />
        )}
        {flash && <div className="absolute inset-0 bg-white/80 animate-pulse" />}

        {/* لا طبقة "توقّفت الكاميرا" فوق الشاشة عمداً حالياً — بطلب صريح، حتى تبقى
            الشاشة كما هي فعلياً (سوداء لو كتمها النظام) ونراقب سلوكها الحقيقي في
            الكونسول (راجع تشخيص canvas-sample في attachStream) بدل حجبه بواجهة تكيّف
            معه. زر "استخدام كاميرا الجهاز العادية" لا يزال متاحاً من الشريط العلوي. */}
        {!useNativeCamera && !error && videoMuted && (
          <p className="absolute top-2 inset-x-3 text-center text-[11px] text-white/70 bg-black/50 rounded-full px-3 py-1">
            النظام كتم مسار الكاميرا — راقب الكونسول (5 ضغطات على النص فوق)
          </p>
        )}

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
          onClick={() => (useNativeCamera ? nativeCameraRef.current?.click() : capture())}
          disabled={!useNativeCamera && !ready}
          className="size-16 rounded-full border-4 border-white flex items-center justify-center disabled:opacity-40"
          aria-label="التقاط صورة"
        >
          <div className="size-12 rounded-full bg-white" />
        </button>
        <input
          ref={nativeCameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            onNativeCapture(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
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
