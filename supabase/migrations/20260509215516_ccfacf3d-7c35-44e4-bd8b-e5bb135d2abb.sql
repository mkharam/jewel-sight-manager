ALTER TABLE public.product_images ADD COLUMN IF NOT EXISTS source_url text;
CREATE INDEX IF NOT EXISTS idx_product_images_source_url ON public.product_images(source_url) WHERE source_url IS NOT NULL;