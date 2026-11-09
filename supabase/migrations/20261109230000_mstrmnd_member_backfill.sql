-- عضو جديد يركّب بطاقة الولاء → شرياته القديمة في أمارسوفت (برقمه) تتزاد على بطاقته وحدها، باش زبون ذهبي ما يلقاش
-- بطاقته برونزي. يخدم من قاعدة البيانات كل نص ساعة (pg_cron + pg_net) بالرمز اللي يجدده mstrmnd-link.
-- ما يعاودش يزيد فاتورة تبعتت (mstrmnd_sync) ولا فاتورة الموظف مسحها بنفس المبلغ في نفس اليوم (mstrmnd_transactions).
create table if not exists public.mstrmnd_member_backfill (
  customer_id text primary key,
  ops int not null default 0,
  done_at timestamptz not null default now()
);
alter table public.mstrmnd_member_backfill enable row level security;
revoke all on public.mstrmnd_member_backfill from anon, authenticated;

-- الأعضاء الحاليين اتعبّت شرياتهم يدوي يوم 9-11-2026 (mstrmnd_backfill).
insert into public.mstrmnd_member_backfill (customer_id, ops)
select id, 0 from public.mstrmnd_customers on conflict do nothing;

create or replace function public.mstrmnd_backfill_new_members()
returns int language plpgsql security definer set search_path to 'public'
as $$
declare
  tok text;
  n int := 0;
  r record;
begin
  -- نتايج الدفعة اللي قبل. الفاتورة تتحجز في mstrmnd_sync (sent) وقت الإرسال، باش الربط (إعادة الـ 48 ساعة) ما يبعتهاش
  -- مرة ثانية؛ لو MSTRMND رفضها نرجّعوها error.
  update mstrmnd_backfill b set http_status = x.status_code from net._http_response x where x.id = b.request_id and b.http_status is null;
  update mstrmnd_sync s set status = 'error', reason = 'فشلت إضافة الشرية القديمة', http_status = b.http_status, updated_at = now()
  from mstrmnd_backfill b
  where b.op = 'add_new_member' and b.http_status is not null and b.http_status not between 200 and 299
    and s.invoice_id = b.invoice_id and s.mode = 'live' and s.template_id = 908119 and s.status = 'sent';

  select access_token into tok from mstrmnd_auth where id = 1 and access_expires_at > now() + interval '3 minutes';
  if tok is null then return 0; end if;

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

  -- كل عضو جديد يتعلّم إنه اتعبّا (حتى لو ما عندهش شريات قديمة) باش ما يتعاودش.
  insert into mstrmnd_member_backfill (customer_id, ops)
  select c.id, (select count(*) from mstrmnd_backfill b where b.customer_id = c.id and b.op = 'add_new_member')
  from mstrmnd_customers c
  where exists (select 1 from jsonb_array_elements(c.cards) k where (k->>'template_id')::int = 908119)
  on conflict do nothing;
  return n;
end;
$$;
revoke execute on function public.mstrmnd_backfill_new_members() from public, anon, authenticated;

select cron.schedule('mstrmnd-backfill-new-members', '5,35 * * * *', $$ select public.mstrmnd_backfill_new_members(); $$);
