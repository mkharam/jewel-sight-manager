-- ============ SUPPLIERS ============
CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;
GRANT ALL ON public.suppliers TO service_role;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read suppliers" ON public.suppliers FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage suppliers" ON public.suppliers FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role)) WITH CHECK (has_role(auth.uid(),'admin'::app_role));
CREATE TRIGGER trg_suppliers_updated BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ PRODUCT COLUMNS ============
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS received_at date,
  ADD COLUMN IF NOT EXISTS gold_color text,
  ADD COLUMN IF NOT EXISTS hallmark text,
  ADD COLUMN IF NOT EXISTS making_charge numeric;

-- ============ PRODUCT STONES ============
CREATE TABLE public.product_stones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  stone_type text NOT NULL,
  quantity integer,
  carat numeric,
  color text,
  clarity text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_stones TO authenticated;
GRANT ALL ON public.product_stones TO service_role;
ALTER TABLE public.product_stones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read stones" ON public.product_stones FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth manage stones" ON public.product_stones FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE INDEX idx_product_stones_product ON public.product_stones(product_id);

-- ============ PRODUCT CERTIFICATES ============
CREATE TABLE public.product_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  cert_number text,
  issuer text,
  issued_at date,
  file_path text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_certificates TO authenticated;
GRANT ALL ON public.product_certificates TO service_role;
ALTER TABLE public.product_certificates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read certs" ON public.product_certificates FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth manage certs" ON public.product_certificates FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE INDEX idx_product_certs_product ON public.product_certificates(product_id);

-- ============ CUSTOMERS ============
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  phone text,
  notes text,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read customers" ON public.customers FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert customers" ON public.customers FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth update customers" ON public.customers FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "admin delete customers" ON public.customers FOR DELETE TO authenticated USING (has_role(auth.uid(),'admin'::app_role));
CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_customers_phone ON public.customers(phone);

-- ============ WISHLIST ============
CREATE TABLE public.wishlist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  wanted_text text,
  budget numeric,
  is_fulfilled boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wishlist_items TO authenticated;
GRANT ALL ON public.wishlist_items TO service_role;
ALTER TABLE public.wishlist_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read wishlist" ON public.wishlist_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth manage wishlist" ON public.wishlist_items FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- ============ RESERVATIONS ============
CREATE TYPE public.reservation_status AS ENUM ('active','expired','cancelled','converted');

CREATE TABLE public.reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name text,
  customer_phone text,
  deposit numeric NOT NULL DEFAULT 0,
  agreed_price numeric,
  expires_at date NOT NULL,
  status public.reservation_status NOT NULL DEFAULT 'active',
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  notes text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reservations TO authenticated;
GRANT ALL ON public.reservations TO service_role;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read reservations" ON public.reservations FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert reservations" ON public.reservations FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth update reservations" ON public.reservations FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "admin delete reservations" ON public.reservations FOR DELETE TO authenticated USING (has_role(auth.uid(),'admin'::app_role));
CREATE TRIGGER trg_reservations_updated BEFORE UPDATE ON public.reservations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_reservations_product ON public.reservations(product_id);
CREATE INDEX idx_reservations_status ON public.reservations(status, expires_at);

-- ============ SALES ============
CREATE TABLE public.sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name_snapshot text,
  sku_snapshot text,
  weight_grams numeric,
  karat text,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name text,
  customer_phone text,
  final_price numeric NOT NULL,
  discount numeric NOT NULL DEFAULT 0,
  payment_method text,
  sold_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes text,
  sold_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales TO authenticated;
GRANT ALL ON public.sales TO service_role;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read sales" ON public.sales FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert sales" ON public.sales FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth update sales" ON public.sales FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "admin delete sales" ON public.sales FOR DELETE TO authenticated USING (has_role(auth.uid(),'admin'::app_role));
CREATE INDEX idx_sales_branch_date ON public.sales(branch_id, sold_at DESC);

-- ============ GOLD PRICES ============
CREATE TABLE public.gold_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  karat text NOT NULL,
  price_per_gram numeric NOT NULL,
  making_charge numeric NOT NULL DEFAULT 0,
  effective_date date NOT NULL DEFAULT CURRENT_DATE,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (karat, effective_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gold_prices TO authenticated;
GRANT ALL ON public.gold_prices TO service_role;
ALTER TABLE public.gold_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read gold prices" ON public.gold_prices FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage gold prices" ON public.gold_prices FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role)) WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- ============ STOCK TAKE ============
CREATE TYPE public.stock_take_status AS ENUM ('open','closed');
CREATE TYPE public.stock_take_result AS ENUM ('found','missing','extra');

CREATE TABLE public.stock_take_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  status public.stock_take_status NOT NULL DEFAULT 'open',
  started_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  closed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes text,
  started_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_take_sessions TO authenticated;
GRANT ALL ON public.stock_take_sessions TO service_role;
ALTER TABLE public.stock_take_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read stock sessions" ON public.stock_take_sessions FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert stock sessions" ON public.stock_take_sessions FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth update stock sessions" ON public.stock_take_sessions FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "admin delete stock sessions" ON public.stock_take_sessions FOR DELETE TO authenticated USING (has_role(auth.uid(),'admin'::app_role));
CREATE TRIGGER trg_stock_sessions_updated BEFORE UPDATE ON public.stock_take_sessions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.stock_take_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.stock_take_sessions(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  result public.stock_take_result NOT NULL DEFAULT 'found',
  notes text,
  checked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, product_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_take_items TO authenticated;
GRANT ALL ON public.stock_take_items TO service_role;
ALTER TABLE public.stock_take_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read stock items" ON public.stock_take_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth manage stock items" ON public.stock_take_items FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE INDEX idx_stock_items_session ON public.stock_take_items(session_id);

-- ============ AUTOMATION ============
-- reservation -> product status
CREATE OR REPLACE FUNCTION public.apply_reservation_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
    UPDATE public.products SET status = 'reserved' WHERE id = NEW.product_id AND status = 'available';
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'active' THEN
      UPDATE public.products SET status = 'reserved' WHERE id = NEW.product_id AND status = 'available';
    ELSIF NEW.status IN ('cancelled','expired') THEN
      UPDATE public.products SET status = 'available' WHERE id = NEW.product_id AND status = 'reserved';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_reservation_status AFTER INSERT OR UPDATE ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.apply_reservation_status();

-- sale -> product sold + close reservation
CREATE OR REPLACE FUNCTION public.apply_sale_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.product_id IS NOT NULL THEN
    UPDATE public.products SET status = 'sold' WHERE id = NEW.product_id;
    UPDATE public.reservations SET status = 'converted'
      WHERE product_id = NEW.product_id AND status = 'active';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_sale_status AFTER INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.apply_sale_status();

-- expire reservations (callable from app/cron)
CREATE OR REPLACE FUNCTION public.expire_due_reservations()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  WITH upd AS (
    UPDATE public.reservations SET status = 'expired'
    WHERE status = 'active' AND expires_at < CURRENT_DATE
    RETURNING 1
  ) SELECT count(*) INTO n FROM upd;
  RETURN COALESCE(n,0);
END; $$;
GRANT EXECUTE ON FUNCTION public.expire_due_reservations() TO authenticated;

-- activity logging for new tables
CREATE OR REPLACE FUNCTION public.log_luxury_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d jsonb; a text;
BEGIN
  IF TG_TABLE_NAME = 'reservations' THEN
    IF TG_OP = 'INSERT' THEN a := 'reserved';
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN a := 'reservation_' || NEW.status::text;
    ELSE RETURN NEW; END IF;
    d := jsonb_build_object('product_id', NEW.product_id, 'customer', NEW.customer_name, 'deposit', NEW.deposit, 'expires_at', NEW.expires_at);
  ELSIF TG_TABLE_NAME = 'sales' THEN
    a := 'sold';
    d := jsonb_build_object('product', NEW.product_name_snapshot, 'price', NEW.final_price, 'branch_id', NEW.branch_id);
  ELSIF TG_TABLE_NAME = 'wishlist_items' THEN
    a := 'wishlist_added';
    d := jsonb_build_object('customer_id', NEW.customer_id, 'wanted', NEW.wanted_text);
  END IF;

  IF a IS NOT NULL THEN
    INSERT INTO public.activity_log (actor_id, entity_type, entity_id, action, details)
    VALUES (auth.uid(), TG_TABLE_NAME, NEW.id, a, d);
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER log_reservations AFTER INSERT OR UPDATE ON public.reservations FOR EACH ROW EXECUTE FUNCTION public.log_luxury_activity();
CREATE TRIGGER log_sales AFTER INSERT ON public.sales FOR EACH ROW EXECUTE FUNCTION public.log_luxury_activity();
CREATE TRIGGER log_wishlist AFTER INSERT ON public.wishlist_items FOR EACH ROW EXECUTE FUNCTION public.log_luxury_activity();

-- realtime
ALTER TABLE public.reservations REPLICA IDENTITY FULL;
ALTER TABLE public.sales REPLICA IDENTITY FULL;
ALTER TABLE public.wishlist_items REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.reservations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.sales;
ALTER PUBLICATION supabase_realtime ADD TABLE public.wishlist_items;
