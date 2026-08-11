// إعادة فهرسة صور القطع: يبحث عن الصور التي لا تحتوي تحليل (ai_labels) أو بصمة (ai_embedding)
// ويعيد تحليلها بنفس سلسلة المزودين المجانية (Groq → Gemini) ثم يحفظ النتيجة.
// للمدير العام فقط (يتحقق من الدور في الكود).
//
// Body: { limit?: number }   الافتراضي 8 صور لكل نداء (لتجنّب مهلة 150 ثانية)
// Response: { processed, failed, remaining, rateLimited, results: [{ imageId, ok, provider?, error? }] }

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  analysisToEmbeddingText,
  analyzeWithFallback,
  embedText,
  friendlyError,
} from "../_shared/lovable-ai.ts";

const BUCKET = "product-images";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // ── التحقق من الهوية والدور (verify_jwt = false، لذا نتحقق في الكود) ──
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "غير مصرّح" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: userData, error: userErr } = await admin.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userErr || !userData?.user) return json({ error: "جلسة غير صالحة" }, 401);

    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) return json({ error: "هذه العملية للمدير العام فقط" }, 403);

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body?.limit ?? 8), 1), 20);

    // ── الصور التي تحتاج فهرسة ──
    const needsWork = "ai_embedding.is.null,ai_labels.eq.{}";

    const { count: remainingBefore } = await admin
      .from("product_images")
      .select("id", { count: "exact", head: true })
      .or(needsWork);

    const { data: images, error: listErr } = await admin
      .from("product_images")
      .select("id,product_id,storage_path")
      .or(needsWork)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (listErr) throw listErr;

    if (!images?.length) {
      return json({ processed: 0, failed: 0, remaining: 0, rateLimited: false, results: [] });
    }

    // ── أسماء الفئات لمساعدة التحليل ──
    const { data: cats } = await admin.from("categories").select("id,name").eq("is_active", true);
    const categories = cats ?? [];

    const results: any[] = [];
    let processed = 0;
    let failed = 0;
    let rateLimited = false;

    for (const img of images) {
      if (rateLimited) break; // لا نُهدر الوقت إن كانت كل المزودات مشغولة

      try {
        const file = await admin.storage.from(BUCKET).download(img.storage_path);
        if (file.error || !file.data) throw new Error("تعذّر تحميل الصورة من التخزين");

        const buf = new Uint8Array(await file.data.arrayBuffer());
        const imageBase64 = base64FromBytes(buf);
        const mimeType = file.data.type || guessMime(img.storage_path);

        const { analysis, provider } = await withRetry(() =>
          analyzeWithFallback({
            imageBase64,
            mimeType,
            categoryNames: categories.map((c) => c.name),
          }),
        );

        const cat = analysis.category_name
          ? categories.find(
              (c) =>
                c.name === analysis.category_name ||
                c.name.includes(analysis.category_name!) ||
                analysis.category_name!.includes(c.name),
            )
          : null;

        const embedding = await withRetry(() => embedText(analysisToEmbeddingText(analysis)));

        const { error: upErr } = await admin
          .from("product_images")
          .update({
            ai_labels: { ...analysis, category_id: cat?.id ?? null },
            ai_embedding: embedding as unknown as string,
          })
          .eq("id", img.id);
        if (upErr) throw upErr;

        processed++;
        results.push({ imageId: img.id, ok: true, provider });
      } catch (e) {
        failed++;
        const { status, message } = friendlyError(e);
        if (status === 429 || status === 402) rateLimited = true;
        results.push({ imageId: img.id, ok: false, error: message });
        console.error("reindex failed", img.id, message);
      }
    }

    const remaining = Math.max((remainingBefore ?? 0) - processed, 0);
    return json({ processed, failed, remaining, rateLimited, results });
  } catch (e) {
    const { status, message } = friendlyError(e);
    return json({ error: message }, status);
  }
});

/** إعادة محاولة مع تراجع تدريجي عند 429/5xx فقط. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const status = (e as any)?.status ?? 500;
      const retryable = status === 429 || status >= 500;
      if (!retryable || i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 2500 * (i + 1)));
    }
  }
  throw lastErr;
}

function base64FromBytes(bytes: Uint8Array): string {
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(out);
}

function guessMime(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
