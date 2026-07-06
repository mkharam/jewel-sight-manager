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
  required: ["name_ar", "category_name", "karat", "style", "gemstones", "description_ar"],
};

/**
 * Vision call: analyze a jewelry photo and return structured fields.
 * Uses Lovable AI Gateway → google/gemini-3-flash-preview.
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
    `أنت خبير مجوهرات عربي. حلّل صورة القطعة واستخرج خصائصها.\n` +
    `اختر category_name فقط من هذه القائمة (طابق الاسم حرفياً): ${catList}.\n` +
    `إن لم تكن الفئة واضحة اجعل category_name = null.\n` +
    `أعد فقط JSON مطابق للـ schema المطلوب، بدون أي نص إضافي.`;

  const body = {
    model: "google/gemini-3-flash-preview",
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: "حلّل هذه القطعة:" },
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
    // Fallback: try to salvage JSON from any wrapping text.
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("AI returned invalid JSON");
  }
}

/**
 * Embedding call: turn text into a 1536-dim vector.
 * Uses openai/text-embedding-3-small with dimensions=1536 to match the
 * product_images.ai_embedding column.
 */
export async function embedText(text: string): Promise<number[]> {
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
