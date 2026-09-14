// شبكة أمان أخيرة: أي خطأ غير متوقَّع في أي صفحة كان يُفرِغ الشجرة كلها فتبقى شاشة بيضاء
// فارغة بلا أي طريق للخروج. أسوأ ما في ذلك أن التطبيق المثبَّت على آيفون يبقى معلّقاً في
// الذاكرة (راجع التعليق في main.tsx) فقد لا يحصل الموظف على تحميل جديد يُنقذه حتى بإعادة
// فتح الأيقونة. هنا نعرض رسالة عربية واضحة مع زر إعادة تحميل فعلي بدل الفراغ.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RotateCcw } from "lucide-react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // يبقى في كونسول الجهاز للتشخيص لو احتجناه — لا يُرسل لأي خدمة خارجية.
    console.error("[app-error]", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-sm w-full text-center space-y-4">
          <div className="size-14 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto">
            <AlertTriangle className="size-7 text-destructive" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-lg font-bold">حصل خطأ غير متوقّع</h1>
            <p className="text-sm text-muted-foreground">
              لم يضع أي شيء صوّرته أو حفظته — كل البيانات محفوظة على الخادم. أعد تحميل
              التطبيق للمتابعة.
            </p>
          </div>
          <Button onClick={() => window.location.reload()} className="w-full bg-gold-gradient text-primary-foreground shadow-gold">
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
