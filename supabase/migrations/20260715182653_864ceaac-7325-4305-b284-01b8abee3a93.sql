CREATE OR REPLACE FUNCTION public.log_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    ELSIF TG_TABLE_NAME = 'products' AND NEW.status IS DISTINCT FROM OLD.status THEN
      act := 'status_' || NEW.status::text;
      details := jsonb_build_object('name', NEW.name, 'from', OLD.status, 'to', NEW.status, 'branch_id', NEW.branch_id);
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  IF act IS NOT NULL THEN
    INSERT INTO public.activity_log (actor_id, entity_type, entity_id, action, details)
    VALUES (actor, ent_type, ent_id, act, details);
  END IF;
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS log_products_status ON public.products;
CREATE TRIGGER log_products_status
AFTER UPDATE ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.log_activity();