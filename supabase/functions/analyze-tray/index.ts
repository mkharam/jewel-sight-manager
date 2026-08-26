// تحليل صورة تحتوي عدة قطع (صينية عرض) → مصفوفة قطع.
// Body: { imageBase64, mimeType?, categories? }
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { analyzeTrayWithFallback, friendlyError } from "../_shared/lovable-ai.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const imageBase64: string | undefined = body?.imageBase64;
    const mimeType: string = body?.mimeType ?? "image/jpeg";
    const categories: { id: string; name: string }[] = body?.categories ?? [];
    if (!imageBase64) return json({ error: "imageBase64 required" }, 400);

    const { pieces, provider } = await analyzeTrayWithFallback({
      imageBase64,
      mimeType,
      categoryNames: categories.map((c) => c.name),
    });

    const withCats = pieces.map((p) => {
      const cat = p.category_name
        ? categories.find(
            (c) =>
              c.name === p.category_name ||
              c.name.includes(p.category_name!) ||
              p.category_name!.includes(c.name),
          )
        : undefined;
      return { ...p, category_id: cat?.id ?? null };
    });

    return json({ pieces: withCats, provider });
  } catch (e) {
    const { status, message } = friendlyError(e);
    if (status === 429) return json({ error: message, code: "AI_BUSY", retryable: true }, 200);
    return json({ error: message }, status);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
