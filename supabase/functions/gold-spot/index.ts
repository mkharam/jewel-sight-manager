// سعر الذهب العالمي (دولار/أونصة) لاقتراح سعر اليوم في صفحة «سعر الذهب».
//
// المصدر api.gold-api.com (بلا مفتاح). نمرّره من الخادم لا من المتصفح لتفادي CORS ولنضع
// مهلة ونتحقق من الرقم قبل عرضه. هذا اقتراح للمالك فقط — لا يُكتب أي سعر تلقائياً؛ سعر
// الدولار بالدينار يدخله المالك بنفسه لأن سعر السوق عندكم لا يأتيه أي مصدر عالمي.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch("https://api.gold-api.com/price/XAU", { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return json({ error: "source_unavailable" }, 502);

    const body = await res.json();
    const price = Number(body?.price);
    // سعر أونصة ذهب معقول بالدولار — أي رقم خارج هذا النطاق يعني خللاً في المصدر لا سوقاً.
    if (!Number.isFinite(price) || price < 500 || price > 20000) return json({ error: "invalid_price" }, 502);

    return json({ usd_per_oz: price, updated_at: body?.updatedAt ?? null, source: "gold-api.com" });
  } catch {
    return json({ error: "source_unavailable" }, 502);
  }
});
