// المنطق الفعلي لرفع/حفظ القطع — يعمل بشكل مستقل عن أي مكوّن React، فلا يتوقف عند
// التنقّل بين صفحات التطبيق (فقط إغلاق التبويب نفسه يوقفه). كل صورة تُحلّل بالذكاء
// الاصطناعي هنا مباشرة (مرئي في طابور الرفع: رفع → تحليل → حفظ) ثم تُحفظ فوراً بمجرد
// اكتمال تحليلها — لا تنتظر بقية الصورة، فيمكنك البدء بالعمل على ما اكتمل أولاً بأول.
// (مشغّل قاعدة البيانات على product_images يُكمّل التحليل تلقائياً فقط للحالات النادرة
// التي يُغلق فيها التبويب قبل اكتمال التحليل — وهو احتياط إضافي وليس المسار الأساسي.)
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { KARAT_OPTIONS } from "@/lib/constants";
import { compressMany, prepareForAIBase64 } from "@/lib/image-compress";
import { isPdf, pdfToImageFiles } from "@/lib/pdf-to-images";
import { uploadQueue } from "@/lib/uploadQueue";

export type UploadOptions = {
  userId: string;
  branchId: string | null;
  trayMode: boolean;
};

// كلما كبر ملف الـ PDF نضغط أكثر — يحافظ هذا على حجم صور معقول للرفع والتحليل
// حتى مع كتالوجات ضخمة (حتى 300MB)، بدون أي حد أقصى لعدد الصفحات.
function pdfCompressionFor(sizeBytes: number): { maxDimension: number; quality: number } {
  const mb = sizeBytes / (1024 * 1024);
  if (mb > 200) return { maxDimension: 900, quality: 0.65 };
  if (mb > 120) return { maxDimension: 1000, quality: 0.7 };
  if (mb > 60) return { maxDimension: 1200, quality: 0.75 };
  return { maxDimension: 1600, quality: 0.82 };
}

function describeWithExtras(a: any): string | null {
  const base = a?.description_ar || "";
  const extras = [a?.stone_count, a?.condition].filter(Boolean).join(" — ");
  const out = extras ? `${base}\n(${extras})` : base;
  return out || null;
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
 * الوضع العادي: يحلّل الصورة بالذكاء الاصطناعي مباشرة (مرئي للمستخدم أثناء الانتظار)
 * ثم يحفظ القطعة كاملة فوراً بمجرد اكتمال تحليلها. إن فشل التحليل (مثلاً الحد المجاني
 * ممتلئ) نحفظ القطعة بحقول فارغة بدل فقدانها بالكامل — يمكن تعديلها يدوياً لاحقاً.
 */
async function analyzeAndSaveProduct(
  file: File,
  storagePath: string,
  opts: UploadOptions,
  categories: { id: string; name: string }[],
  onStatus: (label: string) => void,
): Promise<string> {
  let analysis: any = null;
  let provider: string | undefined;

  // نُحضّر نسخة مصغّرة مرة واحدة فقط — تُستخدم لكل محاولات إعادة الإرسال دون إعادة الترميز.
  const { base64, mimeType } = await prepareForAIBase64(file);

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const { data, error } = await supabase.functions.invoke("analyze-product-image", {
        body: { imageBase64: base64, mimeType, categories },
      });
      if (error) throw error;
      if ((data as any)?.error) throw Object.assign(new Error((data as any).error), { code: (data as any).code });
      analysis = data;
      provider = (data as any)?.provider;
      break;
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      // "AI_BUSY" يشمل ازدحام مؤقت (يزول خلال ثوانٍ) وأيضاً استنفاذ حصة OpenRouter اليومية
      // الصغيرة (50/يوم) — كلاهما يجب أن يُعاد المحاولة لهما لأن Gemini/Groq غالباً لا يزالان
      // متاحين، ورسالة "انتهت الحصة اليومية" لا تعني بالضرورة فشل كل المزوّدات، بل قد يكون
      // مزوّد واحد فقط استنفد حصته بينما فشل آخر فشلاً عابراً وسيُستعاد سريعاً.
      const busy = e?.code === "AI_BUSY" || /429|rate|مشغول|ممتلئ|انتهت|AI_BUSY/i.test(msg);
      if (!busy || attempt === 3) break; // نتابع بدون تحليل بدل تعليق الرفع بالكامل
      await new Promise((r) => setTimeout(r, [3000, 6000, 10000][attempt] ?? 10000));
    }
  }

  const categoryId = matchCategoryId(analysis?.category_name, categories);
  const name = analysis?.name_ar || "قطعة جديدة";

  const { data: prod, error: e1 } = await supabase
    .from("products")
    .insert({
      name,
      category_id: categoryId,
      karat: KARAT_OPTIONS.includes(analysis?.karat) ? analysis.karat : null,
      item_type: analysis?.item_type || null,
      description: describeWithExtras(analysis),
      branch_id: opts.branchId,
      status: "available",
      created_by: opts.userId,
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
      ...(analysis ? { ai_labels: { ...analysis, category_id: categoryId, provider } } : {}),
    } as any)
    .select("id")
    .single();
  if (e2 || !img) throw e2 ?? new Error("فشل حفظ الصورة");

  // بصمة البحث بالصورة — لا تُفشل الحفظ إن تعذّرت (القطعة محفوظة بالفعل).
  if (analysis) {
    supabase.functions
      .invoke("analyze-product-image", { body: { imageId: img.id, analysis, categories } })
      .catch(() => {});
  }

  onStatus(analysis ? name : "تم الحفظ بدون تحليل — عدّلها يدوياً");
  return name;
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

  for (const p of pieces) {
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

    await supabase.from("product_images").insert({
      product_id: prod.id,
      storage_path: storagePath,
      is_primary: true,
      uploaded_by: opts.userId,
      ai_labels: { ...p, category_id: categoryId, provider },
    } as any);
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
  }));

  entries.forEach((e) =>
    uploadQueue.add({ id: e.id, previewUrl: e.previewUrl, label: "جارٍ الرفع…", status: "uploading" }),
  );

  let ok = 0;
  let failed = 0;

  // تحليل صوره واحدة تلو الأخرى مرئياً (نتيجة كل صورة تظهر فور اكتمالها) بدل الانتظار للجميع معاً.
  // 3 بالتوازي مع تباعد 400ms بين كل عنصر جديد — Gemini يقبل 15 طلب/دقيقة فقط وOpenRouter
  // حصته اليومية صغيرة (50)، فرفع التوازي أعلى من هذا كان يُستنفد الحصص الثلاث معاً بسرعة
  // ويُفشل دفعات كبيرة برسالة "كل المزوّدات مشغولة" بدل تحليلها ببطء أكبر لكن بنجاح.
  await pool(entries, 3, async (entry, k) => {
    try {
      const path = await uploadFile(entry.file, opts.userId, k);

      if (opts.trayMode) {
        uploadQueue.update(entry.id, { status: "analyzing", label: "جارٍ التحليل…" });
        const n = await saveTrayPieces(entry.file, path, opts, categories);
        uploadQueue.update(entry.id, { status: "done", label: `تم حفظ ${n} قطعة` });
      } else {
        uploadQueue.update(entry.id, { status: "analyzing", label: "جارٍ التحليل…" });
        const name = await analyzeAndSaveProduct(entry.file, path, opts, categories, (label) => {
          uploadQueue.update(entry.id, { status: "saving", label });
        });
        uploadQueue.update(entry.id, { status: "done", label: `تم الحفظ: ${name}` });
      }
      ok++;
    } catch (e: any) {
      failed++;
      uploadQueue.update(entry.id, { status: "error", message: e?.message ?? "فشل الرفع" });
    }
  }, 400);

  toast.success(`اكتمل رفع ${ok} صورة` + (failed ? ` (${failed} فشل)` : ""), { duration: 6000 });
}
