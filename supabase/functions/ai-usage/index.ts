// يعرض استهلاك اليوم التقريبي لكل مزوّد/موديل ذكاء اصطناعي مجاني — يُستدعى من صفحة
// "رفع قطع جديدة" ليعرف الموظف كم طلباً تبقّى تقريباً قبل أن تنتقل الدفعة التالية
// لمزوّد أضعف. العدّادات تعيش في ذاكرة نسخة الدالة (تُصفَّر عند إعادة تشغيل باردة)
// فهي تقريبية لهذه الجلسة، وليست رقماً رسمياً من جوجل/Groq — نوضّح هذا صراحةً في الواجهة.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getGeminiModelUsageSnapshot, getUsageSnapshot } from "../_shared/lovable-ai.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return json({
    providers: getUsageSnapshot(),
    geminiModels: await getGeminiModelUsageSnapshot(),
  });
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
