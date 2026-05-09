import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { imageBase64, mimeType, categories } = await req.json();
    if (!imageBase64) {
      return new Response(JSON.stringify({ error: "imageBase64 required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");

    const catList = (categories ?? []).map((c: any) => c.name).join("، ");

    const systemPrompt = `أنت خبير مجوهرات. حلّل الصورة واستخرج خصائص القطعة بصيغة JSON فقط.
الفئات المتاحة: ${catList || "خاتم، سلسلة، أسوارة، حلق، طقم، تعليقة، خلخال، دبلة"}.
أعد JSON بالحقول التالية فقط:
{
  "category": "اسم الفئة الأقرب من القائمة أو null",
  "karat": "18K|21K|22K|24K|ألماس|فضة|null",
  "keywords": ["كلمات مفتاحية عربية تصف الشكل والنقش والتصميم، 3 إلى 6 كلمات"],
  "description": "وصف موجز بالعربية بسطر واحد"
}`;

    const aiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{
            role: "user",
            parts: [
              { text: "حلّل هذه القطعة:" },
              { inlineData: { mimeType: mimeType ?? "image/jpeg", data: imageBase64 } },
            ],
          }],
          tools: [{
            functionDeclarations: [{
              name: "return_attrs",
              description: "Return jewelry attributes",
              parameters: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  karat: { type: "string" },
                  keywords: { type: "array", items: { type: "string" } },
                  description: { type: "string" },
                },
                required: ["keywords", "description"],
              },
            }],
          }],
          toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["return_attrs"] } },
        }),
      }
    );

    if (!aiRes.ok) {
      const t = await aiRes.text();
      console.error("AI error", aiRes.status, t);
      const status = aiRes.status === 429 || aiRes.status === 403 ? aiRes.status : 500;
      const msg = aiRes.status === 429 ? "تم تجاوز الحد اليومي لـ Gemini، حاول غداً"
        : aiRes.status === 403 ? "مفتاح Gemini غير صالح"
        : "تعذّر تحليل الصورة";
      return new Response(JSON.stringify({ error: msg }), {
        status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await aiRes.json();
    const args = data?.candidates?.[0]?.content?.parts?.find((p: any) => p.functionCall)?.functionCall?.args;
    const parsed = args ?? {};

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("image-search error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
