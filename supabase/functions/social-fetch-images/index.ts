import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const FIRECRAWL_URL = "https://api.firecrawl.dev/v2/scrape";

const UA_FACEBOOK = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
const UA_BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function extractImages(html: string): string[] {
  const found = new Set<string>();

  const ogRe1 = /<meta[^>]+property=["'](?:og:image(?::url)?|twitter:image)["'][^>]+content=["']([^"']+)["']/gi;
  const ogRe2 = /<meta[^>]+content=["']([^"']+)["'][^>]+property=["'](?:og:image(?::url)?|twitter:image)["']/gi;
  for (const m of html.matchAll(ogRe1)) found.add(m[1]);
  for (const m of html.matchAll(ogRe2)) found.add(m[1]);

  for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) found.add(m[1]);

  for (const m of html.matchAll(/<img[^>]+srcset=["']([^"']+)["']/gi)) {
    const parts = m[1].split(",").map((s) => s.trim().split(/\s+/)[0]);
    if (parts.length) found.add(parts[parts.length - 1]);
  }

  // FB/IG embed image URLs in JSON inside <script>
  for (const m of html.matchAll(/"(https?:\/\/[^"\s]+\.(?:jpg|jpeg|png|webp)[^"\s]*)"/gi)) found.add(m[1]);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of found) {
    let u = raw.trim().replace(/&amp;/g, "&");
    if (!u) continue;
    if (u.startsWith("//")) u = "https:" + u;
    if (!/^https?:\/\//i.test(u)) continue;
    if (/sprite|emoji|favicon|profile_pic|rsrc\.php|static\.cdninstagram\.com\/rsrc/i.test(u)) continue;
    const key = u.split("?")[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
    if (out.length >= 120) break;
  }
  return out;
}

function extractPrimaryImages(html: string): string[] {
  const found = new Set<string>();
  const ogRe1 = /<meta[^>]+property=["'](?:og:image(?::url)?|twitter:image)["'][^>]+content=["']([^"']+)["']/gi;
  const ogRe2 = /<meta[^>]+content=["']([^"']+)["'][^>]+property=["'](?:og:image(?::url)?|twitter:image)["']/gi;
  for (const m of html.matchAll(ogRe1)) found.add(m[1]);
  for (const m of html.matchAll(ogRe2)) found.add(m[1]);
  return Array.from(found).map((u) => u.trim().replace(/&amp;/g, "&")).filter((u) => /^https?:\/\//i.test(u)).slice(0, 1);
}

function isInstagramPermalink(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    return /^\/(p|reel|tv)\/[^/]+/i.test(path);
  } catch {
    return false;
  }
}

function extractTitle(html: string): string | null {
  const m = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<title>([^<]+)<\/title>/i);
  return m?.[1] ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { url, excludeUrls } = await req.json();
    const excludeKeys = new Set<string>(
      Array.isArray(excludeUrls)
        ? excludeUrls
            .filter((u: unknown): u is string => typeof u === "string")
            .map((u: string) => u.replace(/&amp;/g, "&").split("?")[0])
        : []
    );
    if (!url || typeof url !== "string") {
      return new Response(JSON.stringify({ error: "url مطلوب" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isSocial = /facebook\.com|fb\.com|instagram\.com/i.test(url);
    const isInstagram = /instagram\.com/i.test(url);
    const isSingleInstagramPost = isInstagram && isInstagramPermalink(url);
    let images: string[] = [];
    let title: string | null = null;
    let usedMethod = "";

    // Strategy 1: direct fetch with FB crawler UA (works for FB/IG public posts)
    if (isSocial) {
      try {
        const r = await fetch(url, {
          headers: {
            "User-Agent": UA_FACEBOOK,
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
          },
          redirect: "follow",
        });
        if (r.ok) {
          const html = await r.text();
          images = isSingleInstagramPost ? extractPrimaryImages(html) : extractImages(html);
          title = extractTitle(html);
          usedMethod = "direct-fb-ua";
        } else {
          await r.text().catch(() => {});
        }
      } catch (e) {
        console.error("direct fb ua failed", e);
      }

      // Try with browser UA as fallback
      if (!images.length) {
        try {
          const r = await fetch(url, {
            headers: { "User-Agent": UA_BROWSER, "Accept-Language": "en-US,en;q=0.9" },
            redirect: "follow",
          });
          if (r.ok) {
            const html = await r.text();
            images = isSingleInstagramPost ? extractPrimaryImages(html) : extractImages(html);
            title = title ?? extractTitle(html);
            usedMethod = "direct-browser-ua";
          } else {
            await r.text().catch(() => {});
          }
        } catch (e) {
          console.error("direct browser ua failed", e);
        }
      }
    }

    // Strategy 2: Firecrawl with scroll actions to load more posts (esp. Instagram infinite scroll)
    const shouldUseFirecrawl = !images.length || (isInstagram && !isSingleInstagramPost && images.length < 30);
    if (shouldUseFirecrawl) {
      const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
      if (FIRECRAWL_API_KEY) {
        try {
          // Build scroll actions to trigger infinite-scroll loading
          const actions: any[] = [];
          if (isSocial && !isSingleInstagramPost) {
            for (let i = 0; i < 8; i++) {
              actions.push({ type: "scroll", direction: "down" });
              actions.push({ type: "wait", milliseconds: 1500 });
            }
          }

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
              waitFor: 3000,
              ...(actions.length ? { actions } : {}),
            }),
          });
          const fcData = await fcRes.json();
          if (fcRes.ok) {
            const html = fcData?.data?.rawHtml ?? fcData?.rawHtml ?? "";
            const fcImages = isSingleInstagramPost ? extractPrimaryImages(html) : extractImages(html);
            // Merge with previously found
            const merged = new Set(images);
            for (const i of fcImages) merged.add(i);
            const links: string[] = fcData?.data?.links ?? fcData?.links ?? [];
            if (!isSingleInstagramPost) {
              for (const l of links) {
                if (typeof l === "string" && /\.(jpe?g|png|webp)(\?|$)/i.test(l)) merged.add(l);
              }
            }
            images = Array.from(merged).slice(0, isSingleInstagramPost ? 1 : 400);
            title = title ?? fcData?.data?.metadata?.title ?? fcData?.metadata?.title ?? null;
            usedMethod = usedMethod ? `${usedMethod}+firecrawl-scroll` : "firecrawl-scroll";
          } else {
            console.error("firecrawl error", fcRes.status, fcData);
          }
        } catch (e) {
          console.error("firecrawl threw", e);
        }
      }
    }

    if (!images.length) {
      return new Response(JSON.stringify({
        images: [],
        sourceTitle: title,
        sourceUrl: url,
        method: usedMethod || "none",
        warning: isSocial
          ? "تعذّر استخراج صور مناسبة من الرابط. روابط البروفايل غالباً تعرض صورة الحساب فقط؛ جرّب رابط منشور أو صورة مفردة عامة."
          : "لم نجد صوراً مناسبة في هذه الصفحة",
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      images,
      sourceTitle: title,
      sourceUrl: url,
      method: usedMethod,
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
