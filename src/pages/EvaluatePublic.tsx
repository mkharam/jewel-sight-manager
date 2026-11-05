// صفحة الرابط اللي يتبعت للموظفين والمشرفين (واتساب): تفتح بلا تسجيل دخول، بالرمز السري في الرابط.
import { useParams } from "react-router-dom";
import { ClipboardList } from "lucide-react";
import EvaluationForm from "@/components/EvaluationForm";

export default function EvaluatePublic() {
  const { token } = useParams<{ token: string }>();
  return (
    <div dir="rtl" className="min-h-dvh bg-background">
      <div className="brand-silk px-4 pt-[calc(env(safe-area-inset-top)+1.25rem)] pb-5 text-center">
        <ClipboardList className="size-9 mx-auto text-primary" />
        <h1 className="text-2xl font-bold text-gold-gradient mt-1">تقييم الشهر</h1>
        <p className="text-sm text-muted-foreground">مخرّم للذهب والمجوهرات</p>
      </div>
      <div className="max-w-lg mx-auto p-4 pb-[calc(env(safe-area-inset-bottom)+2rem)]">
        <EvaluationForm token={token} />
      </div>
    </div>
  );
}
