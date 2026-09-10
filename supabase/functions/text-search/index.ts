// بحث دلالي (معنوي) عبر نص حر — يقارن بصمة عبارة البحث ببصمة وصف كل قطعة
// (text_embedding)، أي نص↔نص من نفس الوسيط. هذا يمسك تطابقات معنوية لا يمسكها بحث
// الكلمات/المرادفات — مثلاً "أحجار موفيا" تُطابق "بنفسجي/جمشت" لأن المعنى قريب في فضاء
// البصمات، لا مطابقة حرفية.
//
// ملاحظة مهمة (سبب وجود عمود مستقل): كان هذا البحث يقارن بصمة النص بعمود ai_embedding
// الذي صار يحمل بصمة الصورة نفسها — أي مقارنة عبر وسيطين مختلفين. قِسنا نتيجتها فعلياً:
// كل الدرجات تتجمّع حول 0.32–0.34 بفارق ~0.005 بين الأول والسادس، والترتيب بلا معنى
// ("أحجار زرقاء" أعطت القطعة الزرقاء في المركز السادس). راجع migration 20260910120000.
//
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
    // بحث نصي بحت: نمرّر بصمة النص فقط، والدالة تُحيّد الجانب البصري تلقائياً.
    const { data, error } = await admin.rpc("match_product_images_hybrid", {
      query_image_embedding: null,
      query_text_embedding: embedding as unknown as string,
      match_count: matchCount,
      image_weight: 0,
    });
    if (error) throw error;

    // قد تظهر عدة صور لنفس القطعة — نأخذ أفضل تشابه لكل قطعة فقط.
    const byProduct = new Map<string, number>();
    for (const row of (data ?? []) as any[]) {
      const sim = row.text_similarity ?? row.score;
      if (sim == null) continue;
      const prev = byProduct.get(row.product_id) ?? 0;
      if (sim > prev) byProduct.set(row.product_id, sim);
    }
    const ranked = Array.from(byProduct.entries())
      .map(([product_id, similarity]) => ({ product_id, similarity }))
      .sort((a, b) => b.similarity - a.similarity);

    // عتبة نسبية لا مطلقة: النطاق المطلق يتغيّر كثيراً حسب العبارة — قِسنا فعلياً 0.59
    // لـ"خاتم ألماس" مقابل 0.39 لـ"لؤلؤ"، فأي رقم ثابت إمّا يحذف كل نتائج عبارة أو
    // يُبقي ضجيج أخرى. نأخذ ما يقارب أفضل نتيجة فقط، مع حدّ أدنى مطلق يمنع إرجاع
    // نتائج عشوائية حين لا يوجد تطابق معنوي أصلاً.
    const top = ranked[0]?.similarity ?? 0;
    const results = ranked
      .filter((r) => r.similarity >= Math.max(0.32, top - 0.04))
      .slice(0, 12);

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
