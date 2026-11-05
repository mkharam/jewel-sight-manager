// البحث بصورة العميل — هجين: بصمة الصورة نفسها + بصمة وصف الذكاء الاصطناعي لها.
//
// لماذا الاثنان معاً: بصمة الصورة تمسك التطابق البصري (نفس القطعة أو شبيهتها شكلاً)،
// وبصمة الوصف تمسك القطع التي تشترك في الخصائص (لون الحجر، نوع القطعة، الشكل) حتى لو
// اختلفت الصورة في الإضاءة أو الزاوية أو الخلفية. المقارنة تتم داخل كل عمود مع نظيره
// من نفس الوسيط (صورة↔صورة، نص↔نص) لأن المقارنة عبر وسيطين مختلفين تُنتج ترتيباً بلا
// معنى — قِسنا ذلك فعلياً، راجع migration 20260910120000.
//
// السرعة (نوفمبر 2026): التحليل بالذكاء الاصطناعي ياخذ 10–25 ثانية، وبصمة الصورة كانت
// تستناه. توا على مرحلتين: mode "fast" يرجّع نتائج بشكل القطعة بس في ثواني، والطلب الكامل
// يحسب البصمة بالتوازي مع التحليل (ولا يستعمل البصمة اللي رجعت من السريع) ويرتّب أدق.
// التحليل نفسه من دالة analyze-product-image (نفس المزوّدات والـprompt) بدون حفظ شي، فهذا
// الملف مستقل ما يحتاجش الملف المشترك الكبير.
//
// Request:  { imageBase64: string, mimeType?: string, categories?: {id,name}[],
//             matchCount?: number, mode?: "fast", imageEmbedding?: number[] }
// Response: { analysis: {...} | null, matches: [{ product_id, similarity, visual, textual, kind, reasons }],
//             imageEmbedding?: number[] (mode "fast" فقط) }
//   kind: "exact" نفس التصميم | "very_close" قريبة جداً | "similar_look" شكل مشابه |
//   "same_attributes" تشترك في الأوصاف (لون الذهب/الأحجار/الطراز) دون تشابه بصري قوي |
//   "might_like" ذوق قريب — اقتراحات إضافية "ممكن تعجب الزبون".
//   reasons: أسباب بالعربية يقرؤها الموظف للزبون ("نفس لون الذهب"، "نفس الأحجار: خضراء").

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

type Analysis = {
  name_ar?: string; category_name?: string | null; item_type?: string | null; karat?: string | null;
  metal_color?: string | null; style?: string[]; gemstones?: string[]; stone_count?: string | null; description_ar?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const imageBase64: string = String(body?.imageBase64 ?? "").replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
    const mimeType: string = body?.mimeType ?? "image/jpeg";
    const categories: { id: string; name: string }[] = body?.categories ?? [];
    const matchCount: number = Math.min(Math.max(Number(body?.matchCount ?? 140), 1), 150);
    const given = Array.isArray(body?.imageEmbedding) && body.imageEmbedding.length === 1536 ? (body.imageEmbedding as number[]) : null;

    if (!imageBase64 && !given) return json({ error: "imageBase64 required" }, 400);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const t0 = Date.now();

    // بصمة الصورة ما تحتاجش التحليل — تبدأ فوراً بالتوازي معه.
    const imageEmbeddingP = given ? Promise.resolve(given) : embed({ inline_data: { mime_type: mimeType, data: imageBase64 } });
    imageEmbeddingP.catch(() => {});

    if (body?.mode === "fast") {
      const imageEmbedding = await imageEmbeddingP;
      const rows = await match(supabase, imageEmbedding, null, null, matchCount);
      console.log("image-search fast", `${Date.now() - t0}ms`, rows.length);
      return json({ analysis: null, matches: rows, imageEmbedding });
    }

    // التحليل من الدالة الموجودة (نفس سلسلة المزوّدات والـprompt) — بدون imageId فما يحفظ شي.
    const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/analyze-product-image`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: req.headers.get("Authorization") ?? `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
        apikey: req.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      },
      body: JSON.stringify({ imageBase64, mimeType, categories }),
    });
    const analyzed = await res.json().catch(() => ({}));
    if (!res.ok || analyzed?.error) {
      return json({ error: analyzed?.error ?? `تعذّر تحليل الصورة (${res.status})` }, analyzed?.code === "AI_BUSY" ? 429 : 502);
    }
    const { provider: _p, usage: _u, category_id: _c, ...analysis } = analyzed as Analysis & Record<string, unknown>;
    const tAnalysis = Date.now() - t0;

    const [imageEmbedding, textEmbedding] = await Promise.all([
      imageEmbeddingP,
      embed({ text: toEmbeddingText(analysis) }).catch(() => null),
    ]);

    // التصنيف كله في قاعدة البيانات (match_products_tiered): كل قطعة تُقاس نسبةً لبقية المخزون
    // لنفس الصورة لا بعتبة ثابتة، وتُقارن أوصافها بما قرأه الذكاء الاصطناعي من صورة الزبون.
    const rows = await match(supabase, imageEmbedding, textEmbedding, analysis, matchCount);
    console.log("image-search full", `${Date.now() - t0}ms`, `analysis ${tAnalysis}ms`, rows.length);
    return json({ analysis, matches: rows });
  } catch (e) {
    const status = (e as { status?: number })?.status ?? 500;
    console.error("image-search error", status, String(e).slice(0, 300));
    return json({ error: status === 429 ? "خدمة البحث مشغولة — أعد المحاولة بعد قليل" : `فشل البحث: ${(e as Error)?.message ?? e}` }, status);
  }
});

async function match(
  supabase: ReturnType<typeof createClient>, image: number[], text: number[] | null, labels: Analysis | null, max: number,
) {
  const { data, error } = await supabase.rpc("match_products_tiered", {
    q_image: image as unknown as string,
    q_text: (text ?? null) as unknown as string | null,
    q_labels: labels,
    max_results: max,
  });
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  return ((data ?? []) as any[]).map((r) => ({
    product_id: r.product_id,
    similarity: r.score,
    visual: r.visual,
    textual: r.textual,
    kind: r.kind as "exact" | "very_close" | "similar_look" | "same_attributes" | "might_like",
    reasons: (r.reasons ?? []) as string[],
  }));
}

// نفس بصمة الفهرسة (gemini-embedding-2، 1536 بُعد) اللي في _shared/lovable-ai.ts — لازم تتطابق
// مع بصمات القطع المحفوظة باش المقارنة يكون لها معنى.
async function embed(part: { text: string } | { inline_data: { mime_type: string; data: string } }): Promise<number[]> {
  const key = (Deno.env.get("GOOGLE_API_KEY") ?? Deno.env.get("GEMINI_API_KEY") ?? "").trim().replace(/^["']|["']$/g, "");
  if (!key) throw Object.assign(new Error("GOOGLE_API_KEY غير مضبوط"), { status: 500 });
  let last = "";
  let status = 500;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-goog-api-key": key },
      body: JSON.stringify({ content: { parts: [part] }, outputDimensionality: 1536 }),
    });
    if (res.ok) {
      const vec = (await res.json())?.embedding?.values;
      if (Array.isArray(vec) && vec.length === 1536) return vec;
      throw Object.assign(new Error("بصمة غير صالحة من Google"), { status: 500 });
    }
    status = res.status;
    last = await res.text();
    console.error("Google embed error", status, last.slice(0, 200));
    if (!(status === 429 || status >= 500) || attempt === 2) break;
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
  }
  throw Object.assign(new Error(last || `Google embed ${status}`), { status });
}

// نفس نص بصمة الوصف المستعمل عند فهرسة القطع (analysisToEmbeddingText).
function toEmbeddingText(a: Analysis): string {
  const parts: string[] = [];
  if (a.name_ar) parts.push(a.name_ar);
  if (a.category_name) parts.push(a.category_name);
  if (a.item_type) parts.push(a.item_type);
  if (a.karat) parts.push(a.karat);
  if (a.metal_color) parts.push(`لون: ${a.metal_color}`);
  if (a.style?.length) parts.push(a.style.join(" "));
  if (a.gemstones?.length) parts.push("أحجار: " + a.gemstones.join(" "));
  if (a.stone_count) parts.push(a.stone_count);
  if (a.description_ar) parts.push(a.description_ar);
  return (parts.join(" · ").trim().slice(0, 8000)) || "قطعة مجوهرات";
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
