# AI photo analysis + attribute & similarity search

## Where the system already stands (verified in code)

Most of what you described is already built and running:

- **Vision auto-tagging** — `supabase/functions/_shared/lovable-ai.ts` returns a structured analysis for every uploaded photo: `name_ar`, `category_name`, `karat`, `metal_color`, `style[]`, `gemstones[]`, `description_ar`, through a Groq → Gemini → Lovable AI fallback chain.
- **Storage** — `product_images.ai_labels` (jsonb) holds that analysis, `product_images.ai_embedding` (pgvector) holds the vector.
- **Visual similarity search** — `image-search` edge function embeds the query photo's description and runs the `match_product_images` pgvector RPC; `ProductSearch.tsx` already buckets results as مطابقة (≥0.92) / شبه مطابقة (0.80–0.92) / مقاربة (0.65–0.80).
- **Bulk upload** — `BulkImport.tsx` uploads and analyzes in a 4-worker parallel pipeline, and persists the embedding on save.

So the answer to your question 1 is: **both, and both already exist.** The vision model does the naming/tagging (human-readable, editable, filterable), the embedding does visual/attribute similarity. They are chained — the embedding is built from the AI's description text, which is why similarity respects "gold chain 21K" and not just shape.

## What is actually missing

Three real gaps between what exists and what you described:

1. **Tags are stored but not searchable.** Text search only hits `products.name`, `sku`, `description` (`ProductSearch.tsx:167`). Nothing queries `ai_labels`, so a search for "لؤلؤ" or "ذهب أبيض" finds nothing even though the AI detected it.
2. **No "find similar" from an existing piece.** Similarity search only starts from a freshly uploaded photo. There is no button on a product to say "show me pieces like this one" using the vector already stored.
3. **Old photos have no analysis.** Images imported before the pipeline (and any where the embedding step failed) have empty `ai_labels` / null `ai_embedding`, so they are invisible to photo search.

## Proposed scope

### Part 1 — Make AI tags searchable (small)
- Migration: add a generated/maintained `search_tags text[]` on `products`, filled from the primary image's `ai_labels` (karat, metal color, style, gemstones, category) plus a GIN index. Populated by a trigger on `product_images` update so it stays in sync.
- `ProductSearch.tsx`: include tags in the text query, and add tappable filter chips (لون المعدن، أحجار، ستايل) built from the distinct tag values.

### Part 2 — "Find similar" on a product (small)
- New RPC `match_similar_products(product_id, match_count)` that reuses the stored embedding of that product's primary image and excludes itself.
- Button on `ProductDetail.tsx` → routes to `ProductSearch` in similarity mode, reusing the existing bucket UI. No new AI call, no cost.

### Part 3 — Backfill / re-index (small–medium)
- Admin-only "إعادة فهرسة الصور" action that finds images with null `ai_embedding` and processes them in batches through the existing fallback chain, with a progress count.
- Same code path as bulk import, so no new AI logic.

## Technical notes

- No new AI provider or model needed; the existing `analyzeWithFallback` and `embedText` cover it.
- Schema changes are additive only: one `text[]` column + GIN index on `products`, one trigger, one new SQL function. No table rewrites, no data loss.
- Embeddings already stored are reused for Part 2, so it adds latency of a single pgvector query.

## Complexity

- Part 1: ~1 migration + 1 page edit.
- Part 2: ~1 migration + 2 small component edits.
- Part 3: ~1 edge function + 1 admin UI block.

Overall: a focused follow-on to the existing pipeline rather than a new build.

## Assumption to confirm

I am assuming you want tags derived from the **primary image only** (one product = one representative tag set). If you'd rather union tags across all images of a product, say so and I'll adjust Part 1.
