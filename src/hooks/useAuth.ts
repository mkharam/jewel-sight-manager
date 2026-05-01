import { useEffect, useState } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "manager" | "employee";

export interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
  roles: AppRole[];
  profile: { full_name: string; branch_id: string | null } | null;
}

export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [profile, setProfile] = useState<AuthState["profile"]>(null);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s?.user) {
        // Defer DB fetches to avoid deadlocks
        setTimeout(() => loadUserData(s.user.id), 0);
      } else {
        setRoles([]);
        setProfile(null);
      }
    });

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s?.user) loadUserData(s.user.id);
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  async function loadUserData(userId: string) {
    const [{ data: rolesData }, { data: profileData }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("profiles").select("full_name, branch_id").eq("id", userId).maybeSingle(),
    ]);
    setRoles((rolesData ?? []).map((r) => r.role as AppRole));
    setProfile(profileData ?? null);
  }

  return {
    session,
    user: session?.user ?? null,
    loading,
    roles,
    profile,
  };
}

export const hasRole = (roles: AppRole[], role: AppRole) => roles.includes(role);
export const isManagerOrAdmin = (roles: AppRole[]) =>
  roles.includes("admin") || roles.includes("manager");
