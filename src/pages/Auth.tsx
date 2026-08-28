import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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

const signupSchema = loginSchema.extend({
  fullName: z.string().trim().min(2, "اكتب اسمك الكامل").max(100),
});

// "admin" -> "admin@lamaa.local"; legacy "admin@lamaa.com" -> stays
function usernameToEmail(input: string): string {
  const v = input.trim().toLowerCase();
  if (v.includes("@")) return v;
  return `${v}@${USERNAME_DOMAIN}`;
}

export default function Auth() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);

  const submitLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = loginSchema.safeParse({ username, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    try {
      const email = usernameToEmail(username);
      let { error } = await supabase.auth.signInWithPassword({ email, password });
      // Backwards compat: try the old admin email if user typed "admin"
      if (error && username.trim().toLowerCase() === "admin") {
        const r2 = await supabase.auth.signInWithPassword({ email: "admin@lamaa.com", password });
        error = r2.error;
      }
      if (error) throw error;
      toast.success("مرحباً بعودتك");
      navigate("/");
    } catch (err: any) {
      const msg = err.message?.includes("Invalid login")
        ? "اسم المستخدم أو كلمة المرور غير صحيحة"
        : err.message ?? "حدث خطأ";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const submitSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = signupSchema.safeParse({ username, password, fullName });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    try {
      const email = usernameToEmail(username);
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: parsed.data.fullName },
          emailRedirectTo: window.location.origin,
        },
      });
      if (error) {
        if (error.message?.toLowerCase().includes("already registered")) {
          throw new Error("اسم المستخدم مستخدم مسبقاً، جرّب اسماً آخر");
        }
        throw error;
      }
      toast.success("تم إنشاء حسابك بنجاح — مرحباً بك");
      navigate("/");
    } catch (err: any) {
      toast.error(err.message ?? "حدث خطأ أثناء إنشاء الحساب");
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
          <h1 className="text-3xl font-extrabold text-gold-gradient">مخرّم</h1>
          <p className="text-sm text-muted-foreground mt-1">نظام إدارة محلات الذهب والمجوهرات</p>
        </div>

        <Card className="p-6 shadow-elevated">
          <Tabs value={tab} onValueChange={(v) => setTab(v as "login" | "signup")} className="w-full">
            <TabsList className="w-full grid grid-cols-2 mb-5">
              <TabsTrigger value="login">تسجيل الدخول</TabsTrigger>
              <TabsTrigger value="signup">إنشاء حساب</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
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
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={submitSignup} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="fullName">الاسم الكامل</Label>
                  <Input
                    id="fullName"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="مثال: أحمد محمد"
                    required
                    autoComplete="name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-username">اسم المستخدم</Label>
                  <Input
                    id="new-username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="مثال: ahmed"
                    required
                    dir="ltr"
                    autoComplete="username"
                  />
                  <p className="text-[11px] text-muted-foreground">أحرف إنجليزية وأرقام فقط — تستخدمه لتسجيل الدخول</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-password">كلمة المرور</Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="4 خانات على الأقل"
                    required
                    dir="ltr"
                    autoComplete="new-password"
                  />
                </div>

                <Button type="submit" disabled={loading} className="w-full bg-gold-gradient text-primary-foreground hover:opacity-90 shadow-gold">
                  {loading ? "جارٍ..." : "إنشاء الحساب"}
                </Button>
                <p className="text-[11px] text-muted-foreground text-center">
                  الحساب الجديد يُنشأ بدور "موظف" — المدير العام يحدد الفرع والصلاحيات من صفحة "الموظفون".
                </p>
              </form>
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </div>
  );
}
