/**
 * إبقاء الجهاز مستيقظاً أثناء الرفع.
 *
 * الرفع والتحليل يجريان داخل المتصفح، ومتصفحات الهاتف تُجمّد الجافاسكربت بمجرّد أن تُطفأ
 * الشاشة أو يخرج المستخدم من التطبيق — فيتوقف الرفع في منتصفه. سفاري iOS تحديداً لا تدعم
 * Background Sync إطلاقاً، فلا توجد طريقة لمواصلة الرفع فعلياً بعد الخروج من التطبيق.
 * أكثر سبب عملي لانقطاع الرفع هو انطفاء الشاشة أثناء الانتظار، وهذا ما يعالجه Wake Lock
 * (مدعوم في أندرويد كروم و iOS 16.4+).
 *
 * ملاحظة: النظام يُحرّر القفل تلقائياً عند إخفاء الصفحة، لذا نُعيد طلبه عند العودة إليها
 * ما دام الرفع مستمراً — وإلا يبقى مفقوداً بعد أول تبديل تطبيق.
 */

type SentinelLike = { released: boolean; release: () => Promise<void> } | null;

let sentinel: SentinelLike = null;
let holders = 0;
let suspended = false;

async function request() {
  const wl = (navigator as any)?.wakeLock;
  if (suspended || !wl?.request || document.visibilityState !== "visible") return;
  try {
    sentinel = await wl.request("screen");
  } catch {
    // مرفوض (بطارية منخفضة مثلاً) — الرفع يكمل عادياً ما دامت الشاشة مضاءة.
  }
}

function onVisibilityChange() {
  if (document.visibilityState === "visible" && holders > 0 && (!sentinel || sentinel.released)) {
    void request();
  }
}

/**
 * تعليق القفل مؤقتاً مهما كان عدد المستدعين — ضروري أثناء فتح الكاميرا تحديداً.
 *
 * قفل الشاشة يمرّ عبر نفس طبقة إدارة الطاقة/الوسائط في iOS (mediaserverd) التي تدير
 * جلسة الكاميرا، ووجوده أثناء getUserMedia كان يجعل النظام يعامل الجلسة كأنها في
 * الخلفية فيرجع المسار حيّاً لكن muted:true بلا أي إطار — شاشة سوداء كاملة داخل
 * التطبيق المثبَّت (راجع التحذير المفصّل أعلى BulkCameraCapture.tsx).
 *
 * الرفع قد يكون شغّالاً في الخلفية وقت فتح الكاميرا (resumePendingUploads يبدأ دفعة
 * بعد ثوانٍ من فتح التطبيق)، فلا يكفي ألا تطلب الكاميرا القفل لنفسها — يجب تعليق أي
 * قفل قائم أيضاً. يُستعاد تلقائياً عند إغلاق الكاميرا إن كان الرفع ما زال مستمراً.
 */
export function suspendWakeLock(): () => void {
  suspended = true;
  void sentinel?.release().catch(() => {});
  sentinel = null;

  let resumed = false;
  return () => {
    if (resumed) return;
    resumed = true;
    suspended = false;
    if (holders > 0) void request();
  };
}

/** يطلب القفل ويعيد دالة تحرير. يدعم عدة مستدعين متوازيين. */
export function keepAwake(): () => void {
  if (holders === 0) {
    document.addEventListener("visibilitychange", onVisibilityChange);
    void request();
  }
  holders++;

  let releasedByCaller = false;
  return () => {
    if (releasedByCaller) return;
    releasedByCaller = true;
    holders = Math.max(0, holders - 1);
    if (holders === 0) {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void sentinel?.release().catch(() => {});
      sentinel = null;
    }
  };
}
