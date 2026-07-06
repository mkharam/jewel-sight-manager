
-- pgvector for similarity search on product images
CREATE EXTENSION IF NOT EXISTS vector;

-- Add photo AI columns
ALTER TABLE public.product_images
  ADD COLUMN IF NOT EXISTS thumb_path text,
  ADD COLUMN IF NOT EXISTS width int,
  ADD COLUMN IF NOT EXISTS height int,
  ADD COLUMN IF NOT EXISTS ai_labels jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ai_embedding vector(1536),
  ADD COLUMN IF NOT EXISTS dominant_color text;

-- HNSW cosine index for fast top-K similarity
CREATE INDEX IF NOT EXISTS product_images_embedding_idx
  ON public.product_images
  USING hnsw (ai_embedding vector_cosine_ops);

-- RPC: return best matching product images ranked by similarity
CREATE OR REPLACE FUNCTION public.match_product_images(
  query_embedding vector(1536),
  match_count int DEFAULT 12
)
RETURNS TABLE (
  image_id uuid,
  product_id uuid,
  storage_path text,
  thumb_path text,
  similarity float
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pi.id AS image_id,
    pi.product_id,
    pi.storage_path,
    pi.thumb_path,
    1 - (pi.ai_embedding <=> query_embedding) AS similarity
  FROM public.product_images pi
  WHERE pi.ai_embedding IS NOT NULL
  ORDER BY pi.ai_embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_product_images(vector, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_product_images(vector, int) TO service_role;

-- Storage RLS: employees write only under their own branch prefix; everyone in auth reads.
-- Path convention: branch-<branch_id>/<product_id>/<file>.webp
-- (Public bucket already allows anon reads via CDN; these policies gate authenticated writes.)

DROP POLICY IF EXISTS "product-images write own branch" ON storage.objects;
CREATE POLICY "product-images write own branch"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'product-images'
  AND (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR (
      (storage.foldername(name))[1] = 'branch-' || (
        SELECT branch_id::text FROM public.profiles WHERE id = auth.uid()
      )
    )
  )
);

DROP POLICY IF EXISTS "product-images delete own branch" ON storage.objects;
CREATE POLICY "product-images delete own branch"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'product-images'
  AND (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR (
      (storage.foldername(name))[1] = 'branch-' || (
        SELECT branch_id::text FROM public.profiles WHERE id = auth.uid()
      )
    )
  )
);
