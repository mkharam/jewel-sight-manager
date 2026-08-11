// تحليل صورة مجوهرات — مزوّدات مجانية فقط (Groq → Gemini)، بدون Lovable AI.
// Body: { imageBase64, mimeType?, categories?, imageId?, analysis? }

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  analysisToEmbeddingText,
  analyzeWithFallback,
  embedText,
  friendlyError,
  type JewelryAnalysis,
} from "../_shared/lovable-ai.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const imageBase64: string | undefined = body?.imageBase64;
    const mimeType: string = body?.mimeType ?? "image/jpeg";
    const categories: { id: string; name: string }[] = body?.categories ?? [];
    const imageId: string | undefined = body?.imageId;
    const providedAnalysis: JewelryAnalysis | undefined = body?.analysis;

    if (!providedAnalysis && !imageBase64) {
      return json({ error: "imageBase64 or analysis required" }, 400);
    }

    let analysis: JewelryAnalysis;
    let provider = "cached";
    if (providedAnalysis) {
      analysis = providedAnalysis;
    } else {
      const r = await analyzeWithFallback({
        imageBase64: imageBase64!,
        mimeType,
        categoryNames: categories.map((c) => c.name),
      });
      analysis = r.analysis;
      provider = r.provider;
    }

    let categoryId: string | null = null;
    if (analysis.category_name) {
      const cat = categories.find(
        (c) =>
          c.name === analysis.category_name ||
          c.name.includes(analysis.category_name!) ||
          analysis.category_name!.includes(c.name),
      );
      categoryId = cat?.id ?? null;
    }

    // embedding اختياري — يُستخدم للبحث بالصورة
    if (imageId) {
      try {
        const embedding = await embedText(analysisToEmbeddingText(analysis));
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        await supabase
          .from("product_images")
          .update({
            ai_labels: { ...analysis, category_id: categoryId },
            ai_embedding: embedding as unknown as string,
          })
          .eq("id", imageId);
      } catch (e) {
        console.error("Embedding step failed (non-fatal)", e);
      }
    }

    return json({ ...analysis, category_id: categoryId, provider });
  } catch (e) {
    const { status, message } = friendlyError(e);
    if (status === 429) {
      return json({ error: message, code: "AI_BUSY", retryable: true }, 200);
    }
    return json({ error: message }, status);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
