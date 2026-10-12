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
// Response: { analysis: {...}, matches: [{ product_id, similarity, visual, textual, kind, reasons }] }
//   kind: "exact" نفس التصميم | "very_close" قريبة جداً | "similar_look" شكل مشابه |
//   "same_attributes" تشترك في الأوصاف (لون الذهب/الأحجار/الطراز) دون تشابه بصري قوي |
//   "might_like" ذوق قريب — اقتراحات إضافية "ممكن تعجب الزبون".
//   reasons: أسباب بالعربية يقرؤها الموظف للزبون ("نفس لون الذهب"، "نفس الأحجار: خضراء").

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
    const matchCount: number = Math.min(Math.max(Number(body?.matchCount ?? 140), 1), 150);

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

    // التصنيف كله في قاعدة البيانات (match_products_tiered): كل قطعة تُقاس نسبةً لبقية المخزون
    // لنفس الصورة لا بعتبة ثابتة، وتُقارن أوصافها (لون الذهب، ألوان الأحجار، الطراز) بما قرأه
    // الذكاء الاصطناعي من صورة الزبون. راجع migration 20260924120000_photo_search_tiers.sql.
    const { data: rows, error } = await supabase.rpc("match_products_tiered", {
      q_image: imageEmbedding as unknown as string,
      q_text: (textEmbedding ?? null) as unknown as string | null,
      q_labels: analysis,
      max_results: matchCount,
    });

    if (error) {
      console.error("RPC error", error);
      return json({ error: error.message }, 500);
    }

    const matches = ((rows ?? []) as any[]).map((r) => ({
      product_id: r.product_id,
      similarity: r.score,
      visual: r.visual,
      textual: r.textual,
      kind: r.kind as "exact" | "very_close" | "similar_look" | "same_attributes" | "might_like",
      reasons: (r.reasons ?? []) as string[],
    }));

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
