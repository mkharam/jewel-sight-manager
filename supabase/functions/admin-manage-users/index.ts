// Admin-only user management edge function
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");

    // Verify caller and admin role
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: uErr } = await userClient.auth.getUser(token);
    if (uErr || !user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id);
    const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const action = body.action as string;

    if (action === "create") {
      const { email, password, full_name, role, branch_id } = body;
      if (!email || !password || !full_name || !role) {
        return new Response(JSON.stringify({ error: "missing fields" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name },
      });
      if (cErr || !created.user) {
        return new Response(JSON.stringify({ error: cErr?.message ?? "create failed" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const uid = created.user.id;
      await admin.from("profiles").upsert({ id: uid, full_name, branch_id: branch_id || null });
      // remove default role auto-assigned by trigger if any, then set requested role
      await admin.from("user_roles").delete().eq("user_id", uid);
      await admin.from("user_roles").insert({ user_id: uid, role });
      return new Response(JSON.stringify({ ok: true, user_id: uid }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "update_password") {
      const { user_id, password } = body;
      const { error } = await admin.auth.admin.updateUserById(user_id, { password });
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "delete") {
      const { user_id } = body;
      if (user_id === user.id) {
        return new Response(JSON.stringify({ error: "cannot delete self" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { error } = await admin.auth.admin.deleteUser(user_id);
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "list") {
      const { data: users } = await admin.auth.admin.listUsers();
      const ids = users.users.map((u) => u.id);
      const [{ data: profiles }, { data: roles2 }] = await Promise.all([
        admin.from("profiles").select("id, full_name, branch_id").in("id", ids),
        admin.from("user_roles").select("user_id, role").in("user_id", ids),
      ]);
      const list = users.users.map((u) => {
        const p = profiles?.find((x: any) => x.id === u.id);
        const r = roles2?.find((x: any) => x.user_id === u.id);
        return {
          id: u.id,
          email: u.email,
          created_at: u.created_at,
          full_name: p?.full_name ?? "",
          branch_id: p?.branch_id ?? null,
          role: r?.role ?? "employee",
        };
      });
      return new Response(JSON.stringify({ users: list }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "unknown action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message ?? "server error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
