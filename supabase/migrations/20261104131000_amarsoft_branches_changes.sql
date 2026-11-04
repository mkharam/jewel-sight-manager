-- Branch overview, daily series, and what changed in deleted/edited invoices (admins only).

-- One row per branch for a period: sales, weight, price per gram, making, tagging, stock, changes.
create or replace function public.amarsoft_branch_overview(p_start timestamptz, p_end timestamptz)
returns table (branch_code text, branch_id uuid, branch_name text, invoices bigint, returns bigint, tagged bigint,
               grams numeric, pure_grams numeric, sales_dirhams bigint, making_dirhams bigint, making_cost_dirhams bigint,
               stock_pieces bigint, stock_grams numeric, salesmen bigint, customers bigint, deleted bigint, edited bigint,
               last_sale timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with inv as (
    select a.branch_code, a.kind, a.sman, a.net_dirhams, a.sold_at,
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
           sum(case when kind = 'return' then -cost else cost end)::bigint cost
    from inv group by 1
  )
  select m.code, m.branch_id, b.name, coalesce(s.invoices, 0), coalesce(s.returns, 0), coalesce(s.tagged, 0),
         round(coalesce(s.grams, 0), 2), round(coalesce(s.pure_grams, 0), 3), coalesce(s.sales, 0), coalesce(s.making, 0),
         coalesce(s.cost, 0),
         (select count(*) from amarsoft_stock st where st.branch_code = m.code and st.in_stock),
         (select round(coalesce(sum(st.grams), 0), 1) from amarsoft_stock st where st.branch_code = m.code and st.in_stock),
         (select count(*) from amarsoft_salesmen sm where sm.branch_code = m.code and sm.is_active),
         (select count(*) from amarsoft_customer_links cl where cl.branch_code = m.code),
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
$$;
revoke all on function public.amarsoft_branch_overview(timestamptz, timestamptz) from public, anon;
grant execute on function public.amarsoft_branch_overview(timestamptz, timestamptz) to authenticated;

-- Sales per day (Tripoli dates) for a branch or all branches.
create or replace function public.amarsoft_daily(p_start timestamptz, p_end timestamptz, p_branch text default null)
returns table (day date, invoices bigint, grams numeric, sales_dirhams bigint)
language sql
stable
security definer
set search_path = public
as $$
  select (a.sold_at at time zone 'Africa/Tripoli')::date,
         count(*) filter (where a.kind = 'sale'),
         round(sum((case when a.kind = 'return' then -1 else 1 end) *
               (select coalesce(sum((i->>'grams')::numeric), 0) from jsonb_array_elements(a.items) i)), 2),
         sum(a.net_dirhams)::bigint
  from amarsoft_invoices a
  where not a.is_deleted and a.sold_at >= p_start and a.sold_at < p_end
    and (p_branch is null or a.branch_code = p_branch)
    and public.has_role(auth.uid(), 'admin')
  group by 1
  order by 1;
$$;
revoke all on function public.amarsoft_daily(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.amarsoft_daily(timestamptz, timestamptz, text) to authenticated;

-- Deleted and really-changed edited invoices with before/after. For deleted pieces, whether the
-- piece is back in stock or was sold again on another invoice (and for how much).
create or replace function public.amarsoft_invoice_changes(p_from date, p_to date, p_branch text default null)
returns table (branch_code text, branch_name text, invoice_no text, invoice_date date, change text, customer text,
               old_net bigint, new_net bigint, old_items jsonb, new_items jsonb, resold jsonb)
language sql
stable
security definer
set search_path = public
as $$
  with h as (
    select h.*, b.name branch_name,
           (select string_agg(coalesce(x->>'tag','') || '|' || round(coalesce((x->>'grams')::numeric, 0), 2) || '|' ||
                              abs(coalesce((x->>'amount_dirhams')::bigint, 0)), ',' order by 1)
              from jsonb_array_elements(h.items) x) sig
    from amarsoft_invoice_history h
    join amarsoft_branch_map m on m.code = h.branch_code
    join branches b on b.id = m.branch_id
    where h.source in ('deleted', 'old_lines') and h.kind = 'sale'
      and (p_branch is null or h.branch_code = p_branch)
      and public.has_role(auth.uid(), 'admin')
  ), cur as (
    select h.id, a.net_dirhams, a.items, a.invoice_date, a.details->>'customer' customer,
           (select string_agg(coalesce(x->>'tag','') || '|' || round(coalesce((x->>'grams')::numeric, 0), 2) || '|' ||
                              abs(coalesce((x->>'amount_dirhams')::bigint, 0)), ',' order by 1)
              from jsonb_array_elements(a.items) x) sig
    from h join amarsoft_invoices a on a.branch_code = h.branch_code and a.year_folder = h.year_folder
         and a.kind = h.kind and a.invoice_no = h.invoice_no
    where h.source = 'old_lines'
  )
  select h.branch_code, h.branch_name, h.invoice_no, coalesce(h.invoice_date, cur.invoice_date),
         case when h.source = 'deleted' then 'deleted' when abs(coalesce(h.net_dirhams, 0)) <> abs(coalesce(cur.net_dirhams, 0)) then 'amount' else 'items' end,
         coalesce(h.customer, cur.customer), abs(h.net_dirhams), abs(cur.net_dirhams), h.items, cur.items,
         case when h.source = 'deleted' then (
           select jsonb_agg(jsonb_build_object('tag', x->>'tag', 'in_stock', st.in_stock,
                    'sold_on', a2.invoice_no, 'sold_date', a2.invoice_date, 'sold_dirhams', abs((yy.y->>'amount_dirhams')::bigint)))
           from jsonb_array_elements(h.items) x
           left join amarsoft_stock st on st.branch_code = h.branch_code and st.tag = x->>'tag'
           left join lateral (
             select a.invoice_no, a.invoice_date, a.items from amarsoft_invoices a
             where a.branch_code = h.branch_code and not a.is_deleted and a.kind = 'sale'
               and a.items @> jsonb_build_array(jsonb_build_object('tag', x->>'tag'))
             order by a.sold_at desc limit 1) a2 on true
           left join lateral (select y from jsonb_array_elements(a2.items) y where y->>'tag' = x->>'tag' limit 1) yy on true
           where coalesce(x->>'tag', '') ~ '^\d{6,}$') end
  from h left join cur on cur.id = h.id
  where (h.source = 'deleted' or h.sig is distinct from cur.sig)
    and coalesce(h.invoice_date, cur.invoice_date) between p_from and p_to
  order by coalesce(h.invoice_date, cur.invoice_date) desc, h.invoice_no desc;
$$;
revoke all on function public.amarsoft_invoice_changes(date, date, text) from public, anon;
grant execute on function public.amarsoft_invoice_changes(date, date, text) to authenticated;
