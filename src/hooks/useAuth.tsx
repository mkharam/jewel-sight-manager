import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { startPresence } from "@/lib/presence";

// الأدوار من فوق لتحت: الإدارة (admin) ← المشرف العام (supervisor: كل الفروع بلا فلوس) ← مشرف فرع
// (manager) ← موظف.
export type AppRole = "admin" | "supervisor" | "manager" | "employee";

export interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
  rolesLoading: boolean;
  roles: AppRole[];
  profile: { full_name: string; branch_id: string | null } | null;
}

const AuthContext = createContext<AuthState | null>(null);

function useAuthState(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [profile, setProfile] = useState<AuthState["profile"]>(null);
  // المستخدم اللي حمّلنا أدواره. تجديد الجلسة (كل ساعة، وكل ما يرجع للتطبيق من برنامج ثاني) يجي بنفس
  // المستخدم: ما نعاودوش التحميل، لأن rolesLoading يخلي ProtectedRoute يبدّل الصفحة بشاشة التحميل،
  // فالصفحة تتبنى من جديد وترجع لفوق وسط البحث.
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    const load = (userId: string) => {
      if (loadedFor.current === userId) return;
      loadedFor.current = userId;
      setRolesLoading(true);
      setTimeout(() => loadUserData(userId), 0);
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s?.user) {
        load(s.user.id);
      } else {
        loadedFor.current = null;
        setRoles([]);
        setProfile(null);
        setRolesLoading(false);
      }
    });

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s?.user) {
        load(s.user.id);
      } else {
        setRolesLoading(false);
      }
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  // سجل الدخول اليومي والجهاز — للمدير العام (راجع lib/presence.ts).
  const uid = session?.user?.id;
  useEffect(() => (uid ? startPresence() : undefined), [uid]);

  async function loadUserData(userId: string, attempt = 1) {
    let failed = false;
    try {
      const [{ data: rolesData, error: rolesError }, { data: profileData, error: profileError }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", userId),
        supabase.from("profiles").select("full_name, branch_id").eq("id", userId).maybeSingle(),
      ]);
      failed = !!(rolesError || profileError);
      const list = (rolesData ?? []).map((r) => r.role as AppRole);
      // sort so admin > manager > employee — first item used for display
      const order: Record<AppRole, number> = { admin: 0, supervisor: 1, manager: 2, employee: 3 };
      list.sort((a, b) => order[a] - order[b]);
      setRoles(list);
      setProfile(profileData ?? null);
    } catch {
      failed = true;
    } finally {
      setRolesLoading(false);
    }
    // ما جاتش (الشبكة طاحت…): تجديد الجلسة لنفس المستخدم ما يعاودش التحميل (loadedFor)، فنعاودو هنا،
    // وإلا يقعد بلا صلاحياته لين يسكّر البرنامج ويفتحه. بعد 3 محاولات، أول حدث جلسة جاي يعاود.
    if (!failed || loadedFor.current !== userId) return;
    if (attempt < 3) setTimeout(() => { if (loadedFor.current === userId) loadUserData(userId, attempt + 1); }, 2000 * attempt);
    else loadedFor.current = null;
  }

  return {
    session,
    user: session?.user ?? null,
    loading,
    rolesLoading,
    roles,
    profile,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const state = useAuthState();
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}

export const hasRole = (roles: AppRole[], role: AppRole) => roles.includes(role);
export const isManagerOrAdmin = (roles: AppRole[]) =>
  roles.includes("admin") || roles.includes("supervisor") || roles.includes("manager");
/** الإدارة أو المشرف العام: كل الفروع في الشغل اليومي. الفلوس والمبيعات تبقى roles.includes("admin"). */
export const isLead = (roles: AppRole[]) => roles.includes("admin") || roles.includes("supervisor");
export const ROLE_LABEL: Record<AppRole, string> = {
  admin: "الإدارة", supervisor: "مشرف عام", manager: "مشرف فرع", employee: "موظف",
};
export const roleLabel = (roles: AppRole[]) => ROLE_LABEL[roles[0] ?? "employee"] ?? "موظف";
