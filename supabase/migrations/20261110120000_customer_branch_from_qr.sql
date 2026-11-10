-- البطاقة اللي تركّبت من QR الفرع («بطاقة جديدة» في صفحة الولاء، utm_source=b05) تتسجّل على الفرع هذا قبل أي تخمين.
create or replace function public.mstrmnd_customer_branches()
returns table(customer_id text, branch_code text, how text)
language sql stable security definer set search_path = public as $$
  with c as (select id, phone9, created_at from mstrmnd_customers),
  qr as (
    select distinct on (t.customer_id) t.customer_id id, substring(t.utm from '^b(\d{2})$') branch_code
    from mstrmnd_transactions t
    where t.operation = 'Card installed' and t.utm ~ '^b\d{2}$'
    order by t.customer_id, t.created_at
  ),
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
  reg as (
    select distinct on (c.id) c.id, l.branch_code
    from c join amarsoft_customer_links l on right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 9) = c.phone9
    order by c.id, l.branch_code
  )
  select c.id,
         coalesce(qr.branch_code, near.branch_code, scan.branch_code, most.branch_code, reg.branch_code),
         case when qr.branch_code is not null then 'ركّبها من QR الفرع'
              when near.branch_code is not null then 'فاتورة يوم البطاقة'
              when scan.branch_code is not null then 'أول مسح'
              when most.branch_code is not null then 'أكثر فرع يشري منه'
              when reg.branch_code is not null then 'مسجّل في الفرع'
              else 'غير معروف' end
  from c
  left join qr on qr.id = c.id
  left join near on near.id = c.id
  left join scan on scan.id = c.id
  left join most on most.id = c.id
  left join reg on reg.id = c.id
  where public.has_role(auth.uid(), 'admin') or auth.uid() is null;
$$;
