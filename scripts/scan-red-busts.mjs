// يمسح كل المصغّرات في مخزن الصور ويُخرج مسارات القطع المصوّرة على عارضة حمراء.
//
// المحل يصوّر خط 21K التراثي على عارضة قرمزية، والباقي على عارضة بيضاء/بيج. نعدّ
// البكسلات القرمزية المشبعة: المميِّز أن الأخضر فيها لا يعلو الأزرق، بعكس لون البشرة
// والعارضات البيج (تحقّقنا بصرياً أن العتبة الفضفاضة كانت تعدّهما حمراء خطأً).
//
// الاستعمال: node scripts/scan-red-busts.mjs [عتبة]
import sharp from "sharp";

const URL_BASE = "https://iiyaytfdxfvjcvzlnlpp.supabase.co";
const BUCKET = "product-images";
const KEY = process.env.SUPABASE_ANON_KEY;
const THRESHOLD = Number(process.argv[2] ?? 0.05);

async function list(prefix) {
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const res = await fetch(`${URL_BASE}/storage/v1/object/list/${BUCKET}`, {
      method: "POST",
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: "name", order: "asc" } }),
    });
    const page = await res.json();
    if (!Array.isArray(page) || page.length === 0) break;
    out.push(...page);
    if (page.length < 100) break;
  }
  return out;
}

async function redness(path) {
  const res = await fetch(`${URL_BASE}/storage/v1/object/public/${BUCKET}/${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { data, info } = await sharp(Buffer.from(await res.arrayBuffer()))
    .resize(64, 64, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let red = 0;
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (r > 80 && r - g > 60 && g <= b + 20) red++;
  }
  return red / (info.width * info.height);
}

// جذر imports/ يحتوي مجلداً لكل من رفع، والصور القديمة في الجذر مباشرة.
const roots = ["", "imports/"];
const folders = new Set();
const files = [];
for (const root of roots) {
  for (const entry of await list(root)) {
    if (entry.id === null) folders.add(root + entry.name + "/");
    else if (entry.name.endsWith("-thumb.jpg")) files.push(root + entry.name);
  }
}
for (const folder of folders) {
  for (const entry of await list(folder)) {
    if (entry.id !== null && entry.name.endsWith("-thumb.jpg")) files.push(folder + entry.name);
  }
}

console.error(`# مصغّرات: ${files.length} (مجلدات: ${folders.size})`);

const results = [];
let idx = 0;
await Promise.all(Array.from({ length: 10 }, async () => {
  while (idx < files.length) {
    const f = files[idx++];
    try { results.push({ f, red: await redness(f) }); } catch { /* تُتجاهل الصور التالفة */ }
  }
}));

const redOnes = results.filter((r) => r.red >= THRESHOLD).sort((a, b) => b.red - a.red);
console.error(`# على عارضة حمراء: ${redOnes.length} من ${results.length}`);
// نُخرج مسارات الأصل (بلا -thumb) ليسهل ربطها بعمود thumb_path في قاعدة البيانات.
for (const r of redOnes) console.log(r.f);
