-- «تسجيل الزبائن»: لكل فرع وبائع — كم فاتورة بيع فيها اسم الزبون، وكم فيها رقمه (للمدير العام فقط).
-- اسم حقيقي = 3 حروف على الأقل ومش كلمة عامة («ذهب مسبوك»، «زبون»، «نقدي»…).
-- رقم حقيقي = رقم موبايل ليبي (09x xxx xxxx، أو بـ218 في الأول).
create or replace function public.amarsoft_customer_capture(p_start timestamptz, p_end timestamptz)
returns table (branch_code text, branch_name text, sman text, salesman_name text, is_store boolean,
  invoices bigint, with_name bigint, with_phone bigint, with_both bigint)
language sql stable security definer set search_path = public as $$
  with inv as (
    select a.branch_code, coalesce(a.sman, '') sman,
      length(regexp_replace(coalesce(a.details->>'customer', ''), '[^A-Za-zء-ي]', '', 'g')) >= 3
        and btrim(coalesce(a.details->>'customer', '')) !~* '^(ذهب|مسبوك|كسر|زبون|زبونة|زبونه|عميل|نقدي|نقدا|كاش|cash|customer|guest)' as has_name,
      regexp_replace(coalesce(a.details->>'phone', ''), '[^0-9]', '', 'g') ~ '^(00218|218|0)?9[1-6][0-9]{7}$' as has_phone
    from amarsoft_invoices a
    where public.has_role(auth.uid(), 'admin')
      and a.kind = 'sale' and not a.is_deleted and a.sold_at >= p_start and a.sold_at < p_end
  )
  select i.branch_code, b.name, i.sman, coalesce(s.name, nullif(i.sman, ''), 'بلا بائع'),
    public.amarsoft_is_store_sman(i.branch_code, i.sman),
    count(*), count(*) filter (where i.has_name), count(*) filter (where i.has_phone), count(*) filter (where i.has_name and i.has_phone)
  from inv i
  join amarsoft_branch_map m on m.code = i.branch_code
  join branches b on b.id = m.branch_id
  left join amarsoft_salesmen s on s.branch_code = i.branch_code and s.sman = i.sman
  group by 1, 2, 3, 4, 5
  order by 1, 3;
$$;
revoke all on function public.amarsoft_customer_capture(timestamptz, timestamptz) from public, anon;
grant execute on function public.amarsoft_customer_capture(timestamptz, timestamptz) to authenticated;
