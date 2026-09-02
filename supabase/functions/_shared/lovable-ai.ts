// Shared AI helpers for the jewelry photo pipeline — FREE PROVIDERS ONLY.
// Vision: OpenRouter → Groq → Gemini.  Embeddings: Google gemini-embedding-001.
// Lovable AI Gateway is intentionally NOT used anywhere here (no credits).


export type JewelryAnalysis = {
  name_ar: string;
  category_name: string | null;
  item_type: string | null;
  karat: "18K" | "21K" | "22K" | "24K" | "ألماس" | "فضة" | "أخرى" | null;
  metal_color: "yellow" | "white" | "rose" | "mixed" | null;
  style: string[];
  gemstones: string[];
  stone_count: "بدون أحجار" | "حجر واحد" | "عدة أحجار" | null;
  condition: "جديدة" | "مستعملة بحالة جيدة" | "بها خدوش/تلف ظاهر" | null;
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
    `{"name_ar":"...","category_name":"...","item_type":"...","karat":null,"metal_color":"yellow","style":[],"gemstones":[],"stone_count":null,"condition":null,"description_ar":"..."}\n\n` +
    `القيم المسموحة:\n` +
    `- karat: 18K, 21K, 22K, 24K, ألماس, فضة, أخرى, null\n` +
    `- metal_color: yellow, white, rose, mixed, null\n` +
    `- category_name يطابق واحدة من: ${catList} أو null\n` +
    `- item_type: النوع الدقيق للقطعة بالعربية (خاتم، سلسلة، أسوارة، حلق، تعليقة، خلخال، دبلة، طقم، بروش) أو null إن لم يتضح\n` +
    `- stone_count: بدون أحجار (معدن فقط)، حجر واحد (حجر مركزي واحد فقط)، عدة أحجار (أكثر من حجر)، أو null\n` +
    `- condition: جديدة (لا خدوش أو تلف ظاهر)، مستعملة بحالة جيدة (خدوش بسيطة)، بها خدوش/تلف ظاهر (خدوش واضحة أو أجزاء مفقودة)، أو null إن لم تتضح من الصورة\n\n` +
    `قواعد صارمة يجب اتباعها بدقة — لا تخمّن، صف ما تراه فقط:\n` +
    `- لا تفترض "ألماس" أبداً كقيمة افتراضية لأي حجر أبيض لامع. أي حجر أبيض/شفاف هو على الأرجح زركون مكعب (CZ) أو حجر صناعي — ` +
    `اذكره في description_arوgemstones بأنه "أحجار بيضاء لامعة"، وليس "ألماس"، إلا إذا رأيت حجراً واحداً كبيراً بارزاً بوضوح بقطع سوليتير احترافي يوحي فعلاً بألماس حقيقي.\n` +
    `- لا تفترض "21K" أو أي عيار آخر كقيمة افتراضية. إن لم تستطع تمييز درجة نقاء المعدن من لون/بريق المعدن بثقة كافية، أعد karat كـ null. ` +
    `لا يوجد عيار افتراضي لأي منشأ أو بلد — كل قطعة تُقيّم بصرياً فقط ومن دون افتراضات مسبقة.\n` +
    `- في gemstones، اذكر الألوان الفعلية الظاهرة في الصورة بدقة (مثال: زمردي أخضر، جمشت بنفسجي، ياقوت أحمر، سفير أزرق، سيترين أصفر، أبيض/شفاف) — فقط ما تراه فعلياً في هذه الصورة تحديداً، وليس تخميناً عاماً أو قائمة نمطية.\n` +
    `- في style، صف شكل القطعة الفعلي بدقة: أقراط متدلية (شانديلير) أو أقراط ستود صغيرة، عقد قريب من الرقبة (شوكر) أو عقد بسلسلة طويلة نازلة، خاتم كلاستر بعدة أحجار أو خاتم سوليتير بحجر واحد مركزي، أسورة بخط أحجار متصل (تنس) أو أسورة عريضة مزخرفة — حسب ما يظهر فعلياً في هذه الصورة.\n` +
    `- item_type يجب أن يكون النوع المحدد الفعلي (مثلاً "حلق" وليس "مجوهرات")، استنتجه من شكل القطعة نفسها لا من الفئة العامة فقط.\n` +
    `- stone_count وcondition: قيّمهما فقط من الظاهر فعلياً في الصورة، وأعد null عند عدم التأكد بدل التخمين.\n` +
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
// مرتّبة من الأقدر على التفاصيل والتسمية الدقيقة إلى الأبسط — نجرّب الأقوى أولاً.
const OPENROUTER_VISION_MODELS = [
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "nvidia/nemotron-nano-12b-v2-vl:free",
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
      max_tokens: 1100,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("OpenRouter error", model, res.status, text.slice(0, 300));
    const daily = /free-models-per-day|per-day|per day/i.test(text);
    throw Object.assign(new Error(text || `OpenRouter ${res.status}`), { status: res.status, daily });
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
  promptOverride?: string;
}): Promise<any> {
  const key = Deno.env.get("OPENROUTER_API_KEY")?.trim();
  if (!key) throw Object.assign(new Error("OPENROUTER_API_KEY not set"), { status: 500 });

  const { imageBase64, mimeType, categoryNames } = params;
  const catList = categoryNames.length
    ? categoryNames.join("، ")
    : "خاتم، سلسلة، أسوارة، حلق، طقم، تعليقة، خلخال، دبلة";
  const systemPrompt = params.promptOverride ?? buildSystemPrompt(catList);

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
        // الحصة اليومية أو المفتاح غير الصالح: لا فائدة من بقية الموديلات
        if (status === 401 || status === 403 || status === 402 || (e as any)?.daily) throw e;
        if (status === 429 || status >= 500) {
          await new Promise((r) => setTimeout(r, 400 + round * 800));
          continue;
        }
      }
    }
  }
  throw lastErr ?? Object.assign(new Error("OpenRouter unavailable"), { status: 429 });
}


// قائمة موديلات Groq القادرة على الرؤية — تُخزّن مؤقتاً بدل جلبها من /v1/models
// في كل استدعاء تحليل (كانت تضيف رحلة شبكة كاملة إضافية على كل صورة، تُبطئ التحليل).
const KNOWN_GROQ_VISION = [
  "qwen/qwen3.6-27b",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
];
const GROQ_VISION_RE = /llama-4|scout|maverick|-vl-|vision|qwen3\.\d|qwen3-vl/i;
const GROQ_MODELS_CACHE_MS = 60 * 60 * 1000; // ساعة
let groqModelsCache: { list: string[]; expires: number } | null = null;

async function getGroqVisionModels(key: string): Promise<string[]> {
  if (groqModelsCache && groqModelsCache.expires > Date.now()) return groqModelsCache.list;
  try {
    const ml = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (ml.ok) {
      const allIds: string[] = ((await ml.json())?.data ?? []).map((m: any) => String(m?.id ?? ""));
      const available = KNOWN_GROQ_VISION.filter((m) => allIds.includes(m));
      const extra = allIds.filter((id) => GROQ_VISION_RE.test(id) && !available.includes(id));
      const list = [...available, ...extra];
      groqModelsCache = { list, expires: Date.now() + GROQ_MODELS_CACHE_MS };
      return list;
    }
    console.log("Groq /models failed:", ml.status, (await ml.text()).slice(0, 300));
  } catch (e) {
    console.log("Groq /models error:", String(e));
  }
  // فشل الجلب — نستخدم القائمة المعروفة كاحتياط بدل تعطيل Groq بالكامل.
  return KNOWN_GROQ_VISION;
}

/**
 * Groq Vision call — احتياطي مجاني (30 RPM, 14400/day).
 */
export async function analyzeJewelryImageGroq(params: {
  imageBase64: string;
  mimeType: string;
  categoryNames: string[];
  promptOverride?: string;
}): Promise<any> {
  const key = Deno.env.get("GROQ_API_KEY")?.trim();
  if (!key) throw Object.assign(new Error("GROQ_API_KEY not set"), { status: 500 });

  const { imageBase64, mimeType, categoryNames } = params;
  const catList = categoryNames.length
    ? categoryNames.join("، ")
    : "خاتم، سلسلة، أسوارة، حلق، طقم، تعليقة، خلخال، دبلة";
  const systemPrompt = params.promptOverride ?? buildSystemPrompt(catList);

  const GROQ_VISION_MODELS = await getGroqVisionModels(key);
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
    max_tokens: 1100,
    // موديلات qwen التفكيرية تُخرج <think> وتستهلك الرموز — نطفئها لنحصل على JSON مباشرة
    ...(/qwen/i.test(model) ? { reasoning_effort: "none" } : {}),
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
  promptOverride?: string;
}): Promise<any> {
  const raw = Deno.env.get("GOOGLE_API_KEY") ?? Deno.env.get("GEMINI_API_KEY") ?? "";
  const key = raw.trim().replace(/^["']|["']$/g, "");
  if (!key) throw Object.assign(new Error("GEMINI_API_KEY not set"), { status: 500 });

  const { imageBase64, mimeType, categoryNames } = params;
  const catList = categoryNames.length
    ? categoryNames.join("، ")
    : "خاتم، سلسلة، أسوارة، حلق، طقم، تعليقة، خلخال، دبلة";
  const systemPrompt = params.promptOverride ?? buildSystemPrompt(catList);

  // Gemini هو المزوّد الأدق (أول من نجرّب) — نضيف محاولتين إضافيتين عند 429/5xx العابرة
  // بدل الانتقال فوراً لمزوّد أضعف؛ يرفع نسبة نجاح أفضل مزوّد بدل التنازل عن الدقة بسرعة.
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
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
        const retryable = res.status === 429 || res.status >= 500;
        if (retryable && attempt < 2) {
          lastErr = Object.assign(new Error(text || `Gemini ${res.status}`), { status: res.status });
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
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
    } catch (e) {
      if (attempt === 2) throw e;
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("Gemini unavailable");
}

/**
 * مجاني بالكامل: OpenRouter أولاً ثم Groq ثم Gemini.
 * لا يُستخدم Lovable Gateway هنا إطلاقاً حتى لا تُستهلك أي أرصدة.
 * المزوّد الذي يفشل فشلاً صريحاً يُستبعد 10 دقائق لتسريع البقية.
 */
const cooldown = new Map<string, number>();
const COOLDOWN_HARD_MS = 10 * 60 * 1000;
const COOLDOWN_SOFT_MS = 20 * 1000;
const HARD_FAIL = new Set([400, 401, 402, 403, 404]);

/**
 * سباق مُتدرّج (hedged race): يبدأ بأدق مزوّد فوراً، وإن لم يُجب خلال hedgeDelayMs
 * يُشغّل التالي بالتوازي معه دون إلغاء الأول — الفائز هو أول من ينجح. هذا يحدّ من أسوأ
 * زمن انتظار (عندما يكون أدق مزوّد بطيئاً أو محدود الحصة مؤقتاً) دون التضحية بالدقة في
 * الحالة الشائعة (عندما يستجيب أدق مزوّد بسرعة، لا يُستدعى غيره إطلاقاً — لا هدر حصة).
 */
async function hedgedRace<T>(
  providers: Array<{ name: string; fn: () => Promise<T> }>,
  onFail: (name: string, err: unknown) => void,
  hedgeDelayMs = 900,
): Promise<{ result: T; provider: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let remaining = providers.length;
    let lastErr: unknown = null;

    providers.forEach((p, i) => {
      setTimeout(() => {
        if (settled) return;
        p.fn().then((result) => {
          if (settled) return;
          settled = true;
          resolve({ result, provider: p.name });
        }).catch((e) => {
          lastErr = e;
          onFail(p.name, e);
          remaining--;
          if (remaining === 0 && !settled) reject(lastErr);
        });
      }, i * hedgeDelayMs);
    });
  });
}

// عدّاد استهلاك تقريبي لكل مزوّد لعرضه في الواجهة (المتبقي اليوم). يعيش في ذاكرة
// نسخة الدالة فقط — يُصفّر عند إعادة تشغيل الدالة (بارد) وليس عدّاداً رسمياً دقيقاً
// من المزوّد نفسه، لكنه كافٍ لإعطاء الموظف فكرة تقريبية عن الحصة المتبقية اليوم.
const DAILY_LIMITS: Record<string, number> = { gemini: 1500, groq: 14400, openrouter: 50 };
const usageDay = new Map<string, string>();
const usageCount = new Map<string, number>();

function recordUsage(provider: string) {
  if (!(provider in DAILY_LIMITS)) return;
  const today = new Date().toISOString().slice(0, 10);
  if (usageDay.get(provider) !== today) {
    usageDay.set(provider, today);
    usageCount.set(provider, 0);
  }
  usageCount.set(provider, (usageCount.get(provider) ?? 0) + 1);
}

export function getUsageSnapshot(): Record<string, { used: number; limit: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const out: Record<string, { used: number; limit: number }> = {};
  for (const p of Object.keys(DAILY_LIMITS)) {
    const used = usageDay.get(p) === today ? (usageCount.get(p) ?? 0) : 0;
    out[p] = { used, limit: DAILY_LIMITS[p] };
  }
  return out;
}

export async function analyzeWithFallback(params: {
  imageBase64: string;
  mimeType: string;
  categoryNames: string[];
}): Promise<{ analysis: JewelryAnalysis; provider: string; usage: Record<string, { used: number; limit: number }> }> {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(params.imageBase64.trim());
  if (m) params = { ...params, mimeType: m[1], imageBase64: m[2] };
  params = { ...params, imageBase64: params.imageBase64.replace(/\s/g, "") };
  if (!params.imageBase64) {
    throw Object.assign(new Error("الصورة فارغة أو غير صالحة"), { status: 400 });
  }

  const all: Array<{ name: string; fn: () => Promise<JewelryAnalysis> }> = [];

  // ترتيب الدقة: Gemini (الأدق والأكثر تفصيلاً) ثم Groq (نماذج llama-4 قوية)،
  // وOpenRouter أخيراً كاحتياط عند نفاد حصص المزوّدين الأفضل.
  if (Deno.env.get("GOOGLE_API_KEY") || Deno.env.get("GEMINI_API_KEY")) {
    all.push({ name: "gemini", fn: () => analyzeJewelryImageGemini(params) });
  }
  if (Deno.env.get("GROQ_API_KEY")) {
    all.push({ name: "groq", fn: () => analyzeJewelryImageGroq(params) });
  }
  if (Deno.env.get("OPENROUTER_API_KEY")) {
    all.push({ name: "openrouter", fn: () => analyzeJewelryImageOpenRouter(params) });
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

  const markFail = (name: string, e: unknown) => {
    const status = (e as any)?.status ?? 500;
    cooldown.set(name, Date.now() + (HARD_FAIL.has(status) ? COOLDOWN_HARD_MS : COOLDOWN_SOFT_MS));
    console.warn(`Provider ${name} failed [${status}]`);
  };

  let lastErr: unknown = null;
  // محاولتان: سباق متدرّج أولاً (سريع، يفضّل الأدق)، ثم محاولة أخيرة بعد تراجع قصير
  // فقط إن فشل الجميع — الحد المجاني المشترك يرفض الطلبات لحظياً ثم يعود بسرعة.
  for (let pass = 0; pass < 2; pass++) {
    if (pass > 0) await new Promise((r) => setTimeout(r, 1200));
    try {
      const { result, provider } = await hedgedRace(providers, markFail);
      cooldown.delete(provider);
      recordUsage(provider);
      return { analysis: result, provider, usage: getUsageSnapshot() };
    } catch (e) {
      lastErr = e;
    }
  }

  const status = (lastErr as any)?.status ?? 429;
  throw Object.assign(
    new Error(
      (lastErr as any)?.daily
        ? "انتهت الحصة المجانية اليومية للتحليل (50 صورة/يوم على OpenRouter). تُعاد تلقائياً بعد منتصف الليل بتوقيت غرينتش، أو أضف رصيداً صغيراً في OpenRouter لرفعها إلى 1000 صورة/يوم."
        : status === 429
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
  if (a.item_type) parts.push(a.item_type);
  if (a.karat) parts.push(a.karat);
  if (a.metal_color) parts.push(`لون: ${a.metal_color}`);
  if (a.style?.length) parts.push(a.style.join(" "));
  if (a.gemstones?.length) parts.push("أحجار: " + a.gemstones.join(" "));
  if (a.stone_count) parts.push(a.stone_count);
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
    const raw = e instanceof Error ? e.message : "";
    if ((e as any)?.daily || /free-models-per-day|الحصة المجانية اليومية/.test(raw)) {
      return {
        status: 429,
        message:
          "انتهت الحصة المجانية اليومية للتحليل (50 صورة/يوم). تُعاد تلقائياً بعد منتصف الليل بتوقيت غرينتش — أو أضف رصيداً صغيراً في OpenRouter لرفعها إلى 1000 صورة/يوم.",
      };
    }
    return { status: 429, message: "حد الاستخدام المجاني ممتلئ الآن (OpenRouter/Groq/Gemini)، حاول بعد قليل." };
  }

  const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
  return { status: 500, message: msg };
}


// ============================================================
// تحليل «صينية»: صورة واحدة تحتوي عدة قطع → مصفوفة قطع
// يوفر وقت التصوير: تصوّر 5–10 قطع مرة واحدة والنظام يفصلها.
// ============================================================
function buildTraySystemPrompt(catList: string): string {
  return (
    `أنت خبير مجوهرات عربي دقيق الملاحظة. الصورة تحتوي عدة قطع مجوهرات معروضة معاً (صينية/علبة عرض).\n` +
    `افصل كل قطعة مستقلة وأعد JSON فقط بهذا الشكل بالضبط بدون أي نص إضافي:\n` +
    `{"pieces":[{"position":"أعلى يمين","name_ar":"...","category_name":"...","item_type":"...","karat":null,"metal_color":"yellow","style":[],"gemstones":[],"stone_count":null,"condition":null,"description_ar":"..."}]}\n\n` +
    `- position: وصف مكان القطعة في الصورة بالعربية (أعلى يمين، وسط، أسفل يسار…) حتى يتعرّف عليها الموظف.\n` +
    `- لا تدمج قطعتين في سجل واحد، ولا تُكرّر نفس القطعة. الطقم المتكامل (عقد+حلق+خاتم معروضة كطقم واحد) سجل واحد فئته "طقم".\n` +
    `- item_type: النوع الدقيق للقطعة بالعربية (خاتم، سلسلة، أسوارة، حلق، تعليقة، خلخال، دبلة، طقم، بروش) أو null إن لم يتضح.\n` +
    `- karat: 18K, 21K, 22K, 24K, ألماس, فضة, أخرى, null — إن لم تتأكد أعد null ولا تفترض عياراً.\n` +
    `- metal_color: yellow, white, rose, mixed, null بحسب اللون الفعلي الظاهر.\n` +
    `- stone_count: بدون أحجار، حجر واحد، عدة أحجار، أو null إن لم يتضح.\n` +
    `- condition: جديدة، مستعملة بحالة جيدة، بها خدوش/تلف ظاهر، أو null إن لم يتضح من الصورة.\n` +
    `- category_name يطابق واحدة من: ${catList} أو null.\n` +
    `- لا تفترض "ألماس" لأي حجر أبيض لامع — اذكره "أحجار بيضاء لامعة" إلا إذا كان حجراً كبيراً بقطع سوليتير واضح.\n` +
    `- description_ar يذكر ألوان الأحجار الفعلية وتفاصيل التصميم الظاهرة في هذه القطعة تحديداً، لا وصفاً عاماً.`
  );
}

// ============================================================
// تحليل «دفعة»: عدة صور منفصلة (كل صورة قطعة مستقلة) في طلب واحد لكل مزوّد.
// يُستخدم من طابور المعالجة الخلفي (pg_cron) بدل استدعاء منفصل لكل صورة —
// يقلّل عدد الطلبات بمقدار حجم الدفعة (مثلاً 4 صور = طلب واحد بدل 4)، فيريح
// حصة الدقيقة عند Gemini/Groq بشكل مباشر دون الحاجة لتعدد مزوّدين أكثر.
// ============================================================
function buildBatchSystemPrompt(catList: string, count: number): string {
  return (
    `أنت خبير مجوهرات عربي دقيق الملاحظة. ستستلم ${count} صورة، كل صورة تخص قطعة مجوهرات ` +
    `منفصلة تماماً عن البقية (وليست عدة قطع في نفس الصورة). حلّل كل صورة بشكل مستقل تماماً ` +
    `عن غيرها وأعد JSON فقط بهذا الشكل بالضبط بدون أي نص إضافي:\n` +
    `{"results":[{"index":1,"name_ar":"...","category_name":"...","item_type":"...","karat":null,"metal_color":"yellow","style":[],"gemstones":[],"stone_count":null,"condition":null,"description_ar":"..."}]}\n\n` +
    `- index يطابق رقم ترتيب الصورة كما وردت (1 هي الصورة الأولى، 2 الثانية، وهكذا) — ` +
    `يجب أن تعيد بالضبط ${count} عنصراً بنفس هذا الترتيب، عنصر واحد لكل صورة.\n` +
    `- القيم المسموحة: karat: 18K, 21K, 22K, 24K, ألماس, فضة, أخرى, null — metal_color: yellow, white, rose, mixed, null — ` +
    `category_name يطابق واحدة من: ${catList} أو null.\n` +
    `- لا تفترض "ألماس" لأي حجر أبيض لامع — اذكره "أحجار بيضاء لامعة" إلا إذا كان حجراً كبيراً بقطع سوليتير واضح.\n` +
    `- لا تفترض عياراً افتراضياً — أعد null عند عدم التأكد من لون/بريق المعدن.\n` +
    `- description_ar يذكر الألوان الفعلية وتفاصيل التصميم الظاهرة في هذه الدفعة تحديداً بدون خلطها بقطعة أخرى في الدفعة.`
  );
}

type BatchImage = { id: string; base64: string; mimeType: string };
type BatchResult = { id: string; analysis: JewelryAnalysis | null };

function normalizeBatchImages(images: BatchImage[]): BatchImage[] {
  return images.map((img) => {
    const m = /^data:([^;]+);base64,(.*)$/s.exec(img.base64.trim());
    const base64 = (m ? m[2] : img.base64).replace(/\s/g, "");
    return { id: img.id, mimeType: m ? m[1] : img.mimeType, base64 };
  });
}

async function analyzeBatchGemini(images: BatchImage[], systemPrompt: string): Promise<BatchResult[]> {
  const raw = Deno.env.get("GOOGLE_API_KEY") ?? Deno.env.get("GEMINI_API_KEY") ?? "";
  const key = raw.trim().replace(/^["']|["']$/g, "");
  if (!key) throw Object.assign(new Error("GEMINI_API_KEY not set"), { status: 500 });

  const parts: any[] = [{ text: "حلّل كل صورة من الصور التالية بشكل مستقل وأعد JSON فقط." }];
  images.forEach((img, i) => {
    parts.push({ text: `الصورة رقم ${i + 1}:` });
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
  });

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-goog-api-key": key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts }],
            generationConfig: { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 4000 },
          }),
        },
      );
      if (!res.ok) {
        const text = await res.text();
        const retryable = res.status === 429 || res.status >= 500;
        if (retryable && attempt < 2) {
          lastErr = Object.assign(new Error(text || `Gemini ${res.status}`), { status: res.status });
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        throw Object.assign(new Error(text || `Gemini ${res.status}`), { status: res.status });
      }
      const data = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
      return parseBatchResponse(rawText, images);
    } catch (e) {
      if (attempt === 2) throw e;
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("Gemini unavailable");
}

async function analyzeBatchGroq(images: BatchImage[], systemPrompt: string): Promise<BatchResult[]> {
  const key = Deno.env.get("GROQ_API_KEY")?.trim();
  if (!key) throw Object.assign(new Error("GROQ_API_KEY not set"), { status: 500 });

  const GROQ_VISION_MODELS = await getGroqVisionModels(key);
  if (!GROQ_VISION_MODELS.length) throw new Error("No vision-capable Groq model available on this API key");

  const content: any[] = [{ type: "text", text: "حلّل كل صورة من الصور التالية بشكل مستقل وأعد JSON فقط." }];
  images.forEach((img, i) => {
    content.push({ type: "text", text: `الصورة رقم ${i + 1}:` });
    content.push({ type: "image_url", image_url: { url: `data:${img.mimeType};base64,${img.base64}` } });
  });

  let res: Response | null = null;
  let lastText = "";
  let lastStatus = 500;
  for (const model of GROQ_VISION_MODELS) {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content }],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 4000,
        ...(/qwen/i.test(model) ? { reasoning_effort: "none" } : {}),
      }),
    });
    if (r.ok) { res = r; break; }
    lastText = await r.text();
    lastStatus = r.status;
    if (r.status !== 404 && r.status !== 400) break;
  }
  if (!res) throw Object.assign(new Error(lastText || `Groq ${lastStatus}`), { status: lastStatus });
  const data = await res.json();
  const rawText = data?.choices?.[0]?.message?.content ?? "{}";
  return parseBatchResponse(rawText, images);
}

async function analyzeBatchOpenRouter(images: BatchImage[], systemPrompt: string): Promise<BatchResult[]> {
  const key = Deno.env.get("OPENROUTER_API_KEY")?.trim();
  if (!key) throw Object.assign(new Error("OPENROUTER_API_KEY not set"), { status: 500 });

  const content: any[] = [{ type: "text", text: "حلّل كل صورة من الصور التالية بشكل مستقل وأعد JSON فقط." }];
  images.forEach((img, i) => {
    content.push({ type: "text", text: `الصورة رقم ${i + 1}:` });
    content.push({ type: "image_url", image_url: { url: `data:${img.mimeType};base64,${img.base64}` } });
  });

  let lastErr: unknown = null;
  for (const model of OPENROUTER_VISION_MODELS) {
    try {
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
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content }],
          response_format: { type: "json_object" },
          temperature: 0.2,
          max_tokens: 4000,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        const daily = /free-models-per-day|per-day|per day/i.test(text);
        const err = Object.assign(new Error(text || `OpenRouter ${res.status}`), { status: res.status, daily });
        if (res.status === 401 || res.status === 403 || res.status === 402 || daily) throw err;
        lastErr = err;
        continue;
      }
      const data = await res.json();
      if (data?.error) throw Object.assign(new Error(String(data.error?.message ?? "OpenRouter error")), { status: Number(data.error?.code) || 500 });
      const rawText = data?.choices?.[0]?.message?.content ?? "{}";
      return parseBatchResponse(rawText, images);
    } catch (e) {
      lastErr = e;
      if ((e as any)?.daily) throw e;
    }
  }
  throw lastErr ?? Object.assign(new Error("OpenRouter unavailable"), { status: 429 });
}

function parseBatchResponse(rawText: string, images: BatchImage[]): BatchResult[] {
  let parsed: any;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    const m = String(rawText).match(/\{[\s\S]*\}/);
    if (!m) throw new Error("استجابة الدفعة ليست JSON صالحاً");
    parsed = JSON.parse(m[0]);
  }
  const results: any[] = Array.isArray(parsed?.results) ? parsed.results : [];
  return images.map((img, i) => {
    const r = results.find((x) => Number(x?.index) === i + 1) ?? results[i];
    if (!r) return { id: img.id, analysis: null };
    const { index, ...analysis } = r;
    return { id: img.id, analysis: analysis as JewelryAnalysis };
  });
}

/**
 * يحلّل عدة صور مستقلة في طلب واحد لكل مزوّد (بدل طلب منفصل لكل صورة) — يُستخدم من
 * طابور المعالجة الخلفي. سباق متدرّج بين المزوّدات الثلاثة تماماً كما في analyzeWithFallback.
 */
export async function analyzeBatchWithFallback(params: {
  images: BatchImage[];
  categoryNames: string[];
}): Promise<{ results: BatchResult[]; provider: string; usage: Record<string, { used: number; limit: number }> }> {
  const images = normalizeBatchImages(params.images);
  if (!images.length) return { results: [], provider: "none", usage: getUsageSnapshot() };

  const catList = params.categoryNames.length
    ? params.categoryNames.join("، ")
    : "خاتم، سلسلة، أسوارة، حلق، طقم، تعليقة، خلخال، دبلة";
  const systemPrompt = buildBatchSystemPrompt(catList, images.length);

  const providers: Array<{ name: string; fn: () => Promise<BatchResult[]> }> = [];
  if (Deno.env.get("GOOGLE_API_KEY") || Deno.env.get("GEMINI_API_KEY")) {
    providers.push({ name: "gemini", fn: () => analyzeBatchGemini(images, systemPrompt) });
  }
  if (Deno.env.get("GROQ_API_KEY")) {
    providers.push({ name: "groq", fn: () => analyzeBatchGroq(images, systemPrompt) });
  }
  if (Deno.env.get("OPENROUTER_API_KEY")) {
    providers.push({ name: "openrouter", fn: () => analyzeBatchOpenRouter(images, systemPrompt) });
  }
  if (!providers.length) {
    throw Object.assign(new Error("لا يوجد مفتاح ذكاء اصطناعي مجاني مُعد في المشروع."), { status: 500 });
  }

  const markFail = (name: string, e: unknown) => console.warn(`Batch provider ${name} failed [${(e as any)?.status ?? 500}]`);

  let lastErr: unknown = null;
  for (let pass = 0; pass < 2; pass++) {
    if (pass > 0) await new Promise((r) => setTimeout(r, 1200));
    try {
      const { result, provider } = await hedgedRace(providers, markFail);
      recordUsage(provider);
      return { results: result, provider, usage: getUsageSnapshot() };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? Object.assign(new Error("كل المزوّدات مشغولة الآن — أعد المحاولة."), { status: 429 });
}

export async function analyzeTrayWithFallback(params: {
  imageBase64: string;
  mimeType: string;
  categoryNames: string[];
}): Promise<{ pieces: JewelryAnalysis[]; provider: string; usage: Record<string, { used: number; limit: number }> }> {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(params.imageBase64.trim());
  if (m) params = { ...params, mimeType: m[1], imageBase64: m[2] };
  params = { ...params, imageBase64: params.imageBase64.replace(/\s/g, "") };
  if (!params.imageBase64) throw Object.assign(new Error("الصورة فارغة أو غير صالحة"), { status: 400 });

  const catList = params.categoryNames.length
    ? params.categoryNames.join("، ")
    : "خاتم، سلسلة، أسوارة، حلق، طقم، تعليقة، خلخال، دبلة";
  const promptOverride = buildTraySystemPrompt(catList);
  const args = { ...params, promptOverride };

  const providers: Array<{ name: string; fn: () => Promise<any> }> = [];
  if (Deno.env.get("GOOGLE_API_KEY") || Deno.env.get("GEMINI_API_KEY")) {
    providers.push({ name: "gemini", fn: () => analyzeJewelryImageGemini(args) });
  }
  if (Deno.env.get("GROQ_API_KEY")) {
    providers.push({ name: "groq", fn: () => analyzeJewelryImageGroq(args) });
  }
  if (Deno.env.get("OPENROUTER_API_KEY")) {
    providers.push({ name: "openrouter", fn: () => analyzeJewelryImageOpenRouter(args) });
  }
  if (!providers.length) {
    throw Object.assign(new Error("لا يوجد مفتاح ذكاء اصطناعي مجاني مُعد في المشروع."), { status: 500 });
  }

  const validated = providers.map((p) => ({
    name: p.name,
    fn: async () => {
      const out = await p.fn();
      const arr = Array.isArray(out?.pieces) ? out.pieces : Array.isArray(out) ? out : null;
      if (!arr || !arr.length) throw Object.assign(new Error("لم يتعرّف النظام على أي قطعة في الصورة"), { status: 422 });
      return arr as JewelryAnalysis[];
    },
  }));

  const markFail = (name: string, e: unknown) => console.warn(`Tray provider ${name} failed [${(e as any)?.status ?? 500}]`);

  let lastErr: unknown = null;
  for (let pass = 0; pass < 2; pass++) {
    if (pass > 0) await new Promise((r) => setTimeout(r, 1200));
    try {
      const { result, provider } = await hedgedRace(validated, markFail);
      recordUsage(provider);
      return { pieces: result, provider, usage: getUsageSnapshot() };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? Object.assign(new Error("كل المزوّدات مشغولة الآن — أعد المحاولة."), { status: 429 });
}
