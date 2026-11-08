-- برنامج الولاء: كل زبون في customers عضو. النقاط من مشترياته في أمارسوفت (عن طريق amarsoft_customer_links)
-- خلال آخر window_months شهر: نقطة لكل ld_per_point دينار صافي. المستوى حسب النقاط: فضي / ذهبي / ماسي.
-- بطاقة الزبون (ويب و Wallet) تفتح بالرمز loyalty_code بلا تسجيل دخول.

create table if not exists public.loyalty_settings (
  id int primary key default 1 check (id = 1),
  program_name text not null default 'بطاقة مخرّم',
  ld_per_point int not null default 100 check (ld_per_point > 0),
  window_months int not null default 12 check (window_months between 1 and 60),
  gold_points int not null default 300,
  diamond_points int not null default 1000,
  silver_discount numeric not null default 5,
  gold_discount numeric not null default 10,
  diamond_discount numeric not null default 15,
  updated_at timestamptz not null default now()
);
insert into public.loyalty_settings (id) values (1) on conflict do nothing;
alter table public.loyalty_settings enable row level security;
grant select, update on public.loyalty_settings to authenticated;
create policy "auth read loyalty settings" on public.loyalty_settings for select to authenticated using (true);
create policy "admin update loyalty settings" on public.loyalty_settings for update to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

alter table public.customers
  add column if not exists loyalty_code text unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
update public.customers set loyalty_code = substr(replace(gen_random_uuid()::text, '-', ''), 1, 16) where loyalty_code is null;
alter table public.customers alter column loyalty_code set not null;

-- مشتريات كل زبون في الفترة (دراهم). المرتجعات سالبة في net_dirhams أصلاً.
create or replace function public.loyalty_spend(p_since timestamptz)
returns table (customer_id uuid, spend_dirhams bigint, invoices bigint, last_at timestamptz)
language sql stable security definer set search_path to 'public'
as $$
  select l.customer_id, coalesce(sum(a.net_dirhams), 0)::bigint, count(*) filter (where a.kind = 'sale'), max(a.sold_at)
  from amarsoft_customer_links l
  join amarsoft_invoices a on a.branch_code = l.branch_code and a.details->>'guest_code' = l.guest_code
  where l.customer_id is not null and not a.is_deleted and a.sold_at >= p_since
  group by l.customer_id;
$$;
revoke execute on function public.loyalty_spend(timestamptz) from public, anon, authenticated;

create or replace function public.loyalty_tier(p_points int, p_gold int, p_diamond int)
returns text language sql immutable set search_path to 'public' as $$
  select case when p_points >= p_diamond then 'diamond' when p_points >= p_gold then 'gold' else 'silver' end;
$$;

-- قائمة الأعضاء للموظفين.
create or replace function public.loyalty_members()
returns table (customer_id uuid, full_name text, phone text, loyalty_code text, branch_id uuid,
               spend_dirhams bigint, invoices bigint, last_at timestamptz, points int, tier text)
language sql stable security definer set search_path to 'public'
as $$
  with s as (select * from loyalty_settings where id = 1),
  sp as (select * from loyalty_spend(now() - make_interval(months => (select window_months from s))))
  select c.id, c.full_name, c.phone, c.loyalty_code, c.branch_id,
         coalesce(sp.spend_dirhams, 0), coalesce(sp.invoices, 0), sp.last_at, p.points,
         loyalty_tier(p.points, (select gold_points from s), (select diamond_points from s))
  from customers c
  left join sp on sp.customer_id = c.id
  cross join lateral (select greatest(0, floor(coalesce(sp.spend_dirhams, 0) / 1000.0 / (select ld_per_point from s)))::int points) p
  where auth.uid() is not null
  order by p.points desc, c.full_name;
$$;
revoke execute on function public.loyalty_members() from public, anon;
grant execute on function public.loyalty_members() to authenticated;

-- البطاقة العامة: بالرمز بس، وما فيهاش رقم الهاتف ولا الفواتير.
create or replace function public.loyalty_card(p_code text)
returns table (program_name text, full_name text, points int, tier text, discount numeric,
               next_tier text, points_to_next int, member_since date, window_months int, code text)
language sql stable security definer set search_path to 'public'
as $$
  with s as (select * from loyalty_settings where id = 1),
  c as (select * from customers where loyalty_code = p_code and length(p_code) >= 12),
  sp as (select * from loyalty_spend(now() - make_interval(months => (select window_months from s))) x where x.customer_id = (select id from c)),
  p as (select greatest(0, floor(coalesce((select spend_dirhams from sp), 0) / 1000.0 / (select ld_per_point from s)))::int pts)
  select s.program_name, c.full_name, p.pts, loyalty_tier(p.pts, s.gold_points, s.diamond_points),
         case loyalty_tier(p.pts, s.gold_points, s.diamond_points) when 'diamond' then s.diamond_discount when 'gold' then s.gold_discount else s.silver_discount end,
         case when p.pts >= s.diamond_points then null when p.pts >= s.gold_points then 'diamond' else 'gold' end,
         case when p.pts >= s.diamond_points then null when p.pts >= s.gold_points then s.diamond_points - p.pts else s.gold_points - p.pts end,
         (c.created_at at time zone 'Africa/Tripoli')::date, s.window_months, c.loyalty_code
  from c, s, p;
$$;
revoke execute on function public.loyalty_card(text) from public;
grant execute on function public.loyalty_card(text) to anon, authenticated;
