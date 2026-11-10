-- الملخّص اليومي: كل شي صار في يوم واحد في أمارسوفت ومع الولاء، في رد واحد (المدير العام بس).
--   · كل فرع: باع ولا لا، قداش (كاش/مصرف)، أول وآخر فاتورة، البائعين، فواتير بأرقام زبائن وفواتير أعضاء الولاء.
--   · كل فاتورة: البائع، الزبون، عضو ولا لا، وصلت لبطاقته ولا لا، الخصم اللي يستاهله والمسجّل في أمارسوفت.
--   · فواتير انحذفت ولا تعدّلت في اليوم هذا (حتى لو تاريخها قديم)، ومن أي حساب في أمارسوفت.
--   · الولاء: من دخل (بطاقة جديدة)، من ركّبها في موبايله ومن شالها، من طلع مستوى، من كمّل الأختام ومن خدا هديته.
--   · آخر مزامنة مع أمارسوفت ومع MSTRMND، باش «ما فيش مبيعات» ما تتلخبطش مع «المزامنة واقفة».
create or replace function public.daily_amarsoft(p_day date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d0 timestamptz := p_day::timestamp at time zone 'Africa/Tripoli';
  d1 timestamptz := (p_day + 1)::timestamp at time zone 'Africa/Tripoli';
  cfg mstrmnd_sync_settings;
  res jsonb;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'admins only'; end if;
  select * into cfg from mstrmnd_sync_settings where id = 1;

  with inv as (
    select a.*,
           case when length(regexp_replace(coalesce(a.details->>'phone', ''), '\D', '', 'g')) >= 9
                then right(regexp_replace(a.details->>'phone', '\D', '', 'g'), 9) end p9,
           public.amarsoft_internal_customer(a.details->>'customer') internal,
           coalesce((a.details->>'grams')::numeric, 0) g
    from amarsoft_invoices a
    where a.kind in ('sale', 'return') and a.sold_at >= d0 and a.sold_at < d1
  ),
  iv as (
    select i.*, m.full_name m_name,
           (select k from jsonb_array_elements(m.cards) k where (k->>'template_id')::int = cfg.template_id limit 1) lc,
           (select k from jsonb_array_elements(m.cards) k where (k->>'template_id')::int = cfg.stamp_template_id limit 1) sc,
           (coalesce((i.details->>'discount_dirhams')::numeric, 0)
            + coalesce((select sum((it->>'discount_dirhams')::numeric) from jsonb_array_elements(i.items) it), 0)) / 1000.0 given,
           coalesce(sm.name, i.sman) sman_name,
           l.status l_status, l.reason l_reason, st.status s_status, st.reason s_reason
    from inv i
    left join lateral (
      select c.full_name, c.cards from mstrmnd_customers c
      where i.p9 is not null and not i.internal and c.phone9 = i.p9 limit 1
    ) m on true
    left join amarsoft_salesmen sm on sm.branch_code = i.branch_code and sm.sman = i.sman
    left join mstrmnd_sync l on l.invoice_id = i.id and l.mode = 'live' and l.template_id = cfg.template_id
    left join mstrmnd_sync st on st.invoice_id = i.id and st.mode = 'live' and st.template_id = cfg.stamp_template_id
  ),
  ivp as (
    select v.*, case when v.kind = 'sale' and v.lc is not null
                     then public.loyalty_card_pct_at(v.lc, v.sold_at, v.first_seen_at) end pct
    from iv v
  ),
  ev as (
    select distinct on (e.branch_code, e.trn_no, e.trn_date, e.status) e.*
    from amarsoft_doc_events e
    where e.trn_type = 'RSL' and e.status in ('D', 'E') and e.at >= d0 and e.at < d1
    order by e.branch_code, e.trn_no, e.trn_date, e.status, e.at desc
  ),
  ch as (select * from public.amarsoft_invoice_changes(p_day - 120, p_day, null)),
  cb as (select * from public.mstrmnd_customer_branches()),
  tx as (
    select t.customer_id, t.template_id, t.operation, min(t.created_at) at
    from mstrmnd_transactions t
    where t.created_at >= d0 and t.created_at < d1 and not t.reversed
      and t.operation in ('Card installed', 'Card deleted from device', 'New level reached', 'Rewards earned', 'Rewards redeemed')
    group by 1, 2, 3
  ),
  joined as (
    select c.id, c.full_name,
           bool_or((k->>'template_id')::int = cfg.template_id) loyalty,
           bool_or((k->>'template_id')::int = cfg.stamp_template_id) stamps,
           bool_and(k->>'status' = 'installed') installed,
           min(to_timestamp((k->>'card_created')::bigint)) at
    from mstrmnd_customers c cross join jsonb_array_elements(c.cards) k
    where (k->>'card_created') is not null
      and to_timestamp((k->>'card_created')::bigint) >= d0 and to_timestamp((k->>'card_created')::bigint) < d1
    group by c.id, c.full_name
  )
  select jsonb_build_object(
    'day', p_day,
    'sync', jsonb_build_object(
      'amarsoft_at', (select max(received_at) from amarsoft_sync_log),
      'link_at', cfg.last_run_at,
      'cards_at', cfg.mirror_at,
      'link_error', (select a.last_error from mstrmnd_auth a where a.id = 1)),
    'branches', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'code', m.code, 'name', regexp_replace(coalesce(b.name, m.code), '^\d+\s*-\s*', ''),
        'sales', x.sales, 'returns', x.returns, 'deleted', x.deleted, 'net_ld', x.net / 1000.0, 'grams', x.grams,
        'with_phone', x.with_phone, 'members', x.members, 'stamp_members', x.stamp_members,
        'first_at', x.first_at, 'last_at', x.last_at,
        'edited', (select count(*) from ev where ev.branch_code = m.code and ev.status = 'E'),
        'deleted_today', (select count(*) from ev where ev.branch_code = m.code and ev.status = 'D'),
        'pay', (select coalesce(jsonb_object_agg(p.acc, p.v), '{}'::jsonb) from (
                  select pay->>'account' acc, sum(case when v.kind = 'return' then -1 else 1 end * (pay->>'amount_dirhams')::bigint) / 1000.0 v
                  from ivp v cross join jsonb_array_elements(coalesce(v.details->'payments', '[]'::jsonb)) pay
                  where v.branch_code = m.code and not v.is_deleted group by 1) p),
        'salesmen', (select coalesce(jsonb_agg(jsonb_build_object('name', s.nm, 'n', s.n, 'ld', s.v / 1000.0) order by s.v desc), '[]'::jsonb) from (
                  select coalesce(v.sman_name, 'بلا بائع') nm, count(*) n, sum(v.net_dirhams) v
                  from ivp v where v.branch_code = m.code and v.kind = 'sale' and not v.is_deleted group by 1) s)
      ) order by m.code), '[]'::jsonb)
      from amarsoft_branch_map m
      left join branches b on b.id = m.branch_id
      cross join lateral (
        select count(*) filter (where v.kind = 'sale' and not v.is_deleted) sales,
               count(*) filter (where v.kind = 'return' and not v.is_deleted) returns,
               count(*) filter (where v.is_deleted) deleted,
               coalesce(sum(v.net_dirhams) filter (where not v.is_deleted), 0) net,
               round(coalesce(sum(case when v.kind = 'return' then -v.g else v.g end) filter (where not v.is_deleted), 0), 2) grams,
               count(*) filter (where v.kind = 'sale' and not v.is_deleted and v.p9 is not null and not v.internal) with_phone,
               count(*) filter (where v.kind = 'sale' and not v.is_deleted and v.lc is not null) members,
               count(*) filter (where v.kind = 'sale' and not v.is_deleted and v.sc is not null) stamp_members,
               min(v.sold_at) filter (where v.kind = 'sale' and not v.is_deleted) first_at,
               max(v.sold_at) filter (where v.kind = 'sale' and not v.is_deleted) last_at
        from ivp v where v.branch_code = m.code
      ) x),
    'invoices', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', v.id, 'code', v.branch_code, 'no', v.invoice_no, 'kind', v.kind, 'at', v.sold_at, 'deleted', v.is_deleted,
        'sman', v.sman_name, 'customer', coalesce(nullif(trim(v.details->>'customer'), ''), v.m_name),
        'has_phone', v.p9 is not null, 'internal', v.internal,
        'net_ld', v.net_dirhams / 1000.0, 'grams', v.g, 'pcs', jsonb_array_length(coalesce(v.items, '[]'::jsonb)),
        'pay', (select string_agg(distinct pay->>'account', '+') from jsonb_array_elements(coalesce(v.details->'payments', '[]'::jsonb)) pay),
        'member', v.lc is not null, 'stamp_card', v.sc is not null, 'level', nullif(trim(v.lc->>'level'), ''),
        'stamps_now', (v.sc->>'stamps_now')::int,
        'pct', v.pct, 'given', v.given,
        'due', case when v.pct > 0 then round((v.net_dirhams / 1000.0 + v.given) * v.pct / 100, 2) end,
        'on_card', v.l_status, 'on_card_reason', v.l_reason, 'stamp', v.s_status, 'stamp_reason', v.s_reason
      ) order by v.sold_at desc), '[]'::jsonb)
      from ivp v),
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'code', e.branch_code, 'no', e.trn_no, 'inv_date', e.trn_date, 'status', e.status, 'at', e.at,
        'by', nullif(trim(split_part(coalesce(e.user_name, e.machine, ''), '#', 2)), ''),
        'customer', coalesce(a.details->>'customer', c.customer),
        'net_ld', abs(a.net_dirhams) / 1000.0, 'old_ld', c.old_net / 1000.0, 'new_ld', c.new_net / 1000.0, 'change', c.change
      ) order by e.at desc), '[]'::jsonb)
      from ev e
      left join lateral (
        select x.details, x.net_dirhams from amarsoft_invoices x
        where x.branch_code = e.branch_code and x.kind = 'sale' and x.invoice_no = e.trn_no and x.invoice_date = e.trn_date
        limit 1) a on true
      left join lateral (
        select ch.* from ch
        where ch.branch_code = e.branch_code and ch.invoice_no = e.trn_no and ch.invoice_date = e.trn_date
        order by (ch.change = 'deleted') = (e.status = 'D') desc limit 1) c on true),
    'joined', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', j.full_name, 'branch', cb.branch_code, 'loyalty', j.loyalty, 'stamps', j.stamps,
        'installed', j.installed, 'at', j.at) order by j.at), '[]'::jsonb)
      from joined j left join cb on cb.customer_id = j.id),
    'card_events', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'op', t.operation, 'name', c.full_name, 'at', t.at,
        'card', case t.template_id when cfg.template_id then 'loyalty' when cfg.stamp_template_id then 'stamps' else 'other' end,
        'level', case when t.operation = 'New level reached' then (
                   select nullif(trim(k->>'level'), '') from jsonb_array_elements(c.cards) k
                   where (k->>'template_id')::int = cfg.template_id limit 1) end
      ) order by t.at), '[]'::jsonb)
      from tx t left join mstrmnd_customers c on c.id = t.customer_id)
  ) into res;
  return res;
end $$;

revoke execute on function public.daily_amarsoft(date) from public, anon;
grant execute on function public.daily_amarsoft(date) to authenticated;
