// رفع صور القطع وحذفها مع ملفاتها من التخزين.
//
// حذف سطر في products يحذف أسطر product_images تلقائياً (ON DELETE CASCADE)، لكن الملفات
// نفسها في حاوية product-images لا تُحذف أبداً — تبقى يتيمة بلا أي سطر يشير إليها. هكذا
// تراكم قرابة 1GB من الصور اليتيمة (أكثر من 75% من الحاوية) وتجاوز المشروع حصة التخزين.
// كل حذف لقطعة يجب أن يمرّ من هنا.
import { supabase } from "@/integrations/supabase/client";
import { IMAGES_ON_R2, R2_WORKER_URL } from "@/lib/constants";

const BUCKET = "product-images";
const CHUNK = 100;
// مسارات الملفات لا يُعاد استخدامها أبداً (طابع زمني + عشوائي)، فمحتواها ثابت — سنة كاملة.
const IMMUTABLE_CACHE = "31536000";

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/**
 * نداء Worker الصور على Cloudflare بجلسة المستخدم نفسه — الـWorker يسأل قاعدة البيانات
 * (نفس دوال صلاحيات التخزين) قبل أي رفع أو حذف، فلا مفتاح سرّي في المتصفح ولا في الـWorker.
 */
export async function r2Worker(method: "PUT" | "DELETE" | "POST", route: string, body?: BodyInit, headers: Record<string, string> = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("انتهت الجلسة — سجّل الدخول من جديد");
  const res = await fetch(`${R2_WORKER_URL}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      ...headers,
    },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error ? `تعذّر حفظ الصورة (${json.error})` : `تعذّر حفظ الصورة (${res.status})`);
  return json;
}

/**
 * رفع صورة قطعة إلى مكان تخزينها الحالي: Cloudflare R2 إن فُعّل IMAGES_ON_R2، وإلا تخزين
 * Supabase. كل رفع لصور القطع يمرّ من هنا حتى يكفي تغيير المفتاح للانتقال.
 */
export async function uploadProductImage(path: string, file: Blob, opts: { upsert?: boolean } = {}): Promise<void> {
  const contentType = file.type || "image/jpeg";
  if (!IMAGES_ON_R2) {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { cacheControl: IMMUTABLE_CACHE, contentType, upsert: opts.upsert });
    if (error) throw error;
    return;
  }
  await r2Worker("PUT", `/o/${encodePath(path)}`, file, {
    "Content-Type": contentType,
    ...(opts.upsert ? { "x-upsert": "true" } : {}),
  });
}

/**
 * يحذف ملفات من الحاوية — لكن فقط ما لم يعد أي سطر في product_images يشير إليه. في وضع
 * الصينية قد تتشارك عدة قطع صورة الصينية نفسها، فحذف قطعة واحدة لا يجوز أن يمحو صورة أخواتها.
 * الفشل هنا لا يُرمى: لا أثر مرئي لملف يتيم، والقطعة نفسها حُذفت فعلاً.
 */
export async function removeUnreferencedFiles(paths: (string | null | undefined)[]): Promise<void> {
  const unique = Array.from(new Set(paths.filter((p): p is string => !!p)));
  if (!unique.length) return;
  try {
    const stillUsed = new Set<string>();
    for (const part of chunks(unique, CHUNK)) {
      const [a, b] = await Promise.all([
        supabase.from("product_images").select("storage_path").in("storage_path", part),
        supabase.from("product_images").select("thumb_path").in("thumb_path", part),
      ]);
      if (a.error || b.error) throw a.error ?? b.error;
      a.data?.forEach((r) => stillUsed.add(r.storage_path));
      b.data?.forEach((r) => r.thumb_path && stillUsed.add(r.thumb_path));
    }
    const orphaned = unique.filter((p) => !stillUsed.has(p));
    if (IMAGES_ON_R2) {
      for (const p of orphaned) await r2Worker("DELETE", `/o/${encodePath(p)}`);
      return;
    }
    for (const part of chunks(orphaned, 1000)) {
      const { error } = await supabase.storage.from(BUCKET).remove(part);
      if (error) throw error;
    }
  } catch (e) {
    console.warn("storage cleanup failed", e);
  }
}

/**
 * يحذف القطع ثم ملفات صورها. يُعيد معرّفات ما حُذف فعلاً — سياسة RLS قد ترفض بعض القطع
 * بصمت (0 صف بلا خطأ)، ولا نلمس إلا صور ما حُذف فعلاً حتى لا تبقى قطعة بصورة مكسورة.
 */
export async function deleteProducts(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const images: { product_id: string; storage_path: string; thumb_path: string | null }[] = [];
  for (const part of chunks(ids, CHUNK)) {
    const { data, error } = await supabase
      .from("product_images")
      .select("product_id,storage_path,thumb_path")
      .in("product_id", part);
    if (error) throw error;
    images.push(...(data ?? []));
  }

  const deleted = new Set<string>();
  for (const part of chunks(ids, CHUNK)) {
    const { data, error } = await supabase.from("products").delete().in("id", part).select("id");
    if (error) throw error;
    data?.forEach((r) => deleted.add(r.id));
  }

  await removeUnreferencedFiles(
    images.filter((i) => deleted.has(i.product_id)).flatMap((i) => [i.storage_path, i.thumb_path]),
  );
  return Array.from(deleted);
}
