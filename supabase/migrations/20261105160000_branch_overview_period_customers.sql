-- «الزبائن» في التقارير كانت تعدّ كل زبائن الفرع المسجّلين من البداية (765 مقابل 17 فاتورة).
-- توّا تعدّ الزبائن المختلفين اللي اشتروا في الفترة بس (بالكود، ولا الهاتف، ولا الاسم).
create or replace function public.amarsoft_branch_overview(p_start timestamptz, p_end timestamptz)
returns table (branch_code text, branch_id uuid, branch_name text, invoices bigint, returns bigint, tagged bigint,
               grams numeric, pure_grams numeric, sales_dirhams bigint, making_dirhams bigint, making_cost_dirhams bigint,
               stock_pieces bigint, stock_grams numeric, salesmen bigint, customers bigint, deleted bigint, edited bigint,
               last_sale timestamptz)
language sql
stable security definer
set search_path to 'public'
as $function$
  with inv as (
    select a.branch_code, a.kind, a.sman, a.net_dirhams, a.sold_at,
           coalesce(nullif(trim(a.details->>'guest_code'), ''), nullif(trim(a.details->>'phone'), ''),
                    nullif(trim(a.details->>'customer'), '')) cust,
           (select coalesce(sum((i->>'grams')::numeric), 0) from jsonb_array_elements(a.items) i) g,
           (select coalesce(sum((i->>'pure_grams')::numeric), 0) from jsonb_array_elements(a.items) i) pg,
           (select coalesce(sum((i->>'making_dirhams')::bigint), 0) from jsonb_array_elements(a.items) i) mk,
           (select coalesce(sum(st.cost_dirhams), 0) from jsonb_array_elements(a.items) i
              join amarsoft_stock st on st.branch_code = a.branch_code and st.tag = i->>'tag') cost
    from amarsoft_invoices a
    where not a.is_deleted and a.sold_at >= p_start and a.sold_at < p_end
  ), s as (
    select branch_code,
           count(*) filter (where kind = 'sale') invoices, count(*) filter (where kind = 'return') returns,
           count(*) filter (where kind = 'sale' and sman is not null) tagged,
           sum(case when kind = 'return' then -g else g end) grams, sum(case when kind = 'return' then -pg else pg end) pure_grams,
           sum(net_dirhams)::bigint sales, sum(case when kind = 'return' then -mk else mk end)::bigint making,
           sum(case when kind = 'return' then -cost else cost end)::bigint cost,
           count(distinct cust) filter (where kind = 'sale') customers
    from inv group by 1
  )
  select m.code, m.branch_id, b.name, coalesce(s.invoices, 0), coalesce(s.returns, 0), coalesce(s.tagged, 0),
         round(coalesce(s.grams, 0), 2), round(coalesce(s.pure_grams, 0), 3), coalesce(s.sales, 0), coalesce(s.making, 0),
         coalesce(s.cost, 0),
         (select count(*) from amarsoft_stock st where st.branch_code = m.code and st.in_stock),
         (select round(coalesce(sum(st.grams), 0), 1) from amarsoft_stock st where st.branch_code = m.code and st.in_stock),
         (select count(*) from amarsoft_salesmen sm where sm.branch_code = m.code and sm.is_active),
         coalesce(s.customers, 0),
         (select count(distinct h.invoice_no) from amarsoft_invoice_history h where h.branch_code = m.code and h.source = 'deleted'
            and h.invoice_date >= (p_start at time zone 'Africa/Tripoli')::date and h.invoice_date < (p_end at time zone 'Africa/Tripoli')::date),
         (select count(distinct e.trn_no) from amarsoft_doc_events e where e.branch_code = m.code and e.trn_type = 'RSL' and e.status = 'E'
            and e.at >= p_start and e.at < p_end),
         (select max(a.sold_at) from amarsoft_invoices a where a.branch_code = m.code and not a.is_deleted)
  from amarsoft_branch_map m
  join branches b on b.id = m.branch_id
  left join s on s.branch_code = m.code
  where public.has_role(auth.uid(), 'admin')
  order by m.code;
$function$;
