// تتبّع الحسابات: كل ما التطبيق ينفتح (وكل 5 دقايق وهو قدام الموظف) نسجّل اليوم ونوع الجهاز في
// user_presence. منها يشوف المدير العام مين يدخل ومين لا، ومن أي أجهزة — وجهازين بشبكتين في نفس
// اليوم علامة إن الحساب مستعمل من أكثر من واحد.
import { sb } from "@/lib/amarsoft";

/** وصف مختصر للجهاز من المتصفح: «آيفون · سفاري»، «ويندوز · كروم»… */
export function deviceLabel(ua: string | null | undefined) {
  const s = ua ?? "";
  if (!s) return "جهاز غير معروف";
  if (/WindowsPowerShell|curl|python|okhttp/i.test(s)) return "برنامج (مش متصفح)";
  const os = /iPhone/.test(s) ? "آيفون" : /iPad/.test(s) ? "آيباد" : /Android/.test(s) ? "أندرويد"
    : /Windows/.test(s) ? "ويندوز" : /Mac OS X|Macintosh/.test(s) ? "ماك" : /Linux/.test(s) ? "لينكس" : "جهاز";
  const browser = /Edg\//.test(s) ? "إيدج" : /CriOS|Chrome\//.test(s) ? "كروم" : /FxiOS|Firefox\//.test(s) ? "فايرفوكس"
    : /Safari\//.test(s) ? "سفاري" : "";
  return browser ? `${os} · ${browser}` : os;
}

const EVERY = 5 * 60_000;

/** يبدأ التسجيل لحساب داخل، ويرجّع دالة توقفه. */
export function startPresence() {
  const device = deviceLabel(navigator.userAgent);
  let last = 0;
  const touch = () => {
    if (document.visibilityState !== "visible" || Date.now() - last < EVERY - 5_000) return;
    last = Date.now();
    void sb.rpc("touch_presence", { p_device: device });
  };
  touch();
  const timer = window.setInterval(touch, EVERY);
  document.addEventListener("visibilitychange", touch);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", touch);
  };
}
