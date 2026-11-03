-- In-stock totals per branch and karat for the Amarsoft stock page (admins and managers).
create or replace function public.amarsoft_stock_summary()
returns table (branch_code text, branch_name text, karat text, pieces bigint, grams numeric, pure_grams numeric)
language sql
stable
security definer
set search_path = public
as $$
  select s.branch_code, b.name, s.karat, count(*), round(sum(s.grams), 2), round(sum(s.pure_grams), 3)
  from amarsoft_stock s
  join branches b on b.id = s.branch_id
  where s.in_stock and public.is_manager_or_admin(auth.uid())
  group by 1, 2, 3
  order by 1, 3;
$$;
revoke all on function public.amarsoft_stock_summary() from public, anon;
grant execute on function public.amarsoft_stock_summary() to authenticated;
