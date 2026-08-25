CREATE OR REPLACE FUNCTION public.next_sku(_branch_id uuid, _item_type text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  bcode text;
  tletter text := public.sku_type_letter(_item_type);
  prefix text;
  n integer;
  candidate text;
BEGIN
  SELECT COALESCE(NULLIF(b.code, ''), 'GEN') INTO bcode
  FROM public.branches b WHERE b.id = _branch_id;
  IF bcode IS NULL THEN bcode := 'GEN'; END IF;

  prefix := bcode || '-' || tletter || '-';

  PERFORM pg_advisory_xact_lock(hashtext(prefix));

  SELECT COALESCE(MAX((regexp_replace(p.sku, '^' || prefix, ''))::integer), 0)
    INTO n
  FROM public.products p
  WHERE p.sku ~ ('^' || prefix || '[0-9]+$');

  LOOP
    n := n + 1;
    candidate := prefix || lpad(n::text, 4, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.products p WHERE p.sku = candidate);
  END LOOP;

  RETURN candidate;
END;
$$;

REVOKE ALL ON FUNCTION public.next_sku(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_sku(uuid, text) TO authenticated;