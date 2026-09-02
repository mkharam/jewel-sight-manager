// المنطق الفعلي لرفع/حفظ القطع — يعمل بشكل مستقل عن أي مكوّن React، فلا يتوقف عند
// التنقّل بين صفحات التطبيق (فقط إغلاق التبويب نفسه يوقفه).
//
// الوضع العادي (غير الصينية) يرفع الصورة ويحفظ القطعة فوراً باسم مؤقت "قطعة جديدة" بدون
// انتظار الذكاء الاصطناعي إطلاقاً — التحليل يتم لاحقاً في الخلفية عبر طابور معالجة على
// الخادم (job خلفي مجدول كل 15 ثانية يحلّل عدة صور معاً في طلب واحد لكل مزوّد). هذا أبسط
// وأكثر أماناً من محاولة توازي/تهئة الطلبات من المتصفح: الرفع لا يعتمد على حصص الذكاء
// الاصطناعي إطلاقاً فلا يتأثر برفض 429 مهما كان حجم الدفعة، والتحليل يمشي بمعدّل ثابت
// وآمن بغضّ النظر عمّا يفعله المتصفح. راجع صفحة "مراجعة الصور غير المسمّاة" للنتيجة.
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
 * الوضع العادي: يحفظ القطعة فوراً باسم مؤقت "قطعة جديدة" بدون أي انتظار للذكاء الاصطناعي —
 * التحليل يتم لاحقاً في الخلفية عبر طابور معالجة على الخادم (راجع تعليق أعلى الملف). هذا
 * يجعل الرفع سريعاً وموثوقاً تماماً بغضّ النظر عن ازدحام مزوّدات الذكاء الاصطناعي.
 */
async function saveUnanalyzedProduct(
  storagePath: string,
  opts: UploadOptions,
): Promise<string> {
  const name = "قطعة جديدة";
  const { data: prod, error: e1 } = await supabase
    .from("products")
    .insert({
      name,
      branch_id: opts.branchId,
      status: "available",
      created_by: opts.userId,
    } as any)
    .select("id")
    .single();
  if (e1 || !prod) throw e1 ?? new Error("فشل إنشاء المنتج");

  const { error: e2 } = await supabase
    .from("product_images")
    .insert({
      product_id: prod.id,
      storage_path: storagePath,
      is_primary: true,
      uploaded_by: opts.userId,
    } as any);
  if (e2) throw e2 ?? new Error("فشل حفظ الصورة");

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

  // وضع الصينية لا يزال يستدعي الذكاء الاصطناعي مباشرة (يحتاج معرفة عدد القطع فوراً)
  // فيبقى محدوداً ومتباعداً لتفادي حدود المعدّل. الوضع العادي لا يستدعي الذكاء الاصطناعي
  // إطلاقاً هنا (يُحفظ فوراً والتحليل يجري لاحقاً في الخلفية) فلا داعي لأي تحديد أو تباعد.
  const concurrency = opts.trayMode ? 3 : 6;
  const stagger = opts.trayMode ? 400 : 0;
  await pool(entries, concurrency, async (entry, k) => {
    try {
      const path = await uploadFile(entry.file, opts.userId, k);

      if (opts.trayMode) {
        uploadQueue.update(entry.id, { status: "analyzing", label: "جارٍ التحليل…" });
        const n = await saveTrayPieces(entry.file, path, opts, categories);
        uploadQueue.update(entry.id, { status: "done", label: `تم حفظ ${n} قطعة` });
      } else {
        const name = await saveUnanalyzedProduct(path, opts);
        uploadQueue.update(entry.id, { status: "done", label: `تم الحفظ: ${name} — سيُحلّل تلقائياً قريباً` });
      }
      ok++;
    } catch (e: any) {
      failed++;
      uploadQueue.update(entry.id, { status: "error", message: e?.message ?? "فشل الرفع" });
    }
  }, stagger);

  toast.success(`اكتمل رفع ${ok} صورة` + (failed ? ` (${failed} فشل)` : ""), { duration: 6000 });
}
