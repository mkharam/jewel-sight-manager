-- Price per gram and the accountant's view, both from the Amarsoft sale lines (admins only).
--
-- amarsoft_gram_report: what each branch got per gram, not only the average — the spread (low 10%,
-- middle, high 10%), period by period (week or month), per karat, and how many grams went in each
-- 100 LD price band. A line's rate is its amount ÷ its grams, as Amarsoft computes rate_per_gram.
--
-- amarsoft_accounting: money by day and branch split by how it was paid (cash, bank, card, credit…),
-- returns, the credit sales with the customer's name and phone, and the payment totals.

create or replace function public.amarsoft_karat_of(p_purity numeric)
returns text language sql immutable set search_path = public as $$
  select case when p_purity between 0.74 and 0.76 then '18' when p_purity between 0.87 and 0.88 then '21'
              when p_purity between 0.91 and 0.92 then '22' when p_purity >= 0.99 then '24' else 'أخرى' end
$$;

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
           (i->>'grams')::numeric grams, (i->>'amount_dirhams')::bigint amount,
           (i->>'amount_dirhams')::numeric / 1000 / nullif((i->>'grams')::numeric, 0) rate,
           i->>'desc' descr, a.details->>'customer' customer
    from amarsoft_invoices a
    cross join jsonb_array_elements(a.items) i
    left join branches b on b.id = a.branch_id
    where public.has_role(auth.uid(), 'admin')
      and a.kind = 'sale' and not a.is_deleted
      and a.invoice_date between p_start and p_end
      and (i->>'grams')::numeric > 0 and (i->>'amount_dirhams')::bigint > 0
      and amarsoft_karat_of((i->>'purity')::numeric) = p_karat
  )
  select jsonb_build_object(
    'series', (select coalesce(jsonb_agg(s order by s.bucket, s.branch_code), '[]') from (
        select branch_code, branch_name, bucket, count(*) lines, round(sum(grams), 2) grams, sum(amount) sales_dirhams,
               round(sum(amount) / 1000.0 / sum(grams)) avg,
               round(percentile_cont(0.1) within group (order by rate)::numeric) p10,
               round(percentile_cont(0.5) within group (order by rate)::numeric) median,
               round(percentile_cont(0.9) within group (order by rate)::numeric) p90
        from lines group by 1, 2, 3) s),
    'totals', (select coalesce(jsonb_agg(t order by t.branch_code), '[]') from (
        select branch_code, branch_name, count(*) lines, count(distinct invoice_no) invoices, round(sum(grams), 2) grams,
               sum(amount) sales_dirhams, round(sum(amount) / 1000.0 / sum(grams)) avg,
               round(min(rate)) min, round(max(rate)) max,
               round(percentile_cont(0.1) within group (order by rate)::numeric) p10,
               round(percentile_cont(0.25) within group (order by rate)::numeric) p25,
               round(percentile_cont(0.5) within group (order by rate)::numeric) median,
               round(percentile_cont(0.75) within group (order by rate)::numeric) p75,
               round(percentile_cont(0.9) within group (order by rate)::numeric) p90
        from lines group by 1, 2) t),
    'bands', (select coalesce(jsonb_agg(x order by x.branch_code, x.band), '[]') from (
        select branch_code, (floor(rate / 100) * 100)::int band, count(*) lines, round(sum(grams), 2) grams
        from lines group by 1, 2) x),
    'lowest', (select coalesce(jsonb_agg(l order by l.rate), '[]') from (
        select branch_code, branch_name, invoice_no, invoice_date, descr, customer, round(grams, 2) grams,
               round(rate) rate, amount from lines order by rate limit 15) l)
  )
$$;
revoke all on function public.amarsoft_gram_report(date, date, text, text) from public, anon;
grant execute on function public.amarsoft_gram_report(date, date, text, text) to authenticated;

create or replace function public.amarsoft_accounting(p_start date, p_end date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with inv as (
    select a.*, coalesce(b.name, a.branch_code) branch_name
    from amarsoft_invoices a
    left join branches b on b.id = a.branch_id
    where public.has_role(auth.uid(), 'admin') and not a.is_deleted and a.invoice_date between p_start and p_end
  ), pay as (
    select inv.branch_code, inv.branch_name, inv.invoice_date, inv.kind, upper(coalesce(p->>'account', '?')) account,
           (p->>'amount_dirhams')::bigint amount
    from inv cross join jsonb_array_elements(coalesce(inv.details->'payments', '[]'::jsonb)) p
  )
  select jsonb_build_object(
    'days', (select coalesce(jsonb_agg(d order by d.day desc, d.branch_code), '[]') from (
        select i.invoice_date as day, i.branch_code, i.branch_name,
               count(*) filter (where i.kind = 'sale') invoices,
               coalesce(sum(i.net_dirhams) filter (where i.kind = 'sale'), 0) sales_dirhams,
               coalesce(sum(i.net_dirhams) filter (where i.kind = 'return'), 0) returns_dirhams,
               round(coalesce(sum((i.details->>'grams')::numeric) filter (where i.kind = 'sale'), 0), 2) grams,
               (select coalesce(jsonb_object_agg(x.account, x.amount), '{}') from (
                  select account, sum(amount) amount from pay
                  where pay.branch_code = i.branch_code and pay.invoice_date = i.invoice_date and pay.kind = 'sale'
                  group by 1) x) payments
        from inv i group by 1, 2, 3) d),
    'accounts', (select coalesce(jsonb_agg(x order by x.branch_code, x.amount desc), '[]') from (
        select branch_code, branch_name, account, count(*) n, sum(amount) amount from pay where kind = 'sale' group by 1, 2, 3) x),
    'credit', (select coalesce(jsonb_agg(c order by c.invoice_date desc), '[]') from (
        select inv.branch_code, inv.branch_name, inv.invoice_no, inv.invoice_date, inv.details->>'customer' customer,
               inv.details->>'phone' phone, inv.net_dirhams,
               (select sum((p->>'amount_dirhams')::bigint) from jsonb_array_elements(inv.details->'payments') p
                 where upper(p->>'account') in ('CRE', 'CREDIT')) credit_dirhams
        from inv where inv.kind = 'sale' and exists (
          select 1 from jsonb_array_elements(coalesce(inv.details->'payments', '[]'::jsonb)) p where upper(p->>'account') in ('CRE', 'CREDIT'))) c)
  )
$$;
revoke all on function public.amarsoft_accounting(date, date) from public, anon;
grant execute on function public.amarsoft_accounting(date, date) to authenticated;
