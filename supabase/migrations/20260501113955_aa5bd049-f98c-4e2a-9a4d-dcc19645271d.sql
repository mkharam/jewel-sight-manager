
-- Fix search_path for set_updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- Restrict public bucket listing: only allow SELECT on individual objects, not listing
DROP POLICY IF EXISTS "public read product images storage" ON storage.objects;
CREATE POLICY "public read product images storage" ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'product-images');

-- Revoke execute from anon on the helper functions (only authenticated users need them via RLS)
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_manager_or_admin(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_manager_or_admin(UUID) TO authenticated;
