-- استعمال بطاقة الولاء لكل بائع: من فواتير البيع في أمارسوفت (رقم الزبون في الفاتورة ← زبون عنده بطاقة الولاء).
--   sales: فواتير البيع · with_phone: فيها رقم زبون · member_sales: الزبون عنده بطاقة ولاء (يعني البطاقة استُعملت).
-- نفس منطق الملخّص اليومي (daily_amarsoft)، لكن لفترة، ومقسّم بالبائع — باش يدخل في تقييم البائعين.
create or replace function public.loyalty_staff_report(p_start timestamptz, p_end timestamptz)
returns table (branch_code text, sman text, salesman_name text, sales bigint, with_phone bigint, member_sales bigint)
language plpgsql stable security definer set search_path = public as $$
declare tpl int;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'admins only'; end if;
  select template_id into tpl from mstrmnd_sync_settings where id = 1;
  return query
  with inv as (
    select a.branch_code, a.sman,
           case when length(regexp_replace(coalesce(a.details->>'phone', ''), '\D', '', 'g')) >= 9
                then right(regexp_replace(a.details->>'phone', '\D', '', 'g'), 9) end p9,
           public.amarsoft_internal_customer(a.details->>'customer') internal
    from amarsoft_invoices a
    where a.kind = 'sale' and not a.is_deleted and a.sold_at >= p_start and a.sold_at < p_end
      and a.branch_code not in (select code from amarsoft_branch_map where separate)
  ),
  members as (
    select distinct c.phone9 from mstrmnd_customers c, jsonb_array_elements(c.cards) k
    where c.phone9 is not null and (k->>'template_id')::int = tpl
  )
  select i.branch_code, i.sman, max(coalesce(sm.name, i.sman)),
         count(*), count(*) filter (where i.p9 is not null and not i.internal),
         count(*) filter (where not i.internal and i.p9 in (select phone9 from members))
  from inv i
  left join amarsoft_salesmen sm on sm.branch_code = i.branch_code and sm.sman = i.sman
  group by i.branch_code, i.sman;
end $$;
revoke all on function public.loyalty_staff_report(timestamptz, timestamptz) from public, anon;
grant execute on function public.loyalty_staff_report(timestamptz, timestamptz) to authenticated;
