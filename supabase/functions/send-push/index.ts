// إرسال إشعارات Web Push لموظفي فرع معيّن (أو لمستخدمين محددين).
// Body: { branchId?, userIds?, title, body?, url? }
// يُستدعى من triggers قاعدة البيانات مع الترويسة x-webhook-secret،
// أو من التطبيق بجلسة مستخدم مسجّل.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("PUSH_WEBHOOK_SECRET") ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) return json({ error: "VAPID keys not configured" }, 500);
    webpush.setVapidDetails("mailto:notifications@lamaa.local", VAPID_PUBLIC, VAPID_PRIVATE);

    const fromTrigger = req.headers.get("x-webhook-secret") === WEBHOOK_SECRET && !!WEBHOOK_SECRET;
    const authHeader = req.headers.get("Authorization") ?? "";

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (!fromTrigger) {
      // استدعاء من التطبيق: يجب أن يكون مستخدماً مسجّلاً
      const token = authHeader.replace("Bearer ", "");
      const { data: userRes } = await admin.auth.getUser(token);
      if (!userRes?.user) return json({ error: "unauthorized" }, 401);
    }

    const body = await req.json();
    const branchId: string | undefined = body?.branchId ?? undefined;
    const userIds: string[] | undefined = body?.userIds ?? undefined;
    const title: string = body?.title ?? "مخرّم";
    const message: string = body?.body ?? "";
    const url: string = body?.url ?? "/";

    let targets = userIds ?? [];
    if (branchId) {
      const { data: profiles } = await admin
        .from("profiles")
        .select("id")
        .eq("branch_id", branchId)
        .eq("is_active", true);
      targets = [...targets, ...(profiles ?? []).map((p: { id: string }) => p.id)];
    }
    targets = [...new Set(targets)];
    if (targets.length === 0) return json({ sent: 0, reason: "no targets" });

    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .in("user_id", targets);

    if (!subs || subs.length === 0) return json({ sent: 0, reason: "no subscriptions" });

    const payload = JSON.stringify({ title, body: message, url });
    let sent = 0;
    const stale: string[] = [];

    await Promise.all(
      subs.map(async (s: { id: string; endpoint: string; p256dh: string; auth: string }) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
          );
          sent++;
        } catch (e) {
          const status = (e as { statusCode?: number })?.statusCode;
          if (status === 404 || status === 410) stale.push(s.id);
          else console.error("push failed", status, (e as Error)?.message);
        }
      }),
    );

    if (stale.length) await admin.from("push_subscriptions").delete().in("id", stale);

    return json({ sent, removed: stale.length });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error)?.message ?? "unexpected error" }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
