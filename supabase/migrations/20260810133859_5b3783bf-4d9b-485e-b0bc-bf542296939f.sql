-- 1) search_tags column on products
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS search_tags text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_products_search_tags ON public.products USING gin (search_tags);

-- 2) derive tags from a jsonb ai_labels payload
CREATE OR REPLACE FUNCTION public.tags_from_ai_labels(labels jsonb)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  out_tags text[] := '{}';
  v text;
BEGIN
  IF labels IS NULL OR labels = '{}'::jsonb THEN
    RETURN out_tags;
  END IF;

  v := NULLIF(labels->>'karat', '');
  IF v IS NOT NULL THEN out_tags := out_tags || v; END IF;

  v := NULLIF(labels->>'category_name', '');
  IF v IS NOT NULL THEN out_tags := out_tags || v; END IF;

  v := NULLIF(labels->>'metal_color', '');
  IF v IS NOT NULL THEN
    out_tags := out_tags || CASE v
      WHEN 'yellow' THEN 'ذهب أصفر'
      WHEN 'white'  THEN 'ذهب أبيض'
      WHEN 'rose'   THEN 'ذهب وردي'
      WHEN 'mixed'  THEN 'ألوان مختلطة'
      ELSE v END;
  END IF;

  IF jsonb_typeof(labels->'style') = 'array' THEN
    out_tags := out_tags || ARRAY(
      SELECT DISTINCT trim(x) FROM jsonb_array_elements_text(labels->'style') AS t(x)
      WHERE trim(x) <> ''
    );
  END IF;

  IF jsonb_typeof(labels->'gemstones') = 'array' THEN
    out_tags := out_tags || ARRAY(
      SELECT DISTINCT trim(x) FROM jsonb_array_elements_text(labels->'gemstones') AS t(x)
      WHERE trim(x) <> ''
    );
  END IF;

  RETURN ARRAY(SELECT DISTINCT unnest(out_tags));
END; $$;

-- 3) keep products.search_tags in sync with the primary image's ai_labels
CREATE OR REPLACE FUNCTION public.sync_product_search_tags()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pid uuid := COALESCE(NEW.product_id, OLD.product_id);
  lbl jsonb;
BEGIN
  SELECT pi.ai_labels INTO lbl
  FROM public.product_images pi
  WHERE pi.product_id = pid
  ORDER BY pi.is_primary DESC, pi.sort_order ASC, pi.created_at ASC
  LIMIT 1;

  UPDATE public.products p
     SET search_tags = public.tags_from_ai_labels(lbl)
   WHERE p.id = pid;

  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_sync_search_tags ON public.product_images;
CREATE TRIGGER trg_sync_search_tags
AFTER INSERT OR DELETE OR UPDATE OF ai_labels, is_primary, sort_order
ON public.product_images
FOR EACH ROW EXECUTE FUNCTION public.sync_product_search_tags();

-- 4) backfill existing products
UPDATE public.products p
   SET search_tags = public.tags_from_ai_labels(sub.ai_labels)
  FROM (
    SELECT DISTINCT ON (pi.product_id) pi.product_id, pi.ai_labels
    FROM public.product_images pi
    ORDER BY pi.product_id, pi.is_primary DESC, pi.sort_order ASC, pi.created_at ASC
  ) sub
 WHERE sub.product_id = p.id;

-- 5) visually-similar products for an existing product (reuses stored embedding)
CREATE OR REPLACE FUNCTION public.match_similar_products(
  _product_id uuid,
  match_count integer DEFAULT 24
)
RETURNS TABLE(product_id uuid, similarity double precision)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH src AS (
    SELECT pi.ai_embedding AS emb
    FROM public.product_images pi
    WHERE pi.product_id = _product_id AND pi.ai_embedding IS NOT NULL
    ORDER BY pi.is_primary DESC, pi.sort_order ASC, pi.created_at ASC
    LIMIT 1
  ), ranked AS (
    SELECT pi.product_id,
           1 - (pi.ai_embedding <=> (SELECT emb FROM src)) AS similarity,
           row_number() OVER (
             PARTITION BY pi.product_id
             ORDER BY pi.ai_embedding <=> (SELECT emb FROM src)
           ) AS rn
    FROM public.product_images pi
    WHERE pi.ai_embedding IS NOT NULL
      AND pi.product_id <> _product_id
      AND (SELECT emb FROM src) IS NOT NULL
  )
  SELECT r.product_id, r.similarity
  FROM ranked r
  WHERE r.rn = 1
  ORDER BY r.similarity DESC
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_similar_products(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tags_from_ai_labels(jsonb) TO authenticated;