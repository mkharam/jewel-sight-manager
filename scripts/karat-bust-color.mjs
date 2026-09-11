// يقيس "احمرار" عارضة العرض في صورة القطعة.
//
// محل مخرّم يصوّر قطع عيار 21 على عارضات حمراء، و18 على عارضات بيضاء/كريمية — وهذه
// إشارة أوثق بكثير من لون الذهب نفسه (الذي يتأثر بالإضاءة وموازنة البياض). نقيس نسبة
// البكسلات الحمراء المشبعة في الصورة: الأحجار والذهب لا تُنتجها، أما العارضة الحمراء
// فتغطي مساحة كبيرة منها.
//
// الاستعمال: node scripts/karat-bust-color.mjs <ملف فيه مسار لكل سطر>
import sharp from "sharp";
import fs from "node:fs";

const BASE = "https://iiyaytfdxfvjcvzlnlpp.supabase.co/storage/v1/object/public/product-images/";
const PREFIX = "imports/9ec5462d-e605-428b-ab0e-5d046dd4eb4d/";

function toUrl(name) {
  return BASE + (name.startsWith("imports/") ? name : PREFIX + name);
}

/** نسبة البكسلات ذات طابع أحمر مشبع (وردي/قرمزي) من إجمالي الصورة. */
async function redness(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // تصغير إلى 64×64 يسرّع القياس كثيراً ولا يغيّر النِّسَب اللونية العامة.
  const { data, info } = await sharp(buf).resize(64, 64, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let red = 0;
  const total = info.width * info.height;
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    // أحمر/قرمزي: الأحمر يفوق الأخضر والأزرق بفارق واضح، وليس داكناً جداً.
    // الذهب الأصفر يُستبعد لأن أخضره قريب من أحمره (r-g صغير).
    if (r > 70 && r - g > 45 && r - b > 35 && g - b < 60) red++;
  }
  return red / total;
}

// كل سطر: "اسم الملف|العيار الحالي"
const rows = fs.readFileSync(process.argv[2], "utf8").split("\n").map((s) => s.trim()).filter(Boolean)
  .map((line) => { const [name, karat] = line.split("|"); return { name, karat }; });
const THRESHOLD = Number(process.argv[3] ?? 0.06);

const out = [];
const CONCURRENCY = 8;
let idx = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (idx < rows.length) {
      const row = rows[idx++];
      try {
        out.push({ ...row, red: await redness(toUrl(row.name)) });
      } catch (e) {
        out.push({ ...row, red: null, error: String(e.message) });
      }
    }
  }),
);

const ok = out.filter((r) => r.red != null);
const expected = (r) => (r.red >= THRESHOLD ? "21K" : "18K");
const mismatch = ok.filter((r) => r.karat !== expected(r));

console.log(`# فحص ${ok.length} صورة (أخطاء تحميل: ${out.length - ok.length}) — العتبة ${THRESHOLD}`);
for (const k of ["18K", "21K"]) {
  const g = ok.filter((r) => r.karat === k);
  const red = g.filter((r) => r.red >= THRESHOLD).length;
  console.log(`# مُصنَّفة ${k}: ${g.length} — منها على عارضة حمراء ${red}، بيضاء ${g.length - red}`);
}
console.log(`# غير مطابقة للقاعدة: ${mismatch.length}`);
console.log("\n# redness\tالحالي\tالمتوقع\tالملف");
for (const r of mismatch.sort((a, b) => b.red - a.red)) {
  console.log(`${r.red.toFixed(4)}\t${r.karat}\t${expected(r)}\t${r.name}`);
}
