CREATE OR REPLACE FUNCTION public.sku_type_letter(_item_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _item_type IS NULL OR btrim(_item_type) = '' THEN 'X'
    WHEN _item_type ~ 'خاتم' THEN 'R'
    WHEN _item_type ~ '(دبل|محبس)' THEN 'G'
    WHEN _item_type ~ '(سلسال|سلسل|قلاد|كرد)' THEN 'N'
    WHEN _item_type ~ '(اسور|أسور|غوي|بنجر)' THEN 'B'
    WHEN _item_type ~ '(حلق|اقراط|أقراط)' THEN 'E'
    WHEN _item_type ~ 'طقم' THEN 'S'
    WHEN _item_type ~ '(تعليق|دلاي|بندول)' THEN 'P'
    WHEN _item_type ~ 'خلخ' THEN 'A'
    ELSE 'X'
  END;
$$;

CREATE OR REPLACE FUNCTION public.next_sku(_branch_id uuid, _item_type text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  bcode text;
  tletter text := public.sku_type_letter(_item_type);
  prefix text;
  n integer;
  candidate text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

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
GRANT EXECUTE ON FUNCTION public.sku_type_letter(text) TO authenticated;