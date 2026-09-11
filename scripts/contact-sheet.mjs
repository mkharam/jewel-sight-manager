// يبني صورة واحدة (ورقة تواصل) من عدة صور قطع مع رمز كل قطعة تحتها — للمراجعة السريعة
// على الهاتف بدل فتح كل قطعة على حدة.
// الاستعمال: node scripts/contact-sheet.mjs <ملف: "sku|path" لكل سطر> <الناتج.png> [أعمدة]
import sharp from "sharp";
import fs from "node:fs";

const BASE = "https://iiyaytfdxfvjcvzlnlpp.supabase.co/storage/v1/object/public/product-images/";
const PREFIX = "imports/9ec5462d-e605-428b-ab0e-5d046dd4eb4d/";
const CELL = 260;
const LABEL = 34;

const rows = fs.readFileSync(process.argv[2], "utf8").split("\n").map((s) => s.trim()).filter(Boolean)
  .map((l) => { const [sku, path] = l.split("|"); return { sku, path }; });
const outFile = process.argv[3];
const cols = Number(process.argv[4] ?? 3);
const gridRows = Math.ceil(rows.length / cols);

const tiles = await Promise.all(rows.map(async (r, i) => {
  const url = BASE + (r.path.startsWith("imports/") ? r.path : PREFIX + r.path);
  const res = await fetch(url);
  const img = await sharp(Buffer.from(await res.arrayBuffer()))
    .resize(CELL, CELL, { fit: "contain", background: { r: 0, g: 0, b: 0 } })
    .toBuffer();
  const label = Buffer.from(
    `<svg width="${CELL}" height="${LABEL}"><rect width="${CELL}" height="${LABEL}" fill="#111"/>` +
    `<text x="${CELL / 2}" y="24" font-family="monospace" font-size="20" fill="#ffd479" text-anchor="middle">${i + 1}. ${r.sku}</text></svg>`,
  );
  const cell = await sharp({ create: { width: CELL, height: CELL + LABEL, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite([{ input: img, top: 0, left: 0 }, { input: label, top: CELL, left: 0 }])
    .png().toBuffer();
  return { input: cell, top: Math.floor(i / cols) * (CELL + LABEL), left: (i % cols) * CELL };
}));

await sharp({ create: { width: cols * CELL, height: gridRows * (CELL + LABEL), channels: 3, background: { r: 17, g: 17, b: 17 } } })
  .composite(tiles).png().toFile(outFile);
console.log("wrote", outFile, rows.length, "items");
