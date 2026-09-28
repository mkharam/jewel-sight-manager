// Cloudflare Worker "product-images" — رفع صور القطع وحذفها في حاوية R2 بلا أي مفتاح سرّي.
//
// الحاوية مربوطة بالـWorker مباشرةً (R2 binding اسمه BUCKET)، فلا حاجة لمفاتيح S3. الصلاحيات
// هي نفسها قواعد قاعدة البيانات الحالية: نستدعي دوال Supabase (product_image_write_allowed /
// product_image_delete_allowed / has_role) بجلسة المستخدم نفسه (JWT)، فيبقى من يحق له
// الرفع والحذف كما هو تماماً — المدير في أي مكان، والموظف في مجلّده وفرعه فقط.
// القراءة لا تمرّ من هنا: الحاوية عامة عبر رابط r2.dev.
//
// لا متغيّرات ولا أسرار: رابط Supabase ثابت أدناه، والمفتاح العام (publishable) يرسله التطبيق
// في ترويسة apikey مع كل طلب كما تفعل supabase-js. الإعداد الوحيد: R2 bucket binding باسم
// BUCKET → product-images.
//
// المسارات:
//   PUT    /o/<path>   رفع صورة (Content-Type: image/*، x-upsert: true للكتابة فوق مصغّرة)
//   DELETE /o/<path>   حذف صورة لا تشير إليها أي قطعة
//   POST   /copy       {paths: [...]} — للمدير العام: نسخ صور من تخزين Supabase إلى R2
//   GET    /health

const SUPABASE_URL = "https://iiyaytfdxfvjcvzlnlpp.supabase.co";
const ALLOWED_ORIGINS = [
  "https://mkharam.github.io",
  "https://jewel-sight-manager.lovable.app",
  "http://localhost:8080",
];
const CACHE_CONTROL = "public, max-age=31536000, immutable";
const MAX_BYTES = 25 * 1024 * 1024;
// نفس البادئات التي يكتبها التطبيق؛ المسار مفتاح في R2 حرفياً فلا ".." ولا رموز غريبة.
const PATH_RE = /^(imports|instagram|unassigned|branch-[0-9a-f-]{36})\/[A-Za-z0-9._\/-]{1,200}$/;

function corsHeaders(req) {
  const origin = req.headers.get("Origin");
  const h = {
    "Access-Control-Allow-Methods": "PUT, DELETE, POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-upsert",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

const json = (req, body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req), "Content-Type": "application/json" } });

// دالة Supabase بجلسة المستخدم نفسه — تُرجع قيمتها أو null إن رُفض الاستدعاء.
async function rpc(apikey, auth, fn, args) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey, Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!r.ok) return null;
  return r.json();
}

const validPath = (p) => typeof p === "string" && PATH_RE.test(p) && !p.includes("..");
const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });

    const url = new URL(req.url);
    if (url.pathname === "/health") return json(req, { ok: true, bucket: !!env.BUCKET });

    const auth = req.headers.get("Authorization") || "";
    const apikey = req.headers.get("apikey") || "";
    if (!auth.startsWith("Bearer ") || !apikey) return json(req, { error: "unauthorized" }, 401);

    if (url.pathname.startsWith("/o/")) {
      let path;
      try { path = decodeURIComponent(url.pathname.slice(3)); } catch { return json(req, { error: "invalid path" }, 400); }
      if (!validPath(path)) return json(req, { error: "invalid path" }, 400);

      if (req.method === "PUT") {
        const type = req.headers.get("Content-Type") || "";
        if (!type.startsWith("image/")) return json(req, { error: "images only" }, 400);
        if (Number(req.headers.get("Content-Length") || 0) > MAX_BYTES) return json(req, { error: "too large" }, 413);
        if ((await rpc(apikey, auth, "product_image_write_allowed", { obj_name: path })) !== true) {
          return json(req, { error: "forbidden" }, 403);
        }
        // مسارات الصور فريدة؛ الكتابة فوق ملف موجود مسموحة فقط صراحةً (توليد المصغّرات).
        if (req.headers.get("x-upsert") !== "true" && (await env.BUCKET.head(path))) {
          return json(req, { error: "exists" }, 409);
        }
        const body = await req.arrayBuffer();
        if (body.byteLength === 0 || body.byteLength > MAX_BYTES) return json(req, { error: "bad size" }, 400);
        await env.BUCKET.put(path, body, { httpMetadata: { contentType: type, cacheControl: CACHE_CONTROL } });
        return json(req, { ok: true, path });
      }

      if (req.method === "DELETE") {
        // الدالة نفسها تتحقق أن الملف في مجلّد المستخدم أو لا تشير إليه أي قطعة.
        if ((await rpc(apikey, auth, "product_image_delete_allowed", { obj_name: path })) !== true) {
          return json(req, { error: "forbidden" }, 403);
        }
        await env.BUCKET.delete(path);
        return json(req, { ok: true });
      }

      return json(req, { error: "method not allowed" }, 405);
    }

    // نقل الصور الموجودة من تخزين Supabase — للمدير العام فقط، على دفعات صغيرة. يتخطى ما
    // نُسخ من قبل، فتشغيله أكثر من مرة آمن (يلتقط ما رُفع لـSupabase قبل التحويل).
    if (url.pathname === "/copy" && req.method === "POST") {
      const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey, Authorization: auth } });
      if (!who.ok) return json(req, { error: "unauthorized" }, 401);
      const { id } = await who.json();
      if ((await rpc(apikey, auth, "has_role", { _user_id: id, _role: "admin" })) !== true) {
        return json(req, { error: "admin only" }, 403);
      }
      const body = await req.json().catch(() => ({}));
      const paths = Array.isArray(body.paths) ? body.paths : [];
      if (!paths.length || paths.length > 50) return json(req, { error: "1-50 paths" }, 400);

      const result = { copied: 0, skipped: 0, failed: [] };
      for (const p of paths) {
        if (!validPath(p)) { result.failed.push(p); continue; }
        if (await env.BUCKET.head(p)) { result.skipped++; continue; }
        const src = await fetch(`${SUPABASE_URL}/storage/v1/object/public/product-images/${encodePath(p)}`);
        if (!src.ok) { result.failed.push(p); continue; }
        const data = await src.arrayBuffer();
        await env.BUCKET.put(p, data, {
          httpMetadata: { contentType: src.headers.get("Content-Type") || "image/jpeg", cacheControl: CACHE_CONTROL },
        });
        result.copied++;
      }
      return json(req, result);
    }

    return json(req, { error: "not found" }, 404);
  },
};
