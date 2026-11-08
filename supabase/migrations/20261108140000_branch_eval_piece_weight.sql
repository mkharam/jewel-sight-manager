-- تقييم الفروع: نزيد تقسيم القطع حسب وزن القطعة (خفيف أقل من 5 قرام، متوسط 5-20، رزين 20 وفوق)
-- باش يبان مين يبيع في الرزين ومين في الخفيف. نفس الدالة القديمة + 4 أعمدة.
drop function if exists public.amarsoft_branch_eval(timestamptz, timestamptz);

create function public.amarsoft_branch_eval(p_start timestamptz, p_end timestamptz)
returns table (branch_code text, branch_name text, sman text, salesman_name text,
               invoices bigint, returns bigint, deleted bigint, pieces numeric, grams numeric, net_dirhams bigint,
               grams_18 numeric, amount_18 numeric, making_18 numeric,
               grams_21 numeric, amount_21 numeric, making_21 numeric,
               tagged bigint, with_customer bigint, active_days bigint,
               light_pcs numeric, mid_pcs numeric, heavy_pcs numeric, heavy_grams numeric)
language sql stable security definer set search_path to 'public'
as $function$
  with inv as (
    select a.id, a.branch_code, nullif(a.sman, '') sman, a.kind, a.is_deleted, a.net_dirhams, a.sold_at, a.items,
           (nullif(trim(a.details->>'customer'), '') is not null or nullif(trim(a.details->>'phone'), '') is not null
              or nullif(a.details->>'guest_code', '') is not null) has_cust
    from amarsoft_invoices a
    where a.sold_at >= p_start and a.sold_at < p_end
      and not public.amarsoft_internal_customer(a.details->>'customer')
      and public.has_role(auth.uid(), 'admin')
  ), lines as (
    select inv.id, (i->>'pcs')::numeric pcs, (i->>'grams')::numeric g, (i->>'purity')::numeric pur,
           (i->>'amount_dirhams')::numeric amt, (i->>'making_dirhams')::numeric mk,
           (i->>'grams')::numeric / nullif((i->>'pcs')::numeric, 0) gp
    from inv cross join jsonb_array_elements(inv.items) i
    where inv.kind = 'sale' and not inv.is_deleted
  ), per_inv as (
    select inv.id, inv.branch_code, inv.sman, inv.kind, inv.is_deleted, inv.net_dirhams, inv.sold_at, inv.has_cust,
           coalesce(l.pcs, 0) pcs, coalesce(l.g, 0) g,
           coalesce(l.g18, 0) g18, coalesce(l.a18, 0) a18, coalesce(l.m18, 0) m18,
           coalesce(l.g21, 0) g21, coalesce(l.a21, 0) a21, coalesce(l.m21, 0) m21,
           coalesce(l.lp, 0) lp, coalesce(l.mp, 0) mp, coalesce(l.hp, 0) hp, coalesce(l.hg, 0) hg
    from inv left join (
      select id, sum(pcs) pcs, sum(g) g,
             sum(g) filter (where pur = 0.75) g18, sum(amt) filter (where pur = 0.75) a18, sum(mk) filter (where pur = 0.75) m18,
             sum(g) filter (where pur = 0.875) g21, sum(amt) filter (where pur = 0.875) a21, sum(mk) filter (where pur = 0.875) m21,
             sum(pcs) filter (where gp < 5) lp, sum(pcs) filter (where gp >= 5 and gp < 20) mp,
             sum(pcs) filter (where gp >= 20) hp, sum(g) filter (where gp >= 20) hg
      from lines group by id
    ) l on l.id = inv.id
  ), agg as (
    select p.branch_code, p.sman,
           count(*) filter (where kind = 'sale' and not is_deleted) invoices,
           count(*) filter (where kind = 'return' and not is_deleted) returns,
           count(*) filter (where is_deleted) deleted,
           sum(pcs) pieces, round(sum(g), 2) grams,
           coalesce(sum(net_dirhams) filter (where not is_deleted), 0)::bigint net,
           round(sum(g18), 2) g18, sum(a18) a18, sum(m18) m18, round(sum(g21), 2) g21, sum(a21) a21, sum(m21) m21,
           count(*) filter (where kind = 'sale' and not is_deleted and sman is not null) tagged,
           count(*) filter (where kind = 'sale' and not is_deleted and has_cust) with_cust,
           count(distinct (sold_at at time zone 'Africa/Tripoli')::date) filter (where kind = 'sale' and not is_deleted) days,
           sum(lp) lp, sum(mp) mp, sum(hp) hp, round(sum(hg), 2) hg,
           grouping(p.sman) g_sman
    from per_inv p
    group by grouping sets ((p.branch_code), (p.branch_code, p.sman))
  )
  select agg.branch_code, b.name,
         case when agg.g_sman = 1 then null else coalesce(agg.sman, '') end,
         case when agg.g_sman = 1 then null when agg.sman is null then 'بدون بائع'
              else coalesce(nullif(pr.full_name, ''), s.name, agg.sman) end,
         agg.invoices, agg.returns, agg.deleted, agg.pieces, agg.grams, agg.net,
         agg.g18, agg.a18, agg.m18, agg.g21, agg.a21, agg.m21,
         agg.tagged, agg.with_cust, agg.days,
         agg.lp, agg.mp, agg.hp, agg.hg
  from agg
  join amarsoft_branch_map m on m.code = agg.branch_code
  join branches b on b.id = m.branch_id
  left join amarsoft_salesmen s on s.branch_code = agg.branch_code and s.sman = agg.sman
  left join profiles pr on pr.id = s.profile_id
  where agg.g_sman = 1 or agg.sman is null or not public.amarsoft_is_store_sman(agg.branch_code, agg.sman)
  order by agg.branch_code, agg.g_sman desc, agg.grams desc nulls last;
$function$;
revoke execute on function public.amarsoft_branch_eval(timestamptz, timestamptz) from public, anon;
grant execute on function public.amarsoft_branch_eval(timestamptz, timestamptz) to authenticated;
