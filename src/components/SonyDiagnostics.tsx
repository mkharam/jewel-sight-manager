// فحص اتصال كاميرا Sony عبر كابل USB-C: يشرح للموظف بالضبط أين المشكلة — المتصفح، إذن
// الكاميرا، هل ظهرت الكاميرا للحاسوب أصلاً، أم ظهرت لكن برنامج آخر يحجزها — مع الحل لكل حالة،
// وتقرير يُنسخ ويُرسل للدعم. الكاميرا لا تظهر للمتصفح عبر USB إلا كـ«كاميرا ويب»، وa7 III لا
// تفعل ذلك وحدها: تحتاج برنامج Sony Imaging Edge Webcam على الحاسوب (أو كرت HDMI).
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, AlertTriangle, Loader2, Copy, X, Usb } from "lucide-react";
import { toast } from "sonner";

type Level = "ok" | "warn" | "fail";
type Row = { level: Level; title: string; detail?: string; fix?: string[] };

const SONY = /sony|ilce|imaging edge|alpha/i;
const CAPTURE = /cam link|elgato|capture|hdmi|usb video|magewell|avermedia|blackmagic|decklink/i;

const ERR: Record<string, { title: string; fix: string[] }> = {
  NotReadableError: {
    title: "الكاميرا ظاهرة لكن برنامجاً آخر يحجزها",
    fix: [
      "أغلق Imaging Edge Desktop / Remote / Viewer (يحجزون الكاميرا ويمنعون Webcam).",
      "أغلق Zoom وTeams وFaceTime وأي تبويب آخر يستخدم الكاميرا.",
      "افصل الكابل، أطفئ الكاميرا وشغّلها، ثم وصّل من جديد.",
    ],
  },
  NotAllowedError: {
    title: "إذن الكاميرا مرفوض",
    fix: [
      "اضغط رمز القفل بجانب عنوان الموقع ← الكاميرا ← سماح، ثم أعد الفحص.",
      "على الماك: إعدادات النظام ← الخصوصية والأمان ← الكاميرا ← فعّل Google Chrome، ثم أعد تشغيل Chrome.",
    ],
  },
  OverconstrainedError: { title: "الكاميرا لا تقبل الإعداد المطلوب", fix: ["أعد الفحص؛ إن تكرر فافصل الكاميرا ووصّلها."] },
  NotFoundError: { title: "الكاميرا اختفت أثناء الفحص", fix: ["تأكد أن الكابل ثابت ولا يتحرك، وأن الكاميرا لم تدخل وضع النوم."] },
  AbortError: { title: "النظام قطع تشغيل الكاميرا", fix: ["أعد تشغيل الحاسوب ثم أعد الفحص."] },
};

const NOT_DETECTED_FIX = [
  "ثبّت برنامج «Imaging Edge Webcam» من موقع Sony على هذا الحاسوب، وأعد تشغيل الحاسوب بعد التثبيت (a7 III لا تظهر ككاميرا ويب بدونه).",
  "في قائمة الكاميرا: Setup ← USB Connection ← «PC Remote»، و Network ← «Ctrl w/ Smartphone» ← Off، وأطفئ Airplane Mode إن كان يمنع شيئاً.",
  "استخدم كابل بيانات حقيقي (كابل شحن فقط لا ينقل الصورة) وجرّب منفذاً آخر في الحاسوب مباشرة بدون موزّع USB.",
  "شغّل الكاميرا بعد توصيل الكابل، وانتظر أن تظهر على شاشتها «PC Remote» أو «USB connected».",
  "بديل مضمون: كرت التقاط HDMI (مثل Elgato Cam Link) وكابل HDMI من الكاميرا — يعمل بدون أي برنامج.",
];

export default function SonyDiagnostics({ open, onClose, onUse }: { open: boolean; onClose: () => void; onUse?: (deviceId: string) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [sonyId, setSonyId] = useState<string | null>(null);
  const [plugged, setPlugged] = useState<string | null>(null);
  const known = useRef<Set<string>>(new Set());

  const run = async () => {
    setRunning(true);
    setSonyId(null);
    const out: Row[] = [];
    const push = (r: Row) => { out.push(r); setRows([...out]); };
    setRows([]);

    const ua = navigator.userAgent;
    const os = /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone/iPad" : "غير معروف";
    const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "غير معروف";
    push({ level: "ok", title: `الجهاز: ${os} — المتصفح: ${browser}` });

    if (os === "iPhone/iPad" || os === "Android") {
      push({ level: "fail", title: "كاميرا Sony عبر USB تعمل من الحاسوب (ماك أو ويندوز) فقط", fix: ["افتح المنظومة من Chrome على الحاسوب ووصّل الكاميرا به."] });
      setRunning(false);
      return;
    }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      push({ level: "fail", title: "المتصفح لا يسمح بالكاميرا هنا", fix: ["افتح المنظومة من رابطها https في Google Chrome."] });
      setRunning(false);
      return;
    }
    if (browser === "Safari" || browser === "Firefox") {
      push({ level: "warn", title: `${browser} قد لا يعرض كاميرا Sony`, fix: ["الأفضل Google Chrome أو Edge."] });
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = await navigator.permissions?.query({ name: "camera" as any });
      if (p?.state === "denied") push({ level: "fail", title: "إذن الكاميرا مرفوض في المتصفح", fix: ERR.NotAllowedError.fix });
    } catch { /* بعض المتصفحات لا تدعم الاستعلام */ }

    // طلب إذن عام حتى تظهر أسماء الكاميرات.
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      s.getTracks().forEach((t) => t.stop());
    } catch (e) {
      const name = (e as Error).name;
      if (name === "NotAllowedError") { push({ level: "fail", title: ERR.NotAllowedError.title, fix: ERR.NotAllowedError.fix }); setRunning(false); return; }
      if (name === "NotFoundError") push({ level: "fail", title: "الحاسوب لا يرى أي كاميرا إطلاقاً", fix: NOT_DETECTED_FIX });
    }

    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
    known.current = new Set(cams.map((c) => c.deviceId));
    push({
      level: cams.length ? "ok" : "fail",
      title: `الكاميرات التي يراها الحاسوب: ${cams.length}`,
      detail: cams.map((c, i) => `• ${c.label || `كاميرا ${i + 1}`}`).join("\n") || undefined,
    });

    const sony = cams.filter((c) => SONY.test(c.label));
    const capture = cams.filter((c) => CAPTURE.test(c.label));
    if (!sony.length && !capture.length) {
      push({ level: "fail", title: "كاميرا Sony لا تظهر للحاسوب", detail: "المشكلة قبل المتصفح: الكابل أو إعداد الكاميرا أو برنامج Imaging Edge Webcam.", fix: NOT_DETECTED_FIX });
    }

    // نجرب فتح كل كاميرا Sony/التقاط فعلياً — هنا يظهر «برنامج آخر يحجزها».
    for (const cam of [...sony, ...capture]) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: cam.deviceId }, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false });
        const st = s.getVideoTracks()[0]?.getSettings();
        s.getTracks().forEach((t) => t.stop());
        const w = st?.width ?? 0;
        const h = st?.height ?? 0;
        push({
          level: w && w < 1280 ? "warn" : "ok",
          title: `«${cam.label}» تعمل ✓ — الدقة ${w}×${h}`,
          fix: w && w < 1280 ? ["الدقة منخفضة: استخدم منفذ USB 3 (أزرق) مباشرة، ولأفضل جودة صوّر بزر الكاميرا واستورد الصور."] : undefined,
        });
        setSonyId((prev) => prev ?? cam.deviceId);
      } catch (e) {
        const name = (e as Error).name;
        const info = ERR[name] ?? { title: `خطأ غير معروف (${name})`, fix: ["أعد تشغيل الكاميرا والحاسوب ثم أعد الفحص."] };
        push({ level: "fail", title: `«${cam.label}»: ${info.title}`, fix: info.fix });
      }
    }
    setRunning(false);
  };

  // مراقبة التوصيل: يخبرك فوراً إن ظهرت كاميرا جديدة عند توصيل الكابل.
  useEffect(() => {
    if (!open) return;
    void run();
    const onChange = async () => {
      const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
      const added = cams.find((c) => !known.current.has(c.deviceId));
      known.current = new Set(cams.map((c) => c.deviceId));
      if (added) { setPlugged(added.label || "كاميرا جديدة"); void run(); }
      else setPlugged(null);
    };
    navigator.mediaDevices?.addEventListener?.("devicechange", onChange);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const copy = async () => {
    const text = rows.map((r) => `[${r.level}] ${r.title}${r.detail ? "\n" + r.detail : ""}${r.fix ? "\n  - " + r.fix.join("\n  - ") : ""}`).join("\n");
    try { await navigator.clipboard.writeText(`فحص كاميرا Sony\n${navigator.userAgent}\n\n${text}`); toast.success("تم نسخ التقرير"); }
    catch { toast.error("تعذّر النسخ"); }
  };

  if (!open) return null;
  const Icon = ({ l }: { l: Level }) =>
    l === "ok" ? <CheckCircle2 className="size-5 text-green-500 shrink-0" /> : l === "warn" ? <AlertTriangle className="size-5 text-amber-500 shrink-0" /> : <XCircle className="size-5 text-red-500 shrink-0" />;

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-3" dir="rtl">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-background text-foreground p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-bold flex items-center gap-2"><Usb className="size-5" /> فحص اتصال كاميرا Sony (USB-C)</h2>
          <button onClick={onClose} aria-label="إغلاق"><X className="size-5" /></button>
        </div>
        <p className="text-xs text-muted-foreground">اترك هذه النافذة مفتوحة ووصّل الكابل أو افصله — تُعاد النتيجة تلقائياً.</p>
        {plugged && <p className="text-sm rounded-lg bg-green-500/10 text-green-700 p-2">تم اكتشاف توصيل: {plugged}</p>}

        <ul className="space-y-2">
          {rows.map((r, i) => (
            <li key={i} className="rounded-lg border p-2.5 text-sm">
              <div className="flex gap-2 items-start"><Icon l={r.level} /><span className="font-semibold">{r.title}</span></div>
              {r.detail && <pre className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground font-sans">{r.detail}</pre>}
              {r.fix && (
                <ol className="mt-2 list-decimal pr-5 space-y-1 text-xs">
                  {r.fix.map((f) => <li key={f}>{f}</li>)}
                </ol>
              )}
            </li>
          ))}
          {running && <li className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> جارٍ الفحص…</li>}
        </ul>

        <div className="flex gap-2">
          <Button onClick={() => void run()} disabled={running} className="flex-1">إعادة الفحص</Button>
          {sonyId && onUse && <Button variant="secondary" onClick={() => { onUse(sonyId); onClose(); }} className="flex-1">استخدم هذه الكاميرا</Button>}
          <Button variant="outline" onClick={() => void copy()}><Copy className="size-4" /></Button>
        </div>
      </div>
    </div>
  );
}
