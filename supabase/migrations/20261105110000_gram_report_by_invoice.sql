-- Gram price per invoice, not per line. The customer usually agrees one price for the whole invoice and
-- the clerk spreads it over the pieces however it fits: in one invoice a ring shows 851 LD/g and the
-- wedding band next to it 2,544 LD/g, while the invoice as a whole is 1,275 LD/g. So each sale is one
-- invoice-and-karat: its amount ÷ its grams (an invoice with 18 and 21 karat counts once per karat,
-- because those really are priced apart). Totals and averages are unchanged.
create or replace function public.amarsoft_gram_report(p_start date, p_end date, p_bucket text default 'month', p_karat text default '18')
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with lines as (
    select a.branch_code, coalesce(b.name, a.branch_code) branch_name, a.invoice_no, a.invoice_date,
           date_trunc(case when p_bucket = 'week' then 'week' when p_bucket = 'day' then 'day' else 'month' end, a.invoice_date)::date bucket,
           (i->>'grams')::numeric grams, (i->>'amount_dirhams')::bigint amount, i->>'desc' descr, a.details->>'customer' customer
    from amarsoft_invoices a
    cross join jsonb_array_elements(a.items) i
    left join branches b on b.id = a.branch_id
    where public.has_role(auth.uid(), 'admin')
      and a.kind = 'sale' and not a.is_deleted
      and a.invoice_date between p_start and p_end
      and (i->>'grams')::numeric > 0 and (i->>'amount_dirhams')::bigint > 0
      and amarsoft_karat_of((i->>'purity')::numeric) = p_karat
  ), sales as (
    select branch_code, branch_name, invoice_no, invoice_date, bucket, customer,
           string_agg(descr, '، ' order by grams desc) descr, count(*) pieces,
           sum(grams) grams, sum(amount) amount, sum(amount) / 1000.0 / sum(grams) rate
    from lines group by 1, 2, 3, 4, 5, 6
  )
  select jsonb_build_object(
    'series', (select coalesce(jsonb_agg(s order by s.bucket, s.branch_code), '[]') from (
        select branch_code, branch_name, bucket, count(*) lines, round(sum(grams), 2) grams, sum(amount) sales_dirhams,
               round(sum(amount) / 1000.0 / sum(grams)) avg,
               round(percentile_cont(0.1) within group (order by rate)::numeric) p10,
               round(percentile_cont(0.5) within group (order by rate)::numeric) median,
               round(percentile_cont(0.9) within group (order by rate)::numeric) p90
        from sales group by 1, 2, 3) s),
    'totals', (select coalesce(jsonb_agg(t order by t.branch_code), '[]') from (
        select branch_code, branch_name, count(*) lines, count(distinct invoice_no) invoices, round(sum(grams), 2) grams,
               sum(amount) sales_dirhams, round(sum(amount) / 1000.0 / sum(grams)) avg,
               round(min(rate)) min, round(max(rate)) max,
               round(percentile_cont(0.1) within group (order by rate)::numeric) p10,
               round(percentile_cont(0.25) within group (order by rate)::numeric) p25,
               round(percentile_cont(0.5) within group (order by rate)::numeric) median,
               round(percentile_cont(0.75) within group (order by rate)::numeric) p75,
               round(percentile_cont(0.9) within group (order by rate)::numeric) p90
        from sales group by 1, 2) t),
    'bands', (select coalesce(jsonb_agg(x order by x.branch_code, x.band), '[]') from (
        select branch_code, (floor(rate / 100) * 100)::int band, count(*) lines, round(sum(grams), 2) grams
        from sales group by 1, 2) x),
    'lowest', (select coalesce(jsonb_agg(l order by l.rate), '[]') from (
        select branch_code, branch_name, invoice_no, invoice_date, descr, customer, pieces, round(grams, 2) grams,
               round(rate) rate, amount from sales order by rate limit 15) l)
  )
$$;
