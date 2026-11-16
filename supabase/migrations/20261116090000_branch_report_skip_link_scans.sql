-- الربط ولّى يكتب بحساب مدير الفرع، فعملياته تطلع في MSTRMND بموقع الفرع.
-- هذي محسوبة أصلاً في «الربط» (link_sent من فواتير أمارسوفت)، فنشيلوها من «مسح» باش ما تنحسبش مرتين:
-- أي عملية لنفس الزبون خلال 3 دقايق من كتابة الربط هي من الربط مش من موظف مسح البطاقة.
CREATE OR REPLACE FUNCTION public.loyalty_branch_report(p_days integer DEFAULT 30)
 RETURNS TABLE(branch_code text, branch_name text, members bigint, installed bigint, bronze bigint, silver bigint, gold bigint, stamp_holders bigint, stamps_in_progress bigint, rewards_unused bigint, new_cards bigint, scans bigint, link_sent bigint, sales bigint, sales_with_phone bigint, member_sales bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    select mstrmnd_location_branch(t.location) branch_code, count(*) scans
    from mstrmnd_transactions t
    where t.created_at >= (select t from since) and mstrmnd_location_branch(t.location) is not null
      and t.operation not ilike '%install%' and t.operation not ilike '%deleted%' and not t.reversed
      and not exists (
        select 1 from mstrmnd_sync s
        where s.mode = 'live' and s.mstrmnd_customer_id = t.customer_id
          and s.updated_at between t.created_at - interval '3 minutes' and t.created_at + interval '3 minutes'
      )
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
$function$;
