// Analyze a jewelry photo and (optionally) persist AI labels + embedding
// onto an existing product_images row.
//
// Request:
//   { imageBase64: string, mimeType?: string, categories?: {id,name}[],
//     imageId?: string  // if provided, persists ai_labels + ai_embedding
//   }
//
// Response:
//   { name_ar, category_name, category_id?, karat, style[], gemstones[],
//     description_ar }
//
// Uses Lovable AI Gateway (no user key needed).

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  analysisToEmbeddingText,
  analyzeJewelryImage,
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
    const imageId: string | undefined = body?.imageId;

    if (!imageBase64) {
      return json({ error: "imageBase64 required" }, 400);
    }

    const analysis = await analyzeJewelryImage({
      imageBase64,
      mimeType,
      categoryNames: categories.map((c) => c.name),
    });

    // Match category by name → id
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

    // Persist embedding + labels if imageId provided
    if (imageId) {
      try {
        const embedding = await embedText(analysisToEmbeddingText(analysis));
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        const { error } = await supabase
          .from("product_images")
          .update({
            ai_labels: { ...analysis, category_id: categoryId },
            ai_embedding: embedding as unknown as string,
          })
          .eq("id", imageId);
        if (error) console.error("Failed to persist embedding", error);
      } catch (e) {
        console.error("Embedding step failed (non-fatal)", e);
      }
    }

    return json({ ...analysis, category_id: categoryId });
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
