// Shared AI helpers for the jewelry photo pipeline — FREE PROVIDERS ONLY.
// Vision: OpenRouter → Groq → Gemini.  Embeddings: Google gemini-embedding-001.
// Lovable AI Gateway is intentionally NOT used anywhere here (no credits).


export type JewelryAnalysis = {
  name_ar: string;
  category_name: string | null;
  karat: "18K" | "21K" | "22K" | "24K" | "ألماس" | "فضة" | "أخرى" | null;
  metal_color: "yellow" | "white" | "rose" | "mixed" | null;
  style: string[];
  gemstones: string[];
  description_ar: string;
};

// ملاحظة: لا توجد دالة تحليل عبر Lovable AI Gateway — تم إزالتها نهائياً
// حتى لا يستهلك النظام أي أرصدة. المزوّدات المتاحة: OpenRouter ثم Groq ثم Gemini.

// ============================================================
// PROMPT مشترك — دقيق وغير افتراضي (لا "ألماس" ولا "21K" كافتراضي)
// ============================================================
function buildSystemPrompt(catList: string): string {
  return (
    `أنت خبير مجوهرات عربي دقيق الملاحظة. أعد JSON فقط بهذا الشكل بالضبط بدون أي نص إضافي:\n` +
    `{"name_ar":"...","category_name":"...","karat":null,"metal_color":"yellow","style":[],"gemstones":[],"description_ar":"..."}\n\n` +
    `القيم المسموحة:\n` +
    `- karat: 18K, 21K, 22K, 24K, ألماس, فضة, أخرى, null\n` +
    `- metal_color: yellow, white, rose, mixed, null\n` +
    `- category_name يطابق واحدة من: ${catList} أو null\n\n` +
    `قواعد صارمة يجب اتباعها بدقة — لا تخمّن، صف ما تراه فقط:\n` +
    `- لا تفترض "ألماس" أبداً كقيمة افتراضية لأي حجر أبيض لامع. أي حجر أبيض/شفاف هو على الأرجح زركون مكعب (CZ) أو حجر صناعي — ` +
    `اذكره في description_ar وgemstones بأنه "أحجار بيضاء لامعة"، وليس "ألماس"، إلا إذا رأيت حجراً واحداً كبيراً بارزاً بوضوح بقطع سوليتير احترافي يوحي فعلاً بألماس حقيقي.\n` +
    `- لا تفترض "21K" أو أي عيار آخر كقيمة افتراضية. إن لم تستطع تمييز درجة نقاء المعدن من لون/بريق المعدن بثقة كافية، أعد karat كـ null. ` +
    `لا يوجد عيار افتراضي لأي منشأ أو بلد — كل قطعة تُقيَّم بصرياً فقط ومن دون افتراضات مسبقة.\n` +
    `- في gemstones، اذكر الألوان الفعلية الظاهرة في الصورة بدقة (مثال: زمردي أخضر، جمشت بنفسجي، ياقوت أحمر، سفير أزرق، سيترين أصفر، أبيض/شفاف) — فقط ما تراه فعلياً في هذه الصورة تحديداً، وليس تخميناً عاماً أو قائمة نمطية.\n` +
    `- في style، صف شكل القطعة الفعلي بدقة: أقراط متدلية (شاندلير) أو أقراط ستود صغيرة، عقد قريب من الرقبة (شوكر) أو عقد بسلسلة طويلة نازلة، خاتم كلاستر بعدة أحجار أو خاتم سوليتير بحجر واحد مركزي، أسورة بخط أحجار متصل (تنس) أو أسورة عريضة مزخرفة — حسب ما يظهر فعلياً في هذه الصورة.\n` +
    `- metal_color بحسب اللون الحقيقي الظاهر فعلياً في الصورة: أبيض/روديوم لامع، أصفر ذهبي، أو وردي (روز غولد) — لا تخمّن بناءً على نوع القطعة.\n` +
    `- description_ar يجب أن يذكر الألوان الفعلية للأحجار وتفاصيل التصميم الحقيقية الظاهرة في هذه الصورة تحديداً ` +
    `(مثال جيد: "أقراط متدلية بحجر أخضر زمردي شكل كمثرى وأحجار بنفسجية، محاطة بأحجار بيضاء لامعة على تصميم أوراق فضية")، ` +
    `وليس وصفاً عاماً نمطياً مثل "أقراط ألماس فاخرة".`
  );
}

/**
 * OpenRouter Vision — المزوّد الأساسي المجاني.
 * يستخدم مصفوفة models لإعادة التوجيه التلقائي بين 3 موديلات مجانية.
 */
const OPENROUTER_VISION_MODELS = [
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "nvidia/nemotron-nano-12b-v2-vl:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "dots-studio/dots-3-note-preview:free",
];

async function openRouterOnce(params: {
  key: string;
  model: string;
  systemPrompt: string;
  imageBase64: string;
  mimeType: string;
}): Promise<JewelryAnalysis> {
  const { key, model, systemPrompt, imageBase64, mimeType } = params;
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": "https://jewel-sight-manager.lovable.app",
      "X-Title": "Mkharram Jewelry",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: "حلّل هذه القطعة وأعد JSON فقط." },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          ],
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 800,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("OpenRouter error", model, res.status, text.slice(0, 300));
    throw Object.assign(new Error(text || `OpenRouter ${res.status}`), { status: res.status });
  }

  const data = await res.json();
  if (data?.error) {
    const status = Number(data.error?.code) || 500;
    console.error("OpenRouter body error", model, status, String(data.error?.message).slice(0, 200));
    throw Object.assign(new Error(String(data.error?.message ?? "OpenRouter error")), { status });
  }
  const raw = data?.choices?.[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(raw) as JewelryAnalysis;
  } catch {
    const mm = String(raw).match(/\{[\s\S]*\}/);
    if (mm) return JSON.parse(mm[0]) as JewelryAnalysis;
    throw Object.assign(new Error("OpenRouter returned invalid JSON"), { status: 502 });
  }
}

export async function analyzeJewelryImageOpenRouter(params: {
  imageBase64: string;
  mimeType: string;
  categoryNames: string[];
}): Promise<JewelryAnalysis> {
  const key = Deno.env.get("OPENROUTER_API_KEY")?.trim();
  if (!key) throw Object.assign(new Error("OPENROUTER_API_KEY not set"), { status: 500 });

  const { imageBase64, mimeType, categoryNames } = params;
  const catList = categoryNames.length
    ? categoryNames.join("، ")
    : "خاتم، سلسلة، أسوارة، حلق، طقم، تعليقة، خلخال، دبلة";
  const systemPrompt = buildSystemPrompt(catList);

  // نجرّب كل موديل مجاني على حدة، ومع تراجع تدريجي عند 429/5xx
  // (الحد المجاني على OpenRouter مشترك ويرفض الطلبات لحظياً، لكنه يعود بسرعة).
  let lastErr: unknown = null;
  for (let round = 0; round < 2; round++) {
    for (const model of OPENROUTER_VISION_MODELS) {
      try {
        const out = await openRouterOnce({ key, model, systemPrompt, imageBase64, mimeType });
        console.log("OpenRouter used model:", model);
        return out;
      } catch (e) {
        lastErr = e;
        const status = (e as any)?.status ?? 500;
        // مفتاح غير صالح / رصيد منتهٍ: لا فائدة من بقية الموديلات
        if (status === 401 || status === 403 || status === 402) throw e;
        if (status === 429 || status >= 500) {
          await new Promise((r) => setTimeout(r, 700 + round * 1500));
          continue;
        }
      }
    }
  }
  throw lastErr ?? Object.assign(new Error("OpenRouter unavailable"), { status: 429 });
}


/**
 * Groq Vision call — احتياطي مجاني (30 RPM, 14400/day).
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
  const systemPrompt = buildSystemPrompt(catList);

  // موديلات Groq القادرة على الرؤية فقط — لا نستخدم أي موديل نصي
  const KNOWN_VISION = [
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "meta-llama/llama-4-maverick-17b-128e-instruct",
  ];
  const VISION_RE = /llama-4|scout|maverick|-vl-|vision/i;
  let GROQ_VISION_MODELS: string[] = KNOWN_VISION;
  try {
    const ml = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (ml.ok) {
      const allIds: string[] = ((await ml.json())?.data ?? []).map((m: any) => String(m?.id ?? ""));
      console.log("Groq available models (raw):", JSON.stringify(allIds));
      const available = KNOWN_VISION.filter((m) => allIds.includes(m));
      const extra = allIds.filter((id) => VISION_RE.test(id) && !available.includes(id));
      const list = [...available, ...extra];
      console.log("Groq vision candidates:", list.join(", ") || "none");
      GROQ_VISION_MODELS = list;
    } else {
      console.log("Groq /models failed:", ml.status, (await ml.text()).slice(0, 300));
    }
  } catch (e) {
    console.log("Groq /models error:", String(e));
  }

  if (!GROQ_VISION_MODELS.length) {
    throw new Error("No vision-capable Groq model available on this API key");
  }

  const makeBody = (model: string) => ({
    model,
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
  });

  let res: Response | null = null;
  let lastText = "";
  let lastStatus = 500;
  for (const model of GROQ_VISION_MODELS) {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(makeBody(model)),
    });
    if (r.ok) {
      res = r;
      break;
    }
    lastText = await r.text();
    lastStatus = r.status;
    console.error("Groq error", r.status, model, lastText);
    if (r.status !== 404 && r.status !== 400) break;
  }

  if (!res) {
    throw Object.assign(new Error(lastText || `Groq ${lastStatus}`), { status: lastStatus });
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
  const systemPrompt = buildSystemPrompt(catList);

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
 * مجاني بالكامل: OpenRouter أولاً ثم Groq ثم Gemini.
 * لا يُستخدم Lovable Gateway هنا إطلاقاً حتى لا تُستهلك أي أرصدة.
 * المزوّد الذي يفشل فشلاً صريحاً يُستبعد 10 دقائق لتسريع البقية.
 */
const cooldown = new Map<string, number>();
const COOLDOWN_HARD_MS = 10 * 60 * 1000;
const COOLDOWN_SOFT_MS = 45 * 1000;
const HARD_FAIL = new Set([400, 401, 402, 403, 404]);

export async function analyzeWithFallback(params: {
  imageBase64: string;
  mimeType: string;
  categoryNames: string[];
}): Promise<{ analysis: JewelryAnalysis; provider: string }> {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(params.imageBase64.trim());
  if (m) params = { ...params, mimeType: m[1], imageBase64: m[2] };
  params = { ...params, imageBase64: params.imageBase64.replace(/\s/g, "") };
  if (!params.imageBase64) {
    throw Object.assign(new Error("الصورة فارغة أو غير صالحة"), { status: 400 });
  }

  const all: Array<{ name: string; fn: () => Promise<JewelryAnalysis> }> = [];

  if (Deno.env.get("OPENROUTER_API_KEY")) {
    all.push({ name: "openrouter", fn: () => analyzeJewelryImageOpenRouter(params) });
  }
  if (Deno.env.get("GROQ_API_KEY")) {
    all.push({ name: "groq", fn: () => analyzeJewelryImageGroq(params) });
  }
  if (Deno.env.get("GOOGLE_API_KEY") || Deno.env.get("GEMINI_API_KEY")) {
    all.push({ name: "gemini", fn: () => analyzeJewelryImageGemini(params) });
  }
  if (!all.length) {
    throw Object.assign(
      new Error("لا يوجد مفتاح ذكاء اصطناعي مجاني (OPENROUTER_API_KEY أو GROQ_API_KEY أو GOOGLE_API_KEY) — أضفه من إعدادات المشروع."),
      { status: 500 },
    );
  }

  const now = Date.now();
  const fresh = all.filter((p) => (cooldown.get(p.name) ?? 0) < now);
  const cooled = all.filter((p) => (cooldown.get(p.name) ?? 0) >= now);
  const providers = [...fresh, ...cooled];

  let lastErr: unknown = null;
  // محاولتان كاملتان على كل المزودات مع تراجع بينهما — الحد المجاني المشترك
  // يرفض الطلبات لحظياً ثم يعود، فلا نُظهر خطأ للمستخدم من أول رفض.
  for (let pass = 0; pass < 2; pass++) {
    if (pass > 0) await new Promise((r) => setTimeout(r, 2500));
    for (const p of providers) {
      try {
        const analysis = await p.fn();
        cooldown.delete(p.name);
        return { analysis, provider: p.name };
      } catch (e) {
        lastErr = e;
        const status = (e as any)?.status ?? 500;
        cooldown.set(
          p.name,
          Date.now() + (HARD_FAIL.has(status) ? COOLDOWN_HARD_MS : COOLDOWN_SOFT_MS),
        );
        console.warn(`Provider ${p.name} failed [${status}] (pass ${pass + 1}), trying next`);
      }
    }
  }

  const status = (lastErr as any)?.status ?? 429;
  throw Object.assign(
    new Error(
      status === 429
        ? "كل مزودات الذكاء الاصطناعي المجانية مشغولة الآن (OpenRouter/Groq/Gemini) — أعد المحاولة بعد قليل."
        : `فشل تحليل الصورة: ${(lastErr as Error)?.message ?? "خطأ غير معروف"}`,
    ),
    { status },
  );
}

/**
 * Embedding مجاني عبر Google (gemini-embedding-001) بأبعاد 1536.
 */
export async function embedText(text: string): Promise<number[]> {
  const gkey = (Deno.env.get("GOOGLE_API_KEY") ?? Deno.env.get("GEMINI_API_KEY") ?? "")
    .trim()
    .replace(/^["']|["']$/g, "");

  if (!gkey) {
    throw Object.assign(
      new Error("لا يمكن إنشاء بصمة البحث: مفتاح GOOGLE_API_KEY غير مضبوط (أضفه من إعدادات المشروع)."),
      { status: 500 },
    );
  }

  const input = (text || "").trim().slice(0, 8000) || "قطعة مجوهرات";
  let lastStatus = 500;
  let lastText = "";

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-goog-api-key": gkey },
        body: JSON.stringify({
          content: { parts: [{ text: input }] },
          outputDimensionality: 1536,
        }),
      },
    );

    if (res.ok) {
      const data = await res.json();
      const vec = data?.embedding?.values;
      if (Array.isArray(vec) && vec.length === 1536) return vec;
      throw Object.assign(new Error("بصمة غير صالحة من Google (أبعاد غير متوقعة)"), { status: 500 });
    }

    lastStatus = res.status;
    lastText = await res.text();
    console.error("Google embed error", lastStatus, lastText);
    const retryable = lastStatus === 429 || lastStatus >= 500;
    if (!retryable || attempt === 2) break;
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }

  throw Object.assign(new Error(lastText || `Google embed ${lastStatus}`), { status: lastStatus });
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
  if (status === 401 || status === 403) {
    return { status, message: "مفتاح الذكاء الاصطناعي المجاني غير صالح — راجع OPENROUTER_API_KEY / GROQ_API_KEY / GOOGLE_API_KEY." };
  }
  if (status === 402 || status === 429) {
    return { status: 429, message: "حد الاستخدام المجاني ممتلئ الآن (OpenRouter/Groq/Gemini)، حاول بعد قليل." };
  }

  const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
  return { status: 500, message: msg };
}
