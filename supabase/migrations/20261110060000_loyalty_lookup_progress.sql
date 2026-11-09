-- لوحة الولاء: مجموع شريات الزبون على بطاقة الولاء (لشريط التقدّم للمستوى الجاي) وعدد زياراته.
drop function if exists public.loyalty_lookup(text);
create function public.loyalty_lookup(p_q text)
returns table(
  name text, phone9 text, has_card boolean, card_level text, card_pct numeric, card_installed boolean,
  to_next numeric, stamps_now int, rewards_unused int, last_at timestamptz, last_branch text,
  tier_if_joined text, pct_if_joined numeric, has_stamp_card boolean, stamp_installed boolean,
  purchases numeric, visits int)
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
         k.sc is not null, k.sc->>'status' = 'installed',
         (k.lc->>'purchases')::numeric, coalesce((k.lc->>'visits')::int, (k.sc->>'visits')::int)
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

revoke execute on function public.loyalty_lookup(text) from public, anon;
grant execute on function public.loyalty_lookup(text) to authenticated;
