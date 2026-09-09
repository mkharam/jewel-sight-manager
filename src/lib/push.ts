// تسجيل إشعارات الدفع (Web Push) للموظف على جهازه
import { supabase } from "@/integrations/supabase/client";

export const VAPID_PUBLIC_KEY: string =
  (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ??
  "BF4CADXhbzDcY_SyDdmo3NvGSANcHwAjVpzcmm-lrhwSu0C8OHuJJXsJKDNYUjj8DaJHcbkni_dLmovfJB7H_Uo";

export function pushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

export type PushStatus = "unsupported" | "denied" | "subscribed" | "unsubscribed";

/** الحالة الفعلية الحالية — لا تُحدَّث تلقائياً، تُقرأ عند الحاجة فقط. */
export async function currentPushStatus(): Promise<PushStatus> {
  if (!pushSupported()) return "unsupported";
  if (typeof Notification !== "undefined" && Notification.permission === "denied") return "denied";
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? "subscribed" : "unsubscribed";
  } catch {
    return "unsubscribed";
  }
}

/**
 * تُستدعى مرة عند فتح التطبيق (بعد تسجيل الدخول). إن كان الإذن ممنوحاً فعلاً لكن
 * الاشتراك ضاع لسبب ما (تحديث service worker، مسح بيانات الموقع…) تُعيد الاشتراك
 * بصمت دون أي نافذة إذن جديدة. إن لم يُطلب الإذن من قبل («default») تُظهر نافذة
 * الإذن الأصلية من المتصفح تلقائياً بدل انتظار أن يتذكّر الموظف فتح الجرس والضغط
 * على "تفعيل" يدوياً — وهذا يضمن أن الإشعارات "لا تبقى مطفأة" دون أن يلاحظ أحد.
 * لا تفعل شيئاً إن كان الإذن مرفوضاً صراحة («denied») — المتصفح يتجاهل أي طلب جديد
 * في هذه الحالة على أي حال، ولا نملك سوى توجيه الموظف لتفعيله يدوياً من إعدادات الجهاز.
 */
export async function ensurePushEnabled(): Promise<void> {
  const status = await currentPushStatus();
  if (status !== "unsubscribed") return;
  try {
    await enablePush();
  } catch {
    /* أفضل محاولة فقط — لا نُزعج الموظف برسالة خطأ عند فتح التطبيق */
  }
}

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** يطلب الإذن ويحفظ اشتراك الجهاز. يُرجع true عند النجاح. */
export async function enablePush(): Promise<boolean> {
  if (!pushSupported()) return false;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  const reg = await navigator.serviceWorker.ready;
  // لا نُعيد استخدام اشتراك قديم مطلقاً — قد يكون مرتبطاً بمفتاح VAPID سابق (مثلاً بعد
  // توليد مفاتيح جديدة على الخادم)، فيفشل الإرسال بصمت لاحقاً بخطأ BadJwtToken دون أي
  // مؤشر للموظف. إلغاء الاشتراك القديم أولاً يضمن اشتراكاً جديداً مطابقاً للمفتاح الحالي دائماً.
  const existing = await reg.pushManager.getSubscription();
  if (existing) await existing.unsubscribe();
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });

  const json = sub.toJSON();
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes?.user?.id;
  if (!userId || !json.endpoint || !json.keys) return false;

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
    { onConflict: "endpoint" },
  );
  return !error;
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
}
