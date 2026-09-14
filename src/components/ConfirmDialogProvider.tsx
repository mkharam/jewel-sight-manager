// نافذة تأكيد موحّدة بتصميم البرنامج بدل confirm() الأصلية من المتصفح — كانت تظهر بخلفية
// بيضاء بخط النظام في تطبيق كله داكن/عربي، وعلى الموبايل يسهل جداً الضغط على "موافق"
// بالخطأ لأنها تظهر في أعلى الشاشة بعيداً عن مكان إصبع الموظف.
//
// الاستدعاء إجرائي (يرجّع Promise) عمداً: مواضع الحذف موجودة داخل دوال async قصيرة
// (`if (!confirm(...)) return;`)، فتحويلها لنافذة JSX في كل صفحة كان سيتطلب إعادة هيكلة
// كل مكوّن. بهذا الشكل يتغيّر السطر الواحد فقط: `if (!(await confirm({...}))) return;`
import { createContext, useCallback, useContext, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type ConfirmOptions = {
  title: string;
  description?: string;
  /** نص زر التأكيد — الافتراضي "تأكيد". اجعله فعلاً صريحاً مثل "حذف نهائي". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** إجراء لا رجعة فيه (حذف/إغلاق جلسة) — يصبغ زر التأكيد بالأحمر التحذيري. */
  destructive?: boolean;
};

const ConfirmContext = createContext<(opts: ConfirmOptions) => Promise<boolean>>(async () => false);

export function useConfirm() {
  return useContext(ConfirmContext);
}

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  // المُحلِّل في ref لا state: النافذة قد تُغلق بأكثر من طريق (زر، Esc، ضغط خارجها) وكلها
  // تمرّ على settle، فنضمن أن الـPromise يُحلّ مرة واحدة فقط مهما كان طريق الإغلاق.
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((o: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setOpts(o);
    });
  }, []);

  const settle = (result: boolean) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setOpts(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={!!opts} onOpenChange={(open) => { if (!open) settle(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{opts?.title}</AlertDialogTitle>
            {opts?.description && <AlertDialogDescription>{opts.description}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settle(false)}>{opts?.cancelLabel ?? "إلغاء"}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => settle(true)}
              className={cn(opts?.destructive && buttonVariants({ variant: "destructive" }))}
            >
              {opts?.confirmLabel ?? "تأكيد"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}
