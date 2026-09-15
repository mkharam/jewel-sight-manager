// شبكة أمان أخيرة: أي خطأ غير متوقَّع في أي صفحة كان يُفرِغ الشجرة كلها فتبقى شاشة بيضاء
// فارغة بلا أي طريق للخروج. أسوأ ما في ذلك أن التطبيق المثبَّت على آيفون يبقى معلّقاً في
// الذاكرة (راجع التعليق في main.tsx) فقد لا يحصل الموظف على تحميل جديد يُنقذه حتى بإعادة
// فتح الأيقونة.
//
// ولأن أغلب ما يصل هذه الشاشة فعلياً ليس عطلاً في الصفحة بل نسخة قديمة عالقة: التطبيق
// المثبَّت يبقى مفتوحاً أياماً، فإذا نُشرت نسخة جديدة اختفت ملفات النسخة القديمة من
// الخادم، فيفشل تحميل أول صفحة ينتقل إليها الموظف. الحل هناك إعادة تحميل لا قراءة رسالة.
// لذلك نتعافى تلقائياً مرة واحدة بدل مطالبة الموظف بالضغط، ولا نُظهر الشاشة إلا إن تكرّر
// الخطأ — حتى لا ندخل في حلقة إعادة تحميل لا تنتهي أمام خطأ حقيقي.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RotateCcw, Loader2 } from "lucide-react";

type Props = { children: ReactNode };
type State = { error: Error | null; recovering: boolean };

const RETRY_KEY = "lamaa.errorRecovery.v1";
/** نافذة الحماية من الحلقة: خطأ ثانٍ خلالها يعني أن إعادة التحميل لم تُصلح شيئاً. */
const RETRY_WINDOW_MS = 60_000;

/** خطأ تحميل ملف من نسخة لم تعد موجودة على الخادم — علامة النسخة القديمة العالقة. */
function isStaleBuildError(error: Error): boolean {
  const msg = `${error?.name ?? ""} ${error?.message ?? ""}`.toLowerCase();
  return (
    msg.includes("dynamically imported module") ||
    msg.includes("importing a module script failed") ||
    msg.includes("failed to fetch") ||
    msg.includes("chunkloaderror") ||
    msg.includes("unable to preload") ||
    msg.includes("'text/html' is not a valid javascript mime type")
  );
}

/** هل استُهلكت محاولة التعافي التلقائي قريباً؟ */
function recentlyRetried(): boolean {
  try {
    const at = Number(sessionStorage.getItem(RETRY_KEY) ?? 0);
    return at > 0 && Date.now() - at < RETRY_WINDOW_MS;
  } catch {
    return false;
  }
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, recovering: false };

  static getDerivedStateFromError(error: Error): State {
    // لا نُظهر الشاشة أصلاً إن كنا سنعيد التحميل — الموظف يرى "جارٍ إعادة المحاولة" لا خطأً.
    return { error, recovering: !recentlyRetried() };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // يبقى في كونسول الجهاز للتشخيص لو احتجناه — لا يُرسل لأي خدمة خارجية.
    console.error("[app-error]", error, info.componentStack);
    if (recentlyRetried()) return;

    try { sessionStorage.setItem(RETRY_KEY, String(Date.now())); } catch {}
    void this.recover(error);
  }

  /** نمسح مخزن الـservice worker قبل إعادة التحميل حين يكون السبب نسخة قديمة عالقة،
   *  وإلا فقد يُعيد تقديم الملفات القديمة نفسها فتفشل المحاولة بلا فائدة. */
  private async recover(error: Error) {
    if (isStaleBuildError(error)) {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch {}
      try {
        const regs = await navigator.serviceWorker?.getRegistrations?.();
        await Promise.all((regs ?? []).map((r) => r.update().catch(() => {})));
      } catch {}
    }
    // مهلة قصيرة: تسمح بظهور رسالة "جارٍ إعادة المحاولة" فلا يبدو التطبيق وكأنه ارتجّ بلا سبب.
    setTimeout(() => window.location.reload(), 600);
  }

  render() {
    if (!this.state.error) return this.props.children;

    if (this.state.recovering) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-6">
          <div className="text-center space-y-3">
            <Loader2 className="size-8 animate-spin text-primary mx-auto" />
            <p className="text-sm text-muted-foreground">جارٍ إعادة المحاولة…</p>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-sm w-full text-center space-y-4">
          <div className="size-14 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto">
            <AlertTriangle className="size-7 text-destructive" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-lg font-bold">حصل خطأ غير متوقّع</h1>
            <p className="text-sm text-muted-foreground">
              لم يضع أي شيء صوّرته أو حفظته — كل البيانات محفوظة على الخادم. جرّبنا إصلاحه
              تلقائياً ولم ينجح، فأعد التحميل أو أبلغ المدير.
            </p>
          </div>
          <Button
            onClick={() => {
              try { sessionStorage.removeItem(RETRY_KEY); } catch {}
              window.location.reload();
            }}
            className="w-full bg-gold-gradient text-primary-foreground shadow-gold"
          >
            <RotateCcw className="size-4 ml-1" /> إعادة تحميل التطبيق
          </Button>
          {/* نص الخطأ للمالك/الدعم عند الحاجة — مطوي ولا يُفزع الموظف */}
          <details className="text-right">
            <summary className="text-[11px] text-muted-foreground cursor-pointer">تفاصيل تقنية</summary>
            <pre className="mt-2 text-[10px] text-muted-foreground bg-muted/40 rounded-lg p-2 overflow-x-auto text-left" dir="ltr">
              {this.state.error.message}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
