// "أكمل من حيث توقفت" — الموظف يخرج للواتساب (يرسل صورة لزبون، يقرأ رسالة) ثم يعود.
//
// آيفون يقتل التطبيق المثبَّت في الخلفية كثيراً، فيُفتح عند العودة كأنه فتحة جديدة تماماً:
// الصفحة الرئيسية، بحث فارغ، نتائج البحث بالصورة ضائعة. نحفظ هنا ما يلزم لإعادة الموظف لنفس
// مكانه — لكن فقط لفترة قصيرة (RESUME_WINDOW_MS): العودة بعد ساعات تبقى بداية نظيفة كما كانت.
//
// localStorage لا sessionStorage: على آيفون التطبيق المثبَّت يبدأ جلسة جديدة بعد قتله، فتضيع
// sessionStorage بالضبط في الحالة التي نحتاجها. انتهاء الصلاحية بالوقت يعوّض عن ذلك.
import { useEffect, useRef } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";

export const RESUME_WINDOW_MS = 30 * 60 * 1000;

// يُولَّد مرة لكل تحميل فعلي للجافاسكربت. حالة حُفظت في نفس هذا التحميل (فتح قطعة ثم رجوع)
// تُستعاد دائماً مهما طال الوقت؛ حالة من تحميل سابق تُستعاد فقط ضمن نافذة العودة.
export const LOAD_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);

const PREFIX = "lamaa.resume.";

type Entry<T> = { v: T; at: number; loadId: string };

export function saveResume<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ v: value, at: Date.now(), loadId: LOAD_ID } satisfies Entry<T>));
  } catch {
    /* التخزين ممتلئ أو محظور (تصفّح خاص) — الاستعادة ميزة مساعدة لا أكثر */
  }
}

export function readResume<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const e = JSON.parse(raw) as Entry<T>;
    if (e.loadId === LOAD_ID || Date.now() - e.at < RESUME_WINDOW_MS) return e.v;
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* بيانات تالفة — نتجاهلها */
  }
  return null;
}

export function clearResume(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

/** هل هذه فتحة جديدة للتطبيق (لا تنقّل داخلي)؟ صحيحة فقط حتى أول تنقّل. */
let freshLoad = true;

// تحديث التطبيق المؤجَّل: بدل إعادة التحميل فوراً (فيضيع ما على الشاشة لحظة عودة الموظف)
// نؤجّله لأول تنقّل بين الصفحات — لحظة يغادر فيها الصفحة أصلاً.
let updateReady = false;
export const markUpdateReady = () => { updateReady = true; };

// نافذة العودة تُحسب من لحظة مغادرة التطبيق لا من لحظة الحفظ: موظف بقي 40 دقيقة على صفحة
// ثم خرج للواتساب دقيقة يجب أن يعود لنفس الصفحة. نجدّد وقت كل الحالات المحفوظة عند الخروج.
function touchAll() {
  try {
    const now = Date.now();
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(PREFIX)) continue;
      const e = JSON.parse(localStorage.getItem(k)!) as Entry<unknown>;
      if (e.loadId === LOAD_ID) localStorage.setItem(k, JSON.stringify({ ...e, at: now }));
    }
  } catch {
    /* ignore */
  }
}
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") touchAll(); });
  window.addEventListener("pagehide", touchAll);
}

/**
 * يعيد الموظف لآخر صفحة كان فيها إن فُتح التطبيق من جديد (آيفون قتله في الخلفية) خلال نافذة
 * العودة، ويحفظ الصفحة الحالية مع كل تنقّل. يطبّق أيضاً التحديث المؤجَّل عند أول تنقّل —
 * إلا أثناء رفع صور، فإعادة التحميل تقطع الرفع الجاري في المتصفح.
 */
export function useResumeRoute(uploadsActive: () => boolean) {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const first = useRef(true);

  useEffect(() => {
    const path = location.pathname + location.search;
    const isFirst = first.current;
    first.current = false;
    if (isFirst) {
      // start_url للتطبيق المثبَّت هو "/"؛ رابط مباشر لصفحة أخرى (إشعار مثلاً) يُحترم كما هو.
      if (freshLoad && navigationType === "POP" && location.pathname === "/") {
        const saved = readResume<string>("route");
        // دفع لا استبدال: يبقى "/" تحتها في السجل، فزر الرجوع من القطعة المستعادة يعود للبحث
        // (المستعاد بدوره) بدل الخروج من التطبيق.
        if (saved && saved !== path) {
          navigate(saved);
          return;
        }
      }
    } else {
      freshLoad = false;
    }
    saveResume("route", path);
    // الرابط الجديد صار في شريط العنوان فعلاً، فإعادة التحميل تفتح الصفحة التي قصدها بالنسخة الجديدة.
    if (!isFirst && updateReady && !uploadsActive()) window.location.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search]);
}
