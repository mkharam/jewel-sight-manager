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
// ملاحظة مهمة: خدمة Apple لدفع الويب (web.push.apple.com) ترفض توكن VAPID الذي يحمل
// "sub" بنطاق غير حقيقي (مثل ".local") بخطأ "BadJwtToken" غامض لا يشير للسبب الفعلي —
// تأكّدنا من ذلك تجريبياً بعد استبعاد كل الاحتمالات الأخرى (التوقيع، تطابق المفاتيح،
// صيغة الترويسة، تثبيت PWA...). يجب أن يبقى هذا بريداً حقيقياً قابلاً للوصول.
const VAPID_SUBJECT = "mailto:mohamedmkharm@gmail.com";

function b64urlToBytes(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
function bytesToB64url(b: Uint8Array): string {
  let s = "";
  for (const byte of b) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// نوقّع JWT الخاص بـ VAPID بأنفسنا عبر Web Crypto الأصلية في Deno بدل الاعتماد على
// آلية التوقيع الداخلية لمكتبة web-push (المبنية على crypto.createSign الخاصة بـ Node
// وتحويل DER إلى JOSE يدوياً) — تحققنا أن Web Crypto في Deno تُخرج توقيع ECDSA خام
// بصيغة r||s الصحيحة (64 بايت) مباشرة، وهذا أوثق وأبسط من محاولة إصلاح توافق مكتبة
// web-push مع بيئة Deno.
async function signVapidJwt(audience: string): Promise<string> {
  const pub = b64urlToBytes(VAPID_PUBLIC);
  const x = pub.slice(1, 33);
  const y = pub.slice(33, 65);
  const d = b64urlToBytes(VAPID_PRIVATE);

  const jwk = { kty: "EC", crv: "P-256", x: bytesToB64url(x), y: bytesToB64url(y), d: bytesToB64url(d), ext: true };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);

  const header = { typ: "JWT", alg: "ES256" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud: audience, iat: now, exp: now + 3600, sub: VAPID_SUBJECT };
  const enc = (o: unknown) => bytesToB64url(new TextEncoder().encode(JSON.stringify(o)));
  const signingInput = `${enc(header)}.${enc(payload)}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${bytesToB64url(new Uint8Array(sig))}`;
}

async function sendPush(sub: { endpoint: string; p256dh: string; auth: string }, payload: string): Promise<void> {
  // نستخدم web-push فقط لبناء الطلب (التشفير RFC8291 والترويسات)، ونوقّع Authorization
  // بأنفسنا كما هو موضّح أعلاه بدل الاعتماد على توقيعها الداخلي.
  const details = webpush.generateRequestDetails(
    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    payload,
    { vapidDetails: { subject: VAPID_SUBJECT, publicKey: VAPID_PUBLIC, privateKey: VAPID_PRIVATE } },
  );
  const audience = new URL(sub.endpoint).origin;
  const jwt = await signVapidJwt(audience);

  // نحذف أي مفتاح Authorization موجود بالفعل بغض النظر عن حالة الأحرف قبل إضافة مفتاحنا
  // الخاص — لو اكتفينا بالنشر فقط ومفتاح web-push بحالة أحرف مختلفة (مثلاً "authorization"
  // مقابل "Authorization")، فإن fetch() يدمج القيمتين بفاصلة بدل استبدال أحدهما بالآخر،
  // ما يُرسل رأساً مشوّهاً لـ Apple.
  const headers: Record<string, string> = { ...details.headers };
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === "authorization") delete headers[k];
  }
  headers["Authorization"] = `vapid t=${jwt}, k=${VAPID_PUBLIC}`;

  const res = await fetch(details.endpoint, { method: details.method, headers, body: details.body });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(new Error("push send failed"), { statusCode: res.status, body: text });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) return json({ error: "VAPID keys not configured" }, 500);

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
    const errors: Array<{ id: string; status?: number; message?: string; body?: string }> = [];

    await Promise.all(
      subs.map(async (s: { id: string; endpoint: string; p256dh: string; auth: string }) => {
        try {
          await sendPush(s, payload);
          sent++;
        } catch (e) {
          const err = e as { statusCode?: number; body?: string; message?: string };
          const status = err?.statusCode;
          console.error("push send failed", s.id, status, err?.body, err?.message);
          errors.push({ id: s.id, status, message: err?.message, body: err?.body });
          // 404/410: endpoint gone — لن ينجح أبداً، احذفه.
          if (status === 404 || status === 410) stale.push(s.id);
        }
      }),
    );

    if (stale.length) await admin.from("push_subscriptions").delete().in("id", stale);

    return json({ sent, removed: stale.length, errors });
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
