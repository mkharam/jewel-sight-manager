// حارس صلاحيات للمسارات.
//
// كانت الصفحات الإدارية مخفيّة من القائمة فقط — يكفي أن يكتب الموظف العنوان في شريط
// المتصفح ليفتح التقارير أو سجل المبيعات أو إدارة القطع. سياسات RLS تحمي البيانات
// الحسّاسة في القاعدة، لكن الصفحة نفسها كانت تُفتح وتعرض ما يصله منها، وهذا يخالف أن
// «الأدمنز هم من يرون كل شيء».
import { Link } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

type Allowed = "admin" | "manager";

export default function RequireRole({ allow, children }: { allow: Allowed[]; children: React.ReactNode }) {
  const { roles } = useAuth();
  if (allow.some((r) => roles.includes(r))) return <>{children}</>;

  return (
    <div className="max-w-sm mx-auto text-center space-y-4 py-16">
      <div className="size-14 mx-auto rounded-2xl bg-muted flex items-center justify-center">
        <ShieldAlert className="size-7 text-muted-foreground" />
      </div>
      <h1 className="text-xl font-bold">هذه الصفحة للإدارة</h1>
      <p className="text-sm text-muted-foreground leading-relaxed">
        صلاحيتك لا تشمل هذه الصفحة. إن كنت تحتاجها لعملك تواصل مع المدير العام.
      </p>
      <Button asChild variant="outline" className="w-full">
        <Link to="/">العودة للبحث</Link>
      </Button>
    </div>
  );
}
