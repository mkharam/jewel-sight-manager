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

const USERNAME_DOMAIN = "lamaa.local";

const schema = z.object({
  username: z
    .string()
    .trim()
    .min(2, "اسم المستخدم قصير")
    .max(50, "اسم المستخدم طويل")
    .regex(/^[a-zA-Z0-9._-]+$/, "أحرف إنجليزية أو أرقام فقط"),
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
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ username, password });
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
          <h2 className="text-lg font-bold mb-4 text-center">تسجيل الدخول</h2>

          <form onSubmit={submit} className="space-y-4">
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
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-4">
          الحسابات تُنشأ من قِبَل المدير العام من صفحة "الموظفون".
        </p>
      </div>
    </div>
  );
}
