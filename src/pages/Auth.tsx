import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";

const schema = z.object({
  email: z.string().trim().email("بريد إلكتروني غير صالح").max(255),
  password: z.string().min(6, "كلمة المرور 6 أحرف على الأقل").max(72),
  fullName: z.string().trim().min(2, "الاسم قصير").max(100).optional(),
});

export default function Auth() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ email, password, fullName: mode === "signup" ? fullName : undefined });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("مرحباً بعودتك");
        navigate("/");
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: { full_name: fullName },
          },
        });
        if (error) throw error;
        toast.success("تم إنشاء الحساب — يمكنك الآن تسجيل الدخول");
        setMode("signin");
      }
    } catch (err: any) {
      const msg = err.message?.includes("Invalid login")
        ? "بيانات الدخول غير صحيحة"
        : err.message?.includes("already registered")
        ? "هذا البريد مسجل مسبقاً"
        : err.message ?? "حدث خطأ";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gold-soft flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="size-16 mx-auto rounded-2xl bg-gold-gradient flex items-center justify-center shadow-gold mb-3">
            <Sparkles className="size-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-extrabold text-gold-gradient">لمعة</h1>
          <p className="text-sm text-muted-foreground mt-1">نظام إدارة محلات الذهب والمجوهرات</p>
        </div>

        <Card className="p-6 shadow-elevated">
          <div className="flex gap-2 mb-6 p-1 bg-muted rounded-lg">
            <button
              type="button"
              onClick={() => setMode("signin")}
              className={`flex-1 py-2 rounded-md text-sm font-semibold transition ${
                mode === "signin" ? "bg-card shadow-sm" : "text-muted-foreground"
              }`}
            >
              تسجيل دخول
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              className={`flex-1 py-2 rounded-md text-sm font-semibold transition ${
                mode === "signup" ? "bg-card shadow-sm" : "text-muted-foreground"
              }`}
            >
              حساب جديد
            </button>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="fullName">الاسم الكامل</Label>
                <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="مثال: أحمد علي" required />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">البريد الإلكتروني</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@store.com" required dir="ltr" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">كلمة المرور</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required dir="ltr" />
            </div>

            <Button type="submit" disabled={loading} className="w-full bg-gold-gradient text-primary-foreground hover:opacity-90 shadow-gold">
              {loading ? "جارٍ..." : mode === "signin" ? "دخول" : "إنشاء حساب"}
            </Button>
          </form>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-4">
          أول حساب يتم إنشاؤه يجب أن يُرقّى يدوياً إلى صلاحية مدير عام من قاعدة البيانات.
        </p>
      </div>
    </div>
  );
}
