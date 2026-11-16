-- «طلّع بطاقة» من شاشة الموظف: البطاقة تتصدر في MSTRMND بحساب مدير الفرع، ونسجّلو هنا مين طلّعها ومن أنهي فرع.
CREATE TABLE IF NOT EXISTS public.mstrmnd_issued_cards (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_code text NOT NULL,
  phone9 text NOT NULL,
  full_name text NOT NULL,
  serial text,
  existed boolean NOT NULL DEFAULT false,
  issued_by uuid REFERENCES auth.users(id),
  via_manager boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mstrmnd_issued_cards ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS mstrmnd_issued_cards_phone9 ON public.mstrmnd_issued_cards (phone9);

-- بطاقات جديدة (آخر p_days يوم) وصاحبها ما عندهش فاتورة بيع في أمارسوفت برقمه من يوم قبل البطاقة لين توا.
-- الفرع: اللي طلّعها من شاشتنا، وإلا تخمين mstrmnd_customer_branches. الموظف يشوف فرعه بس.
CREATE OR REPLACE FUNCTION public.loyalty_cards_no_invoice(p_days integer DEFAULT 7)
 RETURNS TABLE(customer_id text, full_name text, phone9 text, created_at timestamptz, branch_code text, issued_here boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with mine as (select code from loyalty_counter_branches()),
  cb as (select * from mstrmnd_customer_branches())
  select c.id, c.full_name, c.phone9, c.created_at,
         coalesce(i.branch_code, cb.branch_code), i.branch_code is not null
  from mstrmnd_customers c
  left join cb on cb.customer_id = c.id
  left join lateral (select x.branch_code from mstrmnd_issued_cards x where x.phone9 = c.phone9 order by x.created_at desc limit 1) i on true
  where c.created_at >= now() - make_interval(days => greatest(p_days, 1))
    and c.phone9 is not null
    and coalesce(i.branch_code, cb.branch_code) in (select code from mine)
    and not exists (
      select 1 from amarsoft_invoices a
      where a.kind = 'sale' and not a.is_deleted and a.sold_at >= c.created_at - interval '1 day'
        and right(regexp_replace(coalesce(a.details->>'phone', ''), '\D', '', 'g'), 9) = c.phone9
    )
  order by c.created_at desc;
$function$;
GRANT EXECUTE ON FUNCTION public.loyalty_cards_no_invoice(integer) TO authenticated;
