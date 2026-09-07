// قراءة وسم القطعة الورقي (باركود أو بيانات فرع/عيار/نوع/وزن مطبوعة) من صورة واحدة —
// يُستخدم في صفحة "الإضافة المباشرة" بدل الكتابة اليدوية للوزن/العيار.
// Body: { imageBase64, mimeType? }
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { analyzeTagWithFallback, friendlyError } from "../_shared/lovable-ai.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const imageBase64: string | undefined = body?.imageBase64;
    const mimeType: string = body?.mimeType ?? "image/jpeg";
    if (!imageBase64) return json({ error: "imageBase64 required" }, 400);

    const { tag, provider } = await analyzeTagWithFallback({ imageBase64, mimeType });
    return json({ tag, provider });
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
