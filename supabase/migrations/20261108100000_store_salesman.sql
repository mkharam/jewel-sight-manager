-- ناقل «المحل» (ولا «موظف» لين يتغيّر اسمه): فواتير ماهيش لموظف — شراء/بيع كسر وغيره. تنحسب
-- للمحل في التقارير عادي، لكن ما تطلعش في لوحة المتصدرين، وما تنحسبش «بدون اسم البائع».
create or replace function public.amarsoft_is_store_sman(p_branch text, p_sman text)
returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from amarsoft_salesmen s
                 where s.branch_code = p_branch and s.sman = p_sman
                   and btrim(s.name) in ('المحل', 'محل', 'موظف', 'الموظف'))
$$;
revoke execute on function public.amarsoft_is_store_sman(text, text) from public, anon;

create or replace function public.amarsoft_leaderboard_v2(p_start timestamptz, p_end timestamptz, p_branch text default null)
returns table (branch_code text, branch_name text, sman text, salesman_name text, profile_id uuid, invoices bigint, returns bigint,
               pieces numeric, grams numeric, pure_grams numeric, net_dirhams bigint)
language sql stable security definer set search_path to 'public'
as $function$
  with inv as (
    select a.branch_code, a.sman, a.kind, a.net_dirhams,
           (select coalesce(sum((i->>'pcs')::numeric), 0) from jsonb_array_elements(a.items) i) pcs,
           (select coalesce(sum((i->>'grams')::numeric), 0) from jsonb_array_elements(a.items) i) g,
           (select coalesce(sum((i->>'pure_grams')::numeric), 0) from jsonb_array_elements(a.items) i) pg
    from amarsoft_invoices a
    where not a.is_deleted and a.sman is not null and a.sold_at >= p_start and a.sold_at < p_end
      and (p_branch is null or a.branch_code = p_branch)
      and not public.amarsoft_is_store_sman(a.branch_code, a.sman)
  ), t as (
    select branch_code, sman,
           count(*) filter (where kind = 'sale') invoices,
           count(*) filter (where kind = 'return') returns,
           sum(case when kind = 'return' then -pcs else pcs end) pieces,
           sum(case when kind = 'return' then -g else g end) grams,
           sum(case when kind = 'return' then -pg else pg end) pure_grams,
           sum(net_dirhams)::bigint net
    from inv group by 1, 2
  )
  select t.branch_code, b.name, t.sman, coalesce(nullif(pr.full_name, ''), s.name, t.sman), s.profile_id,
         t.invoices, t.returns, t.pieces, round(t.grams, 2), round(t.pure_grams, 3),
         case when public.has_role(auth.uid(), 'admin') then t.net end
  from t
  join amarsoft_branch_map m on m.code = t.branch_code
  join branches b on b.id = m.branch_id
  left join amarsoft_salesmen s on s.branch_code = t.branch_code and s.sman = t.sman
  left join profiles pr on pr.id = s.profile_id
  where auth.uid() is not null
  order by t.net desc;
$function$;

-- «البائعين» = الموظفين بس (بلا ناقل المحل)، و«فيها بائع» تشمل فواتير المحل.
create or replace function public.amarsoft_branch_tagging(p_start timestamptz, p_end timestamptz)
returns table (branch_code text, branch_name text, invoices bigint, tagged bigint, salesmen bigint)
language sql stable security definer set search_path to 'public'
as $function$
  select m.code, b.name,
         count(a.id) filter (where a.kind = 'sale'),
         count(a.id) filter (where a.kind = 'sale' and a.sman is not null),
         (select count(*) from amarsoft_salesmen s where s.branch_code = m.code and s.is_active
            and not public.amarsoft_is_store_sman(s.branch_code, s.sman))
  from amarsoft_branch_map m
  join branches b on b.id = m.branch_id
  left join amarsoft_invoices a on a.branch_code = m.code and not a.is_deleted and a.sold_at >= p_start and a.sold_at < p_end
  where auth.uid() is not null
  group by m.code, b.name
  order by m.code;
$function$;
