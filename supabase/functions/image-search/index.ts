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

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

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

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: "حلّل هذه القطعة:" },
              { type: "image_url", image_url: { url: `data:${mimeType ?? "image/jpeg"};base64,${imageBase64}` } },
            ],
          },
        ],
        tools: [{
          type: "function",
          function: {
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
          },
        }],
        tool_choice: { type: "function", function: { name: "return_attrs" } },
      }),
    });

    if (!aiRes.ok) {
      const t = await aiRes.text();
      console.error("AI error", aiRes.status, t);
      const status = aiRes.status === 429 || aiRes.status === 402 ? aiRes.status : 500;
      const msg = aiRes.status === 429 ? "تم تجاوز الحد، حاول لاحقاً"
        : aiRes.status === 402 ? "نفدت الرصيد، يرجى الشحن"
        : "تعذّر تحليل الصورة";
      return new Response(JSON.stringify({ error: msg }), {
        status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await aiRes.json();
    const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    const parsed = args ? JSON.parse(args) : {};

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
