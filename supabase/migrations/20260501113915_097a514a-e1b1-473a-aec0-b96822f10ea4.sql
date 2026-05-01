
-- =========================================================
-- ENUMS
-- =========================================================
CREATE TYPE public.app_role AS ENUM ('admin', 'manager', 'employee');
CREATE TYPE public.product_status AS ENUM ('available', 'reserved', 'sold', 'in_transfer', 'damaged', 'lost');
CREATE TYPE public.inquiry_status AS ENUM ('pending', 'found', 'quoted', 'shown', 'sold', 'lost');

-- =========================================================
-- BRANCHES
-- =========================================================
CREATE TABLE public.branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  name_en TEXT,
  location TEXT,
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================
-- PROFILES
-- =========================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================
-- USER ROLES (separate table — security best practice)
-- =========================================================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- Security definer function to check roles (avoids recursive RLS)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

-- Convenience: any of admin/manager
CREATE OR REPLACE FUNCTION public.is_manager_or_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('admin','manager')
  );
$$;

-- =========================================================
-- CATEGORIES
-- =========================================================
CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  name_en TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================
-- PRODUCTS
-- =========================================================
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT UNIQUE,                       -- اختياري: رمز داخلي
  name TEXT NOT NULL,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  item_type TEXT,                         -- خاتم، سوار، سلسلة...
  karat TEXT,                             -- 18K / 21K / ألماس / ...
  weight_grams NUMERIC(10,3),
  ring_size TEXT,
  description TEXT,
  internal_notes TEXT,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  status public.product_status NOT NULL DEFAULT 'available',
  cost_price NUMERIC(12,2),
  sale_price NUMERIC(12,2),
  promo_price NUMERIC(12,2),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_products_name ON public.products USING gin (to_tsvector('simple', name));
CREATE INDEX idx_products_branch ON public.products(branch_id);
CREATE INDEX idx_products_category ON public.products(category_id);
CREATE INDEX idx_products_status ON public.products(status);
CREATE INDEX idx_products_karat ON public.products(karat);

-- =========================================================
-- PRODUCT IMAGES
-- =========================================================
CREATE TABLE public.product_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_product_images_product ON public.product_images(product_id);

-- =========================================================
-- PRODUCT QUOTES (سجل الأسعار المعروضة لمنع التخبط)
-- =========================================================
CREATE TABLE public.product_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  price NUMERIC(12,2) NOT NULL,
  customer_name TEXT,
  customer_phone TEXT,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  quoted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_quotes_product ON public.product_quotes(product_id);

-- =========================================================
-- CUSTOMER INQUIRIES
-- =========================================================
CREATE TABLE public.customer_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name TEXT,
  customer_phone TEXT,
  description TEXT,
  budget NUMERIC(12,2),
  desired_karat TEXT,
  desired_size TEXT,
  customer_image_path TEXT,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  status public.inquiry_status NOT NULL DEFAULT 'pending',
  quoted_price NUMERIC(12,2),
  internal_notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_inquiries_status ON public.customer_inquiries(status);
CREATE INDEX idx_inquiries_branch ON public.customer_inquiries(branch_id);

-- =========================================================
-- ACTIVITY LOG
-- =========================================================
CREATE TABLE public.activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_activity_entity ON public.activity_log(entity_type, entity_id);
CREATE INDEX idx_activity_actor ON public.activity_log(actor_id);

-- =========================================================
-- updated_at trigger
-- =========================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_inquiries_updated BEFORE UPDATE ON public.customer_inquiries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- handle_new_user trigger: auto-create profile + default role
-- =========================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'employee');
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================
-- ENABLE RLS
-- =========================================================
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- RLS POLICIES
-- =========================================================

-- BRANCHES
CREATE POLICY "auth read branches" ON public.branches FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage branches" ON public.branches FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- PROFILES
CREATE POLICY "auth read profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "self update profile" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "admin manage profiles" ON public.profiles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- USER_ROLES
CREATE POLICY "auth read roles" ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- CATEGORIES
CREATE POLICY "auth read categories" ON public.categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage categories" ON public.categories FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- PRODUCTS
CREATE POLICY "auth read products" ON public.products FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert products" ON public.products FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "manager update products" ON public.products FOR UPDATE TO authenticated
  USING (public.is_manager_or_admin(auth.uid()))
  WITH CHECK (public.is_manager_or_admin(auth.uid()));
CREATE POLICY "admin delete products" ON public.products FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- PRODUCT IMAGES
CREATE POLICY "auth read product images" ON public.product_images FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth manage product images" ON public.product_images FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- PRODUCT QUOTES
CREATE POLICY "auth read quotes" ON public.product_quotes FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert quotes" ON public.product_quotes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "manager modify quotes" ON public.product_quotes FOR UPDATE TO authenticated
  USING (public.is_manager_or_admin(auth.uid()));
CREATE POLICY "admin delete quotes" ON public.product_quotes FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- CUSTOMER INQUIRIES
CREATE POLICY "auth read inquiries" ON public.customer_inquiries FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert inquiries" ON public.customer_inquiries FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth update inquiries" ON public.customer_inquiries FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL);
CREATE POLICY "admin delete inquiries" ON public.customer_inquiries FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- ACTIVITY LOG
CREATE POLICY "auth read activity" ON public.activity_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert activity" ON public.activity_log FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- =========================================================
-- STORAGE BUCKETS
-- =========================================================
INSERT INTO storage.buckets (id, name, public) VALUES ('product-images','product-images', true)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('inquiry-images','inquiry-images', false)
  ON CONFLICT (id) DO NOTHING;

-- product-images: public read, auth write
CREATE POLICY "public read product images storage" ON storage.objects FOR SELECT
  USING (bucket_id = 'product-images');
CREATE POLICY "auth upload product images" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-images');
CREATE POLICY "auth update product images" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'product-images');
CREATE POLICY "auth delete product images" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'product-images');

-- inquiry-images: auth-only
CREATE POLICY "auth read inquiry images" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'inquiry-images');
CREATE POLICY "auth upload inquiry images" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'inquiry-images');
CREATE POLICY "auth delete inquiry images" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'inquiry-images');

-- =========================================================
-- SEED DATA
-- =========================================================
INSERT INTO public.branches (name, name_en, location) VALUES
  ('الفرع الرئيسي','Main Branch','المركز'),
  ('فرع 2','Branch 2',''),
  ('فرع 3','Branch 3',''),
  ('فرع 4','Branch 4',''),
  ('فرع 5','Branch 5','');

INSERT INTO public.categories (name, name_en, sort_order) VALUES
  ('خواتم','Rings',1),
  ('أساور','Bracelets',2),
  ('سلاسل','Necklaces',3),
  ('حلق','Earrings',4),
  ('أطقم','Sets',5),
  ('ألماس','Diamond',6),
  ('أخرى','Other',99);
