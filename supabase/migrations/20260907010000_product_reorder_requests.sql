-- ============ PRODUCT REORDER REQUESTS ============
-- موظف يطلب إعادة طلب قطعة (نفس القطعة أو مشابهة) لزبون — يظهر للمدراء ليطلبوها من المورد.
CREATE TYPE public.reorder_status AS ENUM ('pending', 'ordered', 'received', 'cancelled');

CREATE TABLE public.product_reorder_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name_snapshot text NOT NULL,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  customer_name text,
  customer_phone text,
  quantity integer NOT NULL DEFAULT 1,
  note text,
  status public.reorder_status NOT NULL DEFAULT 'pending',
  requested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  handled_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  handled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_reorder_requests TO authenticated;
GRANT ALL ON public.product_reorder_requests TO service_role;
ALTER TABLE public.product_reorder_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read reorder requests" ON public.product_reorder_requests FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert reorder requests" ON public.product_reorder_requests FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "manager update reorder requests" ON public.product_reorder_requests FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role));
CREATE POLICY "admin delete reorder requests" ON public.product_reorder_requests FOR DELETE TO authenticated USING (has_role(auth.uid(),'admin'::app_role));
CREATE TRIGGER trg_reorder_requests_updated BEFORE UPDATE ON public.product_reorder_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_reorder_requests_status ON public.product_reorder_requests(status, created_at DESC);
CREATE INDEX idx_reorder_requests_product ON public.product_reorder_requests(product_id);

-- activity logging + realtime
CREATE OR REPLACE FUNCTION public.log_reorder_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d jsonb; a text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    a := 'reorder_requested';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    a := 'reorder_' || NEW.status::text;
  ELSE
    RETURN NEW;
  END IF;
  d := jsonb_build_object('product', NEW.product_name_snapshot, 'product_id', NEW.product_id, 'customer', NEW.customer_name);
  INSERT INTO public.activity_log (actor_id, entity_type, entity_id, action, details)
  VALUES (auth.uid(), 'product_reorder_requests', NEW.id, a, d);
  RETURN NEW;
END; $$;
CREATE TRIGGER log_reorder_requests AFTER INSERT OR UPDATE ON public.product_reorder_requests
  FOR EACH ROW EXECUTE FUNCTION public.log_reorder_activity();

ALTER TABLE public.product_reorder_requests REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.product_reorder_requests;
