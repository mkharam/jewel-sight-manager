// مُعالج طابور التحليل الخلفي — يُستدعى دورياً عبر pg_cron (وليس من المتصفح مباشرة).
// يسحب دفعة صغيرة من الصور غير المحلّلة (قطع باسمها الافتراضي "قطعة جديدة" وبدون ai_labels)
// ويحلّلها في طلب واحد لكل مزوّد (بدل طلب منفصل لكل صورة) — هذا يقلّل عدد الطلبات الفعلية
// بمقدار حجم الدفعة، فيريح حصة الدقيقة المحدودة عند Gemini/Groq بدل الاعتماد على توازي
// عميل المتصفح (كان هشّاً ومربوطاً بإغلاق التبويب وصعب ضبط سرعته بأمان).
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { analyzeBatchWithFallback, embedImage, type JewelryAnalysis } from "../_shared/lovable-ai.ts";

const BATCH_SIZE = 4;
const PLACEHOLDER_NAME = "قطعة جديدة";

// نفس منطق استنتاج لون ونوع الحجر القياسيَّين الموجود في src/lib/uploadRunner.ts (مسار الرفع
// الفوري) — بدونه يبقى جدول product_stones فارغاً لهذا المسار الاحتياطي، ففلتر "لون الحجر" لا
// يُطابق القطع التي حُلّلت عبر الطابور الخلفي بدل التحليل الفوري. stone_type عمود إلزامي في
// الجدول فنُعيد "أخرى" حين لا نستطيع تحديد النوع بثقة.
// كل لون له صيغتان بالعربية (مذكر/مؤنث) لا تشتركان بجذر مطابقة نصي — "أحجار زرقاء" شائعة
// بقدر "حجر أزرق"، ونص gemstones يستخدم غالباً "أحجار" (مؤنث) فتغيب الصيغة المؤنثة كلياً بدونها.
const STONE_COLOR_KEYWORDS: [string, string, string][] = [
  ["ابيض", "white", "زركون"], ["بيضاء", "white", "زركون"], ["شفاف", "white", "زركون"],
  ["احمر", "red", "ياقوت"], ["حمراء", "red", "ياقوت"], ["روبي", "red", "ياقوت"],
  ["اخضر", "green", "زمرد"], ["خضراء", "green", "زمرد"], ["زمرد", "green", "زمرد"],
  ["ازرق", "blue", "سفير"], ["زرقاء", "blue", "سفير"], ["سفير", "blue", "سفير"], ["صفير", "blue", "سفير"],
  ["اصفر", "yellow", "سيترين"], ["صفراء", "yellow", "سيترين"], ["سيترين", "yellow", "سيترين"],
  ["وردي", "pink", "أخرى"], ["زهري", "pink", "أخرى"], ["روز", "pink", "أخرى"],
  ["جمشت", "purple", "جمشت"], ["بنفسجي", "purple", "جمشت"], ["موف", "purple", "جمشت"], ["ارجواني", "purple", "جمشت"],
  ["فيروز", "turquoise", "فيروز"], ["تركواز", "turquoise", "فيروز"],
  // normalizeArLite يحوّل "ؤ" إلى "و"، فـ"لؤلؤ" تصبح "لولو" بعد التطبيع — الكلمة هنا بصيغتها بعد التطبيع.
  ["لولو", "pearl", "لؤلؤ"], ["لولي", "pearl", "لؤلؤ"],
  ["اسود", "black", "أخرى"], ["سوداء", "black", "أخرى"],
];

function normalizeArLite(input: string): string {
  return (input || "")
    .toLowerCase()
    .replace(/[ً-ْٰۖ-ۭ]/g, "")
    .replace(/ـ/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[ىئي]/g, "ي")
    .replace(/[ؤ]/g, "و")
    .replace(/ة/g, "ه");
}

function detectStoneColors(gemstones: string[] | undefined): { color: string; stoneType: string }[] {
  const found = new Map<string, string>();
  for (const g of gemstones ?? []) {
    const norm = normalizeArLite(g);
    for (const [kw, color, stoneType] of STONE_COLOR_KEYWORDS) {
      if (norm.includes(kw) && !found.has(color)) found.set(color, stoneType);
    }
  }
  return Array.from(found, ([color, stoneType]) => ({ color, stoneType }));
}

// الدالة verify_jwt=false لأن pg_cron لا يملك JWT مستخدم، فنتحقق من المستدعي هنا بأحد طريقين:
//  1) سرّ الطابور من Vault — هذا مسار pg_cron.
//  2) JWT مستخدم مسجّل دخول — هذا مسار المتصفح بعد رفع دفعة صور (شبكة أمان فورية).
// المهم أن يبقى مغلقاً أمام الغرباء كي لا تُستهلك حصص الذكاء الاصطناعي المجانية عبثاً.
// كان الفحص سابقاً يقارن بمتغيّر بيئة QUEUE_SECRET لم يُضبط أصلاً، فكان كل نداء — من الـ cron
// ومن المتصفح — يرجع 401 بصمت؛ راجع migration 20260910030000 للتفاصيل.
async function isAuthorized(req: Request, admin: ReturnType<typeof createClient>): Promise<boolean> {
  const queueSecret = req.headers.get("x-queue-secret");
  if (queueSecret) {
    const { data } = await admin.rpc("verify_internal_secret", {
      _name: "analysis_queue_secret",
      _value: queueSecret,
    });
    if (data === true) return true;
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    const { data } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
    if (data?.user) return true;
  }

  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (!(await isAuthorized(req, admin))) {
    return json({ error: "unauthorized" }, 401);
  }

  try {
    // صور بانتظار التحليل: قطعتها ما زالت بالاسم الافتراضي ولم تُحلّل بعد.
    const { data: pending, error: qErr } = await admin
      .from("product_images")
      .select("id, storage_path, product_id, products!inner(id, name, karat)")
      .is("ai_labels", null)
      .eq("products.name", PLACEHOLDER_NAME)
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE);
    if (qErr) throw qErr;
    if (!pending?.length) return json({ processed: 0, message: "لا توجد صور بانتظار التحليل" });

    const { data: cats } = await admin.from("categories").select("id, name");
    const categories = cats ?? [];

    // تحميل الصور وترميزها base64 — نتجاهل أي صورة يفشل تحميلها بدل إفشال الدفعة كاملة.
    const loaded: { id: string; base64: string; mimeType: string; productId: string; karatAlreadySet: boolean }[] = [];
    for (const row of pending) {
      const { data: file, error: dlErr } = await admin.storage.from("product-images").download(row.storage_path);
      if (dlErr || !file) {
        console.error("download failed", row.storage_path, dlErr?.message);
        continue;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const existingKarat = (row as any).products?.karat as string | null | undefined;
      loaded.push({
        id: row.id,
        base64: btoa(binary),
        mimeType: file.type || "image/jpeg",
        productId: row.product_id,
        karatAlreadySet: !!existingKarat,
      });
    }
    if (!loaded.length) return json({ processed: 0, message: "تعذّر تحميل صور الدفعة" });

    const { results, provider, usage } = await analyzeBatchWithFallback({
      images: loaded.map((l) => ({ id: l.id, base64: l.base64, mimeType: l.mimeType })),
      categoryNames: categories.map((c) => c.name),
    });

    let processed = 0;
    for (const l of loaded) {
      const r = results.find((x) => x.id === l.id);
      const analysis = r?.analysis as JewelryAnalysis | undefined;
      if (!analysis) continue; // تبقى بدون ai_labels — ستُلتقط في الدورة التالية

      let categoryId: string | null = null;
      if (analysis.category_name) {
        const cat = categories.find(
          (c) =>
            c.name === analysis.category_name ||
            c.name.includes(analysis.category_name!) ||
            analysis.category_name!.includes(c.name),
        );
        categoryId = cat?.id ?? null;
      }

      let embedding: unknown = null;
      try {
        embedding = await embedImage(l.base64, l.mimeType);
      } catch (e) {
        console.error("embedding failed (non-fatal)", e);
      }

      await admin
        .from("product_images")
        .update({
          ai_labels: { ...analysis, category_id: categoryId, provider },
          ...(embedding ? { ai_embedding: embedding as unknown as string } : {}),
        })
        .eq("id", l.id);

      const gemstones = Array.isArray(analysis.gemstones) ? analysis.gemstones.filter(Boolean) : [];
      const extras = [analysis.stone_count, analysis.condition].filter(Boolean).join(" — ");
      let descriptionText = analysis.description_ar || "";
      if (gemstones.length) descriptionText += `\nألوان الأحجار: ${gemstones.join("، ")}`;
      if (extras) descriptionText += `\n(${extras})`;
      const description = descriptionText.trim() || null;
      // لا نكتب فوق عيار اختاره الموظف يدوياً قبل الرفع (راجع BulkCameraCapture/Upload) —
      // القيمة اليدوية أوثق من تخمين الذكاء الاصطناعي من الصورة، تماماً كمنطق analyzeAndApply
      // في مسار الرفع الفوري (uploadRunner.ts).
      const karatPatch = l.karatAlreadySet
        ? {}
        : { karat: ["18K", "21K"].includes(analysis.karat as string) ? analysis.karat : null };
      await admin
        .from("products")
        .update({
          name: analysis.name_ar || PLACEHOLDER_NAME,
          category_id: categoryId,
          ...karatPatch,
          item_type: analysis.item_type || null,
          description,
        })
        .eq("id", l.productId)
        .eq("name", PLACEHOLDER_NAME); // لا نكتب فوق اسم غيّره الموظف يدوياً أثناء الانتظار

      const stoneColors = detectStoneColors(gemstones);
      if (stoneColors.length) {
        await admin
          .from("product_stones")
          .insert(stoneColors.map((s) => ({ product_id: l.productId, color: s.color, stone_type: s.stoneType, quantity: 1 })));
      }

      processed++;
    }

    return json({ processed, provider, usage });
  } catch (e) {
    console.error("process-analysis-queue error", e);
    return json({ error: e instanceof Error ? e.message : "unknown error" }, 200); // 200 حتى لا يُعيد pg_net محاولات عدوانية
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
