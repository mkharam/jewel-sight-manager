// بوابة صور القطع على Cloudflare R2.
//
// نقلنا الصور من تخزين Supabase إلى R2 (10GB مجاناً وتنزيل بلا رسوم، مقابل 1GB في خطة
// Supabase المجانية). مفتاح R2 سرّي فلا يُشحن للمتصفح — هذه الدالة تمنحه روابط رفع موقّعة
// قصيرة العمر، وتحذف الملفات نيابةً عنه. القراءة لا تمرّ من هنا: الحاوية عامة عبر R2_PUBLIC_URL.
//
// الأسرار المطلوبة: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// نفس البادئات التي يكتبها التطبيق: imports/<user>/… (الرفع بالجملة)، branch-<id>/… أو
// unassigned/… (نموذج القطعة)، instagram/… (استيراد قديم). لا "..": المسار مفتاح في R2 حرفياً.
const PATH_RE = /^(imports|instagram|unassigned|branch-[0-9a-f-]{36})\/[A-Za-z0-9._\/-]{1,200}$/;
const validPath = (p: unknown): p is string => typeof p === "string" && PATH_RE.test(p) && !p.includes("..");

// الملفات لا يُعاد استخدام مساراتها أبداً (طابع زمني + عشوائي)، فمحتواها ثابت للأبد.
const CACHE_CONTROL = "public, max-age=31536000, immutable";
const UPLOAD_TTL_SECONDS = 600;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: uErr } = await userClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (uErr || !user) return json({ error: "unauthorized" }, 401);

    const r2 = new AwsClient({
      accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID")!,
      secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY")!,
      service: "s3",
      region: "auto",
    });
    const objectUrl = (path: string) =>
      `https://${Deno.env.get("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com/${Deno.env.get("R2_BUCKET")}/${path
        .split("/").map(encodeURIComponent).join("/")}`;

    const admin = createClient(SUPABASE_URL, SERVICE);
    // ما يشير إليه أي سطر في product_images — نقرأ بمفتاح الخدمة فنرى كل الفروع.
    const referenced = async (paths: string[]) => {
      const used = new Set<string>();
      const [a, b] = await Promise.all([
        admin.from("product_images").select("storage_path").in("storage_path", paths),
        admin.from("product_images").select("thumb_path").in("thumb_path", paths),
      ]);
      if (a.error || b.error) throw a.error ?? b.error;
      a.data?.forEach((r) => used.add(r.storage_path));
      b.data?.forEach((r) => r.thumb_path && used.add(r.thumb_path));
      return used;
    };

    const body = await req.json();
    const files: unknown[] = Array.isArray(body?.files) ? body.files : [];
    if (!files.length || files.length > 100) return json({ error: "1-100 files per request" }, 400);

    if (body.action === "sign-upload") {
      const items = files as { path?: unknown; contentType?: unknown }[];
      for (const f of items) {
        if (!validPath(f?.path)) return json({ error: `invalid path: ${String(f?.path)}` }, 400);
        if (typeof f.contentType !== "string" || !f.contentType.startsWith("image/")) {
          return json({ error: "images only" }, 400);
        }
      }
      // لا نوقّع رفعاً فوق صورة تستخدمها قطعة فعلاً — رابط الرفع يكتب فوق أي ملف بنفس المسار.
      const used = await referenced(items.map((f) => f.path as string));
      if (used.size) return json({ error: `path in use: ${[...used][0]}` }, 409);

      const signed = await Promise.all(items.map(async (f) => {
        const url = new URL(objectUrl(f.path as string));
        url.searchParams.set("X-Amz-Expires", String(UPLOAD_TTL_SECONDS));
        const headers = { "Content-Type": f.contentType as string, "Cache-Control": CACHE_CONTROL };
        const signedReq = await r2.sign(url.toString(), { method: "PUT", headers, aws: { signQuery: true } });
        return { path: f.path, url: signedReq.url, headers };
      }));
      return json({ uploads: signed });
    }

    if (body.action === "delete") {
      const paths = files.filter(validPath);
      const used = await referenced(paths);
      const orphaned = paths.filter((p) => !used.has(p));
      const results = await Promise.all(orphaned.map(async (p) => {
        const res = await r2.fetch(objectUrl(p), { method: "DELETE" });
        return res.ok || res.status === 404;
      }));
      return json({ deleted: results.filter(Boolean).length, skipped: paths.length - orphaned.length });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error("product-images-r2", e);
    return json({ error: e instanceof Error ? e.message : "internal error" }, 500);
  }
});
