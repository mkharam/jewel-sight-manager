import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";

const USERNAME_DOMAIN = "lamaa.local";

const usernameSchema = z
  .string()
  .trim()
  .min(2, "اسم المستخدم قصير")
  .max(50, "اسم المستخدم طويل")
  .regex(/^[a-zA-Z0-9._-]+$/, "أحرف إنجليزية أو أرقام فقط");

const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(4, "كلمة المرور 4 خانات على الأقل").max(72),
});

// "admin" -> "admin@lamaa.local"; legacy "admin@lamaa.com" -> stays
function usernameToEmail(input: string): string {
  const v = input.trim().toLowerCase();
  if (v.includes("@")) return v;
  return `${v}@${USERNAME_DOMAIN}`;
}

export default function Auth() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // Redirect once the session actually lands in context — signInWithPassword
  // resolving doesn't mean the AuthProvider's session state has updated yet,
  // so navigating right after the call can race ProtectedRoute back here.
  useEffect(() => {
    if (session) navigate("/", { replace: true });
  }, [session, navigate]);

  const submitLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = loginSchema.safeParse({ username, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    try {
      // "admin" only ever exists under the legacy email — go straight there
      // instead of burning a guaranteed-401 attempt (and rate-limit budget)
      // on the new-style address first.
      const isLegacyAdmin = username.trim().toLowerCase() === "admin";
      const email = isLegacyAdmin ? "admin@lamaa.com" : usernameToEmail(username);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast.success("مرحباً بعودتك");
      // Navigation happens via the session effect above once context updates.
    } catch (err: any) {
      const msg = err.message?.includes("Invalid login")
        ? "اسم المستخدم أو كلمة المرور غير صحيحة"
        : err.message ?? "حدث خطأ";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    // شاشة الدخول تعرض الهوية كاملة: حقل الحرير الزمرّدي وشعار المتجر الفعلي
    <div className="min-h-screen brand-silk flex items-center justify-center p-4 relative overflow-hidden">
      {/* خيوط ذهبية رفيعة تعبر الخلفية، كما في الشعار */}
      <div className="pointer-events-none absolute inset-x-0 top-[18%] h-px bg-gradient-to-l from-transparent via-primary/35 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-[22%] h-px bg-gradient-to-r from-transparent via-primary/25 to-transparent" />

      <div className="w-full max-w-md relative">
        <div className="text-center mb-6">
          <img
            src={`${import.meta.env.BASE_URL}brand-logo.webp`}
            alt="مخرّم"
            width={96}
            height={96}
            className="size-24 mx-auto rounded-2xl object-cover shadow-emerald ring-1 ring-primary/30 mb-3"
          />
          <h1 className="text-3xl font-extrabold text-gold-gradient">مخرّم</h1>
          <p className="text-sm text-on-brand-muted mt-1">نظام إدارة محلات الذهب والمجوهرات</p>
        </div>

        <Card className="p-6 shadow-elevated">
          <h2 className="text-center font-bold mb-5">تسجيل الدخول</h2>
          <form onSubmit={submitLogin} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username">اسم المستخدم</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                required
                dir="ltr"
                autoComplete="username"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">كلمة المرور</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••"
                required
                dir="ltr"
                autoComplete="current-password"
              />
            </div>

            <Button type="submit" disabled={loading} className="w-full bg-gold-gradient text-primary-foreground hover:opacity-90 shadow-gold">
              {loading ? "جارٍ..." : "دخول"}
            </Button>
            <p className="text-[11px] text-muted-foreground text-center">
              ما عندكش حساب؟ اطلب من المدير العام ينشئه من صفحة "الموظفون".
            </p>
          </form>
        </Card>
      </div>
    </div>
  );
}
