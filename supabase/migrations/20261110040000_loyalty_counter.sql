-- شاشة الموظف في خانة «خصم الزبون»: آخر فواتير فرعه وقداش لازم يكون الخصم على كل وحدة، والبحث على زبون قبل الفاتورة.
-- المستوى والخصم من بطاقة MSTRMND (اللي الزبون يشوفها في موبايله). الموظف يشوف فرعه بس؛ المدير العام والمشرف كل الفروع.

-- خصم بطاقة الولاء وقت فاتورة: 0 لو البطاقة طلعت بعد الفاتورة، وإلا المستوى من مجموع البطاقة توا ناقص اللي تبعت من وقتها لتوا.
create or replace function public.loyalty_card_pct_at(p_card jsonb, p_sold_at timestamptz, p_seen_at timestamptz)
returns numeric language sql stable security definer set search_path = public as $$
  with s as (select template_id from mstrmnd_sync_settings where id = 1),
  ls as (select (silver_points * ld_per_point)::numeric silver_ld, (gold_points * ld_per_point)::numeric gold_ld,
                bronze_discount, silver_discount, gold_discount from loyalty_settings where id = 1),
  cum as (
    select coalesce((p_card->>'points')::numeric,
             case (p_card->>'discount_pct')::numeric
               when ls.bronze_discount then ls.silver_ld - coalesce((p_card->>'to_next')::numeric, 0)
               when ls.silver_discount then ls.gold_ld - coalesce((p_card->>'to_next')::numeric, 0)
               else ls.gold_ld end)
           - coalesce((select sum(case when x.action = 'subtract' then -x.amount_ld else x.amount_ld end)
                       from mstrmnd_sync x join amarsoft_invoices xa on xa.id = x.invoice_id, s
                       where x.mode = 'live' and x.template_id = s.template_id and x.status = 'sent'
                         and x.card_id = (p_card->>'card_id')::bigint and xa.sold_at >= p_sold_at), 0) v
    from ls)
  select case
    when p_card is null then null
    when (p_card->>'card_created') is not null and to_timestamp((p_card->>'card_created')::bigint) > p_seen_at then 0
    else (select case when cum.v >= ls.gold_ld then ls.gold_discount when cum.v >= ls.silver_ld then ls.silver_discount
                      else ls.bronze_discount end from cum, ls)
  end;
$$;

-- المستوى اللي يطلعله لو ركّب البطاقة توا (شرياته القديمة تنحسبله): من مجموع شرياته في أمارسوفت.
create or replace function public.loyalty_tier_for(p_total_ld numeric, out tier text, out pct numeric)
language sql stable security definer set search_path = public as $$
  select case when p_total_ld >= gold_points * ld_per_point then 'gold'
              when p_total_ld >= silver_points * ld_per_point then 'silver' else 'bronze' end,
         case when p_total_ld >= gold_points * ld_per_point then gold_discount
              when p_total_ld >= silver_points * ld_per_point then silver_discount else bronze_discount end
  from loyalty_settings where id = 1;
$$;

-- الفروع اللي يشوفها: فرعه بس، ولو مدير عام ولا مشرف (ولا مدير بلا فرع) كل الفروع.
create or replace function public.loyalty_counter_branches()
returns table(code text, name text, mine boolean)
language sql stable security definer set search_path = public as $$
  with me as (select p.branch_id from profiles p where p.id = auth.uid()),
  lead as (select has_role(auth.uid(), 'admin') or has_role(auth.uid(), 'supervisor')
                  or (has_role(auth.uid(), 'manager') and (select branch_id from me) is null) v)
  select m.code, regexp_replace(coalesce(b.name, m.code), '^\d+\s*-\s*', ''),
         coalesce(m.branch_id = (select branch_id from me), false)
  from amarsoft_branch_map m left join branches b on b.id = m.branch_id
  where auth.uid() is not null and ((select v from lead) or m.branch_id = (select branch_id from me))
  order by m.code;
$$;

-- آخر فواتير الفرع (آخر 3 أيام) ومعلومات الولاء لكل وحدة.
create or replace function public.loyalty_counter_invoices(p_branch text default null, p_limit int default 15)
returns table(
  invoice_id bigint, branch_code text, branch_name text, invoice_no text, kind text, sold_at timestamptz,
  net_ld numeric, grams numeric, discount_ld numeric, customer_name text, phone9 text, is_deleted boolean,
  has_card boolean, card_level text, card_installed boolean, pct_due numeric, stamps_now int, rewards_unused int,
  to_next numeric, on_card text, on_card_reason text, stamp_on_card text, tier_if_joined text, pct_if_joined numeric)
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
         r.lc is not null, nullif(trim(r.lc->>'level'), ''), coalesce(r.lc, r.sc)->>'status' = 'installed',
         public.loyalty_card_pct_at(r.lc, r.sold_at, r.first_seen_at),
         (r.sc->>'stamps_now')::int, (r.sc->>'rewards_unused')::int, (r.lc->>'to_next')::numeric,
         l.status, l.reason, st.status, j.tier, j.pct
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

-- زبون قبل الفاتورة: برقمه (4 أرقام فما فوق) ولا باسمه. من زبائن MSTRMND والعملاء في البرنامج.
create or replace function public.loyalty_lookup(p_q text)
returns table(
  name text, phone9 text, has_card boolean, card_level text, card_pct numeric, card_installed boolean,
  to_next numeric, stamps_now int, rewards_unused int, last_at timestamptz, last_branch text,
  tier_if_joined text, pct_if_joined numeric)
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
         coalesce(k.lc, k.sc)->>'status' = 'installed', (k.lc->>'to_next')::numeric,
         (k.sc->>'stamps_now')::int, (k.sc->>'rewards_unused')::int, lv.sold_at, lv.bname, j.tier, j.pct
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

revoke execute on function public.loyalty_card_pct_at(jsonb, timestamptz, timestamptz), public.loyalty_tier_for(numeric)
  from public, anon, authenticated;
revoke execute on function public.loyalty_counter_branches(), public.loyalty_counter_invoices(text, int), public.loyalty_lookup(text)
  from public, anon;
grant execute on function public.loyalty_counter_branches(), public.loyalty_counter_invoices(text, int), public.loyalty_lookup(text)
  to authenticated;
