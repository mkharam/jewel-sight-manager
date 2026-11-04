-- Names on invoices that are not real customers (cast gold, internal stock moves, family), so the
-- customer dashboard leaves them out. Admins mark them; obvious internal names are excluded anyway.
create table public.amarsoft_customer_exclusions (
  customer_key text primary key,
  label text,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index amarsoft_customer_exclusions_created_by_idx on public.amarsoft_customer_exclusions (created_by);
alter table public.amarsoft_customer_exclusions enable row level security;
create policy "admins manage customer exclusions" on public.amarsoft_customer_exclusions for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

drop function public.amarsoft_customer_insights(timestamptz, timestamptz);
create function public.amarsoft_customer_insights(p_start timestamptz, p_end timestamptz)
returns table (customer_key text, customer_id uuid, name text, phone text, branches text,
               visits bigint, invoices bigint, sales_dirhams bigint, grams numeric,
               life_visits bigint, life_invoices bigint, life_sales_dirhams bigint, life_grams numeric,
               first_at timestamptz, last_at timestamptz, fav_type text, fav_karat text, dob date,
               identified boolean, excluded boolean)
language sql
stable
security definer
set search_path = public
as $$
  with inv as (
    select a.id, a.sold_at, a.net_dirhams, b.name branch_name, l.customer_id,
           coalesce(nullif(c.full_name, ''), nullif(trim(a.details->>'customer'), '')) cname,
           coalesce(nullif(c.phone, ''), nullif(trim(a.details->>'phone'), '')) cphone,
           nullif(l.data->>'dob', '')::date dob,
           coalesce(l.customer_id::text,
                    'n:' || lower(regexp_replace(trim(a.details->>'customer'), '\s+', ' ', 'g')) || '|' ||
                    coalesce(amarsoft_phone_key(a.details->>'phone'), '')) ckey,
           (select coalesce(sum((i->>'grams')::numeric), 0) from jsonb_array_elements(a.items) i) g
    from amarsoft_invoices a
    join amarsoft_branch_map m on m.code = a.branch_code
    join branches b on b.id = m.branch_id
    left join amarsoft_customer_links l on l.branch_code = a.branch_code and l.guest_code = a.details->>'guest_code'
    left join customers c on c.id = l.customer_id
    where not a.is_deleted and a.kind = 'sale'
      and (l.customer_id is not null or nullif(trim(a.details->>'customer'), '') is not null)
      and public.has_role(auth.uid(), 'admin')
  ), lines as (
    select inv.ckey, st.type_name, st.karat
    from inv
    join amarsoft_invoices a on a.id = inv.id
    cross join jsonb_array_elements(a.items) i
    join amarsoft_stock st on st.branch_code = a.branch_code and st.tag = i->>'tag'
  ), fav as (
    select ckey, mode() within group (order by type_name) fav_type, mode() within group (order by karat) fav_karat
    from lines group by ckey
  ), agg as (
    select inv.ckey, (array_agg(inv.customer_id) filter (where inv.customer_id is not null))[1] customer_id,
           (array_agg(inv.cname order by inv.sold_at desc))[1] cname,
           (array_agg(inv.cphone order by inv.sold_at desc) filter (where inv.cphone is not null))[1] cphone,
           string_agg(distinct inv.branch_name, '، ') branches,
           count(distinct (inv.sold_at at time zone 'Africa/Tripoli')::date) filter (where inv.sold_at >= p_start and inv.sold_at < p_end) visits,
           count(*) filter (where inv.sold_at >= p_start and inv.sold_at < p_end) invoices,
           coalesce(sum(inv.net_dirhams) filter (where inv.sold_at >= p_start and inv.sold_at < p_end), 0)::bigint sales,
           round(coalesce(sum(inv.g) filter (where inv.sold_at >= p_start and inv.sold_at < p_end), 0), 2) grams,
           count(distinct (inv.sold_at at time zone 'Africa/Tripoli')::date) life_visits, count(*) life_invoices,
           sum(inv.net_dirhams)::bigint life_sales, round(sum(inv.g), 2) life_grams,
           min(inv.sold_at) first_at, max(inv.sold_at) last_at, max(fav.fav_type) fav_type, max(fav.fav_karat) fav_karat, max(inv.dob) dob
    from inv left join fav on fav.ckey = inv.ckey
    group by inv.ckey
  )
  select agg.ckey, agg.customer_id, agg.cname, agg.cphone, agg.branches, agg.visits, agg.invoices, agg.sales, agg.grams,
         agg.life_visits, agg.life_invoices, agg.life_sales, agg.life_grams, agg.first_at, agg.last_at, agg.fav_type, agg.fav_karat, agg.dob,
         (agg.customer_id is not null or agg.cphone is not null),
         (exists (select 1 from amarsoft_customer_exclusions x where x.customer_key = agg.ckey)
          or coalesce(agg.cname, '') ~ '(مسبوك|بضاعة|بضاعه|كسر|خردة|خرده|تحويل)')
  from agg;
$$;
revoke all on function public.amarsoft_customer_insights(timestamptz, timestamptz) from public, anon;
grant execute on function public.amarsoft_customer_insights(timestamptz, timestamptz) to authenticated;
