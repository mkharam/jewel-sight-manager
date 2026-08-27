-- 1) products: new identity + verification columns
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS serial_number text,
  ADD COLUMN IF NOT EXISTS barcode_value text,
  ADD COLUMN IF NOT EXISTS showcase_location text,
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_verified_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 2) backfill SKUs for existing rows (all currently null), then enforce
DO $$
DECLARE r record; s text;
BEGIN
  FOR r IN SELECT id, branch_id, item_type FROM public.products WHERE sku IS NULL OR btrim(sku) = '' LOOP
    s := public.next_sku(r.branch_id, r.item_type);
    UPDATE public.products SET sku = s WHERE id = r.id;
  END LOOP;
END $$;

-- de-duplicate any accidental duplicates before unique index
DO $$
DECLARE r record; n int;
BEGIN
  FOR r IN
    SELECT id, sku FROM (
      SELECT id, sku, row_number() OVER (PARTITION BY sku ORDER BY created_at) rn
      FROM public.products WHERE sku IS NOT NULL
    ) x WHERE rn > 1
  LOOP
    n := 1;
    WHILE EXISTS (SELECT 1 FROM public.products WHERE sku = r.sku || '-' || n) LOOP n := n + 1; END LOOP;
    UPDATE public.products SET sku = r.sku || '-' || n WHERE id = r.id;
  END LOOP;
END $$;

-- auto-generate SKU on insert when missing, so NOT NULL never breaks imports
CREATE OR REPLACE FUNCTION public.ensure_product_sku()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.sku IS NULL OR btrim(NEW.sku) = '' THEN
    NEW.sku := public.next_sku(NEW.branch_id, NEW.item_type);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ensure_product_sku ON public.products;
CREATE TRIGGER trg_ensure_product_sku
  BEFORE INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.ensure_product_sku();

ALTER TABLE public.products ALTER COLUMN sku SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS products_sku_unique ON public.products (sku);
CREATE UNIQUE INDEX IF NOT EXISTS products_serial_number_unique
  ON public.products (serial_number) WHERE serial_number IS NOT NULL AND btrim(serial_number) <> '';
CREATE UNIQUE INDEX IF NOT EXISTS products_barcode_value_unique
  ON public.products (barcode_value) WHERE barcode_value IS NOT NULL AND btrim(barcode_value) <> '';
CREATE INDEX IF NOT EXISTS products_last_verified_at_idx ON public.products (last_verified_at);
CREATE INDEX IF NOT EXISTS products_status_idx ON public.products (status);

-- 3) manager-only guards on sensitive product changes (DB enforced)
CREATE OR REPLACE FUNCTION public.guard_product_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE is_mgr boolean := public.is_manager_or_admin(auth.uid());
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW; -- service role / edge functions / triggers
  END IF;

  IF NOT is_mgr THEN
    IF NEW.sku IS DISTINCT FROM OLD.sku
       OR NEW.serial_number IS DISTINCT FROM OLD.serial_number
       OR NEW.barcode_value IS DISTINCT FROM OLD.barcode_value THEN
      RAISE EXCEPTION 'تعديل رقم القطعة أو التسلسلي أو الباركود متاح للمدير فقط';
    END IF;
    IF NEW.status::text = 'archived' AND OLD.status::text <> 'archived' THEN
      RAISE EXCEPTION 'أرشفة القطع متاحة للمدير فقط';
    END IF;
    IF OLD.status::text = 'stock_discrepancy' AND NEW.status::text <> 'stock_discrepancy' THEN
      RAISE EXCEPTION 'إغلاق فرق الجرد متاح للمدير فقط';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_product_changes ON public.products;
CREATE TRIGGER trg_guard_product_changes
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.guard_product_changes();

-- 4) reservations: block sold/archived products
CREATE OR REPLACE FUNCTION public.guard_reservation_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE st text;
BEGIN
  SELECT status::text INTO st FROM public.products WHERE id = NEW.product_id;
  IF st IN ('sold','archived') THEN
    RAISE EXCEPTION 'لا يمكن حجز قطعة مبيعة أو مؤرشفة';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_reservation_product ON public.reservations;
CREATE TRIGGER trg_guard_reservation_product
  BEFORE INSERT ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.guard_reservation_product();

-- 5) transfers: block sold/archived products + block duplicate acceptance
CREATE OR REPLACE FUNCTION public.guard_transfer_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE st text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.product_id IS NOT NULL THEN
      SELECT status::text INTO st FROM public.products WHERE id = NEW.product_id;
      IF st IN ('sold','archived') THEN
        RAISE EXCEPTION 'لا يمكن تحويل قطعة مبيعة أو مؤرشفة';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status::text = 'received' AND OLD.status::text IN ('received','rejected','cancelled') THEN
    RAISE EXCEPTION 'هذا التحويل مغلق مسبقاً ولا يمكن استلامه مرة أخرى';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_transfer_rules ON public.transfers;
CREATE TRIGGER trg_guard_transfer_rules
  BEFORE INSERT OR UPDATE ON public.transfers
  FOR EACH ROW EXECUTE FUNCTION public.guard_transfer_rules();

-- 6) sales: Amar invoice reference + return/cancel tracking
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS amar_invoice_number text,
  ADD COLUMN IF NOT EXISTS returned_at timestamptz,
  ADD COLUMN IF NOT EXISTS returned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS return_reason text;

CREATE UNIQUE INDEX IF NOT EXISTS sales_product_amar_invoice_unique
  ON public.sales (product_id, amar_invoice_number)
  WHERE amar_invoice_number IS NOT NULL AND btrim(amar_invoice_number) <> '';

-- manager-only sale return
CREATE OR REPLACE FUNCTION public.return_sale(_sale_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE s record;
BEGIN
  IF NOT public.is_manager_or_admin(auth.uid()) THEN
    RAISE EXCEPTION 'إرجاع البيع متاح للمدير فقط';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'سبب الإرجاع مطلوب';
  END IF;

  SELECT * INTO s FROM public.sales WHERE id = _sale_id;
  IF s IS NULL THEN RAISE EXCEPTION 'البيعة غير موجودة'; END IF;
  IF s.returned_at IS NOT NULL THEN RAISE EXCEPTION 'تم إرجاع هذه البيعة مسبقاً'; END IF;

  UPDATE public.sales
     SET returned_at = now(), returned_by = auth.uid(), return_reason = _reason
   WHERE id = _sale_id;

  IF s.product_id IS NOT NULL THEN
    UPDATE public.products SET status = 'available' WHERE id = s.product_id;
  END IF;

  INSERT INTO public.activity_log (actor_id, entity_type, entity_id, action, details)
  VALUES (auth.uid(), 'sales', _sale_id, 'sale_returned',
          jsonb_build_object('product_id', s.product_id, 'reference', s.amar_invoice_number,
                             'final_price', s.final_price, 'reason', _reason));
END $$;

REVOKE ALL ON FUNCTION public.return_sale(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.return_sale(uuid, text) TO authenticated;

-- 7) richer activity logging for products (adds branch/location change)
CREATE OR REPLACE FUNCTION public.log_product_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.showcase_location IS DISTINCT FROM OLD.showcase_location THEN
    INSERT INTO public.activity_log (actor_id, entity_type, entity_id, action, details)
    VALUES (auth.uid(), 'products', NEW.id, 'location_changed',
            jsonb_build_object('name', NEW.name, 'sku', NEW.sku,
                               'old_branch_id', OLD.branch_id, 'new_branch_id', NEW.branch_id,
                               'old_showcase', OLD.showcase_location, 'new_showcase', NEW.showcase_location));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_log_product_movement ON public.products;
CREATE TRIGGER trg_log_product_movement
  AFTER UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.log_product_movement();