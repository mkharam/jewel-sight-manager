// المنطق الفعلي لرفع/حفظ القطع — يعمل بشكل مستقل عن أي مكوّن React، فلا يتوقف عند
// التنقّل بين صفحات التطبيق (فقط إغلاق التبويب نفسه يوقفه).
//
// التسلسل: رفع الصورة ← حفظ القطعة باسم مؤقت ← تحليل فوري بالذكاء الاصطناعي مع إظهار
// مؤشر "جارٍ التحليل…" للموظف ← تحديث القطعة باسمها وفئتها الحقيقية. الموظف يرى النتيجة
// أثناء وقوفه أمام الشاشة بدل رسالة "سيُحلّل قريباً" ثم انتظار مجهول.
//
// شبكة الأمان: إن تعذّر التحليل الفوري (ازدحام المزوّدات المجانية أو نفاد حصة لحظية)
// لا نُظهر خطأ ولا نفقد شيئاً — تبقى القطعة محفوظة باسمها المؤقت ويُستدعى طابور التحليل
// الخلفي (process-analysis-queue) لالتقاطها لاحقاً، وهو ما كان السلوك الوحيد سابقاً.
// لهذا يبقى الرفع نفسه غير معتمد إطلاقاً على حصص الذكاء الاصطناعي.
// راجع صفحة "مراجعة الصور غير المسمّاة" لما لم يُحلَّل بعد.
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { KARAT_OPTIONS } from "@/lib/constants";
import { compressMany, cropImageToBbox, prepareForAIBase64 } from "@/lib/image-compress";
import { isPdf, pdfToImageFiles } from "@/lib/pdf-to-images";
import { uploadQueue } from "@/lib/uploadQueue";
import { normalizeAr } from "@/lib/arabic-search";

export type UploadOptions = {
  userId: string;
  branchId: string | null;
  trayMode: boolean;
};

const PLACEHOLDER_NAME = "قطعة جديدة";

// كلما كبر ملف الـ PDF نضغط أكثر — يحافظ هذا على حجم صور معقول للرفع والتحليل
// حتى مع كتالوجات ضخمة (حتى 300MB)، بدون أي حد أقصى لعدد الصفحات.
function pdfCompressionFor(sizeBytes: number): { maxDimension: number; quality: number } {
  const mb = sizeBytes / (1024 * 1024);
  if (mb > 200) return { maxDimension: 900, quality: 0.65 };
  if (mb > 120) return { maxDimension: 1000, quality: 0.7 };
  if (mb > 60) return { maxDimension: 1200, quality: 0.75 };
  return { maxDimension: 1600, quality: 0.82 };
}

// نُلحق ألوان الأحجار كسطر منفصل صريح بدل الاعتماد فقط على أن الذكاء الاصطناعي ذكرها
// طبيعياً داخل نص الوصف الحر — هذا يضمن وجود كلمة اللون القياسية (بنفسجي/أخضر/أزرق...)
// في description بشكل موثوق دائماً، فيلتقطها البحث الذكي (بما فيه مرادفات مثل "موفيا")
// بثقة تامة بدل الاعتماد على صياغة الذكاء الاصطناعي الحرة كل مرة.
function describeWithExtras(a: any): string | null {
  const base = a?.description_ar || "";
  const gemstones: string[] = Array.isArray(a?.gemstones) ? a.gemstones.filter(Boolean) : [];
  const extras = [a?.stone_count, a?.condition].filter(Boolean).join(" — ");
  let out = base;
  if (gemstones.length) out += `\nألوان الأحجار: ${gemstones.join("، ")}`;
  if (extras) out += `\n(${extras})`;
  return out.trim() || null;
}

// خرائط الكلمات المفتاحية لاستنتاج لون ونوع الحجر القياسيَّين (يطابقان STONE_COLORS/STONE_TYPES
// في luxury.ts) من نص gemstones الحر الذي يكتبه الذكاء الاصطناعي — بدون هذا، فلتر "لون الحجر"
// في صفحة البحث يبقى فارغاً دائماً لأن جدول product_stones لا يُملأ إلا يدوياً من نموذج التعديل.
// stone_type عمود إلزامي في الجدول فنُعيد "أخرى" حين لا نستطيع تحديد النوع بثقة.
const STONE_COLOR_KEYWORDS: [string, string, string][] = [
  ["ابيض", "white", "زركون"], ["شفاف", "white", "زركون"],
  ["احمر", "red", "ياقوت"], ["روبي", "red", "ياقوت"],
  ["اخضر", "green", "زمرد"], ["زمرد", "green", "زمرد"],
  ["ازرق", "blue", "سفير"], ["سفير", "blue", "سفير"], ["صفير", "blue", "سفير"],
  ["اصفر", "yellow", "سيترين"], ["سيترين", "yellow", "سيترين"],
  ["وردي", "pink", "أخرى"], ["زهري", "pink", "أخرى"], ["روز", "pink", "أخرى"],
  ["جمشت", "purple", "جمشت"], ["بنفسجي", "purple", "جمشت"], ["موف", "purple", "جمشت"], ["ارجواني", "purple", "جمشت"],
  ["اسود", "black", "أخرى"],
];

function detectStoneColors(gemstones: string[] | undefined): { color: string; stoneType: string }[] {
  const found = new Map<string, string>();
  for (const g of gemstones ?? []) {
    const norm = normalizeAr(g);
    for (const [kw, color, stoneType] of STONE_COLOR_KEYWORDS) {
      if (norm.includes(kw) && !found.has(color)) found.set(color, stoneType);
    }
  }
  return Array.from(found, ([color, stoneType]) => ({ color, stoneType }));
}

async function saveStoneColors(productId: string, gemstones: string[] | undefined) {
  const stones = detectStoneColors(gemstones);
  if (!stones.length) return;
  await supabase
    .from("product_stones")
    .insert(stones.map((s) => ({ product_id: productId, color: s.color, stone_type: s.stoneType, quantity: 1 })) as any);
}

async function uploadFile(file: File, userId: string, k: number): Promise<string> {
  let lastErr: any;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `imports/${userId}/${Date.now()}-${k}-${Math.random().toString(36).slice(2, 7)}.${ext || "jpg"}`;
      const { error } = await supabase.storage.from("product-images").upload(path, file);
      if (error) throw error;
      return path;
    } catch (e) {
      lastErr = e;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastErr;
}

function matchCategoryId(name: string | null | undefined, categories: { id: string; name: string }[]) {
  if (!name) return null;
  return categories.find((c) => c.name === name || name.includes(c.name) || c.name.includes(name))?.id ?? null;
}

/**
 * الوضع العادي: يحفظ القطعة فوراً باسم مؤقت "قطعة جديدة" بدون أي انتظار للذكاء الاصطناعي —
 * التحليل يتم لاحقاً في الخلفية عبر طابور معالجة على الخادم (راجع تعليق أعلى الملف). هذا
 * يجعل الرفع سريعاً وموثوقاً تماماً بغضّ النظر عن ازدحام مزوّدات الذكاء الاصطناعي.
 */
async function saveUnanalyzedProduct(
  storagePath: string,
  opts: UploadOptions,
  weightGrams?: number | null,
  barcodeValue?: string | null,
  karat?: string | null,
  itemType?: string | null,
): Promise<{ productId: string; imageId: string }> {
  const { data: prod, error: e1 } = await supabase
    .from("products")
    .insert({
      name: PLACEHOLDER_NAME,
      branch_id: opts.branchId,
      status: "available",
      created_by: opts.userId,
      weight_grams: weightGrams ?? null,
      barcode_value: barcodeValue || null,
      karat: karat && KARAT_OPTIONS.includes(karat) ? karat : null,
      item_type: itemType || null,
    } as any)
    .select("id")
    .single();
  if (e1 || !prod) throw e1 ?? new Error("فشل إنشاء المنتج");

  const { data: img, error: e2 } = await supabase
    .from("product_images")
    .insert({
      product_id: prod.id,
      storage_path: storagePath,
      is_primary: true,
      uploaded_by: opts.userId,
    } as any)
    .select("id")
    .single();
  if (e2 || !img) throw e2 ?? new Error("فشل حفظ الصورة");

  return { productId: prod.id, imageId: img.id };
}

/**
 * تحليل فوري للقطعة مباشرة بعد رفعها (بدل انتظار الطابور الخلفي) — يُظهر للموظف نتيجة
 * التحليل فوراً مع مؤشر تحميل أثناء العمل. يُعيد اسم القطعة عند النجاح، أو null عند
 * الفشل/انشغال المزوّدات (429) لتبقى القطعة في الطابور الخلفي كما كان سابقاً — لا شيء
 * يضيع، فقط يتأخر تحليله.
 *
 * لا نكتب فوق أي حقل عبّأه الموظف فعلاً من وسم القطعة (العيار/النوع)؛ بيانات الوسم
 * المطبوعة أوثق من استنتاج الذكاء الاصطناعي من الصورة.
 */
async function analyzeAndApply(
  file: File,
  saved: { productId: string; imageId: string },
  categories: { id: string; name: string }[],
  alreadySet: { karat: boolean; itemType: boolean },
): Promise<string | null> {
  try {
    const { base64, mimeType } = await prepareForAIBase64(file);
    const { data, error } = await supabase.functions.invoke("analyze-product-image", {
      body: { imageBase64: base64, mimeType, categories, imageId: saved.imageId },
    });
    if (error) throw error;

    const a = data as any;
    // AI_BUSY أو أي خطأ مُعاد داخل الجسم — نتركها للطابور الخلفي بدل إظهار خطأ للموظف.
    if (!a || a.error) return null;

    const patch: Record<string, unknown> = {};
    if (a.name_ar) patch.name = a.name_ar;
    if (a.category_id) patch.category_id = a.category_id;
    if (!alreadySet.karat && KARAT_OPTIONS.includes(a.karat)) patch.karat = a.karat;
    if (!alreadySet.itemType && a.item_type) patch.item_type = a.item_type;
    const description = describeWithExtras(a);
    if (description) patch.description = description;
    if (!Object.keys(patch).length) return null;

    // شرط الاسم الافتراضي: لا نكتب فوق اسم عدّله الموظف يدوياً أثناء التحليل.
    const { error: upErr } = await supabase
      .from("products")
      .update(patch as any)
      .eq("id", saved.productId)
      .eq("name", PLACEHOLDER_NAME);
    if (upErr) throw upErr;

    await saveStoneColors(saved.productId, a.gemstones);

    return (a.name_ar as string) || null;
  } catch (e) {
    console.warn("inline analysis failed — falling back to background queue", e);
    return null;
  }
}

/** وضع الصينية: التحليل معروف مسبقاً (لازم لمعرفة عدد القطع) فنحفظه كاملاً فوراً. */
async function saveTrayPieces(
  file: File,
  storagePath: string,
  opts: UploadOptions,
  categories: { id: string; name: string }[],
) {
  // وضع الصينية يحتاج دقة أعلى قليلاً من الوضع العادي لفصل عدة قطع صغيرة في إطار واحد.
  const { base64, mimeType } = await prepareForAIBase64(file, { maxDimension: 1280 });

  const { data, error } = await supabase.functions.invoke("analyze-tray", {
    body: { imageBase64: base64, mimeType, categories },
  });
  if (error) throw error;
  if ((data as any)?.error) throw new Error((data as any).error);
  const pieces: any[] = (data as any)?.pieces ?? [];
  if (!pieces.length) throw new Error("لم يتم التعرّف على أي قطعة في الصورة");
  const provider = (data as any)?.provider;

  let pieceIndex = 0;
  for (const p of pieces) {
    pieceIndex++;
    const categoryId = matchCategoryId(p.category_name, categories);
    let sku: string | null = null;
    if (opts.branchId) {
      try {
        const { data: skuData } = await supabase.rpc("next_sku", {
          _branch_id: opts.branchId,
          _item_type: p.item_type || p.category_name || null,
        });
        sku = (skuData as unknown as string) ?? null;
      } catch { /* SKU اختياري */ }
    }

    const { data: prod, error: e1 } = await supabase
      .from("products")
      .insert({
        name: p.name_ar || "قطعة جديدة",
        sku,
        category_id: categoryId,
        karat: KARAT_OPTIONS.includes(p.karat) ? p.karat : null,
        item_type: p.item_type || p.category_name || null,
        description: describeWithExtras(p),
        branch_id: opts.branchId,
        status: "available",
        created_by: opts.userId,
      } as any)
      .select("id")
      .single();
    if (e1 || !prod) continue;

    // نقصّ صورة القطعة وحدها من صورة الصينية بدل استخدام الصينية كاملة كصورة للمنتج —
    // يعطي كل قطعة صورتها الخاصة الواضحة كما لو صُوّرت منفردة. عند فشل القص أو غياب
    // مستطيل صالح نسقط لصورة الصينية الكاملة بدل فقدان الصورة تماماً.
    let piecePath = storagePath;
    if (p.bbox) {
      try {
        const cropped = await cropImageToBbox(file, p.bbox);
        if (cropped) piecePath = await uploadFile(cropped, opts.userId, 1000 + pieceIndex);
      } catch { /* نسقط للصينية الكاملة */ }
    }

    await supabase.from("product_images").insert({
      product_id: prod.id,
      storage_path: piecePath,
      is_primary: true,
      uploaded_by: opts.userId,
      ai_labels: { ...p, category_id: categoryId, provider },
    } as any);

    await saveStoneColors(prod.id, p.gemstones);
  }

  return pieces.length;
}

// staggerMs يباعد بين بدء كل عنصر جديد داخل نفس "الحارة" — يمنع اصطدام حصة الدقيقة
// المحدودة عند بعض المزوّدين (Gemini مثلاً 15 طلب/دقيقة فقط) عند رفع دفعات كبيرة.
async function pool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
  staggerMs = 0,
) {
  let i = 0;
  const run = async () => {
    while (i < items.length) {
      const k = i++;
      if (staggerMs && k > 0) await new Promise((r) => setTimeout(r, staggerMs));
      await worker(items[k], k);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
}

export async function runUploadBatch(fileList: FileList | File[], opts: UploadOptions) {
  const all = Array.from(fileList);
  const MAX_PDF_MB = 300;
  const allPdfs = all.filter(isPdf);
  const pdfs = allPdfs.filter((f) => f.size <= MAX_PDF_MB * 1024 * 1024);
  const oversizedPdfs = allPdfs.filter((f) => f.size > MAX_PDF_MB * 1024 * 1024);
  const images = all.filter((f) => f.type.startsWith("image/") && f.size <= 25 * 1024 * 1024);

  if (oversizedPdfs.length) {
    toast.error(
      `${oversizedPdfs.length > 1 ? "بعض الملفات" : "الملف"} أكبر من ${MAX_PDF_MB}MB — قسّم الكتالوج إلى ملفات أصغر وأعد المحاولة.`,
      { duration: 10000 },
    );
  }

  let pdfPages: File[] = [];
  let pdfFailed = false;
  if (pdfs.length) {
    const t = toast.loading("جارٍ تحويل صفحات PDF…");
    try {
      for (let i = 0; i < pdfs.length; i++) {
        const pages = await pdfToImageFiles(pdfs[i], pdfCompressionFor(pdfs[i].size), (done, total) =>
          toast.loading(
            `جارٍ تحويل صفحات PDF… ${pdfs.length > 1 ? `(${i + 1}/${pdfs.length}) ` : ""}صفحة ${done}/${total}`,
            { id: t },
          ),
        );
        pdfPages = pdfPages.concat(pages);
      }
      toast.success(`تم تحويل ${pdfPages.length} صفحة PDF إلى صور`, { id: t });
    } catch (e: any) {
      pdfFailed = true;
      const msg = String(e?.message ?? "");
      const memory = /memory|allocation|out of/i.test(msg);
      toast.error(
        memory
          ? "تعذّر تحويل الملف — الجهاز نفد من الذاكرة. قسّمه إلى ملفات أصغر وأعد المحاولة."
          : msg || "تعذّر تحويل ملف PDF",
        { id: t, duration: 10000 },
      );
    }
  }

  // وزن وباركود كل قطعة (اختياريان) يُلتقطان في كاميرا التصوير المتتالي ويُرفقان
  // كخاصيتين إضافيتين على ملف الصورة نفسه (weightGrams / barcodeValue) — نستخرجهما هنا
  // قبل الضغط بترتيب مطابق لـ `picked`، فصور الـ PDF ليس لها وزن أو باركود (null).
  const weightsForImages = images.map((f) => (f as any).weightGrams ?? null);
  const weights: (number | null)[] = [...weightsForImages, ...pdfPages.map(() => null)];
  const barcodesForImages = images.map((f) => (f as any).barcodeValue ?? null);
  const barcodes: (string | null)[] = [...barcodesForImages, ...pdfPages.map(() => null)];
  const karatsForImages = images.map((f) => (f as any).karat ?? null);
  const karats: (string | null)[] = [...karatsForImages, ...pdfPages.map(() => null)];
  const itemTypesForImages = images.map((f) => (f as any).itemType ?? null);
  const itemTypes: (string | null)[] = [...itemTypesForImages, ...pdfPages.map(() => null)];

  const picked = [...images, ...pdfPages];
  if (!picked.length) {
    if (pdfFailed || oversizedPdfs.length) return;
    toast.error("اختر صوراً (JPG/PNG/WEBP) أو ملف PDF — حجم كل صورة ≤ 25MB");
    return;
  }

  const compressToast = toast.loading(`جارٍ تحسين ${picked.length} صورة قبل الرفع…`);
  const files = await compressMany(picked, { maxDimension: 1600, quality: 0.82 }, 3, (done, total) => {
    toast.loading(`تحسين الصور ${done}/${total}…`, { id: compressToast });
  });
  toast.success(`${files.length} صورة جاهزة — يبدأ الرفع والتحليل الآن`, { id: compressToast });

  const categories = (await supabase.from("categories").select("id,name").eq("is_active", true)).data ?? [];

  const entries = files.map((file, idx) => ({
    id: `${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
    file,
    previewUrl: URL.createObjectURL(file),
    weightGrams: weights[idx] ?? null,
    barcodeValue: barcodes[idx] ?? null,
    karat: karats[idx] ?? null,
    itemType: itemTypes[idx] ?? null,
  }));

  entries.forEach((e) =>
    uploadQueue.add({ id: e.id, previewUrl: e.previewUrl, label: "جارٍ الرفع…", status: "uploading" }),
  );

  let ok = 0;
  let failed = 0;
  let deferred = 0; // نجح رفعها لكن تعذّر تحليلها فوراً — تبقى للطابور الخلفي

  // كلا الوضعين يستدعيان الذكاء الاصطناعي مباشرة الآن (التحليل الفوري مع مؤشر تحميل بدل
  // "سيُحلّل قريباً")، لذا نُبقي التوازي محدوداً والبدايات متباعدة حتى لا نصطدم بحد
  // الطلبات في الدقيقة عند المزوّدات المجانية عند رفع دفعة كبيرة.
  const concurrency = 3;
  const stagger = 350;
  await pool(entries, concurrency, async (entry, k) => {
    try {
      const path = await uploadFile(entry.file, opts.userId, k);

      if (opts.trayMode) {
        uploadQueue.update(entry.id, { status: "analyzing", label: "جارٍ التحليل…" });
        const n = await saveTrayPieces(entry.file, path, opts, categories);
        uploadQueue.update(entry.id, { status: "done", label: `تم حفظ ${n} قطعة` });
      } else {
        const saved = await saveUnanalyzedProduct(path, opts, entry.weightGrams, entry.barcodeValue, entry.karat, entry.itemType);

        // مؤشر التحليل يظهر فوراً بعد نجاح الرفع والحفظ — الموظف يرى أن العمل جارٍ.
        uploadQueue.update(entry.id, { status: "analyzing", label: "جارٍ التحليل…" });
        const analyzedName = await analyzeAndApply(entry.file, saved, categories, {
          karat: !!entry.karat,
          itemType: !!entry.itemType,
        });

        const weightLabel = entry.weightGrams ? ` (${entry.weightGrams} جم)` : "";
        const barcodeLabel = entry.barcodeValue ? ` — باركود ${entry.barcodeValue}` : "";
        if (analyzedName) {
          uploadQueue.update(entry.id, { status: "done", label: `${analyzedName}${weightLabel}${barcodeLabel}` });
        } else {
          deferred++;
          uploadQueue.update(entry.id, {
            status: "done",
            label: `تم الحفظ${weightLabel}${barcodeLabel} — المزوّدات مشغولة، سيُحلّل تلقائياً قريباً`,
          });
        }
      }
      ok++;
    } catch (e: any) {
      failed++;
      uploadQueue.update(entry.id, { status: "error", message: e?.message ?? "فشل الرفع" });
    }
  }, stagger);

  toast.success(`اكتمل رفع ${ok} صورة` + (failed ? ` (${failed} فشل)` : ""), { duration: 6000 });

  // الطابور الخلفي صار شبكة أمان فقط: يُستدعى حين يتعذّر التحليل الفوري لبعض القطع
  // (ازدحام/نفاد حصة لحظية)، بدل استدعائه دائماً كما كان.
  if (deferred > 0 && !opts.trayMode) {
    const QUEUE_SECRET = "555b188d91d392e574d5b939db23f50d39e4a9c68c425350";
    const rounds = Math.min(6, Math.ceil(deferred / 4));
    (async () => {
      for (let i = 0; i < rounds; i++) {
        await supabase.functions
          .invoke("process-analysis-queue", { headers: { "x-queue-secret": QUEUE_SECRET } })
          .catch(() => {});
        if (i < rounds - 1) await new Promise((r) => setTimeout(r, 500));
      }
    })();
  }
}
