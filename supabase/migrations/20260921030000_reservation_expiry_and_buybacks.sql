-- =====================================================================
-- 1) انتهاء الحجوزات تلقائياً
-- expire_due_reservations() كانت موجودة لكن لا أحد يستدعيها، فبقيت الحجوزات «فعّالة» والقطع
-- «محجوزة» إلى الأبد. الآن تُشغَّل يومياً، ومع مهلة يومين بعد تاريخ الانتهاء (بتوقيت
-- طرابلس) حتى لا تُفرَج قطعة عن زبون تأخّر يوماً واحداً وعربونه عندنا.
-- التريغر apply_reservation_status يعيد القطعة «متوفرة» عند التحويل إلى expired.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.expire_due_reservations()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  WITH upd AS (
    UPDATE public.reservations SET status = 'expired'
    WHERE status = 'active'
      AND expires_at < ((now() AT TIME ZONE 'Africa/Tripoli')::date - 2)
    RETURNING 1
  ) SELECT count(*) INTO n FROM upd;
  RETURN COALESCE(n, 0);
END; $$;

-- 04:00 UTC = 06:00 طرابلس.
SELECT cron.schedule('expire-reservations-daily', '0 4 * * *', $$select public.expire_due_reservations()$$);

-- =====================================================================
-- 2) شراء الذهب القديم (كسر)
-- =====================================================================
CREATE TABLE public.gold_buybacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  id_number TEXT,                                  -- رقم هوية البائع (اختياري لكنه يحمي المحل)
  karat TEXT NOT NULL CHECK (karat IN ('18K', '21K')),
  gross_weight_grams NUMERIC(10,3) NOT NULL CHECK (gross_weight_grams > 0),
  net_weight_grams NUMERIC(10,3) NOT NULL CHECK (net_weight_grams > 0),  -- بعد خصم الأحجار واللحام
  price_per_gram NUMERIC(12,2) NOT NULL CHECK (price_per_gram >= 0),
  total_paid NUMERIC(14,2) NOT NULL CHECK (total_paid >= 0),
  market_price_per_gram NUMERIC(12,2),             -- لقطة سعر اليوم للمقارنة لاحقاً
  payment_method TEXT NOT NULL CHECK (payment_method IN ('نقداً', 'تحويل بنكي', 'مقايضة ذهب')),
  sale_id UUID REFERENCES public.sales(id) ON DELETE SET NULL,           -- إن كانت مقايضة ضمن بيعة
  disposition TEXT NOT NULL DEFAULT 'in_stock' CHECK (disposition IN ('in_stock', 'melted', 'sold_to_refiner')),
  disposition_at TIMESTAMPTZ,
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (net_weight_grams <= gross_weight_grams)
);
CREATE INDEX gold_buybacks_branch_date_idx ON public.gold_buybacks (branch_id, created_at DESC);
CREATE INDEX gold_buybacks_customer_idx ON public.gold_buybacks (customer_id);
CREATE INDEX gold_buybacks_sale_idx ON public.gold_buybacks (sale_id);
CREATE INDEX gold_buybacks_created_by_idx ON public.gold_buybacks (created_by);

ALTER TABLE public.gold_buybacks ENABLE ROW LEVEL SECURITY;

-- المدير العام لكل الفروع، والمشرف لفرعه. الموظف العادي لا يشتري ذهباً (مال يخرج من الدرج).
CREATE POLICY "admin manage buybacks" ON public.gold_buybacks FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "manager read own branch buybacks" ON public.gold_buybacks FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'manager') AND branch_id = public.current_user_branch_id());
CREATE POLICY "manager insert own branch buybacks" ON public.gold_buybacks FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'manager')
    AND branch_id = public.current_user_branch_id()
    AND created_by = auth.uid()
    AND disposition = 'in_stock'
  );

GRANT SELECT, INSERT, DELETE ON public.gold_buybacks TO authenticated;
GRANT ALL ON public.gold_buybacks TO service_role;

-- تغيير مصير الكسر (صُهر / بيع لمصفّاة) عبر دالة فقط: لا سياسة UPDATE عامة كي لا يُعدَّل
-- الوزن أو المبلغ المدفوع بعد التسجيل.
CREATE OR REPLACE FUNCTION public.set_buyback_disposition(p_id UUID, p_disposition TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_branch UUID;
BEGIN
  IF p_disposition NOT IN ('in_stock', 'melted', 'sold_to_refiner') THEN RAISE EXCEPTION 'حالة غير صالحة'; END IF;
  SELECT branch_id INTO v_branch FROM public.gold_buybacks WHERE id = p_id;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'السجل غير موجود'; END IF;
  IF NOT (public.has_role(auth.uid(), 'admin')
          OR (public.has_role(auth.uid(), 'manager') AND v_branch = public.current_user_branch_id())) THEN
    RAISE EXCEPTION 'لا تملك صلاحية';
  END IF;
  UPDATE public.gold_buybacks
     SET disposition = p_disposition,
         disposition_at = CASE WHEN p_disposition = 'in_stock' THEN NULL ELSE now() END
   WHERE id = p_id;
END; $$;
REVOKE ALL ON FUNCTION public.set_buyback_disposition(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_buyback_disposition(UUID, TEXT) TO authenticated;

-- =====================================================================
-- 3) الإقفال اليومي يخصم ما دُفع للكسر: النقد الخارج من الدرج والتحويلات الصادرة.
-- المقايضة لا تحرّك مالاً فلا تدخل.
-- =====================================================================
ALTER TABLE public.daily_closings
  ADD COLUMN buyback_cash NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN buyback_transfer NUMERIC(14,2) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.submit_daily_closing(
  p_branch_id UUID,
  p_date DATE,
  p_opening_cash NUMERIC,
  p_counted_cash NUMERIC,
  p_counted_card NUMERIC,
  p_counted_transfer NUMERIC,
  p_notes TEXT DEFAULT NULL
) RETURNS public.daily_closings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_today DATE := (now() AT TIME ZONE 'Africa/Tripoli')::date;
  v_cash NUMERIC := 0; v_card NUMERIC := 0; v_transfer NUMERIC := 0;
  v_inst NUMERIC := 0; v_trade NUMERIC := 0; v_count INT := 0; v_exp NUMERIC := 0;
  v_bb_cash NUMERIC := 0; v_bb_transfer NUMERIC := 0;
  v_exp_cash NUMERIC; v_exp_transfer NUMERIC; v_row public.daily_closings;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'غير مصرّح'; END IF;
  IF NOT (
    public.has_role(v_uid, 'admin')
    OR (public.has_role(v_uid, 'manager') AND p_branch_id = public.current_user_branch_id())
  ) THEN
    RAISE EXCEPTION 'لا تملك صلاحية إقفال هذا الفرع';
  END IF;
  IF p_date IS NULL OR p_date > v_today THEN RAISE EXCEPTION 'تاريخ الإقفال غير صالح'; END IF;
  IF p_counted_cash IS NULL OR p_counted_cash < 0
     OR COALESCE(p_counted_card, 0) < 0 OR COALESCE(p_counted_transfer, 0) < 0
     OR COALESCE(p_opening_cash, 0) < 0 THEN
    RAISE EXCEPTION 'المبالغ يجب ألا تكون سالبة';
  END IF;

  SELECT
    COUNT(*),
    COALESCE(SUM(final_price) FILTER (WHERE payment_method = 'نقداً'), 0),
    COALESCE(SUM(final_price) FILTER (WHERE payment_method = 'بطاقة'), 0),
    COALESCE(SUM(final_price) FILTER (WHERE payment_method = 'تحويل بنكي'), 0),
    COALESCE(SUM(final_price) FILTER (WHERE payment_method = 'تقسيط'), 0),
    COALESCE(SUM(final_price) FILTER (WHERE payment_method = 'مقايضة ذهب'), 0)
  INTO v_count, v_cash, v_card, v_transfer, v_inst, v_trade
  FROM public.sales
  WHERE branch_id = p_branch_id
    AND returned_at IS NULL
    AND (sold_at AT TIME ZONE 'Africa/Tripoli')::date = p_date;

  SELECT COALESCE(SUM(amount), 0) INTO v_exp
  FROM public.expenses WHERE branch_id = p_branch_id AND expense_date = p_date;

  SELECT
    COALESCE(SUM(total_paid) FILTER (WHERE payment_method = 'نقداً'), 0),
    COALESCE(SUM(total_paid) FILTER (WHERE payment_method = 'تحويل بنكي'), 0)
  INTO v_bb_cash, v_bb_transfer
  FROM public.gold_buybacks
  WHERE branch_id = p_branch_id
    AND (created_at AT TIME ZONE 'Africa/Tripoli')::date = p_date;

  v_exp_cash := COALESCE(p_opening_cash, 0) + v_cash - v_exp - v_bb_cash;
  v_exp_transfer := v_transfer - v_bb_transfer;

  INSERT INTO public.daily_closings (
    branch_id, closing_date, opening_cash,
    counted_cash, counted_card, counted_transfer,
    sales_count, cash_sales, card_sales, transfer_sales, installment_sales, tradein_sales, expenses_total,
    buyback_cash, buyback_transfer,
    expected_cash, expected_card, expected_transfer,
    diff_cash, diff_card, diff_transfer, notes, closed_by
  ) VALUES (
    p_branch_id, p_date, COALESCE(p_opening_cash, 0),
    p_counted_cash, COALESCE(p_counted_card, 0), COALESCE(p_counted_transfer, 0),
    v_count, v_cash, v_card, v_transfer, v_inst, v_trade, v_exp,
    v_bb_cash, v_bb_transfer,
    v_exp_cash, v_card, v_exp_transfer,
    p_counted_cash - v_exp_cash,
    COALESCE(p_counted_card, 0) - v_card,
    COALESCE(p_counted_transfer, 0) - v_exp_transfer,
    NULLIF(btrim(p_notes), ''), v_uid
  )
  RETURNING * INTO v_row;

  RETURN v_row;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'هذا الفرع مُقفَل لهذا اليوم مسبقاً';
END;
$$;
