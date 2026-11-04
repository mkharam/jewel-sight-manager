-- Supplier detail: the goods of this supplier still sitting unsold, oldest first, and how long the
-- stock has been waiting (by age bracket), so the owner sees what to push, move to another branch,
-- or send back.
create or replace function public.amarsoft_supplier_detail(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.has_role(auth.uid(), 'admin') then null else jsonb_build_object(
    'months', (select coalesce(jsonb_agg(m order by m.month desc), '[]') from (
        select to_char(received_on, 'YYYY-MM') as month, count(*) pcs, round(sum(grams_in), 2) grams,
               round(sum(pure_grams_in), 2) as pure, sum(cost_dirhams)::bigint making_cost_dirhams,
               count(*) filter (where not in_stock) sold_pcs
        from amarsoft_stock where coalesce(nullif(supplier_code, ''), '—') = p_code and received_on is not null
        group by 1 order by 1 desc limit 18) m),
    'types', (select coalesce(jsonb_agg(t order by t.pcs desc), '[]') from (
        select coalesce(type_name, type_code, '—') as type, karat, count(*) pcs, round(sum(grams_in), 2) grams,
               count(*) filter (where not in_stock) sold_pcs, count(*) filter (where in_stock) stock_pcs,
               round(sum(grams) filter (where in_stock), 2) stock_grams,
               round(avg(sold_on - received_on) filter (where not in_stock and sold_on >= received_on), 0) as days
        from amarsoft_stock where coalesce(nullif(supplier_code, ''), '—') = p_code
        group by 1, 2) t),
    'aging', (select coalesce(jsonb_agg(a order by a.bucket), '[]') from (
        select case when current_date - received_on <= 90 then 1
                    when current_date - received_on <= 180 then 2
                    when current_date - received_on <= 365 then 3 else 4 end as bucket,
               count(*) pcs, round(sum(grams), 2) grams, sum(cost_dirhams)::bigint making_cost_dirhams
        from amarsoft_stock
        where coalesce(nullif(supplier_code, ''), '—') = p_code and in_stock and received_on is not null
        group by 1) a),
    'stale', (select coalesce(jsonb_agg(p order by p.received_on, p.tag), '[]') from (
        select st.tag, st.branch_code, b.name branch_name, coalesce(st.type_name, st.type_code, '—') as type,
               st.karat, round(st.grams, 2) grams, st.received_on, current_date - st.received_on as days,
               st.cost_dirhams
        from amarsoft_stock st left join branches b on b.id = st.branch_id
        where coalesce(nullif(st.supplier_code, ''), '—') = p_code and st.in_stock
          and st.received_on is not null and st.received_on <= current_date - 90
        order by st.received_on, st.tag limit 500) p),
    'entries', (select coalesce(jsonb_agg(e order by e.entry_date desc, e.id desc), '[]') from (
        select e.id, e.entry_date, e.kind, e.gold_pure_grams, e.money_dirhams, e.note, p.full_name by_name
        from amarsoft_supplier_entries e left join profiles p on p.id = e.created_by
        where e.supplier_code = p_code) e)
  ) end;
$$;
