-- مراجعة الولاء:
--  1) خانة «الفواتير»: مستوى الزبون وقت الشراء كان يتحسب من lc->>'points'، والبطاقة ما فيهاش points (المجموع في
--     purchases)، فكان يخمّن من الخصم: الذهبي اللي شرى بعدها كان يطلع برونزي وقت الشراء. توا نفس دالة شاشة الموظف.
--  2) إضافة الشريات القديمة للعضو الجديد (كل نص ساعة) تاخذ نفس قفل mstrmnd-link: زبون شرى وبعدين ركّب البطاقة،
--     فاتورته يعاودها الربط ويزيدها، ولو اشتغلوا في نفس اللحظة كانت تتزاد مرتين.
--  3) مرتجع انحذف من أمارسوفت: اللي تنقص من البطاقة يرجع (قبل كان الحذف يتعامل مع فواتير البيع بس).
--     ومع كل فاتورة محذوفة ولا متعدّلة يرجع رقم زبون MSTRMND، باش mstrmnd-link يقرا البطاقة لو الاتصال طاح
--     وسط الكتابة ويعرف هل وصلت (بدل ما يعاودها ويزيدها مرتين).

drop function if exists public.mstrmnd_sync_reversals_t(text);
create function public.mstrmnd_sync_reversals_t(p_mode text)
returns table(invoice_id bigint, template_id integer, amount_ld bigint, card_id bigint, branch_code text, invoice_no text,
              action text, mstrmnd_customer_id text)
language sql stable security definer set search_path = public as $$
  select m.invoice_id, m.template_id, m.amount_ld, m.card_id, a.branch_code, a.invoice_no, m.action, m.mstrmnd_customer_id
  from mstrmnd_sync m
  join amarsoft_invoices a on a.id = m.invoice_id
  where m.mode = p_mode and m.action in ('add', 'subtract') and m.status in ('sent', 'would_send') and a.is_deleted
  limit 50;
$$;

drop function if exists public.mstrmnd_sync_adjustments_t(text);
create function public.mstrmnd_sync_adjustments_t(p_mode text)
returns table(invoice_id bigint, template_id integer, card_id bigint, action text, amount_ld bigint, ld_now bigint,
              branch_code text, invoice_no text, mstrmnd_customer_id text)
language sql stable security definer set search_path = public as $$
  select m.invoice_id, m.template_id, m.card_id, m.action, m.amount_ld,
         round(abs(a.net_dirhams) / 1000.0)::bigint, a.branch_code, a.invoice_no, m.mstrmnd_customer_id
  from mstrmnd_sync m
  join mstrmnd_sync_settings s on s.id = 1
  join amarsoft_invoices a on a.id = m.invoice_id
  where m.mode = p_mode and m.template_id = s.template_id and m.status = 'sent' and m.card_id is not null
    and not a.is_deleted and round(abs(a.net_dirhams) / 1000.0) <> m.amount_ld
  limit 50;
$$;

revoke execute on function public.mstrmnd_sync_reversals_t(text), public.mstrmnd_sync_adjustments_t(text)
  from public, anon, authenticated;

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
         -- المستوى وقت الشراء: نفس حساب شاشة الموظف (مجموع البطاقة توا ناقص اللي تبعت من وقتها).
         public.loyalty_card_pct_at(r.lc, r.sold_at, r.first_seen_at),
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

create or replace function public.mstrmnd_backfill_new_members()
returns integer language plpgsql security definer set search_path = public as $$
declare
  tok text;
  n int := 0;
  r record;
  again boolean;
begin
  update mstrmnd_backfill b set http_status = x.status_code from net._http_response x where x.id = b.request_id and b.http_status is null;
  update mstrmnd_sync s set status = 'error', reason = 'فشلت إضافة الشرية القديمة', http_status = b.http_status, updated_at = now()
  from mstrmnd_backfill b
  where b.op = 'add_new_member' and b.http_status is not null and b.http_status not between 200 and 299
    and s.invoice_id = b.invoice_id and s.mode = 'live' and s.template_id = 908119 and s.status = 'sent';

  select access_token into tok from mstrmnd_auth where id = 1 and access_expires_at > now() + interval '3 minutes';
  if tok is null then return 0; end if;

  -- الربط شغال توا (فاتورة جديدة): نخليوها للدورة الجاية بعد نص ساعة، باش ما نزيدوش نفس الفاتورة مع بعض.
  if not public.mstrmnd_link_acquire(60) then return 0; end if;

  for r in
    with newm as (
      select c.id, c.full_name, c.phone9, (k->>'card_id')::bigint card_id
      from mstrmnd_customers c, jsonb_array_elements(c.cards) k
      where (k->>'template_id')::int = 908119 and c.phone9 is not null
        and not exists (select 1 from mstrmnd_member_backfill m where m.customer_id = c.id)
    ),
    inv as (
      select n.id cust, n.full_name, n.card_id, a.id inv_id, a.branch_code, a.invoice_no,
             (a.sold_at at time zone 'Africa/Tripoli')::date d, round(a.net_dirhams / 1000.0) ld
      from newm n join amarsoft_invoices a on right(regexp_replace(coalesce(a.details->>'phone', ''), '\D', '', 'g'), 9) = n.phone9
      where a.kind = 'sale' and not a.is_deleted and a.net_dirhams > 0
        and not public.amarsoft_internal_customer(a.details->>'customer')
        and not exists (select 1 from mstrmnd_sync s where s.invoice_id = a.id and s.mode = 'live' and s.template_id = 908119 and s.status = 'sent')
        and not exists (select 1 from mstrmnd_backfill b where b.invoice_id = a.id and b.op like 'add%')
    )
    select * from inv
    where not exists (
      select 1 from mstrmnd_transactions t
      where t.customer_id = inv.cust and t.template_id = 908119 and t.operation = 'Transaction amount' and not t.reversed
        and abs((t.created_at at time zone 'Africa/Tripoli')::date - inv.d) <= 1 and abs(t.amount - inv.ld) <= greatest(5, inv.ld * 0.02))
  loop
    insert into mstrmnd_backfill (op, customer_id, customer_name, card_id, invoice_id, amount, note, request_id)
    values ('add_new_member', r.cust, r.full_name, r.card_id, r.inv_id, r.ld, 'شرية قديمة ' || r.branch_code || '-' || r.invoice_no,
      net.http_post(url := 'https://api.digitalwallet.cards/cards/' || r.card_id || '/add-point',
        headers := jsonb_build_object('Authorization', 'Bearer ' || tok, 'Accept', 'application/json', 'Content-Type', 'application/json'),
        body := jsonb_build_object('sourceType', 1, 'points', r.ld::int, 'comment', 'شرية قديمة ' || r.branch_code || '-' || r.invoice_no, 'purchaseSum', r.ld::int),
        timeout_milliseconds := 60000));
    insert into mstrmnd_sync (invoice_id, mode, template_id, action, amount_ld, status, reason, mstrmnd_customer_id, card_id)
    values (r.inv_id, 'live', 908119, 'add', r.ld, 'sent', 'شرية قديمة (عضو جديد)', r.cust, r.card_id)
    on conflict (invoice_id, mode, template_id) do update set status = 'sent', reason = excluded.reason,
      mstrmnd_customer_id = excluded.mstrmnd_customer_id, card_id = excluded.card_id, amount_ld = excluded.amount_ld, updated_at = now();
    n := n + 1;
  end loop;

  insert into mstrmnd_member_backfill (customer_id, ops)
  select c.id, (select count(*) from mstrmnd_backfill b where b.customer_id = c.id and b.op = 'add_new_member')
  from mstrmnd_customers c
  where exists (select 1 from jsonb_array_elements(c.cards) k where (k->>'template_id')::int = 908119)
  on conflict do nothing;

  -- نفكو القفل؛ ولو فاتورة طلبت الربط وهو عندنا، نشغّلوه توا.
  select rerun into again from mstrmnd_sync_settings where id = 1 for update;
  update mstrmnd_sync_settings set run_until = null, rerun = false where id = 1;
  if again then perform public.mstrmnd_kick(); end if;
  return n;
end;
$$;
