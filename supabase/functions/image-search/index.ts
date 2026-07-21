// Search by photo: analyze the customer's photo with vision, embed the
// description, then run pgvector similarity against product_images.ai_embedding.
//
// Request:  { imageBase64: string, mimeType?: string, categories?: {id,name}[],
//             matchCount?: number }
// Response: { analysis: {...}, matches: [{ product_id, similarity }] }

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  analysisToEmbeddingText,
  analyzeWithFallback,
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
    const matchCount: number = Math.min(Math.max(Number(body?.matchCount ?? 12), 1), 30);

    if (!imageBase64) return json({ error: "imageBase64 required" }, 400);

    const { analysis } = await analyzeWithFallback({
      imageBase64,
      mimeType,
      categoryNames: categories.map((c) => c.name),
    });

    const embedding = await embedText(analysisToEmbeddingText(analysis));

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: matches, error } = await supabase.rpc("match_product_images", {
      query_embedding: embedding as unknown as string,
      match_count: matchCount,
    });

    if (error) {
      console.error("RPC error", error);
      return json({ error: error.message }, 500);
    }

    // Dedupe by product_id, keep highest similarity per product
    const bestByProduct = new Map<string, { product_id: string; similarity: number }>();
    for (const m of (matches ?? []) as any[]) {
      const cur = bestByProduct.get(m.product_id);
      if (!cur || m.similarity > cur.similarity) {
        bestByProduct.set(m.product_id, { product_id: m.product_id, similarity: m.similarity });
      }
    }
    const productMatches = Array.from(bestByProduct.values())
      .filter((m) => m.similarity >= 0.55) // فلترة النتائج الضعيفة جداً
      .sort((a, b) => b.similarity - a.similarity);

    return json({ analysis, matches: productMatches });
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
