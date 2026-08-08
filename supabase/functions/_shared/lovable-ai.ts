// Shared helpers to call Lovable AI Gateway from edge functions.
// Uses raw fetch (no AI SDK) to keep the function light.
// Gateway is OpenAI-compatible: baseURL + Lovable-API-Key header.

const GATEWAY = "https://ai.gateway.lovable.dev/v1";

export function getLovableKey(): string {
  const k = Deno.env.get("LOVABLE_API_KEY");
  if (!k) throw new Error("LOVABLE_API_KEY not configured");
  return k;
}

export type JewelryAnalysis = {
  name_ar: string;
  category_name: string | null;
  karat: "18K" | "21K" | "22K" | "24K" | "ألماس" | "فضة" | "أخرى" | null;
  metal_color: "yellow" | "white" | "rose" | "mixed" | null;
  style: string[];
  gemstones: string[];
  description_ar: string;
};

const JEWELRY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name_ar: { type: "string", description: "اسم مختصر بالعربية للقطعة، 2-6 كلمات" },
    category_name: { type: ["string", "null"], description: "اسم الفئة الأقرب من القائمة، أو null" },
    karat: {
      type: ["string", "null"],
      enum: ["18K", "21K", "22K", "24K", "ألماس", "فضة", "أخرى", null],
    },
    metal_color: {
      type: ["string", "null"],
      enum: ["yellow", "white", "rose", "mixed", null],
      description: "لون المعدن الظاهر في الصورة",
    },
    style: {
      type: "array",
      items: { type: "string" },
      description: "1-3 كلمات وصف للتصميم بالعربية",
    },
    gemstones: {
      type: "array",
      items: { type: "string" },
      description: "أنواع الأحجار الظاهرة أو مصفوفة فارغة",
    },
    description_ar: { type: "string", description: "وصف بالعربية بجملة أو جملتين" },
  },
  required: ["name_ar", "category_name", "karat", "metal_color", "style", "gemstones", "description_ar"],
};

/**
 * Vision call: analyze a jewelry photo and return structured fields.
 */
export async function analyzeJewelryImage(params: {
  imageBase64: string;
  mimeType: string;
  categoryNames: string[];
}): Promise<JewelryAnalysis> {
  const { imageBase64, mimeType, categoryNames } = params;

  const catList = categoryNames.length
    ? categoryNames.join("، ")
    : "خاتم، سلسلة، أسوارة، حلق، طقم، تعليقة، خلخال، دبلة";

  const systemPrompt =
    `أنت خبير مجوهرات عربي متخصص في تمييز أنواع المعادن والأحجار الكريمة.\n` +
    `\n` +
    `قواعد التمييز الحاسمة (طبّقها بصرامة):\n` +
    `1) لون المعدن (metal_color):\n` +
    `   • yellow = ذهب أصفر لامع/دافئ.\n` +
    `   • white  = ذهب أبيض أو بلاتين أو فضة (سطح فضي/رمادي فاتح).\n` +
    `   • rose   = ذهب وردي/نحاسي.\n` +
    `   • mixed  = القطعة تجمع لونين أو أكثر.\n` +
    `\n` +
    `2) قواعد اختيار karat — مهمة جداً:\n` +
    `   • القطع الصفراء الشائعة في ليبيا ⇐ اختر 21K افتراضياً ما لم يظهر ختم آخر.\n` +
    `   • السطح الأبيض/الفضي اللامع بدون أحجار شفافة مقطّعة (facets) = ذهب أبيض ⇐ اختر 18K أو 21K حسب اللمعان (ليس "ألماس" وليس "فضة" تلقائياً).\n` +
    `   • لا تختر "ألماس" إلا إذا رأيت بوضوح أحجاراً شفافة مقطّعة (لها أوجه/facets تعكس الضوء بألوان قزحية) مثبّتة في القطعة. مجرد اللمعان أو اللون الأبيض لا يعني ألماس.\n` +
    `   • "فضة" فقط إذا كان التصميم بسيطاً/عصرياً بنمط فضي واضح أو يظهر ختم فضة.\n` +
    `\n` +
    `3) gemstones: اذكر الأحجار الظاهرة فعلياً (ألماس، زركون، ياقوت، زمرد، لؤلؤ...). إن لم تكن متأكداً اتركها فارغة.\n` +
    `\n` +
    `4) category_name: اختر فقط من هذه القائمة (طابق الاسم حرفياً): ${catList}. إن لم تكن الفئة واضحة اجعلها null.\n` +
    `\n` +
    `5) description_ar: جملة قصيرة تصف الشكل واللون والحجم النسبي.\n` +
    `\n` +
    `أعد فقط JSON مطابق للـ schema، بدون أي نص إضافي.`;

  const body = {
    model: "google/gemini-3-flash-preview",
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: "حلّل هذه القطعة بدقة عالية:" },
          {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${imageBase64}` },
          },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "jewelry_analysis",
        strict: true,
        schema: JEWELRY_SCHEMA,
      },
    },
  };

  const res = await fetch(`${GATEWAY}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": getLovableKey(),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("Gateway vision error", res.status, text);
    const err = new Error(text || `Gateway ${res.status}`);
    (err as any).status = res.status;
    throw err;
  }

  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(raw) as JewelryAnalysis;
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("AI returned invalid JSON");
  }
}

/**
 * Groq Vision call — احتياطي مجاني (30 RPM, 14400/day).
 * يستخدم Llama 3.2 Vision. جودة تحليل عربية جيدة.
 */
export async function analyzeJewelryImageGroq(params: {
  imageBase64: string;
  mimeType: string;
  categoryNames: string[];
}): Promise<JewelryAnalysis> {
  const key = Deno.env.get("GROQ_API_KEY")?.trim();
  if (!key) throw Object.assign(new Error("GROQ_API_KEY not set"), { status: 500 });

  const { imageBase64, mimeType, categoryNames } = params;
  const catList = categoryNames.length
    ? categoryNames.join("، ")
    : "خاتم، سلسلة، أسوارة، حلق، طقم، تعليقة، خلخال، دبلة";

  const systemPrompt =
    `أنت خبير مجوهرات عربي. أعد JSON فقط بهذا الشكل بالضبط بدون أي نص إضافي:\n` +
    `{"name_ar":"...","category_name":"...","karat":"21K","metal_color":"yellow","style":[],"gemstones":[],"description_ar":"..."}\n\n` +
    `القيم المسموحة:\n` +
    `- karat: 18K, 21K, 22K, 24K, ألماس, فضة, أخرى, null\n` +
    `- metal_color: yellow, white, rose, mixed, null\n` +
    `- category_name يطابق واحدة من: ${catList} أو null\n\n` +
    `قواعد:\n` +
    `- السطح الأبيض اللامع بدون أحجار مقطّعة شفافة = ذهب أبيض (18K/21K)، ليس ألماس.\n` +
    `- "ألماس" فقط عند رؤية أحجار شفافة لها facets واضحة.\n` +
    `- القطع الصفراء الليبية الافتراضي 21K.`;

  const body = {
    model: "meta-llama/llama-4-maverick-17b-128e-instruct",
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: "حلّل هذه القطعة وأعد JSON فقط." },
          {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${imageBase64}` },
          },
        ],
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
    max_tokens: 800,
  };

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("Groq error", res.status, text);
    throw Object.assign(new Error(text || `Groq ${res.status}`), { status: res.status });
  }

  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(raw) as JewelryAnalysis;
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("Groq returned invalid JSON");
  }
}

/**
 * Direct Gemini vision call (uses GOOGLE_API_KEY or GEMINI_API_KEY).
 * 1500 requests/day free tier, 15 RPM.
 */
export async function analyzeJewelryImageGemini(params: {
  imageBase64: string;
  mimeType: string;
  categoryNames: string[];
}): Promise<JewelryAnalysis> {
  const raw = Deno.env.get("GOOGLE_API_KEY") ?? Deno.env.get("GEMINI_API_KEY") ?? "";
  const key = raw.trim().replace(/^["']|["']$/g, "");
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

  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{
          role: "user",
          parts: [
            { text: "حلّل هذه القطعة وأعد JSON فقط." },
            { inlineData: { mimeType, data: imageBase64 } },
          ],
        }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    console.error("Gemini error", res.status, text);
    throw Object.assign(new Error(text || `Gemini ${res.status}`), { status: res.status });
  }

  const data = await res.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  try {
    return JSON.parse(rawText) as JewelryAnalysis;
  } catch {
    const m = rawText.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("Gemini returned invalid JSON");
  }
}

/**
 * مجاني بالكامل: Groq أولاً (سريع جداً وحد مجاني كبير) ثم Gemini.
 * لا يُستخدم Lovable Gateway هنا إطلاقاً حتى لا تُستهلك أي أرصدة.
 * المزوّد الذي يفشل فشلاً صريحاً يُستبعد 10 دقائق لتسريع البقية.
 */
const cooldown = new Map<string, number>();
const COOLDOWN_MS = 10 * 60 * 1000;
const HARD_FAIL = new Set([400, 401, 402, 403, 404, 429]);

export async function analyzeWithFallback(params: {
  imageBase64: string;
  mimeType: string;
  categoryNames: string[];
}): Promise<{ analysis: JewelryAnalysis; provider: string }> {
  // تنظيف: قبول data URL أو base64 خام
  const m = /^data:([^;]+);base64,(.*)$/s.exec(params.imageBase64.trim());
  if (m) params = { ...params, mimeType: m[1], imageBase64: m[2] };
  params = { ...params, imageBase64: params.imageBase64.replace(/\s/g, "") };

  const all: Array<{ name: string; fn: () => Promise<JewelryAnalysis> }> = [];

  if (Deno.env.get("GROQ_API_KEY")) {
    all.push({ name: "groq", fn: () => analyzeJewelryImageGroq(params) });
  }
  if (Deno.env.get("GOOGLE_API_KEY") || Deno.env.get("GEMINI_API_KEY")) {
    all.push({ name: "gemini", fn: () => analyzeJewelryImageGemini(params) });
  }
  if (!all.length) {
    throw Object.assign(new Error("لا يوجد مفتاح ذكاء اصطناعي مجاني (GROQ_API_KEY أو GOOGLE_API_KEY)"), {
      status: 500,
    });
  }

  const now = Date.now();
  const active = all.filter((p) => (cooldown.get(p.name) ?? 0) < now);
  const providers = active.length ? active : all;

  let lastErr: unknown = null;
  for (const p of providers) {
    try {
      const analysis = await p.fn();
      cooldown.delete(p.name);
      return { analysis, provider: p.name };
    } catch (e) {
      lastErr = e;
      const status = (e as any)?.status;
      if (HARD_FAIL.has(status)) cooldown.set(p.name, Date.now() + COOLDOWN_MS);
      console.warn(`Provider ${p.name} failed [${status}], trying next`);
    }
  }
  throw lastErr ?? new Error("All AI providers failed");
}



/**
 * Embedding مجاني عبر Google (gemini-embedding-001) بأبعاد 1536
 * لمطابقة product_images.ai_embedding. يستخدم Lovable Gateway فقط إن لم يوجد مفتاح Google.
 */
export async function embedText(text: string): Promise<number[]> {
  const gkey = (Deno.env.get("GOOGLE_API_KEY") ?? Deno.env.get("GEMINI_API_KEY") ?? "")
    .trim()
    .replace(/^["']|["']$/g, "");

  if (gkey) {
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-goog-api-key": gkey },
        body: JSON.stringify({
          content: { parts: [{ text }] },
          outputDimensionality: 1536,
        }),
      },
    );
    if (res.ok) {
      const data = await res.json();
      const vec = data?.embedding?.values;
      if (Array.isArray(vec)) return vec;
    } else {
      console.error("Google embed error", res.status, await res.text());
    }
  }

  const res = await fetch(`${GATEWAY}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": getLovableKey(),
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text,
      dimensions: 1536,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    console.error("Gateway embed error", res.status, t);
    const err = new Error(t || `Gateway ${res.status}`);
    (err as any).status = res.status;
    throw err;
  }

  const data = await res.json();
  const vec = data?.data?.[0]?.embedding;
  if (!Array.isArray(vec)) throw new Error("Embedding missing from response");
  return vec;
}


/** Build a compact text representation of an analysis for embedding. */
export function analysisToEmbeddingText(a: JewelryAnalysis): string {
  const parts: string[] = [];
  if (a.name_ar) parts.push(a.name_ar);
  if (a.category_name) parts.push(a.category_name);
  if (a.karat) parts.push(a.karat);
  if (a.metal_color) parts.push(`لون: ${a.metal_color}`);
  if (a.style?.length) parts.push(a.style.join(" "));
  if (a.gemstones?.length) parts.push("أحجار: " + a.gemstones.join(" "));
  if (a.description_ar) parts.push(a.description_ar);
  return parts.join(" · ");
}

/** Map an AI-friendly error to user-facing Arabic + status code. */
export function friendlyError(e: unknown): { status: number; message: string } {
  const status = (e as any)?.status ?? 500;
  if (status === 402) {
    return { status: 402, message: "انتهى رصيد الذكاء الاصطناعي، تواصل مع المدير لشحن الرصيد." };
  }
  if (status === 429) {
    return { status: 429, message: "الذكاء الاصطناعي مشغول الآن، حاول بعد قليل." };
  }
  const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
  return { status: 500, message: msg };
}
