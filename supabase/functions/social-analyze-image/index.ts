import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { imageUrl, imageBase64, contentType: ctIn, categories } = await req.json();
    if (!imageUrl && !imageBase64) {
      return new Response(JSON.stringify({ error: "imageUrl أو imageBase64 مطلوب" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");

    // Auth: user must be logged in
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) {
      return new Response(JSON.stringify({ error: "غير مصرح" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let buf: Uint8Array;
    let contentType: string;
    if (imageBase64) {
      contentType = ctIn || "image/jpeg";
      const bin = atob(imageBase64);
      buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    } else {
      const imgRes = await fetch(imageUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; LamaaBot/1.0)" },
      });
      if (!imgRes.ok) {
        return new Response(JSON.stringify({ error: `تعذّر جلب الصورة (${imgRes.status})` }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      contentType = imgRes.headers.get("content-type") ?? "image/jpeg";
      buf = new Uint8Array(await imgRes.arrayBuffer());
    }
    if (buf.byteLength < 2000) {
      return new Response(JSON.stringify({
        skipped: true,
        reason: "image_too_small",
        error: "الصورة صغيرة جداً وتم تخطيها",
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // base64 for AI
    let bin = "";
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    const b64 = btoa(bin);

    // Upload to storage
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const path = `social-import/${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await admin.storage.from("product-images").upload(path, buf, {
      contentType,
      upsert: false,
    });
    if (upErr) {
      console.error("upload err", upErr);
      return new Response(JSON.stringify({ error: "فشل رفع الصورة" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // AI analyze
    const catList = (categories ?? []).map((c: any) => c.name).join("، ");
    const systemPrompt = `أنت خبير مجوهرات. حلّل صورة قطعة واستخرج بياناتها بصيغة JSON.
الفئات المتاحة: ${catList || "خاتم، سلسلة، أسوارة، حلق، طقم، تعليقة، خلخال، دبلة"}.
أعد:
- name: اسم تجاري قصير وجذاب بالعربية (مثل: "خاتم ذهب أصفر بنقش يدوي")
- category: اسم الفئة الأقرب من القائمة
- karat: 18K أو 21K أو 22K أو 24K أو ألماس أو فضة
- description: وصف موجز سطر واحد
- keywords: 3-5 كلمات مفتاحية`;

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
              { inlineData: { mimeType: contentType, data: b64 } },
            ],
          }],
          tools: [{
            functionDeclarations: [{
              name: "return_product",
              description: "Return product attributes",
              parameters: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  category: { type: "string" },
                  karat: { type: "string" },
                  description: { type: "string" },
                  keywords: { type: "array", items: { type: "string" } },
                },
                required: ["name", "description"],
              },
            }],
          }],
          toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["return_product"] } },
        }),
      }
    );

    let parsed: any = {};
    if (aiRes.ok) {
      const data = await aiRes.json();
      const args = data?.candidates?.[0]?.content?.parts?.find((p: any) => p.functionCall)?.functionCall?.args;
      if (args) parsed = args;
    } else {
      const t = await aiRes.text();
      console.error("AI error", aiRes.status, t);
      if (aiRes.status === 429 || aiRes.status === 403) {
        return new Response(JSON.stringify({
          error: aiRes.status === 429 ? "تم تجاوز الحد اليومي لـ Gemini، حاول غداً" : "مفتاح Gemini غير صالح أو محظور",
          aiBlocked: true,
          code: aiRes.status === 429 ? "AI_RATE_LIMITED" : "AI_KEY_INVALID",
          storagePath: path,
        }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({
      storagePath: path,
      name: parsed.name ?? "",
      category: parsed.category ?? "",
      karat: parsed.karat ?? "",
      description: parsed.description ?? "",
      keywords: parsed.keywords ?? [],
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("social-analyze-image error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "خطأ غير معروف" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
