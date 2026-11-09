-- خانة «الفواتير» في صفحة الولاء (المدير العام): كل فاتورة لزبون عنده بطاقة MSTRMND، وشن صار فيها:
-- تزادت على بطاقة الولاء ولا لا (وليش)، الختم، مستواه وقت الشراء وقداش كان يستاهل خصم، وقداش الخصم المسجّل في أمارسوفت.
-- مستواه وقت الشراء = مجموع البطاقة توا ناقص الفواتير اللي تبعتت من وقت هذي الفاتورة لتوا.
create or replace function public.loyalty_invoice_feed(p_days int default 7)
returns table(
  invoice_id bigint, branch_code text, branch_name text, invoice_no text, kind text, sold_at timestamptz,
  first_seen_at timestamptz, net_ld numeric, is_deleted boolean, customer_name text, phone9 text,
  has_card boolean, card_created timestamptz, card_level text, card_pct numeric, card_installed boolean,
  stamps_now int, rewards_unused int, pct_at_sale numeric, discount_ld numeric,
  loyalty_status text, loyalty_reason text, loyalty_amount bigint, loyalty_action text, loyalty_at timestamptz,
  stamp_status text, stamp_reason text, stamp_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'admins only'; end if;
  return query
  with s as (select * from mstrmnd_sync_settings where id = 1),
  ls as (
    select (l.silver_points * l.ld_per_point)::numeric silver_ld, (l.gold_points * l.ld_per_point)::numeric gold_ld,
           l.bronze_discount, l.silver_discount, l.gold_discount
    from loyalty_settings l where l.id = 1
  ),
  inv as (
    select a.*, right(regexp_replace(a.details->>'phone', '\D', '', 'g'), 9) p9
    from amarsoft_invoices a, s
    where a.kind in ('sale', 'return')
      and a.sold_at >= greatest(s.live_start_at, now() - make_interval(days => p_days))
      and length(regexp_replace(coalesce(a.details->>'phone', ''), '\D', '', 'g')) >= 9
      and not public.amarsoft_internal_customer(a.details->>'customer')
  ),
  rw as (
    select i.*, m.full_name m_name,
           (select k from jsonb_array_elements(m.cards) k, s where (k->>'template_id')::int = s.template_id limit 1) lc,
           (select k from jsonb_array_elements(m.cards) k, s where (k->>'template_id')::int = s.stamp_template_id limit 1) sc
    from inv i
    cross join lateral (select c.full_name, c.cards from mstrmnd_customers c where c.phone9 = i.p9 limit 1) m
  )
  select r.id, r.branch_code, coalesce(regexp_replace(b.name, '^\d+\s*-\s*', ''), r.branch_code), r.invoice_no, r.kind,
         r.sold_at, r.first_seen_at, r.net_dirhams / 1000.0, r.is_deleted,
         coalesce(nullif(r.m_name, ''), r.details->>'customer'), r.p9,
         r.lc is not null,
         case when (r.lc->>'card_created') is not null then to_timestamp((r.lc->>'card_created')::bigint) end,
         nullif(trim(r.lc->>'level'), ''), (r.lc->>'discount_pct')::numeric, coalesce(r.lc, r.sc)->>'status' = 'installed',
         (r.sc->>'stamps_now')::int, (r.sc->>'rewards_unused')::int,
         -- المستوى وقت الشراء
         case
           when r.lc is null then null
           when (r.lc->>'card_created') is not null and to_timestamp((r.lc->>'card_created')::bigint) > r.first_seen_at then 0
           else (
             select case when cum >= ls.gold_ld then ls.gold_discount when cum >= ls.silver_ld then ls.silver_discount
                         else ls.bronze_discount end
             from ls, lateral (
               select coalesce((r.lc->>'points')::numeric,
                        case (r.lc->>'discount_pct')::numeric
                          when ls.bronze_discount then ls.silver_ld - coalesce((r.lc->>'to_next')::numeric, 0)
                          when ls.silver_discount then ls.gold_ld - coalesce((r.lc->>'to_next')::numeric, 0)
                          else ls.gold_ld end)
                      - coalesce((select sum(case when x.action = 'subtract' then -x.amount_ld else x.amount_ld end)
                                  from mstrmnd_sync x join amarsoft_invoices xa on xa.id = x.invoice_id, s
                                  where x.mode = 'live' and x.template_id = s.template_id and x.status = 'sent'
                                    and x.card_id = (r.lc->>'card_id')::bigint and xa.sold_at >= r.sold_at), 0) cum
             ) c
           )
         end,
         (coalesce((r.details->>'discount_dirhams')::numeric, 0)
          + coalesce((select sum((it->>'discount_dirhams')::numeric) from jsonb_array_elements(r.items) it), 0)) / 1000.0,
         l.status, l.reason, l.amount_ld, l.action, l.updated_at,
         st.status, st.reason, st.updated_at
  from rw r
  cross join s
  left join amarsoft_branch_map bm on bm.code = r.branch_code
  left join branches b on b.id = bm.branch_id
  left join mstrmnd_sync l on l.invoice_id = r.id and l.mode = 'live' and l.template_id = s.template_id
  left join mstrmnd_sync st on st.invoice_id = r.id and st.mode = 'live' and st.template_id = s.stamp_template_id
  order by r.sold_at desc
  limit 300;
end $$;

revoke execute on function public.loyalty_invoice_feed(int) from public, anon;
grant execute on function public.loyalty_invoice_feed(int) to authenticated;
