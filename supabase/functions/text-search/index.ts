// بحث دلالي (معنوي) عبر نص حر — يحوّل عبارة البحث إلى بصمة (embedding) بنفس الطريقة
// التي تُفهرس بها صور القطع (analysisToEmbeddingText + embedText)، ثم يطابقها بأقرب
// الصور بصمةً عبر match_product_images الموجودة أصلاً (تُستخدم للبحث بالصورة). هذا
// يمسك تطابقات معنوية لا يمسكها بحث الكلمات المفتاحية/المرادفات — مثلاً "أحجار موفيا"
// حتى لو لم تكن الكلمة نفسها في قائمة المرادفات، لأن المعنى قريب من "بنفسجي/جمشت"
// في فضاء البصمات، لا مطابقة نصية حرفية.
// Body: { query: string, matchCount?: number }
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { embedText } from "../_shared/lovable-ai.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const query: string | undefined = body?.query;
    const matchCount: number = body?.matchCount ?? 40;
    if (!query || typeof query !== "string" || query.trim().length < 2) {
      return json({ results: [] });
    }

    const embedding = await embedText(query.trim());

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data, error } = await admin.rpc("match_product_images", {
      query_embedding: embedding as unknown as string,
      match_count: matchCount,
    });
    if (error) throw error;

    // قد تظهر عدة صور لنفس القطعة — نأخذ أفضل تشابه لكل قطعة فقط.
    const byProduct = new Map<string, number>();
    for (const row of (data ?? []) as any[]) {
      const prev = byProduct.get(row.product_id) ?? 0;
      if (row.similarity > prev) byProduct.set(row.product_id, row.similarity);
    }
    const results = Array.from(byProduct.entries())
      .map(([product_id, similarity]) => ({ product_id, similarity }))
      .filter((r) => r.similarity >= 0.5) // عتبة دنيا — نتجنب نتائج بعيدة المعنى تماماً
      .sort((a, b) => b.similarity - a.similarity);

    return json({ results });
  } catch (e) {
    // بحث معنوي احتياطي فقط — أي فشل هنا لا يجب أن يكسر البحث النصي العادي في العميل.
    console.error("text-search error", e);
    return json({ results: [], error: e instanceof Error ? e.message : "unexpected error" }, 200);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
