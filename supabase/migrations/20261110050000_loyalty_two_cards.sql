-- بطاقة الولاء وبطاقة الأختام بطاقتين منفصلتين: شاشة الموظف تعرض كل وحدة لروحها (مركّبة ولا لا)،
-- فـ card_installed يولّي لبطاقة الولاء بس، وتنزاد has_stamp_card و stamp_installed.
drop function if exists public.loyalty_counter_invoices(text, int);
create function public.loyalty_counter_invoices(p_branch text default null, p_limit int default 15)
returns table(
  invoice_id bigint, branch_code text, branch_name text, invoice_no text, kind text, sold_at timestamptz,
  net_ld numeric, grams numeric, discount_ld numeric, customer_name text, phone9 text, is_deleted boolean,
  has_card boolean, card_level text, card_installed boolean, pct_due numeric, stamps_now int, rewards_unused int,
  to_next numeric, on_card text, on_card_reason text, stamp_on_card text, tier_if_joined text, pct_if_joined numeric,
  has_stamp_card boolean, stamp_installed boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare allowed text[];
begin
  allowed := array(select c.code from public.loyalty_counter_branches() c where p_branch is null or c.code = p_branch);
  return query
  with s as (select * from mstrmnd_sync_settings where id = 1),
  inv as (
    select a.*, case when length(regexp_replace(coalesce(a.details->>'phone', ''), '\D', '', 'g')) >= 9
                     then right(regexp_replace(a.details->>'phone', '\D', '', 'g'), 9) end p9
    from amarsoft_invoices a
    where a.branch_code = any(allowed) and a.kind in ('sale', 'return') and a.sold_at > now() - interval '3 days'
      and not public.amarsoft_internal_customer(a.details->>'customer')
    order by a.sold_at desc
    limit least(greatest(p_limit, 1), 50)
  ),
  rw as (
    select i.*, m.full_name m_name,
           (select k from jsonb_array_elements(m.cards) k, s where (k->>'template_id')::int = s.template_id limit 1) lc,
           (select k from jsonb_array_elements(m.cards) k, s where (k->>'template_id')::int = s.stamp_template_id limit 1) sc
    from inv i
    left join lateral (select c.full_name, c.cards from mstrmnd_customers c where i.p9 is not null and c.phone9 = i.p9 limit 1) m on true
  )
  select r.id, r.branch_code, regexp_replace(coalesce(b.name, r.branch_code), '^\d+\s*-\s*', ''), r.invoice_no, r.kind,
         r.sold_at, r.net_dirhams / 1000.0, coalesce((r.details->>'grams')::numeric, 0),
         (coalesce((r.details->>'discount_dirhams')::numeric, 0)
          + coalesce((select sum((it->>'discount_dirhams')::numeric) from jsonb_array_elements(r.items) it), 0)) / 1000.0,
         coalesce(nullif(r.details->>'customer', ''), r.m_name), r.p9, r.is_deleted,
         r.lc is not null, nullif(trim(r.lc->>'level'), ''), r.lc->>'status' = 'installed',
         public.loyalty_card_pct_at(r.lc, r.sold_at, r.first_seen_at),
         (r.sc->>'stamps_now')::int, (r.sc->>'rewards_unused')::int, (r.lc->>'to_next')::numeric,
         l.status, l.reason, st.status, j.tier, j.pct,
         r.sc is not null, r.sc->>'status' = 'installed'
  from rw r
  cross join s
  left join amarsoft_branch_map bm on bm.code = r.branch_code
  left join branches b on b.id = bm.branch_id
  left join mstrmnd_sync l on l.invoice_id = r.id and l.mode = 'live' and l.template_id = s.template_id
  left join mstrmnd_sync st on st.invoice_id = r.id and st.mode = 'live' and st.template_id = s.stamp_template_id
  left join lateral (
    select t.tier, t.pct from public.loyalty_tier_for((
      select coalesce(sum(x.net_dirhams), 0) / 1000.0 from amarsoft_invoices x
      where x.kind = 'sale' and not x.is_deleted and x.net_dirhams > 0 and x.sold_at < r.sold_at
        and right(regexp_replace(coalesce(x.details->>'phone', ''), '\D', '', 'g'), 9) = r.p9)) t
    where r.lc is null and r.p9 is not null
  ) j on true
  order by r.sold_at desc;
end $$;

drop function if exists public.loyalty_lookup(text);
create function public.loyalty_lookup(p_q text)
returns table(
  name text, phone9 text, has_card boolean, card_level text, card_pct numeric, card_installed boolean,
  to_next numeric, stamps_now int, rewards_unused int, last_at timestamptz, last_branch text,
  tier_if_joined text, pct_if_joined numeric, has_stamp_card boolean, stamp_installed boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  q text := trim(coalesce(p_q, ''));
  d text := regexp_replace(regexp_replace(coalesce(p_q, ''), '\D', '', 'g'), '^(00218|218|0)', '');
begin
  if auth.uid() is null or (length(d) < 4 and length(q) < 2) then return; end if;
  return query
  with s as (select * from mstrmnd_sync_settings where id = 1),
  people as (
    select c.full_name nm, c.phone9 p9, c.cards from mstrmnd_customers c where c.phone9 is not null
    union all
    select cu.full_name, right(regexp_replace(cu.phone, '\D', '', 'g'), 9), null::jsonb
    from customers cu where length(regexp_replace(coalesce(cu.phone, ''), '\D', '', 'g')) >= 9
  ),
  hit as (
    select distinct on (p.p9) p.nm, p.p9, p.cards from people p
    where case when length(d) >= 4 then p.p9 like '%' || d || '%' else p.nm ilike '%' || q || '%' end
    order by p.p9, (p.cards is null)
    limit 6
  )
  select h.nm, h.p9, k.lc is not null, nullif(trim(k.lc->>'level'), ''), (k.lc->>'discount_pct')::numeric,
         k.lc->>'status' = 'installed', (k.lc->>'to_next')::numeric,
         (k.sc->>'stamps_now')::int, (k.sc->>'rewards_unused')::int, lv.sold_at, lv.bname, j.tier, j.pct,
         k.sc is not null, k.sc->>'status' = 'installed'
  from hit h
  cross join s
  cross join lateral (
    select (select x from jsonb_array_elements(h.cards) x where (x->>'template_id')::int = s.template_id limit 1) lc,
           (select x from jsonb_array_elements(h.cards) x where (x->>'template_id')::int = s.stamp_template_id limit 1) sc
  ) k
  left join lateral (
    select a.sold_at, regexp_replace(coalesce(b.name, a.branch_code), '^\d+\s*-\s*', '') bname
    from amarsoft_invoices a
    left join amarsoft_branch_map bm on bm.code = a.branch_code left join branches b on b.id = bm.branch_id
    where a.kind = 'sale' and not a.is_deleted
      and right(regexp_replace(coalesce(a.details->>'phone', ''), '\D', '', 'g'), 9) = h.p9
    order by a.sold_at desc limit 1
  ) lv on true
  left join lateral (
    select t.tier, t.pct from public.loyalty_tier_for((
      select coalesce(sum(x.net_dirhams), 0) / 1000.0 from amarsoft_invoices x
      where x.kind = 'sale' and not x.is_deleted and x.net_dirhams > 0
        and right(regexp_replace(coalesce(x.details->>'phone', ''), '\D', '', 'g'), 9) = h.p9)) t
    where k.lc is null
  ) j on true
  order by (k.lc is null), h.nm;
end $$;

revoke execute on function public.loyalty_counter_invoices(text, int), public.loyalty_lookup(text) from public, anon;
grant execute on function public.loyalty_counter_invoices(text, int), public.loyalty_lookup(text) to authenticated;
