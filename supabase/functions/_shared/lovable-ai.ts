// Shared AI helpers for the jewelry photo pipeline — FREE PROVIDERS ONLY.
// Vision: OpenRouter → Groq → Gemini.  Embeddings: Google gemini-embedding-001.
// Lovable AI Gateway is intentionally NOT used anywhere here (no credits).

import { createClient } from "npm:@supabase/supabase-js@2";

// عميل إداري خفيف لتسجيل استهلاك الذكاء الاصطناعي في قاعدة البيانات — ملاحظة مهمة: كل
// Edge Function نسخة معزولة تماماً حتى لو استوردت هذا الملف المشترك نفسه، فعدّاد في
// ذاكرة الدالة (كما كان سابقاً) لا تراه دالة أخرى إطلاقاً (مثلاً analyze-product-image
// التي تُجري التحليل الفعلي، وai-usage التي تعرض النتيجة للموظف). التخزين في قاعدة
// البيانات هو الحل الوحيد الصحيح لمشاركة هذا العدّاد بين كل الدوال. فشل التسجيل نفسه
// غير حرج أبداً (best-effort) — لا يجب أن يُفشل أي تحليل بسببه.
let adminClient: ReturnType<typeof createClient> | null = null;
function getAdminClient() {
  if (!adminClient) {
    adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
  }
  return adminClient;
}


export type JewelryAnalysis = {
  name_ar: string;
  category_name: string | null;
  item_type: string | null;
  karat: "18K" | "21K" | null;
  metal_color: "yellow" | "white" | "rose" | "mixed" | null;
  style: string[];
  gemstones: string[];
  stone_count: "بدون أحجار" | "حجر واحد" | "عدة أحجار" | null;
  condition: "جديدة" | "مستعملة بحالة جيدة" | "بها خدوش/تلف ظاهر" | null;
  description_ar: string;
  /** مستطيل موقع القطعة داخل صورة الصينية (0..1 نسبةً لأبعاد الصورة) — تحليل الصينية فقط. */
  bbox?: { x: number; y: number; w: number; h: number } | null;
};

// ملاحظة: لا توجد دالة تحليل عبر Lovable AI Gateway — تم إزالتها نهائياً
// حتى لا يستهلك النظام أي أرصدة. المزوّدات المتاحة: OpenRouter ثم Groq ثم Gemini.

// ============================================================
// PROMPT مشترك — دقيق وغير افتراضي (لا "ألماس" ولا "21K" كافتراضي)
// ============================================================
function buildSystemPrompt(catList: string, calibration = ""): string {
  return (
    `أنت خبير مجوهرات عربي دقيق الملاحظة تعمل في محل ذهب محلي. أعد JSON فقط بهذا الشكل بالضبط بدون أي نص إضافي:\n` +
    `{"name_ar":"...","category_name":"...","item_type":"...","karat":null,"metal_color":"yellow","style":[],"gemstones":[],"stone_count":null,"condition":null,"description_ar":"..."}\n\n` +
    `القيم المسموحة:\n` +
    `- karat: 18K أو 21K فقط، أو null إن تعذّر التمييز تماماً. هذا الحقل خاص بعيار الذهب فقط ولا علاقة له بالأحجار الكريمة إطلاقاً.\n` +
    `- metal_color: yellow, white, rose, mixed, null\n` +
    `- category_name يطابق واحدة من: ${catList} أو null\n` +
    `- item_type: النوع الدقيق للقطعة بالعربية (خاتم، سلسلة، أسوارة، حلق، تعليقة، خلخال، دبلة، طقم، بروش) أو null إن لم يتضح\n` +
    `- stone_count: بدون أحجار (معدن فقط)، حجر واحد (حجر مركزي واحد فقط)، عدة أحجار (أكثر من حجر)، أو null\n` +
    `- condition: جديدة (لا خدوش أو تلف ظاهر)، مستعملة بحالة جيدة (خدوش بسيطة)، بها خدوش/تلف ظاهر (خدوش واضحة أو أجزاء مفقودة)، أو null إن لم تتضح من الصورة\n\n` +
    `قواعد صارمة جداً حول العيار (karat) — هذا أهم جزء ويُخطئ فيه كثيراً:\n` +
    `- karat هو عيار الذهب (نقاؤه) فقط، وليس نوع الحجر أو المعدن. "ألماس" أو "فضة" ليستا قيماً مسموحة لـ karat إطلاقاً — إن كانت القطعة مرصعة بأحجار بيضاء لامعة، هذا لا علاقة له بالعيار؛ اذكر الأحجار في gemstones وضع karat كعيار الذهب الفعلي (18K أو 21K) بغض النظر عن وجود الأحجار من عدمه.\n` +
    `- أغلب مخزون المحل إما 18K أو 21K — لا يوجد 22K أو 24K أو فضة عملياً. استخدم كل الإشارات المتاحة معاً بدل الاعتماد على لون المعدن وحده (وهو أضعف إشارة فردية، يتأثر بالإضاءة والتصوير كثيراً):\n` +
    `  · اللون: 21K عادة أصفر ذهبي غامق ومشبّع (الأصفر التقليدي المعروف محلياً)، بينما 18K عادة أفتح وأقل تشبعاً، أو يُستخدم غالباً للذهب الأبيض والروز غولد.\n` +
    `  · الطراز: القطع التراثية/الفلكلورية الثقيلة (تصميم مشجّر، عملات، مشغولات يدوية معقدة، أطقم عرايس تقليدية ثقيلة) غالباً 21K في هذا السوق. القطع الخفيفة العصرية بتصميم بسيط أو مرصّعة بأحجار كثيرة صغيرة غالباً 18K.\n` +
    `  · إن تعارضت الإشارات ولم تصل لثقة معقولة من مجموعها، أعد null بدل التخمين العشوائي — null صريح أفضل من قيمة خاطئة بثقة زائفة.\n` +
    `- أعد karat كـ null في حالتين: (أ) القطعة ليست ذهباً أصلاً (فضة أو معدن غير ثمين واضح)، أو (ب) الصورة غير واضحة كفاية أو الإشارات متعارضة فعلاً لدرجة تمنع الوصول لثقة معقولة.\n\n` +
    `قواعد صارمة أخرى — لا تخمّن، صف ما تراه فقط:\n` +
    `- لا تفترض "ألماس" أبداً في gemstones لأي حجر أبيض لامع. أي حجر أبيض/شفاف هو على الأرجح زركون مكعب (CZ) أو حجر صناعي — ` +
    `اذكره في description_ar وgemstones بأنه "أحجار بيضاء لامعة"، وليس "ألماس"، إلا إذا رأيت حجراً واحداً كبيراً بارزاً بوضوح بقطع سوليتير احترافي يوحي فعلاً بألماس حقيقي. لمعان المعدن نفسه (الذهب الأبيض اللامع) ليس دليلاً على وجود أحجار كريمة إطلاقاً — عدم وجود أي حجر ظاهر يعني stone_count: "بدون أحجار" وgemstones: [] حتى لو كانت القطعة لامعة جداً.\n` +
    `- في gemstones، اذكر الألوان الفعلية الظاهرة في الصورة بدقة (مثال: زمردي أخضر، جمشت بنفسجي، ياقوت أحمر، سفير أزرق، سيترين أصفر، فيروزي، لؤلؤ، أبيض/شفاف) — فقط ما تراه فعلياً في هذه الصورة تحديداً، وليس تخميناً عاماً أو قائمة نمطية.\n` +
    `- في style، صف شكل القطعة الفعلي بدقة: أقراط متدلية (شانديلير) أو أقراط ستود صغيرة، عقد قريب من الرقبة (شوكر) أو عقد بسلسلة طويلة نازلة، خاتم كلاستر بعدة أحجار أو خاتم سوليتير بحجر واحد مركزي، أسورة بخط أحجار متصل (تنس) أو أسورة عريضة مزخرفة — حسب ما يظهر فعلياً في هذه الصورة.\n` +
    `- item_type يجب أن يكون النوع المحدد الفعلي (مثلاً "حلق" وليس "مجوهرات")، استنتجه من شكل القطعة نفسها لا من الفئة العامة فقط.\n` +
    `- stone_count وcondition: قيّمهما فقط من الظاهر فعلياً في الصورة، وأعد null عند عدم التأكد بدل التخمين.\n` +
    `- metal_color بحسب اللون الحقيقي الظاهر فعلياً في الصورة: أبيض/روديوم لامع، أصفر ذهبي، أو وردي (روز غولد) — لا تخمّن بناءً على نوع القطعة.\n` +
    `- description_ar: اكتب فقرة غنية بالتفاصيل والكلمات المفتاحية القابلة للبحث لاحقاً — الهدف أن يجد الموظف هذه القطعة بالبحث النصي عن أي من تفاصيلها لاحقاً، وأن تلتقطها خوارزمية "قطع مشابهة" بدقة. اذكر بالترتيب: (1) نوع القطعة وطرازها العام، ` +
    `(2) ألوان الأحجار وأشكالها وترتيبها (مثال: "حجر أخضر زمردي شكل كمثرى في المنتصف محاطاً بأحجار بيضاء لامعة صغيرة")، (3) تفاصيل التصميم المميّزة (مشجّر، هندسي، مجدول، مرصّع، مطفي/لامع، حواف منقوشة…)، ` +
    `(4) الفكرة/الطابع التصميمي العام إن وُجد بوضوح (مثال: طقم بفكرة زهور وأوراق نباتي/حديقة، طقم نجوم وأهلة، طقم حيواني كثعبان أو فراشة أو طاووس، طقم هندسي، طقم كلاسيكي بسيط) — هذا يساعد كثيراً في البحث النصي لاحقاً عن "طقم فيه ورد" أو "شكل نجوم" حتى لو اختلفت الصور شكلاً وزاوية وإضاءة، ` +
    `(5) الطراز التجاري الشهير الأقرب للتصميم إن وُجد تشابه حقيقي واضح فعلاً — من أي دار عالمية مشهورة للمجوهرات والذهب والإكسسوارات الفاخرة، لا تقتصر على قائمة مغلقة (مثل، وليس حصراً: كارتييه Cartier، فان كليف أند أربلز Van Cleef & Arpels، بولغري Bulgari، مسيكا Messika، تيفاني Tiffany، شوبارد Chopard، بوشرون Boucheron، هاري وينستون Harry Winston، غراف Graff، ديور Dior، شانيل Chanel، غوتشي Gucci، بياجيه Piaget). ` +
    `دليل تعرّف بصري سريع على أشهر السمات (استخدمه للمطابقة، لا تفترض الطراز لمجرد وجود عنصر واحد بعيد الشبه): ` +
    `كارتييه — سوار لوف بمسامير/براغي ظاهرة على طول السوار، خاتم/سوار ترينيتي بثلاث حلقات متشابكة بثلاثة ألوان ذهب، طراز باثر (فهد/نمر) برأس حيوان منقوش وعيون حجرية، مسمار جوست أن كلو؛ ` +
    `فان كليف أند أربلز — نقشة ألامبرا المتكررة (ورقة برسيم/نجمة رباعية محاطة بحبة لؤلؤية) على عدة قطع متطابقة في نفس الطقم، تصميم إخفاء وسائد الأحجار (لا يظهر أي معدن حول الحجر)، مواضيع الزهور والفراشات والحظ؛ ` +
    `بولغري — سلسلة سربنتي بشكل ثعبان ملتف حول المعصم/الرقبة برأس أفعى وعينين بارزتين وقشور متتالية، خاتم بي.زيرو1 حلزوني الشكل، ميداليات شبيهة بالعملات الرومانية؛ ` +
    `تيفاني — خاتم خطوبة بستة مخالب (Tiffany Setting) يرفع الحجر عن القاعدة بوضوح، تصميمات بسيطة أنيقة؛ ` +
    `إن ظهرت إحدى هذه السمات بوضوح فعلي في الصورة اذكر الطراز صراحة داخل الوصف (مثال: "بطراز قريب من سلسلة سربنتي لبولغري" أو "بطراز باثر لكارتييه") ليتعرّف الموظف والمدير على القطعة بسرعة عند القراءة أو البحث؛ لا تدّعِ أبداً أن القطعة أصلية من تلك الدار أو مقلَّدة، فقط تشابه التصميم، وإن لم يتضح تشابه حقيقي فلا تذكر أي اسم علامة إطلاقاً، ` +
    `(6) أي طابع أو مناسبة واضحة من التصميم نفسه إن وُجدت (عرايسي/تراثي/يومي/رسمي) بدون تخمين إن لم يتضح. مثال جيد: "طقم عرايسي تراثي ثقيل بتصميم مشجّر مطفي بفكرة زهور وأوراق، مرصّع بأحجار خضراء زمردية بيضاوية الشكل وأحجار بيضاء لامعة صغيرة محيطة، حواف مذهّبة منقوشة يدوياً، بطراز قريب من تصاميم بولغري الكلاسيكية" — ` +
    `وليس وصفاً عاماً نمطياً مثل "أقراط ألماس فاخرة".` +
    calibration
  );
}

// ============================================================
// معايرة العيار من مخزون حقيقي — "دع الذكاء الاصطناعي يتعلّم" مما رُفع فعلاً بلا أي بنية
// تدريب/fine-tuning (غير متاحة على الخطة المجانية): نجلب عيّنة من آخر قطع حقيقية (وزنها
// معروف فعلياً، لا صور تجريبية) وأعيدها كأمثلة نصية داخل الـ prompt نفسه (few-shot من بيانات
// المحل الفعلية) — كل تحليل جديد "يرى" أحدث ما أدخله الموظفون فعلياً بدل الاعتماد على
// افتراضات عامة عن السوق فقط. تُخزَّن مؤقتاً 5 دقائق لتفادي استعلام قاعدة بيانات على كل صورة.
// ============================================================
let karatCalibrationCache: { text: string; expires: number } | null = null;
const KARAT_CALIBRATION_TTL_MS = 5 * 60 * 1000;

async function buildKaratCalibrationBlock(): Promise<string> {
  if (karatCalibrationCache && karatCalibrationCache.expires > Date.now()) return karatCalibrationCache.text;
  try {
    const admin = getAdminClient();
    const { data } = await admin
      .from("products")
      .select("name, karat, weight_grams, item_type")
      .not("karat", "is", null)
      .not("weight_grams", "is", null)
      .order("created_at", { ascending: false })
      .limit(10);
    const rows = (data ?? []) as { name: string; karat: string; weight_grams: number; item_type: string | null }[];
    let text = "";
    if (rows.length) {
      const lines = rows
        .map((r) => `  · ${r.item_type ?? "قطعة"} "${r.name}" — الوزن الفعلي ${r.weight_grams}غ — العيار الفعلي المؤكد: ${r.karat}`)
        .join("\n");
      text =
        `\n\nأمثلة حقيقية مؤكدة من مخزون هذا المحل تحديداً (وزن وعيار فعليَّين وليسا تخميناً)، استخدمها كمرجع تعرّف على أسلوب هذا المحل تحديداً في ربط الوزن/الطراز بالعيار — ليست قاعدة مطلقة تنطبق حرفياً على كل قطعة، بل مؤشر على النمط الغالب في هذا المخزون بالذات:\n${lines}`;
    }
    karatCalibrationCache = { text, expires: Date.now() + KARAT_CALIBRATION_TTL_MS };
    return text;
  } catch (e) {
    console.warn("karat calibration fetch failed (non-fatal)", e);
    return "";
  }
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

// ============================================================
// مهم جداً — سبب أخطاء "تجاوزت الحصة" المتكرّرة سابقاً: كنا نستدعي الاسم المستعار
// "gemini-flash-latest" الذي يشير دائماً لأحدث موديل (كان وقتها gemini-3.8-flash)، وجوجل
// تمنح أحدث الموديلات حصة مجانية ضئيلة جداً — 20 طلباً/يوم فقط لا 1500 كما هو شائع عن
// موديلات flash المستقرّة. تأكّدنا من ذلك من سجلات الدالة نفسها:
//   "Quota exceeded ... limit: 20, model: gemini-3.8-flash"
//   quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier
// الحل: تثبيت موديلات محدّدة مستقرّة والتنقّل بينها بالترتيب عند نفاد حصة كل واحد — الأدق
// أولاً ثم الأوفر حصةً، بدل الفشل كلياً بمجرد نفاد حصة موديل واحد. الحصص لكل موديل على
// حدة (per-model quota) فالتنقّل يضاعف الطاقة اليومية المتاحة فعلياً.
const GEMINI_VISION_MODELS = [
  "gemini-2.5-flash", // دقة عالية للنصوص الصغيرة والوسوم — الخيار الأول
  "gemini-2.5-flash-lite", // حصة يومية أوفر، دقة أقل قليلاً — عند نفاد الأول
  "gemini-3.1-flash-lite", // بديل حديث بحصة معقولة
  "gemini-flash-latest", // أحدث موديل (حصة ضئيلة 20/يوم) — ملاذ أخير فقط
];

// ============================================================
// Gemini structured output (responseSchema) — بدل الاعتماد فقط على وصف شكل الـJSON
// نصياً داخل الـ prompt. جوجل توصي صراحةً بهذا: تقييد الحقول المصنَّفة (karat, metal_color…)
// بـ enum يمنع النموذج تركيبياً من إرجاع قيمة خارج القائمة المسموحة — وهذا فعلياً منع خطأً
// حقيقياً رصدناه في الإنتاج: النموذج أرجع karat:"ألماس" لقطعة واحدة رغم تحذير نصّي صريح في
// الـ prompt بعدم فعل ذلك (نص وحده لم يمنعه، الالتزام التركيبي بـenum يمنعه فعلياً).
// راجع: https://ai.google.dev/gemini-api/docs/structured-output
// ============================================================
const KARAT_ENUM = ["18K", "21K"];
const METAL_COLOR_ENUM = ["yellow", "white", "rose", "mixed"];
const STONE_COUNT_ENUM = ["بدون أحجار", "حجر واحد", "عدة أحجار"];
const CONDITION_ENUM = ["جديدة", "مستعملة بحالة جيدة", "بها خدوش/تلف ظاهر"];

/** الحقول المشتركة لكل تحليل قطعة مفردة — تُستخدم في تحليل المفرد وداخل عناصر الصينية/الدفعة. */
function itemSchemaProperties(): Record<string, unknown> {
  return {
    name_ar: { type: "STRING" },
    category_name: { type: "STRING", nullable: true },
    item_type: { type: "STRING", nullable: true },
    metal_color: { type: "STRING", enum: METAL_COLOR_ENUM, nullable: true },
    karat: { type: "STRING", enum: KARAT_ENUM, nullable: true },
    style: { type: "ARRAY", items: { type: "STRING" } },
    gemstones: { type: "ARRAY", items: { type: "STRING" } },
    stone_count: { type: "STRING", enum: STONE_COUNT_ENUM, nullable: true },
    condition: { type: "STRING", enum: CONDITION_ENUM, nullable: true },
    description_ar: { type: "STRING" },
  };
}
const ITEM_PROPERTY_ORDER = [
  "name_ar", "category_name", "item_type", "metal_color", "karat",
  "style", "gemstones", "stone_count", "condition", "description_ar",
];

// كل الحقول إلزامية عمداً (لا فقط name_ar/description_ar) — لاحظنا في اختبار مباشر أن
// جوجل تُسقط الحقول غير الإلزامية كلياً من الاستجابة (لا حتى null/[]) عندما لا تكون واثقة
// منها، فيغيب gemstones/style/stone_count/condition/metal_color بالكامل من الرد. جعلها
// إلزامية يجبر النموذج على إرجاعها دائماً (null أو [] عند عدم الوضوح)، مطابقاً للسلوك
// الأصلي القائم على النص فقط قبل إضافة responseSchema.
const SINGLE_ITEM_SCHEMA = {
  type: "OBJECT",
  properties: itemSchemaProperties(),
  required: ITEM_PROPERTY_ORDER,
  propertyOrdering: ITEM_PROPERTY_ORDER,
};

const TRAY_SCHEMA = {
  type: "OBJECT",
  properties: {
    pieces: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          position: { type: "STRING" },
          bbox: {
            type: "OBJECT",
            properties: {
              x: { type: "NUMBER" },
              y: { type: "NUMBER" },
              w: { type: "NUMBER" },
              h: { type: "NUMBER" },
            },
            required: ["x", "y", "w", "h"],
          },
          ...itemSchemaProperties(),
        },
        required: ["position", "bbox", ...ITEM_PROPERTY_ORDER],
        propertyOrdering: ["position", "bbox", ...ITEM_PROPERTY_ORDER],
      },
    },
  },
  required: ["pieces"],
};

const TAG_SCHEMA = {
  type: "OBJECT",
  properties: {
    barcode: { type: "STRING", nullable: true },
    branch_code: { type: "STRING", nullable: true },
    karat_raw: { type: "STRING", nullable: true },
    type_raw: { type: "STRING", nullable: true },
    weight_grams: { type: "NUMBER", nullable: true },
  },
  propertyOrdering: ["barcode", "branch_code", "karat_raw", "type_raw", "weight_grams"],
};

const BATCH_SCHEMA = {
  type: "OBJECT",
  properties: {
    results: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          index: { type: "INTEGER" },
          ...itemSchemaProperties(),
        },
        required: ["index", ...ITEM_PROPERTY_ORDER],
        propertyOrdering: ["index", ...ITEM_PROPERTY_ORDER],
      },
    },
  },
  required: ["results"],
};

async function geminiGenerate(params: {
  key: string;
  model: string;
  systemPrompt: string;
  parts: unknown[];
  maxOutputTokens?: number;
  responseSchema?: unknown;
}): Promise<string> {
  const { key, model, systemPrompt, parts, maxOutputTokens, responseSchema } = params;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseMimeType: "application/json",
          ...(responseSchema ? { responseSchema } : {}),
          temperature: 0.2,
          ...(maxOutputTokens ? { maxOutputTokens } : {}),
        },
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    console.error("Gemini error", model, res.status, text.slice(0, 400));
    // عند 429 تُرفق جوجل الحصة الفعلية للموديل نفسه في الجسم (quotaValue) — نلتقطها
    // ونحفظها كحصة معروفة بدل تخمينها، بعد أن أخطأنا سابقاً بافتراض 1500/يوم للجميع
    // بينما كانت 20/يوم فقط لموديل معيّن. راجع getGeminiModelUsageSnapshot أدناه.
    if (res.status === 429) {
      const m = text.match(/"quotaValue"\s*:\s*"(\d+)"/);
      if (m) await learnGeminiModelLimit(model, parseInt(m[1], 10));
    }
    throw Object.assign(new Error(text || `Gemini ${res.status}`), { status: res.status });
  }

  await recordGeminiModelUsage(model);
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
}

// تتبّع استهلاك كل موديل Gemini على حدة (بدل عدّاد واحد مضلِّل باسم "gemini") في قاعدة
// البيانات مباشرة — الحصة المجانية تختلف جذرياً بين الموديلات (اكتشفنا هذا مباشرة من
// خطأ 429 حقيقي: 20 طلباً/يوم لموديل جديد مقابل مئات لموديل مستقر). الحد الأقصى المعروض
// هنا مُتعلَّم من استجابة جوجل الفعلية عند أول 429 نمرّ به لكل موديل، لا رقم مُخمَّن —
// يبقى null حتى نصطدم بالحد فعلياً. best-effort دائماً: فشل التسجيل لا يُفشل التحليل.
async function recordGeminiModelUsage(model: string) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    await getAdminClient().rpc("increment_ai_usage", { p_model: model, p_day: today });
  } catch (e) {
    console.warn("usage record failed (non-fatal)", e);
  }
}

async function learnGeminiModelLimit(model: string, quotaValue: number) {
  try {
    await getAdminClient()
      .from("ai_model_limits")
      .upsert({ model, limit_value: quotaValue, updated_at: new Date().toISOString() } as any, { onConflict: "model" });
  } catch (e) {
    console.warn("limit record failed (non-fatal)", e);
  }
}

export async function getGeminiModelUsageSnapshot(): Promise<Record<string, { used: number; limit: number | null }>> {
  const today = new Date().toISOString().slice(0, 10);
  const out: Record<string, { used: number; limit: number | null }> = {};
  for (const model of GEMINI_VISION_MODELS) out[model] = { used: 0, limit: null };

  try {
    const admin = getAdminClient();
    const [{ data: usageRows }, { data: limitRows }] = await Promise.all([
      admin.from("ai_usage_daily").select("model, used").eq("day", today),
      admin.from("ai_model_limits").select("model, limit_value"),
    ]);
    for (const row of (usageRows ?? []) as any[]) {
      if (out[row.model]) out[row.model].used = row.used;
    }
    for (const row of (limitRows ?? []) as any[]) {
      if (out[row.model]) out[row.model].limit = row.limit_value;
    }
  } catch (e) {
    console.warn("usage snapshot read failed (non-fatal)", e);
  }
  return out;
}

function parseGeminiJson(rawText: string): any {
  try {
    return JSON.parse(rawText);
  } catch {
    const m = rawText.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("Gemini returned invalid JSON");
  }
}

/**
 * Direct Gemini vision call (uses GOOGLE_API_KEY or GEMINI_API_KEY).
 * يجرّب موديلات GEMINI_VISION_MODELS بالترتيب: ينتقل للتالي فوراً عند 429 (نفاد حصة هذا
 * الموديل تحديداً)، ويعيد المحاولة على نفس الموديل عند أخطاء 5xx العابرة فقط.
 */
export async function analyzeJewelryImageGemini(params: {
  imageBase64: string;
  mimeType: string;
  categoryNames: string[];
  promptOverride?: string;
  responseSchema?: unknown;
}): Promise<any> {
  const raw = Deno.env.get("GOOGLE_API_KEY") ?? Deno.env.get("GEMINI_API_KEY") ?? "";
  const key = raw.trim().replace(/^["']|["']$/g, "");
  if (!key) throw Object.assign(new Error("GEMINI_API_KEY not set"), { status: 500 });

  const { imageBase64, mimeType, categoryNames } = params;
  const catList = categoryNames.length
    ? categoryNames.join("، ")
    : "خاتم، سلسلة، أسوارة، حلق، طقم، تعليقة، خلخال، دبلة";
  const systemPrompt = params.promptOverride ?? buildSystemPrompt(catList);
  const responseSchema = params.responseSchema ?? SINGLE_ITEM_SCHEMA;
  const parts = [
    { text: "حلّل هذه القطعة وأعد JSON فقط." },
    { inlineData: { mimeType, data: imageBase64 } },
  ];

  let lastErr: unknown = null;
  for (const model of GEMINI_VISION_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const rawText = await geminiGenerate({ key, model, systemPrompt, parts, responseSchema });
        console.log("Gemini used model:", model);
        return parseGeminiJson(rawText);
      } catch (e) {
        lastErr = e;
        const status = (e as any)?.status ?? 500;
        // 429 = حصة هذا الموديل نفدت: لا فائدة من إعادة المحاولة عليه، ننتقل للتالي فوراً.
        if (status === 429) break;
        // مفتاح غير صالح: لا فائدة من أي موديل آخر.
        if (status === 401 || status === 403) throw e;
        if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
      }
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
  promptOverride?: string;
}): Promise<{ analysis: JewelryAnalysis; provider: string; usage: Record<string, { used: number; limit: number }> }> {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(params.imageBase64.trim());
  if (m) params = { ...params, mimeType: m[1], imageBase64: m[2] };
  params = { ...params, imageBase64: params.imageBase64.replace(/\s/g, "") };
  if (!params.imageBase64) {
    throw Object.assign(new Error("الصورة فارغة أو غير صالحة"), { status: 400 });
  }

  // نبني الـ prompt مرة واحدة هنا (بدل أن يبنيه كل مزوّد بمفرده) فنضمن اتساقاً بين
  // Gemini/Groq/OpenRouter ونجلب أمثلة المعايرة الحقيقية من الاستعلام مرة واحدة فقط،
  // لا مرة لكل مزوّد. راجع buildKaratCalibrationBlock أدناه.
  if (!params.promptOverride) {
    const catList = params.categoryNames.length
      ? params.categoryNames.join("، ")
      : "خاتم، سلسلة، أسوارة، حلق، طقم، تعليقة، خلخال، دبلة";
    const calibration = await buildKaratCalibrationBlock();
    params = { ...params, promptOverride: buildSystemPrompt(catList, calibration) };
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
        ? "انتهت الحصة المجانية اليومية لكل مزوّدات التحليل (Gemini بموديلاته المتعددة، Groq، OpenRouter). تُعاد الحصص تلقائياً بعد منتصف الليل بتوقيت غرينتش."
        : status === 429
        ? "كل مزودات الذكاء الاصطناعي المجانية مشغولة الآن (OpenRouter/Groq/Gemini) — أعد المحاولة بعد قليل."
        : `فشل تحليل الصورة: ${(lastErr as Error)?.message ?? "خطأ غير معروف"}`,
    ),
    { status },
  );
}

// gemini-embedding-2 نموذج متعدد الوسائط حقيقي — يضع النص والصورة في نفس فضاء المتجهات
// (1536 بُعداً هنا عبر outputDimensionality لمطابقة عمود ai_embedding الحالي دون أي
// تعديل على قاعدة البيانات). كان النظام سابقاً يُضمّن نص الوصف الذي تكتبه الذكاء
// الاصطناعي عن الصورة (gemini-embedding-001، نص فقط) بدل الصورة نفسها — فحصنا هذا فعلياً
// عبر استدعاءات مباشرة: قطعتان مختلفتا الشكل واللون كانتا تحصلان على نص وصف متشابه
// (كلاهما "طقم ذهب مرصّع بأحجار") فتتشابهان بنسبة 90%+ في البحث رغم اختلافهما بصرياً
// تماماً. مع embedImage (بصمة الصورة الفعلية) اتضح فارق حقيقي بين القطعة الصحيحة
// والخاطئة (0.82 مقابل 0.75) بدل تشابه زائف (96% مقابل 91%). التبديل شامل: الفهرسة
// (صورة القطعة عند الرفع) والبحث بالصورة يستخدمان embedImage، والبحث النصي المكتوب يبقى
// يستخدم embedText — وبما أنهما نفس النموذج الآن، مقارنتهما ببعض عبر pgvector صحيحة
// دلالياً (بحث نصي عن "أحجار زرقاء" يُطابق فعلياً صور القطع الزرقاء لا وصفها النصي فقط).
async function embedContentV2(
  content: { text: string } | { inlineData: { mimeType: string; data: string } },
): Promise<number[]> {
  const gkey = (Deno.env.get("GOOGLE_API_KEY") ?? Deno.env.get("GEMINI_API_KEY") ?? "")
    .trim()
    .replace(/^["']|["']$/g, "");

  if (!gkey) {
    throw Object.assign(
      new Error("لا يمكن إنشاء بصمة البحث: مفتاح GOOGLE_API_KEY غير مضبوط (أضفه من إعدادات المشروع)."),
      { status: 500 },
    );
  }

  const part =
    "text" in content
      ? { text: content.text }
      : { inline_data: { mime_type: content.inlineData.mimeType, data: content.inlineData.data } };

  let lastStatus = 500;
  let lastText = "";

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-goog-api-key": gkey },
        body: JSON.stringify({
          content: { parts: [part] },
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

/** بصمة نص — تُستخدم للبحث النصي المكتوب (تبقى بنفس فضاء بصمات الصور أدناه). */
export async function embedText(text: string): Promise<number[]> {
  const input = (text || "").trim().slice(0, 8000) || "قطعة مجوهرات";
  return embedContentV2({ text: input });
}

/** بصمة صورة حقيقية (لا وصف نصي عنها) — أساس الفهرسة والبحث بالصورة الآن. */
export async function embedImage(imageBase64: string, mimeType: string): Promise<number[]> {
  const clean = imageBase64.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  return embedContentV2({ inlineData: { mimeType, data: clean } });
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
          "انتهت الحصة المجانية اليومية لكل مزوّدات التحليل. تُعاد الحصص تلقائياً بعد منتصف الليل بتوقيت غرينتش.",
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
function buildTraySystemPrompt(catList: string, calibration = ""): string {
  return (
    `أنت خبير مجوهرات عربي دقيق الملاحظة. الصورة تحتوي عدة قطع مجوهرات معروضة معاً (صينية/علبة عرض).\n` +
    `افصل كل قطعة مستقلة وأعد JSON فقط بهذا الشكل بالضبط بدون أي نص إضافي:\n` +
    `{"pieces":[{"position":"أعلى يمين","bbox":{"x":0,"y":0,"w":0,"h":0},"name_ar":"...","category_name":"...","item_type":"...","karat":null,"metal_color":"yellow","style":[],"gemstones":[],"stone_count":null,"condition":null,"description_ar":"..."}]}\n\n` +
    `- position: وصف مكان القطعة في الصورة بالعربية (أعلى يمين، وسط، أسفل يسار…) حتى يتعرّف عليها الموظف.\n` +
    `- bbox: مستطيل يحيط بالقطعة فقط (بدون هامش زائد)، بمقياس صحيح من 0 إلى 1000 نسبةً لأبعاد الصورة الكاملة (وليس 0 إلى 1، ` +
    `وليس بكسل فعلي): x وy هما ركن المستطيل العلوي الأيسر، وw وh هما العرض والارتفاع، وكل القيم أعداد صحيحة بين 0 و1000. ` +
    `مثال: قطعة تشغل الربع العلوي الأيمن تماماً تُعطى تقريباً {"x":500,"y":0,"w":500,"h":500}. يجب أن يحيط المستطيل بالقطعة كاملة بإحكام دون قطع أي جزء منها ودون ضم قطعة مجاورة — كن دقيقاً خصوصاً في الحافة السفلية للمستطيل: لا تمتد h إلى ما بعد آخر نقطة ظاهرة من القطعة نفسها (لا إلى قاعدة الحامل/المانيكان الذي تُعرض عليه ولا إلى القطعة الأخرى تحته إن وُجدت). هذا الحقل إلزامي دائماً ولا يجوز إغفاله أو إرجاعه null.\n` +
    `- لا تدمج قطعتين في سجل واحد، ولا تُكرّر نفس القطعة. الطقم المتكامل (عقد+حلق+خاتم معروضة كطقم واحد) سجل واحد فئته "طقم".\n` +
    `- item_type: النوع الدقيق للقطعة بالعربية (خاتم، سلسلة، أسوارة، حلق، تعليقة، خلخال، دبلة، طقم، بروش) أو null إن لم يتضح.\n` +
    `- karat: 18K أو 21K فقط (عيار الذهب — لا علاقة له بالأحجار)، أو null. أغلب المخزون 18K أو 21K: ` +
    `21K عادة أصفر ذهبي غامق ومشبّع، و18K أفتح أو أبيض/روز غولد — حدد أحدهما من لون المعدن بدل إرجاع null مباشرة، ` +
    `ولا تضع "ألماس" أو "فضة" هنا أبداً حتى لو كانت مرصعة بأحجار.\n` +
    `- metal_color: yellow, white, rose, mixed, null بحسب اللون الفعلي الظاهر.\n` +
    `- stone_count: بدون أحجار، حجر واحد، عدة أحجار، أو null إن لم يتضح.\n` +
    `- condition: جديدة، مستعملة بحالة جيدة، بها خدوش/تلف ظاهر، أو null إن لم يتضح من الصورة.\n` +
    `- category_name يطابق واحدة من: ${catList} أو null.\n` +
    `- لا تفترض "ألماس" لأي حجر أبيض لامع — اذكره "أحجار بيضاء لامعة" إلا إذا كان حجراً كبيراً بقطع سوليتير واضح. لمعان المعدن نفسه ليس دليل وجود أحجار.\n` +
    `- description_ar يذكر ألوان الأحجار الفعلية وتفاصيل التصميم الظاهرة في هذه القطعة تحديداً، لا وصفاً عاماً. اذكر أيضاً الفكرة التصميمية العامة إن وُجدت (زهور/نباتي، نجوم وأهلة، حيواني، هندسي…) ` +
    `والطراز التجاري الأقرب من أي دار عالمية مشهورة للمجوهرات إن وُجد تشابه حقيقي واضح (مثل كارتييه، فان كليف أند أربلز، بولغري، مسيكا، تيفاني، شوبارد، بوشرون، هاري وينستون، وغيرها) — تشابه تصميم فقط بلا ادّعاء أصالة، وبدون ذكر أي اسم إن لم يتضح تشابه فعلي.` +
    calibration
  );
}

// ============================================================
// تحليل «دفعة»: عدة صور منفصلة (كل صورة قطعة مستقلة) في طلب واحد لكل مزوّد.
// يُستخدم من طابور المعالجة الخلفي (pg_cron) بدل استدعاء منفصل لكل صورة —
// يقلّل عدد الطلبات بمقدار حجم الدفعة (مثلاً 4 صور = طلب واحد بدل 4)، فيريح
// حصة الدقيقة عند Gemini/Groq بشكل مباشر دون الحاجة لتعدد مزوّدين أكثر.
// ============================================================
function buildBatchSystemPrompt(catList: string, count: number, calibration = ""): string {
  return (
    `أنت خبير مجوهرات عربي دقيق الملاحظة. ستستلم ${count} صورة، كل صورة تخص قطعة مجوهرات ` +
    `منفصلة تماماً عن البقية (وليست عدة قطع في نفس الصورة). حلّل كل صورة بشكل مستقل تماماً ` +
    `عن غيرها وأعد JSON فقط بهذا الشكل بالضبط بدون أي نص إضافي:\n` +
    `{"results":[{"index":1,"name_ar":"...","category_name":"...","item_type":"...","karat":null,"metal_color":"yellow","style":[],"gemstones":[],"stone_count":null,"condition":null,"description_ar":"..."}]}\n\n` +
    `- index يطابق رقم ترتيب الصورة كما وردت (1 هي الصورة الأولى، 2 الثانية، وهكذا) — ` +
    `يجب أن تعيد بالضبط ${count} عنصراً بنفس هذا الترتيب، عنصر واحد لكل صورة.\n` +
    `- القيم المسموحة: karat: 18K أو 21K فقط (عيار الذهب، لا علاقة له بالأحجار) أو null — metal_color: yellow, white, rose, mixed, null — ` +
    `category_name يطابق واحدة من: ${catList} أو null.\n` +
    `- أغلب المخزون 18K أو 21K: 21K عادة أصفر ذهبي غامق ومشبّع، و18K أفتح أو أبيض/روز غولد — حدد أحدهما من لون المعدن بدل إرجاع null مباشرة. لا تضع "ألماس" أو "فضة" في karat أبداً حتى لو كانت القطعة مرصعة بأحجار.\n` +
    `- لا تفترض "ألماس" لأي حجر أبيض لامع — اذكره "أحجار بيضاء لامعة" إلا إذا كان حجراً كبيراً بقطع سوليتير واضح. لمعان المعدن نفسه ليس دليل وجود أحجار.\n` +
    `- description_ar يذكر الألوان الفعلية وتفاصيل التصميم الظاهرة في هذه الدفعة تحديداً بدون خلطها بقطعة أخرى في الدفعة. اذكر الفكرة التصميمية العامة إن وُجدت (زهور/نباتي، نجوم، حيواني، هندسي…) ` +
    `والطراز التجاري الأقرب من أي دار عالمية مشهورة للمجوهرات إن وُجد تشابه حقيقي واضح (مثل كارتييه، فان كليف أند أربلز، بولغري، مسيكا، تيفاني، شوبارد، بوشرون، هاري وينستون، وغيرها) — تشابه تصميم فقط بلا ادّعاء أصالة، وبلا ذكر اسم إن لم يتضح تشابه فعلي.` +
    calibration
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

  // نفس منطق التنقّل بين الموديلات المستخدم في التحليل المفرد — الحصة المجانية لكل موديل
  // على حدة، فنفاد حصة موديل لا يعني نفاد Gemini كلها.
  let lastErr: unknown = null;
  for (const model of GEMINI_VISION_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const rawText = await geminiGenerate({ key, model, systemPrompt, parts, maxOutputTokens: 4000, responseSchema: BATCH_SCHEMA });
        console.log("Gemini batch used model:", model);
        return parseBatchResponse(rawText, images);
      } catch (e) {
        lastErr = e;
        const status = (e as any)?.status ?? 500;
        if (status === 429) break; // حصة هذا الموديل نفدت — انتقل للتالي
        if (status === 401 || status === 403) throw e;
        if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
      }
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
  const calibration = await buildKaratCalibrationBlock();
  const systemPrompt = buildBatchSystemPrompt(catList, images.length, calibration);

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
  const calibration = await buildKaratCalibrationBlock();
  const promptOverride = buildTraySystemPrompt(catList, calibration);
  const args = { ...params, promptOverride, responseSchema: TRAY_SCHEMA };

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

// ============================================================
// قراءة وسم القطعة الورقي (باركود + بيانات مطبوعة: فرع/عيار/نوع/وزن) — يُستخدم في صفحة
// "الإضافة المباشرة" لقراءة الوجهين الاثنين للوسم بالكاميرا بدل الكتابة اليدوية.
// يعمل على أي من الوجهين بصورة واحدة: وجه الباركود (يُعيد الرقم المطبوع أسفل الأعمدة
// كنص احتياطي إن تعذّر على BarcodeDetector في المتصفح قراءته)، أو وجه البيانات
// (BRANCH/KARAT/TYPE/WEIGHT) — الحقول غير الظاهرة في الصورة تُعاد null.
// ============================================================
export type TagInfo = {
  barcode: string | null;
  branch_code: string | null;
  karat_raw: string | null;
  type_raw: string | null;
  weight_grams: number | null;
};

function buildTagSystemPrompt(): string {
  return (
    `أنت تقرأ وسماً ورقياً صغيراً ملصقاً على قطعة مجوهرات في محل ذهب. الوسم قد يُصوَّر من أحد وجهين مختلفين:\n` +
    `- وجه الباركود: خطوط باركود مع رقم مطبوع أسفلها (مثال: 01002717) وربما رمز حروف قصير فوقه (مثال: HPJ 1).\n` +
    `- وجه البيانات: نص مطبوع بخط نقطي بتنسيق "BRANCH :" و"KARAT :" و"TYPE :" و"WEIGHT :" يليه قيمة كل حقل.\n\n` +
    `اقرأ ما هو ظاهر فعلياً في هذه الصورة تحديداً فقط وأعد JSON فقط بهذا الشكل بالضبط بدون أي نص إضافي:\n` +
    `{"barcode":null,"branch_code":null,"karat_raw":null,"type_raw":null,"weight_grams":null}\n\n` +
    `قواعد:\n` +
    `- barcode: الرقم المطبوع أسفل خطوط الباركود فقط (أرقام فقط عادة)، أو null إن لم يظهر وجه الباركود في الصورة.\n` +
    `- branch_code: القيمة بعد "BRANCH :" كما هي (مثال: "01")، أو null إن لم تظهر.\n` +
    `- karat_raw: القيمة بعد "KARAT :" كما هي بالضبط بدون تعديل (مثال: "18KB")، أو null إن لم تظهر.\n` +
    `- type_raw: القيمة بعد "TYPE :" كما هي (مثال: "FS")، أو null إن لم تظهر.\n` +
    `- weight_grams: القيمة الرقمية بعد "WEIGHT :" فقط كرقم عشري (مثال: 94.90)، أو null إن لم تظهر.\n` +
    `- لا تخمّن أي قيمة غير ظاهرة بوضوح في الصورة — أعدها null بدل التخمين.`
  );
}

export async function analyzeTagWithFallback(params: {
  imageBase64: string;
  mimeType: string;
}): Promise<{ tag: TagInfo; provider: string }> {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(params.imageBase64.trim());
  let p = params;
  if (m) p = { ...p, mimeType: m[1], imageBase64: m[2] };
  p = { ...p, imageBase64: p.imageBase64.replace(/\s/g, "") };
  if (!p.imageBase64) throw Object.assign(new Error("الصورة فارغة أو غير صالحة"), { status: 400 });

  const promptOverride = buildTagSystemPrompt();
  const args = { imageBase64: p.imageBase64, mimeType: p.mimeType, categoryNames: [], promptOverride, responseSchema: TAG_SCHEMA };

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

  const markFail = (name: string, e: unknown) => console.warn(`Tag provider ${name} failed [${(e as any)?.status ?? 500}]`);

  let lastErr: unknown = null;
  for (let pass = 0; pass < 2; pass++) {
    if (pass > 0) await new Promise((r) => setTimeout(r, 1000));
    try {
      const { result, provider } = await hedgedRace(providers, markFail);
      recordUsage(provider);
      const tag: TagInfo = {
        barcode: result?.barcode ? String(result.barcode).trim() : null,
        branch_code: result?.branch_code ? String(result.branch_code).trim() : null,
        karat_raw: result?.karat_raw ? String(result.karat_raw).trim() : null,
        type_raw: result?.type_raw ? String(result.type_raw).trim() : null,
        weight_grams: typeof result?.weight_grams === "number" ? result.weight_grams : (parseFloat(result?.weight_grams) || null),
      };
      return { tag, provider };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? Object.assign(new Error("كل المزوّدات مشغولة الآن — أعد المحاولة."), { status: 429 });
}
