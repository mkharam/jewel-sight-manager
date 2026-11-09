-- نسخة من عمليات MSTRMND (تركيب بطاقة، مسح، ختم، مكافأة...) يحدّثها mstrmnd-link، باش نعرفو نشاط كل فرع.
-- MSTRMND يسجّل الفرع على عمليات الماسح بس؛ التركيب كله من نفس الـ QR (utm=qr) فما فيهش فرع.
create table if not exists public.mstrmnd_transactions (
  id bigint primary key,
  customer_id text,
  template_id int,
  operation text,
  amount numeric,
  purchase_sum numeric,
  location text,
  manager text,
  device text,
  utm text,
  reversed boolean not null default false,
  created_at timestamptz
);
create index if not exists mstrmnd_transactions_customer_idx on public.mstrmnd_transactions (customer_id, created_at);
alter table public.mstrmnd_transactions enable row level security;
revoke all on public.mstrmnd_transactions from anon;
grant select on public.mstrmnd_transactions to authenticated;
create policy "admin read mstrmnd transactions" on public.mstrmnd_transactions for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- أسامي محلات MSTRMND ← كود فرع أمارسوفت.
create or replace function public.mstrmnd_location_branch(p_location text)
returns text language sql immutable set search_path to 'public' as $$
  select case trim(coalesce(p_location, ''))
    when 'حي الاندلس' then '01' when 'القادسية' then '02' when 'الجرابة' then '03'
    when 'بن عاشور' then '04' when 'النوفليين' then '05' else null end;
$$;

-- فرع بطاقة كل زبون في MSTRMND، بالترتيب:
--   1) فاتورة أمارسوفت برقمه في نفس يوم ما طلّع البطاقة (أو اليوم اللي قبله/بعده) — الأقرب للوقت
--   2) أول عملية ماسح عليه (الماسح يسجّل الفرع)
--   3) الفرع اللي يشري منه أكثر في أمارسوفت
--   4) الفرع اللي مسجّل فيه في أمارسوفت
create or replace function public.mstrmnd_customer_branches()
returns table (customer_id text, branch_code text, how text)
language sql stable security definer set search_path to 'public'
as $$
  with c as (select id, phone9, created_at from mstrmnd_customers),
  inv as (
    select a.branch_code, a.sold_at, right(regexp_replace(a.details->>'phone', '\D', '', 'g'), 9) p9
    from amarsoft_invoices a
    where not a.is_deleted and a.kind = 'sale' and length(regexp_replace(coalesce(a.details->>'phone', ''), '\D', '', 'g')) >= 9
  ),
  near as (
    select distinct on (c.id) c.id, i.branch_code
    from c join inv i on i.p9 = c.phone9 and abs(extract(epoch from (i.sold_at - c.created_at))) <= 36 * 3600
    order by c.id, abs(extract(epoch from (i.sold_at - c.created_at)))
  ),
  scan as (
    select distinct on (t.customer_id) t.customer_id id, mstrmnd_location_branch(t.location) branch_code
    from mstrmnd_transactions t
    where mstrmnd_location_branch(t.location) is not null
    order by t.customer_id, t.created_at
  ),
  most as (
    select distinct on (c.id) c.id, i.branch_code
    from c join inv i on i.p9 = c.phone9
    group by c.id, i.branch_code
    order by c.id, count(*) desc
  ),
  -- 4) الفرع اللي مسجّل فيه كزبون في أمارسوفت (لو عمره ما شرى برقمه ولا تمسح)
  reg as (
    select distinct on (c.id) c.id, l.branch_code
    from c join amarsoft_customer_links l on right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 9) = c.phone9
    order by c.id, l.branch_code
  )
  select c.id,
         coalesce(near.branch_code, scan.branch_code, most.branch_code, reg.branch_code),
         case when near.branch_code is not null then 'فاتورة يوم البطاقة'
              when scan.branch_code is not null then 'أول مسح'
              when most.branch_code is not null then 'أكثر فرع يشري منه'
              when reg.branch_code is not null then 'مسجّل في الفرع'
              else 'غير معروف' end
  from c
  left join near on near.id = c.id
  left join scan on scan.id = c.id
  left join most on most.id = c.id
  left join reg on reg.id = c.id
  where public.has_role(auth.uid(), 'admin') or auth.uid() is null;
$$;
revoke execute on function public.mstrmnd_customer_branches() from public, anon;
grant execute on function public.mstrmnd_customer_branches() to authenticated;

-- تقرير الفروع: أعضاء MSTRMND حسب فرع بطاقتهم ومستوياتهم وأختامهم، ونشاط كل فرع في الفترة.
create or replace function public.loyalty_branch_report(p_days int default 30)
returns table (branch_code text, branch_name text, members bigint, installed bigint,
               bronze bigint, silver bigint, gold bigint, stamp_holders bigint, stamps_in_progress bigint, rewards_unused bigint,
               new_cards bigint, scans bigint, link_sent bigint, sales bigint, sales_with_phone bigint, member_sales bigint)
language sql stable security definer set search_path to 'public'
as $$
  with since as (select now() - make_interval(days => greatest(p_days, 1)) t),
  cb as (select * from mstrmnd_customer_branches()),
  m as (
    select cb.branch_code, c.id, c.created_at,
           (select k from jsonb_array_elements(c.cards) k where (k->>'template_id')::int = 908119) loyal,
           (select k from jsonb_array_elements(c.cards) k where (k->>'template_id')::int = 908120) stamp,
           exists (select 1 from jsonb_array_elements(c.cards) k where k->>'status' = 'installed') inst
    from mstrmnd_customers c join cb on cb.customer_id = c.id
  ),
  mem as (
    select coalesce(branch_code, '—') branch_code, count(*) members, count(*) filter (where inst) installed,
           count(*) filter (where trim(loyal->>'level') = 'برونزي') bronze,
           count(*) filter (where trim(loyal->>'level') = 'فضي') silver,
           count(*) filter (where trim(loyal->>'level') = 'ذهبي') gold,
           count(stamp) stamp_holders,
           count(*) filter (where (stamp->>'stamps_now')::int > 0) stamps_in_progress,
           coalesce(sum((stamp->>'rewards_unused')::int) filter (where (stamp->>'stamps_total')::int <= 100), 0) rewards_unused,
           count(*) filter (where created_at >= (select t from since)) new_cards
    from m group by 1
  ),
  sc as (
    select mstrmnd_location_branch(location) branch_code, count(*) scans
    from mstrmnd_transactions
    where created_at >= (select t from since) and mstrmnd_location_branch(location) is not null
      and operation not ilike '%install%' and operation not ilike '%deleted%' and not reversed
    group by 1
  ),
  ln as (
    select a.branch_code, count(distinct m.invoice_id) link_sent
    from mstrmnd_sync m join amarsoft_invoices a on a.id = m.invoice_id
    where m.mode = 'live' and m.status = 'sent' and a.sold_at >= (select t from since)
    group by 1
  ),
  sa as (
    select a.branch_code, count(*) sales,
           count(*) filter (where length(regexp_replace(coalesce(a.details->>'phone', ''), '\D', '', 'g')) >= 9) with_phone,
           count(*) filter (where right(regexp_replace(coalesce(a.details->>'phone', ''), '\D', '', 'g'), 9) in (select phone9 from mstrmnd_customers where phone9 is not null)) member_sales
    from amarsoft_invoices a
    where a.kind = 'sale' and not a.is_deleted and a.sold_at >= (select t from since)
      and not public.amarsoft_internal_customer(a.details->>'customer')
    group by 1
  )
  select bm.code, b.name,
         coalesce(mem.members, 0), coalesce(mem.installed, 0), coalesce(mem.bronze, 0), coalesce(mem.silver, 0), coalesce(mem.gold, 0),
         coalesce(mem.stamp_holders, 0), coalesce(mem.stamps_in_progress, 0), coalesce(mem.rewards_unused, 0), coalesce(mem.new_cards, 0),
         coalesce(sc.scans, 0), coalesce(ln.link_sent, 0), coalesce(sa.sales, 0), coalesce(sa.with_phone, 0), coalesce(sa.member_sales, 0)
  from amarsoft_branch_map bm
  join branches b on b.id = bm.branch_id
  left join mem on mem.branch_code = bm.code
  left join sc on sc.branch_code = bm.code
  left join ln on ln.branch_code = bm.code
  left join sa on sa.branch_code = bm.code
  where public.has_role(auth.uid(), 'admin')
  union all
  select '—', 'فرع غير معروف', mem.members, mem.installed, mem.bronze, mem.silver, mem.gold, mem.stamp_holders, mem.stamps_in_progress,
         mem.rewards_unused, mem.new_cards, 0, 0, 0, 0, 0
  from mem where mem.branch_code = '—' and public.has_role(auth.uid(), 'admin')
  order by 1;
$$;
revoke execute on function public.loyalty_branch_report(int) from public, anon;
grant execute on function public.loyalty_branch_report(int) to authenticated;
