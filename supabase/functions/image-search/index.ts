// البحث بصورة العميل — هجين: بصمة الصورة نفسها + بصمة وصف الذكاء الاصطناعي لها.
//
// لماذا الاثنان معاً: بصمة الصورة تمسك التطابق البصري (نفس القطعة أو شبيهتها شكلاً)،
// وبصمة الوصف تمسك القطع التي تشترك في الخصائص (لون الحجر، نوع القطعة، الشكل) حتى لو
// اختلفت الصورة في الإضاءة أو الزاوية أو الخلفية. المقارنة تتم داخل كل عمود مع نظيره
// من نفس الوسيط (صورة↔صورة، نص↔نص) لأن المقارنة عبر وسيطين مختلفين تُنتج ترتيباً بلا
// معنى — قِسنا ذلك فعلياً، راجع migration 20260910120000.
//
// Request:  { imageBase64: string, mimeType?: string, categories?: {id,name}[],
//             matchCount?: number }
// Response: { analysis: {...}, matches: [{ product_id, similarity, visual, textual, kind }] }
//   kind: "exact" تطابق بصري شبه تام | "similar" شبيه بصرياً | "same_attributes" يشترك
//   في الأوصاف (لون/شكل/نوع) دون تطابق بصري قوي.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  analysisToEmbeddingText,
  analyzeWithFallback,
  embedImage,
  embedText,
  friendlyError,
} from "../_shared/lovable-ai.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const imageBase64: string | undefined = body?.imageBase64;
    const mimeType: string = body?.mimeType ?? "image/jpeg";
    const categories: { id: string; name: string }[] = body?.categories ?? [];
    const matchCount: number = Math.min(Math.max(Number(body?.matchCount ?? 12), 1), 40);

    if (!imageBase64) return json({ error: "imageBase64 required" }, 400);

    // التحليل مطلوب أصلاً لعرضه في الواجهة (فئة/عيار/أحجار)، ونستفيد منه هنا مرة ثانية
    // كمصدر لبصمة الوصف بدل استدعاء إضافي.
    const { analysis } = await analyzeWithFallback({
      imageBase64,
      mimeType,
      categoryNames: categories.map((c) => c.name),
    });

    const [imageEmbedding, textEmbedding] = await Promise.all([
      embedImage(imageBase64, mimeType),
      embedText(analysisToEmbeddingText(analysis)).catch(() => null),
    ]);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: rows, error } = await supabase.rpc("match_product_images_hybrid", {
      query_image_embedding: imageEmbedding as unknown as string,
      query_text_embedding: (textEmbedding ?? null) as unknown as string | null,
      match_count: matchCount * 3, // نجلب أكثر ثم نوحّد حسب القطعة
      // الوصف يُرجّح أكثر من الصورة عمداً: الوصف يلتقط تركيبة القطعة الكاملة (فكرة
      // "طقم زهور وأوراق"، طراز تجاري معروف…) بينما التشابه البصري وحده قد يُطابق حسب
      // زاوية/إضاءة/خلفية الصورة فقط دون التقاط الفكرة العامة للتصميم. راجع توثيق الوصف
      // الموسّع في buildSystemPrompt (lovable-ai.ts).
      image_weight: 0.35,
    });

    if (error) {
      console.error("RPC error", error);
      return json({ error: error.message }, 500);
    }

    // عدة صور قد تخصّ نفس القطعة — نُبقي أفضل صورة لكل قطعة.
    const best = new Map<string, { product_id: string; similarity: number; visual: number | null; textual: number | null }>();
    for (const r of (rows ?? []) as any[]) {
      const cur = best.get(r.product_id);
      if (!cur || r.score > cur.similarity) {
        best.set(r.product_id, {
          product_id: r.product_id,
          similarity: r.score,
          visual: r.visual_similarity,
          textual: r.text_similarity,
        });
      }
    }

    // تصنيف النتيجة بدل رقم واحد مبهم — الموظف يحتاج يعرف هل هي نفس القطعة أم قطعة
    // تشبهها أم قطعة تشترك معها في الأوصاف فقط، ليعرض على الزبون البدائل المناسبة.
    const matches = Array.from(best.values())
      .map((m) => ({
        ...m,
        kind: (m.visual ?? 0) >= 0.92 ? "exact" : (m.visual ?? 0) >= 0.75 ? "similar" : "same_attributes",
      }))
      .filter((m) => (m.visual ?? 0) >= 0.55 || (m.textual ?? 0) >= 0.72)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, matchCount);

    return json({ analysis, matches });
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
