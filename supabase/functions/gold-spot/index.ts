// أسعار السوق العالمي لاقتراح سعر اليوم في صفحة «سعر الذهب»:
//  - الذهب: دولار/أونصة من api.gold-api.com (بلا مفتاح).
//  - الدولار: السعر الرسمي للدينار الليبي من open.er-api.com، ومنه احتياطي fawazahmed0.
//
// نمرّرها من الخادم لا من المتصفح لتفادي CORS ولنضع مهلة ونتحقق من الأرقام قبل عرضها.
// تنبيه مهم: السعر الرسمي للدولار أقل بكثير من سعر السوق الذي يُسعَّر به الذهب فعلاً، ولا
// يوجد مصدر مجاني موثوق لسعر السوق الموازي — لذلك يضبط المالك «علاوة السوق» فوق الرسمي.
// هذا اقتراح فقط: لا يُكتب أي سعر تلقائياً.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function getJson(url: string): Promise<any | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** الدينار الليبي بالدولار الرسمي. نطاق معقول فقط — خارجه خلل في المصدر لا سوق. */
async function officialUsdLyd(): Promise<{ rate: number; updated: string | null } | null> {
  const ok = (n: number) => Number.isFinite(n) && n > 1 && n < 100;

  const a = await getJson("https://open.er-api.com/v6/latest/USD");
  const r1 = Number(a?.rates?.LYD);
  if (a?.result === "success" && ok(r1)) return { rate: r1, updated: a?.time_last_update_utc ?? null };

  const b = await getJson("https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json");
  const r2 = Number(b?.usd?.lyd);
  if (ok(r2)) return { rate: r2, updated: b?.date ?? null };

  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const [gold, fx] = await Promise.all([getJson("https://api.gold-api.com/price/XAU"), officialUsdLyd()]);

  const price = Number(gold?.price);
  // سعر أونصة ذهب معقول بالدولار — أي رقم خارج هذا النطاق يعني خللاً في المصدر لا سوقاً.
  if (!Number.isFinite(price) || price < 500 || price > 20000) return json({ error: "source_unavailable" }, 502);

  return json({
    usd_per_oz: price,
    updated_at: gold?.updatedAt ?? null,
    usd_lyd_official: fx?.rate ?? null, // قد يكون null إن تعذّر المصدر — الواجهة تتراجع للسعر اليدوي
    official_updated_at: fx?.updated ?? null,
    source: "gold-api.com + open.er-api.com",
  });
});
