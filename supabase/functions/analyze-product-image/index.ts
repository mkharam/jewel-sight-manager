// تحليل صورة مجوهرات باستخدام Gemini API مباشرة (مجاني)
// - يستخدم GEMINI_API_KEY (1500 طلب/يوم مجاناً)
// - إن كان imageId موجوداً، يحسب embedding عبر Lovable Gateway ويحفظه (اختياري)
//
// Body: { imageBase64, mimeType?, categories?, imageId? }

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  analyzeJewelryImage,
  analysisToEmbeddingText,
  embedText,
  friendlyError,
  type JewelryAnalysis,
} from "../_shared/lovable-ai.ts";

function getGeminiKey(): string | null {
  const raw =
    Deno.env.get("GOOGLE_API_KEY") ??
    Deno.env.get("GEMINI_API_KEY") ??
    "";
  const k = raw.trim().replace(/^["']|["']$/g, "");
  return k || null;
}

async function analyzeWithGemini(params: {
  imageBase64: string;
  mimeType: string;
  categoryNames: string[];
}): Promise<JewelryAnalysis> {
  const key = getGeminiKey();
  if (!key) throw Object.assign(new Error("GEMINI_API_KEY not set"), { status: 500 });
  const { imageBase64, mimeType, categoryNames } = params;
  const catList = categoryNames.length
    ? categoryNames.join("، ")
    : "خاتم، سلسلة، أسوارة، حلق، طقم، تعليقة، خلخال، دبلة";

  const systemPrompt =
    `أنت خبير مجوهرات عربي. حلّل الصورة وأعد JSON فقط:\n` +
    `{"name_ar": string, "category_name": string|null, "karat": "18K"|"21K"|"22K"|"24K"|"ألماس"|"فضة"|"أخرى"|null, "metal_color": "yellow"|"white"|"rose"|"mixed"|null, "style": string[], "gemstones": string[], "description_ar": string}\n\n` +
    `قواعد: السطح الأبيض اللامع بدون أحجار مقطّعة = ذهب أبيض 18K/21K (ليس ألماس). ` +
    `"ألماس" فقط عند رؤية أحجار شفافة لها facets. القطع الصفراء الليبية = 21K افتراضياً. ` +
    `category_name يطابق واحدة من: ${catList} أو null.`;

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent";

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [
      {
        role: "user",
        parts: [
          { text: "حلّل هذه القطعة وأعد JSON فقط." },
          { inlineData: { mimeType, data: imageBase64 } },
        ],
      },
    ],
    generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-goog-api-key": key },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("Gemini error", res.status, text);
    const status = res.status;
    throw Object.assign(new Error(text || `Gemini ${res.status}`), { status });
  }

  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  try {
    return JSON.parse(raw) as JewelryAnalysis;
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("Gemini returned invalid JSON");
  }
}

// يحاول Gemini المباشر أولاً (مجاني)، وعند فشله يستخدم Lovable AI Gateway كاحتياطي.
async function analyzeWithFallback(params: {
  imageBase64: string;
  mimeType: string;
  categoryNames: string[];
}): Promise<JewelryAnalysis> {
  if (getGeminiKey()) {
    try {
      return await analyzeWithGemini(params);
    } catch (e) {
      const msg = (e as Error)?.message ?? "";
      const status = (e as any)?.status;
      // 429 = rate limit → دع الواجهة تنتظر بدل التبديل
      if (status === 429) throw e;
      console.warn("Gemini failed, falling back to Lovable Gateway:", status, msg.slice(0, 200));
    }
  }
  return await analyzeJewelryImage(params);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const imageBase64: string | undefined = body?.imageBase64;
    const mimeType: string = body?.mimeType ?? "image/jpeg";
    const categories: { id: string; name: string }[] = body?.categories ?? [];
    const imageId: string | undefined = body?.imageId;
    // Optional: caller can pass a previously computed analysis to skip Gemini
    // and only compute+persist the embedding (used by bulk import on Save).
    const providedAnalysis: JewelryAnalysis | undefined = body?.analysis;

    if (!providedAnalysis && !imageBase64) {
      return json({ error: "imageBase64 or analysis required" }, 400);
    }

    const analysis: JewelryAnalysis = providedAnalysis
      ? providedAnalysis
      : await analyzeWithFallback({
          imageBase64: imageBase64!,
          mimeType,
          categoryNames: categories.map((c) => c.name),
        });

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


    // embedding اختياري — يُستخدم للبحث بالصورة، وليس مطلوباً للاستيراد بالجملة
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
