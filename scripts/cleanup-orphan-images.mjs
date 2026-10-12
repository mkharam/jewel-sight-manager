// Finds files in the `product-images` bucket that no DB row references, and optionally deletes them.
//
// Usage (Node 18+, no dependencies):
//   SUPABASE_URL=https://iiyaytfdxfvjcvzlnlpp.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node scripts/cleanup-orphan-images.mjs
//   ...same, plus --delete to actually remove them.
//
// Dry-run by default. Files created in the last 24h are never touched (could be an upload in progress).

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "product-images";
const DELETE = process.argv.includes("--delete");
const MIN_AGE_MS = 24 * 60 * 60 * 1000;

if (!URL_ || !KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function api(path, init = {}) {
  const res = await fetch(`${URL_}${path}`, { ...init, headers: { ...headers, ...init.headers } });
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

// Every path referenced from the database.
async function referencedPaths() {
  const sources = [
    ["product_images", ["storage_path", "thumb_path"]],
    ["customer_inquiries", ["customer_image_path"]],
    ["product_reorder_requests", ["image_path"]],
  ];
  const refs = new Set();
  for (const [table, cols] of sources) {
    for (let from = 0; ; from += 1000) {
      const rows = await api(`/rest/v1/${table}?select=${cols.join(",")}`, {
        headers: { Range: `${from}-${from + 999}` },
      });
      for (const r of rows) for (const c of cols) if (r[c]) refs.add(r[c]);
      if (rows.length < 1000) break;
    }
  }
  return refs;
}

// Every file in the bucket (recursive).
async function listAll(prefix = "") {
  const files = [];
  for (let offset = 0; ; offset += 1000) {
    const entries = await api(`/storage/v1/object/list/${BUCKET}`, {
      method: "POST",
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: "name", order: "asc" } }),
    });
    for (const e of entries) {
      const full = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id === null) files.push(...(await listAll(full))); // folder
      else files.push({ name: full, size: e.metadata?.size ?? 0, created: new Date(e.created_at) });
    }
    if (entries.length < 1000) break;
  }
  return files;
}

const mb = (b) => (b / 1024 / 1024).toFixed(1) + " MB";

const [refs, files] = await Promise.all([referencedPaths(), listAll()]);
const cutoff = Date.now() - MIN_AGE_MS;
const orphans = files.filter((f) => !refs.has(f.name) && f.created.getTime() < cutoff);
const total = files.reduce((s, f) => s + f.size, 0);
const orphanBytes = orphans.reduce((s, f) => s + f.size, 0);

console.log(`Bucket:     ${files.length} files, ${mb(total)}`);
console.log(`Referenced: ${refs.size} paths`);
console.log(`Orphans:    ${orphans.length} files, ${mb(orphanBytes)}`);
console.log(`After:      ${mb(total - orphanBytes)}`);
console.log("Sample:", orphans.slice(0, 5).map((f) => f.name));

if (!DELETE) {
  console.log("\nDry run. Re-run with --delete to remove these files.");
  process.exit(0);
}

for (let i = 0; i < orphans.length; i += 500) {
  const batch = orphans.slice(i, i + 500).map((f) => f.name);
  await api(`/storage/v1/object/${BUCKET}`, { method: "DELETE", body: JSON.stringify({ prefixes: batch }) });
  console.log(`Deleted ${Math.min(i + 500, orphans.length)}/${orphans.length}`);
}
console.log("Done.");
