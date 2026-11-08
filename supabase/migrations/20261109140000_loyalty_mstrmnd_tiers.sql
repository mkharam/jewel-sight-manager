-- نفس مستويات بطاقة MSTRMND «بطاقة مخرم للولاء»: برونزي من 0 بخصم 1%، فضي من 70,000 د.ل بخصم 3%،
-- ذهبي من 100,000 د.ل بخصم 5%. الخصم على قيمة الفاتورة كاملة (مش المصنعية).
-- بنقطة لكل 100 دينار: فضي = 700 نقطة، ذهبي = 1000 نقطة.
alter table public.loyalty_settings rename column gold_points to silver_points;
alter table public.loyalty_settings rename column diamond_points to gold_points;
alter table public.loyalty_settings rename column silver_discount to bronze_discount;
alter table public.loyalty_settings rename column gold_discount to silver_discount;
alter table public.loyalty_settings rename column diamond_discount to gold_discount;
update public.loyalty_settings set silver_points = 700, gold_points = 1000,
  bronze_discount = 1, silver_discount = 3, gold_discount = 5, updated_at = now() where id = 1;

drop function if exists public.loyalty_tier(int, int, int) cascade;
create function public.loyalty_tier(p_points int, p_silver int, p_gold int)
returns text language sql immutable set search_path to 'public' as $$
  select case when p_points >= p_gold then 'gold' when p_points >= p_silver then 'silver' else 'bronze' end;
$$;

create or replace function public.loyalty_members()
returns table (customer_id uuid, full_name text, phone text, loyalty_code text, branch_id uuid,
               spend_dirhams bigint, invoices bigint, last_at timestamptz, points int, tier text)
language sql stable security definer set search_path to 'public'
as $$
  with s as (select * from loyalty_settings where id = 1),
  sp as (select * from loyalty_spend(now() - make_interval(months => (select window_months from s))))
  select c.id, c.full_name, c.phone, c.loyalty_code, c.branch_id,
         coalesce(sp.spend_dirhams, 0), coalesce(sp.invoices, 0), sp.last_at, p.points,
         loyalty_tier(p.points, (select silver_points from s), (select gold_points from s))
  from customers c
  left join sp on sp.customer_id = c.id
  cross join lateral (select greatest(0, floor(coalesce(sp.spend_dirhams, 0) / 1000.0 / (select ld_per_point from s)))::int points) p
  where auth.uid() is not null
  order by p.points desc, c.full_name;
$$;

create or replace function public.loyalty_card(p_code text)
returns table (program_name text, full_name text, points int, tier text, discount numeric,
               next_tier text, points_to_next int, member_since date, window_months int, code text)
language sql stable security definer set search_path to 'public'
as $$
  with s as (select * from loyalty_settings where id = 1),
  c as (select * from customers where loyalty_code = p_code and length(p_code) >= 12),
  sp as (select * from loyalty_spend(now() - make_interval(months => (select window_months from s))) x where x.customer_id = (select id from c)),
  p as (select greatest(0, floor(coalesce((select spend_dirhams from sp), 0) / 1000.0 / (select ld_per_point from s)))::int pts)
  select s.program_name, c.full_name, p.pts, loyalty_tier(p.pts, s.silver_points, s.gold_points),
         case loyalty_tier(p.pts, s.silver_points, s.gold_points) when 'gold' then s.gold_discount when 'silver' then s.silver_discount else s.bronze_discount end,
         case when p.pts >= s.gold_points then null when p.pts >= s.silver_points then 'gold' else 'silver' end,
         case when p.pts >= s.gold_points then null when p.pts >= s.silver_points then s.gold_points - p.pts else s.silver_points - p.pts end,
         (c.created_at at time zone 'Africa/Tripoli')::date, s.window_months, c.loyalty_code
  from c, s, p;
$$;
