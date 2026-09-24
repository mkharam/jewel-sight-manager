// Copies every file in the Supabase `product-images` bucket to Cloudflare R2 under the same path,
// so product_images.storage_path / thumb_path keep working unchanged after the switch.
//
// Usage (Node 18+, no dependencies):
//   SUPABASE_URL=https://iiyaytfdxfvjcvzlnlpp.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//   R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=product-images \
//   node scripts/migrate-images-to-r2.mjs
//
// Safe to re-run: files already in R2 with the same size are skipped. Run it once before switching
// VITE_R2_PUBLIC_URL on, and once more right after, to catch uploads made in between.
import { createHash, createHmac } from "node:crypto";

const env = (k) => {
  const v = process.env[k];
  if (!v) { console.error(`Missing ${k}`); process.exit(1); }
  return v;
};
const SUPABASE_URL = env("SUPABASE_URL").replace(/\/$/, "");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const ACCOUNT_ID = env("R2_ACCOUNT_ID");
const ACCESS_KEY = env("R2_ACCESS_KEY_ID");
const SECRET_KEY = env("R2_SECRET_ACCESS_KEY");
const R2_BUCKET = env("R2_BUCKET");
const SRC_BUCKET = "product-images";
const CACHE_CONTROL = "public, max-age=31536000, immutable";
const CONCURRENCY = 8;

const sbHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };

async function listAll(prefix = "") {
  const files = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${SRC_BUCKET}`, {
      method: "POST",
      headers: sbHeaders,
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: "name", order: "asc" } }),
    });
    if (!res.ok) throw new Error(`list ${prefix}: ${res.status} ${await res.text()}`);
    const entries = await res.json();
    for (const e of entries) {
      const full = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id === null) files.push(...(await listAll(full)));
      else files.push({ name: full, size: e.metadata?.size ?? null, type: e.metadata?.mimetype || "image/jpeg" });
    }
    if (entries.length < 1000) break;
  }
  return files;
}

// --- Minimal AWS SigV4 for R2 (S3 API, region "auto") ---
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();
const encodeKey = (path) => path.split("/").map((s) => encodeURIComponent(s)).join("/");

function signedRequest(method, path, headers = {}, body = Buffer.alloc(0)) {
  const host = `${ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const uri = `/${R2_BUCKET}/${encodeKey(path)}`;
  const now = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = now.slice(0, 8);
  const payloadHash = sha256(body);
  const all = { ...headers, host, "x-amz-content-sha256": payloadHash, "x-amz-date": now };
  const names = Object.keys(all).map((k) => k.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(all).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const canonical = [method, uri, "", names.map((n) => `${n}:${lower[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${date}/auto/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", now, scope, sha256(canonical)].join("\n");
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${SECRET_KEY}`, date), "auto"), "s3"), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(toSign).digest("hex");
  const { host: _h, ...sendHeaders } = all;
  sendHeaders.Authorization = `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  return fetch(`https://${host}${uri}`, { method, headers: sendHeaders, body: method === "PUT" ? body : undefined });
}

async function copy(file) {
  const head = await signedRequest("HEAD", file.name);
  if (head.ok && file.size != null && Number(head.headers.get("content-length")) === file.size) return "skipped";

  const src = await fetch(`${SUPABASE_URL}/storage/v1/object/${SRC_BUCKET}/${encodeKey(file.name)}`, { headers: sbHeaders });
  if (!src.ok) throw new Error(`download ${file.name}: ${src.status}`);
  const body = Buffer.from(await src.arrayBuffer());

  const put = await signedRequest("PUT", file.name, { "content-type": file.type, "cache-control": CACHE_CONTROL }, body);
  if (!put.ok) throw new Error(`upload ${file.name}: ${put.status} ${await put.text()}`);
  return "copied";
}

const files = await listAll();
console.log(`Supabase bucket: ${files.length} files`);
const counts = { copied: 0, skipped: 0, failed: 0 };
let i = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (i < files.length) {
    const f = files[i++];
    try {
      counts[await copy(f)]++;
    } catch (e) {
      counts.failed++;
      console.error(e.message);
    }
    const done = counts.copied + counts.skipped + counts.failed;
    if (done % 100 === 0) console.log(`${done}/${files.length}`, counts);
  }
}));
console.log("Done:", counts);
if (counts.failed) process.exit(1);
