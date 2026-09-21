-- إقفال اليوم لكل فرع: المشرف يُدخل ما عدّه فعلاً (نقد/بطاقة/تحويل) فيقارنه النظام بما
-- يُفترض أن يكون. المتوقّع يُحسب في الخادم لحظة الإقفال ويُخزَّن لقطةً — لا يقبل من
-- المتصفح، ولا يتغيّر لاحقاً إن عُدّلت مبيعات ذلك اليوم.
--
-- العدّ أعمى عمداً: الواجهة لا تُظهر المتوقّع قبل الإرسال، وإلا طابق المُقفِل رقمه به.
-- «تقسيط» و«مقايضة ذهب» لا يدخلان الدرج، فتُسجَّل قيمتهما للعلم دون مقارنة.
CREATE TABLE public.daily_closings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  closing_date DATE NOT NULL,
  opening_cash NUMERIC(14,2) NOT NULL DEFAULT 0,

  -- ما أدخله المشرف
  counted_cash NUMERIC(14,2) NOT NULL,
  counted_card NUMERIC(14,2) NOT NULL DEFAULT 0,
  counted_transfer NUMERIC(14,2) NOT NULL DEFAULT 0,

  -- لقطة المتوقّع وقت الإقفال
  sales_count INT NOT NULL DEFAULT 0,
  cash_sales NUMERIC(14,2) NOT NULL DEFAULT 0,
  card_sales NUMERIC(14,2) NOT NULL DEFAULT 0,
  transfer_sales NUMERIC(14,2) NOT NULL DEFAULT 0,
  installment_sales NUMERIC(14,2) NOT NULL DEFAULT 0,
  tradein_sales NUMERIC(14,2) NOT NULL DEFAULT 0,
  expenses_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  expected_cash NUMERIC(14,2) NOT NULL,   -- افتتاحي + مبيعات نقداً − مصروفات
  expected_card NUMERIC(14,2) NOT NULL,
  expected_transfer NUMERIC(14,2) NOT NULL,

  -- الفرق = المعدود − المتوقّع (سالب = نقص)
  diff_cash NUMERIC(14,2) NOT NULL,
  diff_card NUMERIC(14,2) NOT NULL,
  diff_transfer NUMERIC(14,2) NOT NULL,

  notes TEXT,
  closed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id, closing_date)
);

CREATE INDEX daily_closings_date_idx ON public.daily_closings (closing_date DESC);
CREATE INDEX daily_closings_closed_by_idx ON public.daily_closings (closed_by);

ALTER TABLE public.daily_closings ENABLE ROW LEVEL SECURITY;

-- القراءة: المدير العام لكل الفروع، والمشرف لفرعه. لا كتابة مباشرة إلا إعادة الفتح (حذف) للمدير العام.
CREATE POLICY "admin read closings" ON public.daily_closings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "manager read own branch closings" ON public.daily_closings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'manager') AND branch_id = public.current_user_branch_id());
CREATE POLICY "admin reopen closing" ON public.daily_closings FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

GRANT SELECT, DELETE ON public.daily_closings TO authenticated;
GRANT ALL ON public.daily_closings TO service_role;

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
  v_exp_cash NUMERIC; v_row public.daily_closings;
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

  -- مبيعات اليوم في هذا الفرع (بتوقيت المحل)، بلا المُرجَعة.
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

  v_exp_cash := COALESCE(p_opening_cash, 0) + v_cash - v_exp;

  INSERT INTO public.daily_closings (
    branch_id, closing_date, opening_cash,
    counted_cash, counted_card, counted_transfer,
    sales_count, cash_sales, card_sales, transfer_sales, installment_sales, tradein_sales, expenses_total,
    expected_cash, expected_card, expected_transfer,
    diff_cash, diff_card, diff_transfer, notes, closed_by
  ) VALUES (
    p_branch_id, p_date, COALESCE(p_opening_cash, 0),
    p_counted_cash, COALESCE(p_counted_card, 0), COALESCE(p_counted_transfer, 0),
    v_count, v_cash, v_card, v_transfer, v_inst, v_trade, v_exp,
    v_exp_cash, v_card, v_transfer,
    p_counted_cash - v_exp_cash,
    COALESCE(p_counted_card, 0) - v_card,
    COALESCE(p_counted_transfer, 0) - v_transfer,
    NULLIF(btrim(p_notes), ''), v_uid
  )
  RETURNING * INTO v_row;

  RETURN v_row;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'هذا الفرع مُقفَل لهذا اليوم مسبقاً';
END;
$$;

REVOKE ALL ON FUNCTION public.submit_daily_closing(UUID, DATE, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_daily_closing(UUID, DATE, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT) TO authenticated;
