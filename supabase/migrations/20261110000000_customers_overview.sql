-- ملف الزبون الموحّد (المدير العام): كل اللي يهمك على كل عميل في مكان واحد، باش ما تحتاجش تدخل MSTRMND.
-- فواتير أمارسوفت تنربط بالعميل برقم هاتفه على الفاتورة أو برمزه في أمارسوفت (amarsoft_customer_links).

-- 1) أعضاء MSTRMND اللي مش في قائمة العملاء (ركّبوا البطاقة وما شروش برقمهم) يتزادوا للقائمة.
create or replace function public.customers_add_mstrmnd_members()
returns int language sql security definer set search_path to 'public'
as $$
  with ins as (
    insert into customers (full_name, phone, notes)
    select coalesce(nullif(trim(m.full_name), ''), 'عضو بطاقة'), '0' || m.phone9, 'من بطاقة الولاء (MSTRMND)'
    from mstrmnd_customers m
    where m.phone9 is not null
      and not exists (select 1 from customers c where right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 9) = m.phone9)
    returning 1
  )
  select count(*)::int from ins;
$$;
revoke execute on function public.customers_add_mstrmnd_members() from public, anon, authenticated;
select public.customers_add_mstrmnd_members();
select cron.schedule('customers-add-mstrmnd-members', '10,40 * * * *', $$ select public.customers_add_mstrmnd_members(); $$);

-- 2) فواتير كل عميل (برقمه أو برمزه في أمارسوفت).
create or replace function public.customer_invoice_ids()
returns table (customer_id uuid, invoice_id bigint)
language sql stable security definer set search_path to 'public'
as $$
  with c as (select id, right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 9) p9 from customers),
  a as (
    select id, branch_code, details->>'guest_code' guest, right(regexp_replace(coalesce(details->>'phone', ''), '\D', '', 'g'), 9) p9
    from amarsoft_invoices where not is_deleted and kind in ('sale', 'return') and not public.amarsoft_internal_customer(details->>'customer')
  )
  select c.id, a.id from c join a on a.p9 = c.p9 where length(c.p9) = 9
  union
  select l.customer_id, a.id from amarsoft_customer_links l join a on a.branch_code = l.branch_code and a.guest = l.guest_code
  where l.customer_id is not null;
$$;
revoke execute on function public.customer_invoice_ids() from public, anon, authenticated;

-- 3) نظرة على كل العملاء.
create or replace function public.customers_overview()
returns table (
  customer_id uuid, full_name text, phone text, phone9 text, notes text,
  main_branch text, main_branch_name text, invoices bigint, visit_days bigint, returns bigint, total_ld numeric, grams numeric,
  first_at timestamptz, last_at timestamptz, last_branch_name text, last_salesman text,
  last_price18 numeric, last_price21 numeric, avg_price18 numeric, avg_price21 numeric,
  tier text, has_card boolean, card_installed boolean, card_level text, card_discount numeric, card_to_next numeric,
  stamps_now int, rewards_unused int, gift_balance numeric, contacted text[]
)
language sql stable security definer set search_path to 'public'
as $$
  with s as (select silver_points * ld_per_point silver_ld, gold_points * ld_per_point gold_ld from loyalty_settings where id = 1),
  ids as (select * from customer_invoice_ids()),
  inv as (
    select ids.customer_id cust, a.id, a.branch_code, a.kind, a.sman, a.sold_at, a.net_dirhams / 1000.0 ld, a.items,
           (a.sold_at at time zone 'Africa/Tripoli')::date d,
           (select coalesce(sum((i->>'grams')::numeric), 0) from jsonb_array_elements(a.items) i) inv_grams
    from ids join amarsoft_invoices a on a.id = ids.invoice_id
  ),
  -- سعر القرام لكل عيار في كل فاتورة: (قيمة القطع ÷ وزنها).
  kp as (
    select inv.cust, inv.id, inv.sold_at,
           case when (i->>'purity')::numeric = 0.75 then '18' when (i->>'purity')::numeric = 0.875 then '21' end karat,
           sum((i->>'amount_dirhams')::numeric) / 1000.0 amt, sum((i->>'grams')::numeric) g
    from inv, jsonb_array_elements(inv.items) i
    where inv.kind = 'sale' and (i->>'purity')::numeric in (0.75, 0.875) and (i->>'grams')::numeric > 0
    group by 1, 2, 3, 4
  ),
  lastp as (
    select distinct on (cust, karat) cust, karat, round(amt / nullif(g, 0)) price from kp order by cust, karat, sold_at desc
  ),
  avgp as (select cust, karat, round(sum(amt) / nullif(sum(g), 0)) price from kp group by 1, 2),
  mainb as (
    select distinct on (cust) cust, branch_code from inv group by cust, branch_code order by cust, count(*) desc
  ),
  agg as (
    select cust,
           count(*) filter (where kind = 'sale') invoices, count(distinct d) filter (where kind = 'sale') visit_days,
           count(*) filter (where kind = 'return') returns, round(sum(ld)) total_ld,
           round(sum(inv_grams) filter (where kind = 'sale'), 2) grams,
           min(sold_at) first_at, max(sold_at) last_at,
           (array_agg(branch_code order by sold_at desc))[1] last_branch,
           (array_agg(sman order by sold_at desc) filter (where kind = 'sale'))[1] last_sman
    from inv group by cust
  ),
  mc as (
    select m.phone9,
           bool_or(k->>'status' = 'installed') installed,
           max(trim(k->>'level')) filter (where (k->>'template_id')::int = 908119) level,
           max((k->>'discount_pct')::numeric) filter (where (k->>'template_id')::int = 908119) discount,
           max((k->>'to_next')::numeric) filter (where (k->>'template_id')::int = 908119) to_next,
           max((k->>'stamps_now')::int) filter (where (k->>'template_id')::int = 908120) stamps_now,
           max((k->>'rewards_unused')::int) filter (where (k->>'template_id')::int = 908120) rewards_unused,
           max((k->>'balance')::numeric) filter (where (k->>'template_id')::int = 908118) gift
    from mstrmnd_customers m, jsonb_array_elements(m.cards) k where m.phone9 is not null group by m.phone9
  ),
  bn as (select bm.code, regexp_replace(b.name, '^\d+\s*-\s*', '') name from amarsoft_branch_map bm join branches b on b.id = bm.branch_id)
  select c.id, c.full_name, c.phone, right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 9), c.notes,
         mainb.branch_code, mb.name, coalesce(agg.invoices, 0), coalesce(agg.visit_days, 0), coalesce(agg.returns, 0),
         coalesce(agg.total_ld, 0), coalesce(agg.grams, 0), agg.first_at, agg.last_at, lb.name,
         coalesce(nullif(pr.full_name, ''), sm.name, nullif(agg.last_sman, '')),
         l18.price, l21.price, a18.price, a21.price,
         case when agg.total_ld is null or agg.total_ld <= 0 then null
              when agg.total_ld >= (select gold_ld from s) then 'gold' when agg.total_ld >= (select silver_ld from s) then 'silver' else 'bronze' end,
         mc.phone9 is not null, coalesce(mc.installed, false), mc.level, mc.discount, mc.to_next, mc.stamps_now, mc.rewards_unused, mc.gift,
         coalesce((select array_agg(lc.category) from loyalty_contacts lc
                   where lc.phone9 = right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 9)), '{}')
  from customers c
  left join agg on agg.cust = c.id
  left join mainb on mainb.cust = c.id
  left join bn mb on mb.code = mainb.branch_code
  left join bn lb on lb.code = agg.last_branch
  left join amarsoft_salesmen sm on sm.branch_code = agg.last_branch and sm.sman = agg.last_sman
  left join profiles pr on pr.id = sm.profile_id
  left join lastp l18 on l18.cust = c.id and l18.karat = '18'
  left join lastp l21 on l21.cust = c.id and l21.karat = '21'
  left join avgp a18 on a18.cust = c.id and a18.karat = '18'
  left join avgp a21 on a21.cust = c.id and a21.karat = '21'
  left join mc on mc.phone9 = right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 9)
  where public.has_role(auth.uid(), 'admin');
$$;
revoke execute on function public.customers_overview() from public, anon;
grant execute on function public.customers_overview() to authenticated;

-- 4) فواتير عميل واحد بالتفصيل: القطع، العيار، سعر القرام، البائع، وهل وصلت لبطاقته.
create or replace function public.customer_invoices(p_customer uuid)
returns table (id bigint, branch_code text, branch_name text, invoice_no text, sold_at timestamptz, kind text, net_dirhams bigint,
               items jsonb, salesman text, price18 numeric, price21 numeric, sent_to_card boolean)
language sql stable security definer set search_path to 'public'
as $$
  with bn as (select bm.code, regexp_replace(b.name, '^\d+\s*-\s*', '') name from amarsoft_branch_map bm join branches b on b.id = bm.branch_id),
  mid as (
    select m.id from customers c join mstrmnd_customers m on m.phone9 = right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 9)
    where c.id = p_customer
  )
  select a.id, a.branch_code, bn.name, a.invoice_no, a.sold_at, a.kind, a.net_dirhams, a.items,
         coalesce(nullif(pr.full_name, ''), sm.name, nullif(a.sman, '')),
         (select round(sum((i->>'amount_dirhams')::numeric) / 1000.0 / nullif(sum((i->>'grams')::numeric), 0))
            from jsonb_array_elements(a.items) i where (i->>'purity')::numeric = 0.75 and (i->>'grams')::numeric > 0),
         (select round(sum((i->>'amount_dirhams')::numeric) / 1000.0 / nullif(sum((i->>'grams')::numeric), 0))
            from jsonb_array_elements(a.items) i where (i->>'purity')::numeric = 0.875 and (i->>'grams')::numeric > 0),
         -- على البطاقة: بعتها الربط، ولا اتزادت كشرية قديمة، ولا الموظف مسحها بنفس المبلغ في نفس اليوم.
         exists (select 1 from mstrmnd_sync s where s.invoice_id = a.id and s.mode = 'live' and s.status = 'sent' and s.template_id = 908119)
         or exists (select 1 from mstrmnd_backfill b where b.invoice_id = a.id and b.op like 'add%' and b.http_status between 200 and 299)
         or exists (select 1 from mstrmnd_transactions t join mid on mid.id = t.customer_id
                    where t.template_id = 908119 and t.operation = 'Transaction amount' and not t.reversed
                      and abs((t.created_at at time zone 'Africa/Tripoli')::date - (a.sold_at at time zone 'Africa/Tripoli')::date) <= 1
                      and abs(t.amount - a.net_dirhams / 1000.0) <= greatest(5, a.net_dirhams / 1000.0 * 0.02))
  from customer_invoice_ids() ids
  join amarsoft_invoices a on a.id = ids.invoice_id
  left join bn on bn.code = a.branch_code
  left join amarsoft_salesmen sm on sm.branch_code = a.branch_code and sm.sman = a.sman
  left join profiles pr on pr.id = sm.profile_id
  where ids.customer_id = p_customer and public.has_role(auth.uid(), 'admin')
  order by a.sold_at desc;
$$;
revoke execute on function public.customer_invoices(uuid) from public, anon;
grant execute on function public.customer_invoices(uuid) to authenticated;
