// تحميل صورة قطعة من حيث تُخزَّن فعلاً: Cloudflare R2 إن ضُبط R2_PUBLIC_URL، وإلا تخزين
// Supabase كما كان. هكذا تعمل الدوال قبل النقل وبعده بلا تغيير آخر.
// deno-lint-ignore no-explicit-any
export async function downloadProductImage(admin: any, path: string): Promise<Blob> {
  const r2 = Deno.env.get("R2_PUBLIC_URL");
  if (r2) {
    const res = await fetch(`${r2.replace(/\/$/, "")}/${path.split("/").map(encodeURIComponent).join("/")}`);
    if (!res.ok) throw new Error(`R2 download failed (${res.status}) for ${path}`);
    return await res.blob();
  }
  const { data, error } = await admin.storage.from("product-images").download(path);
  if (error || !data) throw new Error(`storage download failed for ${path}: ${error?.message ?? "no data"}`);
  return data;
}
