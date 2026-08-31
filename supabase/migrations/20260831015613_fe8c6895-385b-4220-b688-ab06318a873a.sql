-- =========================================================
-- STAFF OPERATIONS HARDENING
-- =========================================================

-- Helper: current user's assigned branch id
CREATE OR REPLACE FUNCTION public.current_user_branch_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT branch_id FROM public.profiles WHERE id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.current_user_branch_id() TO authenticated;

-- =========================================================
-- TRANSFERS: branch-scoped read/update
-- =========================================================
DROP POLICY IF EXISTS "auth read transfers" ON public.transfers;
DROP POLICY IF EXISTS "auth update transfers" ON public.transfers;
DROP POLICY IF EXISTS "admin or branch manager update transfers" ON public.transfers;

CREATE POLICY "read transfers for involved branches or admin"
ON public.transfers FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.current_user_branch_id() IS NOT NULL
     AND (from_branch_id = public.current_user_branch_id()
          OR to_branch_id = public.current_user_branch_id())
);

CREATE POLICY "update transfers for involved branches or admin"
ON public.transfers FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.current_user_branch_id() IS NOT NULL
     AND (from_branch_id = public.current_user_branch_id()
          OR to_branch_id = public.current_user_branch_id())
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR public.current_user_branch_id() IS NOT NULL
     AND (from_branch_id = public.current_user_branch_id()
          OR to_branch_id = public.current_user_branch_id())
);

-- =========================================================
-- TRANSFERS: status transition guard
-- =========================================================
CREATE OR REPLACE FUNCTION public.guard_transfer_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  my_branch uuid := public.current_user_branch_id();
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' AND NEW.status = 'approved' THEN
    IF my_branch IS DISTINCT FROM OLD.from_branch_id THEN
      RAISE EXCEPTION 'فقط فرع المرسل يمكنه قبول طلب التحويل';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'approved' AND NEW.status = 'in_transit' THEN
    IF my_branch IS DISTINCT FROM OLD.from_branch_id THEN
      RAISE EXCEPTION 'فقط فرع المرسل يمكنه إرسال القطعة';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'in_transit' AND NEW.status = 'received' THEN
    IF my_branch IS DISTINCT FROM OLD.to_branch_id THEN
      RAISE EXCEPTION 'فقط فرع المستلم يمكنه تأكيد الاستلام';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'in_transit' AND NEW.status = 'cancelled' THEN
    IF my_branch IS DISTINCT FROM OLD.from_branch_id
       AND my_branch IS DISTINCT FROM OLD.to_branch_id THEN
      RAISE EXCEPTION 'لا يمكن إلغاء التحويل من فرع غير مشارك';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' AND NEW.status = 'cancelled' THEN
    IF my_branch IS DISTINCT FROM OLD.from_branch_id
       AND my_branch IS DISTINCT FROM OLD.to_branch_id THEN
      RAISE EXCEPTION 'لا يمكن إلغاء التحويل من فرع غير مشارك';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status IN ('cancelled','rejected') AND NEW.status = 'pending' THEN
    IF my_branch IS DISTINCT FROM OLD.from_branch_id
       AND my_branch IS DISTINCT FROM OLD.to_branch_id THEN
      RAISE EXCEPTION 'لا يمكن إعادة فتح التحويل من فرع غير مشارك';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'in_transit' AND NEW.status = 'approved' THEN
    IF my_branch IS DISTINCT FROM OLD.from_branch_id THEN
      RAISE EXCEPTION 'فقط فرع المرسل يمكنه التراجع عن الإرسال';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'انتقال الحالة من % إلى % غير مسموح به', OLD.status, NEW.status;
END $$;

DROP TRIGGER IF EXISTS trg_guard_transfer_status_transition ON public.transfers;
CREATE TRIGGER trg_guard_transfer_status_transition
  BEFORE UPDATE ON public.transfers
  FOR EACH ROW EXECUTE FUNCTION public.guard_transfer_status_transition();

-- =========================================================
-- PRODUCTS: branch-scoped read/update
-- =========================================================
DROP POLICY IF EXISTS "auth read products" ON public.products;
DROP POLICY IF EXISTS "read products when assigned" ON public.products;
DROP POLICY IF EXISTS "auth insert products" ON public.products;
DROP POLICY IF EXISTS "manager update products" ON public.products;
DROP POLICY IF EXISTS "auth update products" ON public.products;
DROP POLICY IF EXISTS "admin delete products" ON public.products;

CREATE POLICY "read products scoped to branch or admin"
ON public.products FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.current_user_branch_id() IS NOT NULL
     AND branch_id = public.current_user_branch_id()
);

CREATE POLICY "insert products for assigned branch"
ON public.products FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR (public.current_user_branch_id() IS NOT NULL
      AND branch_id = public.current_user_branch_id())
);

CREATE POLICY "update products scoped to branch or admin"
ON public.products FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.current_user_branch_id() IS NOT NULL
     AND branch_id = public.current_user_branch_id()
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR public.current_user_branch_id() IS NOT NULL
     AND branch_id = public.current_user_branch_id()
);

CREATE POLICY "delete products admin only"
ON public.products FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- =========================================================
-- PRODUCT IMAGES: scoped to product branch
-- =========================================================
DROP POLICY IF EXISTS "auth read product images" ON public.product_images;
DROP POLICY IF EXISTS "auth manage product images" ON public.product_images;

CREATE POLICY "read product images scoped to branch"
ON public.product_images FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = product_id
      AND p.branch_id = public.current_user_branch_id()
  )
);

CREATE POLICY "manage product images scoped to branch"
ON public.product_images FOR ALL TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = product_id
      AND p.branch_id = public.current_user_branch_id()
  )
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = product_id
      AND p.branch_id = public.current_user_branch_id()
  )
);

-- =========================================================
-- SALES: branch-scoped
-- =========================================================
DROP POLICY IF EXISTS "auth read sales" ON public.sales;
DROP POLICY IF EXISTS "auth insert sales" ON public.sales;
DROP POLICY IF EXISTS "auth update sales" ON public.sales;
DROP POLICY IF EXISTS "admin delete sales" ON public.sales;

CREATE POLICY "read sales scoped to branch or admin"
ON public.sales FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.current_user_branch_id() IS NOT NULL
     AND branch_id = public.current_user_branch_id()
);

CREATE POLICY "insert sales for assigned branch"
ON public.sales FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR (public.current_user_branch_id() IS NOT NULL
      AND branch_id = public.current_user_branch_id())
);

CREATE POLICY "update sales scoped to branch or admin"
ON public.sales FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.current_user_branch_id() IS NOT NULL
     AND branch_id = public.current_user_branch_id()
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR public.current_user_branch_id() IS NOT NULL
     AND branch_id = public.current_user_branch_id()
);

CREATE POLICY "delete sales admin only"
ON public.sales FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- =========================================================
-- PRODUCT QUOTES: branch-scoped
-- =========================================================
DROP POLICY IF EXISTS "auth read quotes" ON public.product_quotes;
DROP POLICY IF EXISTS "auth insert quotes" ON public.product_quotes;
DROP POLICY IF EXISTS "manager modify quotes" ON public.product_quotes;
DROP POLICY IF EXISTS "auth update quotes" ON public.product_quotes;
DROP POLICY IF EXISTS "admin delete quotes" ON public.product_quotes;

CREATE POLICY "read quotes scoped to branch or admin"
ON public.product_quotes FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.current_user_branch_id() IS NOT NULL
     AND branch_id = public.current_user_branch_id()
);

CREATE POLICY "insert quotes for assigned branch"
ON public.product_quotes FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR (public.current_user_branch_id() IS NOT NULL
      AND branch_id = public.current_user_branch_id())
);

CREATE POLICY "update quotes scoped to branch or admin"
ON public.product_quotes FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.current_user_branch_id() IS NOT NULL
     AND branch_id = public.current_user_branch_id()
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR public.current_user_branch_id() IS NOT NULL
     AND branch_id = public.current_user_branch_id()
);

CREATE POLICY "delete quotes admin only"
ON public.product_quotes FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- =========================================================
-- CUSTOMER INQUIRIES: branch-scoped
-- =========================================================
DROP POLICY IF EXISTS "auth read inquiries" ON public.customer_inquiries;
DROP POLICY IF EXISTS "auth insert inquiries" ON public.customer_inquiries;
DROP POLICY IF EXISTS "auth update inquiries" ON public.customer_inquiries;
DROP POLICY IF EXISTS "admin delete inquiries" ON public.customer_inquiries;

CREATE POLICY "read inquiries scoped to branch or admin"
ON public.customer_inquiries FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.current_user_branch_id() IS NOT NULL
     AND branch_id = public.current_user_branch_id()
);

CREATE POLICY "insert inquiries for assigned branch"
ON public.customer_inquiries FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR (public.current_user_branch_id() IS NOT NULL
      AND branch_id = public.current_user_branch_id())
);

CREATE POLICY "update inquiries scoped to branch or admin"
ON public.customer_inquiries FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.current_user_branch_id() IS NOT NULL
     AND branch_id = public.current_user_branch_id()
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR public.current_user_branch_id() IS NOT NULL
     AND branch_id = public.current_user_branch_id()
);

CREATE POLICY "delete inquiries admin only"
ON public.customer_inquiries FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- =========================================================
-- PROFILES: restrict visibility
-- =========================================================
DROP POLICY IF EXISTS "auth read profiles" ON public.profiles;
DROP POLICY IF EXISTS "self update profile" ON public.profiles;
DROP POLICY IF EXISTS "admin manage profiles" ON public.profiles;

CREATE POLICY "read profiles admin manager or self"
ON public.profiles FOR SELECT TO authenticated
USING (
  id = auth.uid()
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'manager')
);

CREATE POLICY "self update profile"
ON public.profiles FOR UPDATE TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

CREATE POLICY "admin manage profiles"
ON public.profiles FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =========================================================
-- USER_ROLES: admin only
-- =========================================================
DROP POLICY IF EXISTS "auth read roles" ON public.user_roles;
DROP POLICY IF EXISTS "admin manage roles" ON public.user_roles;

CREATE POLICY "read roles admin only"
ON public.user_roles FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admin manage roles"
ON public.user_roles FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =========================================================
-- STOCK TAKE: branch-scoped
-- =========================================================
DROP POLICY IF EXISTS "auth read stock sessions" ON public.stock_take_sessions;
DROP POLICY IF EXISTS "auth insert stock sessions" ON public.stock_take_sessions;
DROP POLICY IF EXISTS "auth update stock sessions" ON public.stock_take_sessions;
DROP POLICY IF EXISTS "admin delete stock sessions" ON public.stock_take_sessions;

CREATE POLICY "read stock sessions scoped to branch or admin"
ON public.stock_take_sessions FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.current_user_branch_id() IS NOT NULL
     AND branch_id = public.current_user_branch_id()
);

CREATE POLICY "insert stock sessions for assigned branch"
ON public.stock_take_sessions FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR (public.current_user_branch_id() IS NOT NULL
      AND branch_id = public.current_user_branch_id())
);

CREATE POLICY "update stock sessions scoped to branch or admin"
ON public.stock_take_sessions FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.current_user_branch_id() IS NOT NULL
     AND branch_id = public.current_user_branch_id()
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR public.current_user_branch_id() IS NOT NULL
     AND branch_id = public.current_user_branch_id()
);

CREATE POLICY "delete stock sessions admin only"
ON public.stock_take_sessions FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "auth read stock items" ON public.stock_take_items;
DROP POLICY IF EXISTS "auth manage stock items" ON public.stock_take_items;

CREATE POLICY "read stock items scoped to branch or admin"
ON public.stock_take_items FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.stock_take_sessions s
    WHERE s.id = session_id
      AND s.branch_id = public.current_user_branch_id()
  )
);

CREATE POLICY "manage stock items scoped to branch or admin"
ON public.stock_take_items FOR ALL TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.stock_take_sessions s
    WHERE s.id = session_id
      AND s.branch_id = public.current_user_branch_id()
  )
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.stock_take_sessions s
    WHERE s.id = session_id
      AND s.branch_id = public.current_user_branch_id()
  )
);
