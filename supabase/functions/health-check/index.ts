// فحص صحة يومي يرسل إشعاراً لهاتف المدير العام عند أي خلل — بدل أن يكتشفه موظف أمام زبون
// (هكذا تعطّل البحث بالصورة حين أوقفت جوجل موديلات Gemini 2.5 ولم يعرف أحد).
// يُستدعى كل صباح من pg_cron (راجع migration 20260925120000_health_check.sql).
//
// POST  (x-queue-secret) → يفحص ويُرسل إشعاراً فقط إن وُجدت مشاكل.
// POST  {"dryRun": true} → نفس الفحص بلا إشعار، ويُرجع النتيجة (للتجربة اليدوية).
// POST  {"testAlert": true} → يرسل إشعاراً تجريبياً للمدراء للتأكد من وصول التنبيهات.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { GEMINI_VISION_MODELS } from "../_shared/lovable-ai.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// الموديلات التي يعتمد عليها التطبيق فعلاً: الرؤية (تحليل الصور والبحث بالصورة) + البصمة.
const GEMINI_MODELS = [...GEMINI_VISION_MODELS, "gemini-embedding-2"];
const SITES = {
  "تطبيق المجوهرات": "https://mkharam.github.io/jewel-sight-manager/",
  "تطبيق الصيانة": "https://mkharam.github.io/Goldsystem/",
};
const STORAGE_QUOTA_BYTES = 1024 ** 3; // خطة Supabase المجانية: 1GB لكل المشاريع
const STORAGE_WARN_RATIO = 0.8;

type Check = { name: string; ok: boolean; detail?: string };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function withTimeout<T>(p: Promise<T>, ms = 10_000): Promise<T> {
  return await Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

async function checkGemini(): Promise<Check> {
  const key = (Deno.env.get("GOOGLE_API_KEY") ?? Deno.env.get("GEMINI_API_KEY") ?? "").trim().replace(/^["']|["']$/g, "");
  if (!key) return { name: "Gemini", ok: false, detail: "مفتاح Gemini غير مضبوط" };
  // استعلام معلومات الموديل لا يستهلك أي حصة — 404 يعني أن جوجل أوقفته.
  const results = await Promise.all(GEMINI_MODELS.map(async (m) => {
    try {
      const r = await withTimeout(fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}?key=${key}`));
      return { m, status: r.status };
    } catch {
      return { m, status: 0 };
    }
  }));
  const gone = results.filter((r) => r.status === 404).map((r) => r.m);
  const failing = results.filter((r) => r.status !== 200 && r.status !== 404).map((r) => `${r.m} (${r.status || "لا رد"})`);
  if (gone.length === GEMINI_VISION_MODELS.length || gone.includes("gemini-embedding-2")) {
    return { name: "Gemini", ok: false, detail: `موديلات متوقفة — البحث بالصورة معطّل: ${gone.join("، ")}` };
  }
  if (gone.length) return { name: "Gemini", ok: false, detail: `أوقفت جوجل: ${gone.join("، ")} — يجب تحديث القائمة` };
  if (failing.length) return { name: "Gemini", ok: false, detail: `لا يستجيب: ${failing.join("، ")}` };
  return { name: "Gemini", ok: true };
}

async function checkSite(label: string, url: string): Promise<Check> {
  try {
    const r = await withTimeout(fetch(url, { redirect: "follow" }));
    return r.ok ? { name: label, ok: true } : { name: label, ok: false, detail: `الموقع يرجع ${r.status}` };
  } catch (e) {
    return { name: label, ok: false, detail: `الموقع لا يفتح (${(e as Error).message})` };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  // نفس سرّ طابور التحليل من Vault — يحمي الدالة من استدعاء الغرباء (كل فحص يستدعي جوجل).
  const secret = req.headers.get("x-queue-secret");
  const { data: authorized } = secret
    ? await admin.rpc("verify_internal_secret", { _name: "analysis_queue_secret", _value: secret })
    : { data: false };
  if (authorized !== true) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dryRun === true;
  const testAlert = body?.testAlert === true;

  const checks: Check[] = [];

  // قاعدة البيانات + طابور التحليل + التخزين في استعلام واحد.
  const { data: snap, error: snapErr } = await admin.rpc("health_snapshot");
  if (snapErr || !snap) {
    checks.push({ name: "قاعدة البيانات", ok: false, detail: snapErr?.message ?? "لا رد" });
  } else {
    checks.push({ name: "قاعدة البيانات", ok: true });
    const stuck = Number(snap.unanalyzed_images_2h ?? 0);
    checks.push(stuck > 0
      ? { name: "تحليل الصور", ok: false, detail: `${stuck} صورة لم تُحلَّل منذ أكثر من ساعتين — طابور التحليل متوقف` }
      : { name: "تحليل الصور", ok: true });
    const used = Number(snap.storage_bytes ?? 0);
    const mb = Math.round(used / 1024 ** 2);
    checks.push(used > STORAGE_QUOTA_BYTES * STORAGE_WARN_RATIO
      ? { name: "التخزين", ok: false, detail: `${mb}MB من 1024MB — قارب الحد` }
      : { name: "التخزين", ok: true, detail: `${mb}MB` });
  }

  checks.push(await checkGemini());
  for (const [label, url] of Object.entries(SITES)) checks.push(await checkSite(label, url));

  const problems = checks.filter((c) => !c.ok);
  if (testAlert) problems.push({ name: "اختبار", ok: false, detail: "إشعار تجريبي — نظام التنبيه اليومي يعمل، لا توجد مشكلة" });
  let notified = 0;
  if (problems.length && !dryRun) {
    const { data: admins } = await admin.from("user_roles").select("user_id").eq("role", "admin");
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-webhook-secret": Deno.env.get("PUSH_WEBHOOK_SECRET") ?? "" },
      body: JSON.stringify({
        userIds: (admins ?? []).map((a: { user_id: string }) => a.user_id),
        title: `⚠️ ${problems.length === 1 ? "مشكلة" : `${problems.length} مشاكل`} في التطبيق`,
        body: problems.map((p) => `• ${p.name}: ${p.detail}`).join("\n"),
        url: "/",
      }),
    });
    notified = (await res.json().catch(() => ({})))?.sent ?? 0;
    console.error("health-check problems", JSON.stringify(problems), "notified", notified);
  }

  return json({ ok: problems.length === 0, checks, notified, dryRun });
});
