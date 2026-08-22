// دعوة لتثبيت التطبيق على الشاشة الرئيسية (يعمل كتطبيق آيفون بدون شريط المتصفح).
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Share, Plus, X, Download } from "lucide-react";

const DISMISS_KEY = "mkharrm-install-dismissed";

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // @ts-expect-error iOS Safari
    window.navigator.standalone === true
  );
}

export default function InstallPrompt() {
  const [show, setShow] = useState(false);
  const [deferred, setDeferred] = useState<any>(null);
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

  useEffect(() => {
    if (isStandalone() || localStorage.getItem(DISMISS_KEY)) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    // آيفون لا يدعم beforeinstallprompt — نعرض التعليمات بعد لحظة
    const t = isIOS ? window.setTimeout(() => setShow(true), 2500) : undefined;

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      if (t) clearTimeout(t);
    };
  }, [isIOS]);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setShow(false);
  };

  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice?.catch(() => {});
    dismiss();
  };

  if (!show) return null;

  return (
    <div className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:bottom-4 md:right-4 md:left-auto md:w-96 z-40">
      <div className="rounded-2xl border border-primary/30 bg-card/95 backdrop-blur p-4 shadow-elevated">
        <div className="flex items-start gap-3">
          <img src="/app-icon-192.png" alt="مخرّم" width={44} height={44} className="size-11 rounded-xl shadow-gold" />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm">ثبّت مخرّم على شاشتك الرئيسية</p>
            {isIOS && !deferred ? (
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                اضغط <Share className="inline size-3.5 align-[-2px] text-primary" /> مشاركة في سفاري، ثم
                <span className="font-semibold"> إضافة إلى الشاشة الرئيسية </span>
                <Plus className="inline size-3.5 align-[-2px] text-primary" /> ليفتح كتطبيق بدون شريط المتصفح.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-1">فتح أسرع، شاشة كاملة، وتجربة تطبيق حقيقي.</p>
            )}
            {deferred && (
              <Button onClick={install} className="mt-3 h-11 w-full bg-gold-gradient text-primary-foreground shadow-gold">
                <Download className="size-4 ml-1" />
                تثبيت التطبيق
              </Button>
            )}
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="إغلاق"
            className="size-10 -m-1 flex items-center justify-center rounded-lg text-muted-foreground active:bg-muted/50"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
