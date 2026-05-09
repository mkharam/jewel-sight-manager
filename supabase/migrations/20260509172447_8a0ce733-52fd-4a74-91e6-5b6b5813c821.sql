
-- Allow all authenticated employees to update transfers, quotes, products
DROP POLICY IF EXISTS "admin or branch manager update transfers" ON public.transfers;
CREATE POLICY "auth update transfers" ON public.transfers
  FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "manager modify quotes" ON public.product_quotes;
CREATE POLICY "auth update quotes" ON public.product_quotes
  FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "manager update products" ON public.products;
CREATE POLICY "auth update products" ON public.products
  FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Auto-log activity triggers for live notifications
CREATE OR REPLACE FUNCTION public.log_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  act text;
  details jsonb;
  ent_id uuid;
  ent_type text := TG_TABLE_NAME;
BEGIN
  IF TG_OP = 'INSERT' THEN
    act := 'created';
    ent_id := NEW.id;
    IF TG_TABLE_NAME = 'transfers' THEN
      details := jsonb_build_object('product', NEW.product_name_snapshot, 'from', NEW.from_branch_id, 'to', NEW.to_branch_id, 'status', NEW.status);
    ELSIF TG_TABLE_NAME = 'product_quotes' THEN
      details := jsonb_build_object('product_id', NEW.product_id, 'price', NEW.price, 'customer', NEW.customer_name);
    ELSIF TG_TABLE_NAME = 'customer_inquiries' THEN
      details := jsonb_build_object('customer', NEW.customer_name, 'description', NEW.description);
    ELSIF TG_TABLE_NAME = 'products' THEN
      details := jsonb_build_object('name', NEW.name);
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    ent_id := NEW.id;
    IF TG_TABLE_NAME = 'transfers' AND NEW.status IS DISTINCT FROM OLD.status THEN
      act := 'status_' || NEW.status::text;
      details := jsonb_build_object('product', NEW.product_name_snapshot, 'from', NEW.from_branch_id, 'to', NEW.to_branch_id, 'status', NEW.status);
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  IF act IS NOT NULL THEN
    INSERT INTO public.activity_log (actor_id, entity_type, entity_id, action, details)
    VALUES (actor, ent_type, ent_id, act, details);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS log_transfers ON public.transfers;
CREATE TRIGGER log_transfers AFTER INSERT OR UPDATE ON public.transfers
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();

DROP TRIGGER IF EXISTS log_quotes ON public.product_quotes;
CREATE TRIGGER log_quotes AFTER INSERT ON public.product_quotes
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();

DROP TRIGGER IF EXISTS log_inquiries ON public.customer_inquiries;
CREATE TRIGGER log_inquiries AFTER INSERT ON public.customer_inquiries
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();

-- Enable realtime
ALTER TABLE public.activity_log REPLICA IDENTITY FULL;
ALTER TABLE public.product_quotes REPLICA IDENTITY FULL;
ALTER TABLE public.customer_inquiries REPLICA IDENTITY FULL;
ALTER TABLE public.transfers REPLICA IDENTITY FULL;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_log;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.product_quotes;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_inquiries;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
