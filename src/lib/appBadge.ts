// رقم التنبيهات على أيقونة التطبيق في الشاشة الرئيسية (آيفون iOS 16.4+ ومتصفحات
// سطح المكتب) — مجموع الإشعارات والرسائل غير المقروءة. يتطلّب إذن الإشعارات، وهو ممنوح
// أصلاً لمن فعّل إشعارات الجهاز. حين يكون التطبيق مغلقاً يزيد الـSW الرقم مع كل
// إشعار (public/sw.js)، وعند فتحه نضع الرقم الدقيق هنا.

export const NOTIFS_SEEN_KEY = "lamaa.notifs.lastSeen";
export const CHAT_SEEN_KEY = "lamaa.chat.lastSeen";
/** يُطلق عند تعليم شيء كمقروء، فتعيد العدّادات الحساب فوراً في كل مكان. */
export const SEEN_EVENT = "lamaa-seen";

export function readSeen(key: string): string {
  try {
    return localStorage.getItem(key) ?? "1970-01-01";
  } catch {
    return "1970-01-01";
  }
}

export function markSeen(key: string, iso: string) {
  try {
    if (iso <= readSeen(key)) return;
    localStorage.setItem(key, iso);
  } catch {
    /* تخزين غير متاح — العدّاد يبقى كما هو */
  }
  window.dispatchEvent(new Event(SEEN_EVENT));
}

export function setIconBadge(count: number) {
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  try {
    if (count > 0) void nav.setAppBadge?.(count)?.catch(() => {});
    else void nav.clearAppBadge?.()?.catch(() => {});
  } catch {
    /* غير مدعوم */
  }
  // الـSW يحفظ الرقم ليزيد عليه مع الإشعارات القادمة والتطبيق مغلق.
  navigator.serviceWorker?.controller?.postMessage({ type: "badge", count });
}
