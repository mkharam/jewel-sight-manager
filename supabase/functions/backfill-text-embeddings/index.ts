// توليد بصمة الوصف (text_embedding) للصور المفهرسة سابقاً.
//
// لا يُعيد تحليل الصور إطلاقاً: يقرأ ai_labels المخزّن أصلاً ويحوّله لبصمة نصية فقط —
// أرخص وأسرع بكثير من reindex-product-images (الذي يستدعي نماذج الرؤية لكل صورة)،
// والنتيجة نفسها لأن الوصف موجود مسبقاً. للمدير العام فقط.
//
// Body: { limit?: number }  — الافتراضي 50 صورة لكل نداء.
// Response: { processed, failed, remaining }
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { analysisToEmbeddingText, embedText, friendlyError, type JewelryAnalysis } from "../_shared/lovable-ai.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "غير مصرّح" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: userData, error: userErr } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userErr || !userData?.user) return json({ error: "جلسة غير صالحة" }, 401);

    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) return json({ error: "هذه العملية للمدير العام فقط" }, 403);

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body?.limit ?? 50), 1), 100);

    const { count: remainingBefore } = await admin
      .from("product_images")
      .select("id", { count: "exact", head: true })
      .is("text_embedding", null)
      .not("ai_labels", "is", null);

    const { data: rows, error: listErr } = await admin
      .from("product_images")
      .select("id, ai_labels")
      .is("text_embedding", null)
      .not("ai_labels", "is", null)
      .limit(limit);
    if (listErr) throw listErr;
    if (!rows?.length) return json({ processed: 0, failed: 0, remaining: 0 });

    let processed = 0;
    let failed = 0;

    // تسلسلي بفاصل بسيط — بصمات النص رخيصة لكن حصة الدقيقة عند Gemini محدودة، والدفعة
    // كاملة تُستدعى مراراً من الواجهة فلا داعي لاستنزاف الحصة بتوازٍ عالٍ.
    for (const row of rows) {
      try {
        const labels = row.ai_labels as JewelryAnalysis | null;
        const text = labels ? analysisToEmbeddingText(labels) : "";
        if (!text.trim()) { failed++; continue; }

        const vec = await embedText(text);
        const { error: upErr } = await admin
          .from("product_images")
          .update({ text_embedding: vec as unknown as string })
          .eq("id", row.id);
        if (upErr) throw upErr;
        processed++;
      } catch (e) {
        failed++;
        console.error("text embedding failed", row.id, e instanceof Error ? e.message : e);
      }
    }

    return json({ processed, failed, remaining: Math.max((remainingBefore ?? 0) - processed, 0) });
  } catch (e) {
    const { status, message } = friendlyError(e);
    return json({ error: message }, status);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
