# Photo pipeline: categorize, search, auto-name

One unified plan for the three photo touchpoints — **storing photos per branch**, **searching by photo**, and **AI auto-fill when adding a product**. All AI runs through **Lovable AI Gateway** (`LOVABLE_API_KEY` is already provisioned), model `google/gemini-3-flash-preview` for vision + text. No third-party keys, no OpenRouter, no Gemini free tier — the Gateway is what the workspace pays for.

---

## 1. How photos are stored & organized per branch

Today: `product-images` public bucket, rows in `product_images` (path + is_primary). Nothing branch-aware.

**Change:** keep one bucket, use the *path* as the organizational key.

```
product-images/
  branch-<branchId>/
    <productId>/
      <uuid>.webp        ← original upload, WebP-compressed to ~1600px
      <uuid>_thumb.webp  ← 400px thumb for cards/search results
```

Why not one bucket per branch: buckets are heavy, RLS on `storage.objects` can filter by path prefix just as well, thumbnails share the same CDN, and cross-branch transfers keep the same URL.

**On `product_images` add columns:** `width`, `height`, `thumb_path`, `ai_labels jsonb`, `ai_embedding vector(1536)`, `dominant_color text`. `ai_labels` holds `{ category, karat, style, gemstones, description }` returned by the analyzer. The embedding column powers vector search (§2).

**RLS on storage:** employees can read all photos (they need to find pieces across branches), but insert/delete only under `branch-<own_branch_id>/`. Managers/admins: all branches.

---

## 2. Search by photo (visual similarity, not keyword)

The current `image-search` edge function asks Gemini "describe this image", then does an `ilike` on `products.name/description`. That's why it fails as soon as the vision quota hits — every search is a fresh vision call.

**Move to vector search — one vision call per *product*, zero per search.**

Pipeline:

1. **On product save** (new photo added): edge function calls Lovable AI Gateway → `google/gemini-embedding-001` on the image (multimodal embedding) → stores 1536-dim vector in `product_images.ai_embedding`. Also runs a *single* Gemini vision pass to fill `ai_labels` (category, karat guess, style, gems, short caption).
2. **On search-by-photo**: same embedding call on the customer's photo (one Gateway request, cheap), then Postgres `ORDER BY embedding <=> query_embedding LIMIT 12` using `pgvector` HNSW index. Returns top matches in <100ms, no LLM in the loop.
3. **Optional re-rank**: if the top 12 look close by cosine distance, skip re-rank. If distances are wide, one Gemini call can pick the best 6 — but this is a v2 nicety.

Adds pgvector extension + HNSW index on `product_images.ai_embedding`. Search cost drops from "1 vision call per search" to "1 embedding call per search" (roughly 10× cheaper) and stops breaking when vision is rate-limited.

Text search stays as-is on `products.name`; the two blend on the search page: text results first, then "قطع مشابهة بالصورة" section below when the user searched by photo.

---

## 3. AI auto-fill when adding a new product

Today: employee uploads photo → types name, category, karat, weight, etc. Slow and inconsistent between branches.

**New flow in `ProductForm`:**

1. Employee picks/takes a photo. Upload starts immediately in the background.
2. Once uploaded, a new edge function `analyze-product-image` is invoked. It calls Gemini vision with a **strict JSON schema** (via `Output.object` / `generateObject`) returning:
   ```
   {
     name_ar: string,           // "خاتم ذهبي بحجر أزرق"
     category_slug: enum,       // matched to existing categories
     karat_guess: "18K"|"21K"|"22K"|"24K"|null,
     style: string[],           // ["كلاسيكي","خطوبة"]
     gemstones: string[],       // ["زفير","ألماس"]
     estimated_weight_g: number|null,  // rough, only if scale visible
     description_ar: string     // 1–2 sentences
   }
   ```
3. Form fields **pre-fill** with the AI's guesses, each field marked with a small ✨ badge = "AI اقترح". Employee reviews and edits in one glance — no retyping unless the AI is wrong.
4. Same call also produces the embedding + labels stored on `product_images` (§2), so nothing is wasted.
5. Fallback if the Gateway returns 402/429: the form still works, fields stay empty, employee fills manually. A toast says "AI مشغول الآن — املأ يدوياً".

Category is matched by asking Gemini to pick from the *existing* `categories` list (passed in the prompt), not free-text — this keeps the taxonomy clean.

---

## 4. Migration off the two current Gemini functions

- `supabase/functions/image-search`: rewrite to embedding-based search (§2). Drops the ad-hoc `GEMINI_API_KEY` — uses `LOVABLE_API_KEY` via the Gateway helper.
- `supabase/functions/social-analyze-image`: same migration to Gateway, reuses the same JSON schema as `analyze-product-image` so social imports and manual adds produce identical data.

---

## Technical section

**DB migration:**
- `create extension if not exists vector;`
- `alter table product_images add column thumb_path text, width int, height int, ai_labels jsonb default '{}'::jsonb, ai_embedding vector(1536), dominant_color text;`
- `create index product_images_embedding_idx on product_images using hnsw (ai_embedding vector_cosine_ops);`
- SQL function `match_product_images(query_embedding vector(1536), match_count int)` returning `product_id, similarity`.
- Storage RLS on `storage.objects` filtering path prefix `branch-<uid's branch_id>/` for write; open read.

**Edge functions:**
- `analyze-product-image` (new): input `{ imagePath }` → returns structured JSON + writes embedding & labels to `product_images`.
- `image-search` (rewrite): input `{ imagePath | imageBase64 }` → embeds → RPC `match_product_images` → returns product ids ordered by similarity.
- `social-analyze-image` (rewrite): same as `analyze-product-image` but reads from social scraper's temp URL.
- Shared `_shared/ai-gateway.ts` provider helper per the AI SDK Gateway pattern.

**Client:**
- `ImageSearchButton`: instead of applying text filters, navigate to `/products?similarTo=<uploadId>` and render similarity results grid.
- `ProductForm`: add "Analyze with AI" auto-trigger on first photo upload, ✨ badges on pre-filled fields, manual override always available.
- Thumbnails: generate `_thumb.webp` client-side (Canvas resize) before upload, so cards never fetch full-size images.

**Costs (order of magnitude, per employee action):**
- Add product: 1 vision + 1 embedding call (~one-time per product).
- Search by photo: 1 embedding call (~10× cheaper than vision).
- Browse: zero AI calls.

---

## Not in scope now

- On-device embedding (privacy/cost win, but adds ~5MB model download).
- Re-embedding all existing photos in a batch job — can run once after deploy.
- Face/hand detection to auto-crop (nice-to-have).

---

## Suggested build order

1. DB migration (pgvector, new columns, RPC, storage RLS).
2. `_shared/ai-gateway.ts` + rewrite `image-search` to embeddings.
3. `analyze-product-image` + wire into `ProductForm` with ✨ pre-fill.
4. Backfill script: embed every existing product's primary image.
5. Rewrite `social-analyze-image` to reuse the same schema.

Ready to start with step 1 (DB migration), or want to reorder?
