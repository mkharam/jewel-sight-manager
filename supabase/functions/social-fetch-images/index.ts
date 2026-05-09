import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const FIRECRAWL_URL = "https://api.firecrawl.dev/v2/scrape";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string") {
      return new Response(JSON.stringify({ error: "url مطلوب" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    if (!FIRECRAWL_API_KEY) throw new Error("FIRECRAWL_API_KEY غير مهيأ");

    const fcRes = await fetch(FIRECRAWL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["rawHtml", "links"],
        onlyMainContent: false,
        waitFor: 2500,
      }),
    });

    const fcData = await fcRes.json();
    if (!fcRes.ok) {
      console.error("firecrawl error", fcRes.status, fcData);
      const msg = fcRes.status === 402
        ? "رصيد Firecrawl غير كافٍ"
        : `تعذّر سحب الصفحة (${fcRes.status})`;
      return new Response(JSON.stringify({ error: msg }), {
        status: fcRes.status === 402 ? 402 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const html: string = fcData?.data?.rawHtml ?? fcData?.rawHtml ?? "";
    const metadata = fcData?.data?.metadata ?? fcData?.metadata ?? {};
    const links: string[] = fcData?.data?.links ?? fcData?.links ?? [];

    const found = new Set<string>();

    // og:image / twitter:image
    const ogMatches = [...html.matchAll(/<meta[^>]+property=["'](?:og:image|og:image:url|twitter:image)["'][^>]+content=["']([^"']+)["']/gi)];
    for (const m of ogMatches) found.add(m[1]);
    const ogMatches2 = [...html.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["'](?:og:image|og:image:url|twitter:image)["']/gi)];
    for (const m of ogMatches2) found.add(m[1]);

    // <img src=...>
    const imgMatches = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)];
    for (const m of imgMatches) found.add(m[1]);

    // <img srcset=...> take last (highest res)
    const srcsetMatches = [...html.matchAll(/<img[^>]+srcset=["']([^"']+)["']/gi)];
    for (const m of srcsetMatches) {
      const parts = m[1].split(",").map(s => s.trim().split(/\s+/)[0]);
      if (parts.length) found.add(parts[parts.length - 1]);
    }

    // links that look like images
    for (const l of links) {
      if (typeof l === "string" && /\.(jpe?g|png|webp)(\?|$)/i.test(l)) found.add(l);
    }

    // Filter, normalize, dedupe
    const results: string[] = [];
    const seen = new Set<string>();
    for (const raw of found) {
      let u = raw.trim();
      if (!u) continue;
      if (u.startsWith("//")) u = "https:" + u;
      if (!/^https?:\/\//i.test(u)) continue;
      // skip tiny icons / emoji / sprites
      if (/sprite|emoji|favicon|profile_pic|rsrc\.php|static\.cdninstagram\.com\/rsrc/i.test(u)) continue;
      // unique by stripped query (some CDNs vary tokens)
      const key = u.split("?")[0];
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(u);
      if (results.length >= 40) break;
    }

    return new Response(JSON.stringify({
      images: results,
      sourceTitle: metadata?.title ?? metadata?.ogTitle ?? null,
      sourceUrl: url,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("social-fetch-images error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "خطأ غير معروف" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
