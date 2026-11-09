-- قائمة التواصل (المدير العام): زبائن أمارسوفت برقم هاتف — كم شرية (أيام شراء) وكم مجموع شرياتهم من البداية،
-- وهل عندهم بطاقة MSTRMND ومستواها. الفئات: «5 شريات» (هدية 1,250 + 50 على القرام)، «ذهبي» (100,000 فما فوق)،
-- «فضي» (70,000–100,000). التواصل نفسه واتساب يدوي من الصفحة؛ هنا نسجّلو بس شكون تكلّمنا معاه.
create table if not exists public.loyalty_contacts (
  phone9 text not null,
  category text not null,
  contacted_at timestamptz not null default now(),
  contacted_by uuid references public.profiles(id) on delete set null,
  primary key (phone9, category)
);
alter table public.loyalty_contacts enable row level security;
revoke all on public.loyalty_contacts from anon;
grant select, insert, delete on public.loyalty_contacts to authenticated;
create policy "admin manage loyalty contacts" on public.loyalty_contacts for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

create or replace function public.loyalty_outreach()
returns table (phone9 text, phone text, full_name text, branch_code text, branch_name text, purchase_days bigint, total_ld numeric,
               last_at timestamptz, has_card boolean, card_level text, card_installed boolean, five boolean, gold boolean, silver boolean,
               contacted text[])
language sql stable security definer set search_path to 'public'
as $$
  with inv as (
    select right(regexp_replace(a.details->>'phone', '\D', '', 'g'), 9) p9, regexp_replace(a.details->>'phone', '\D', '', 'g') phone,
           nullif(trim(a.details->>'customer'), '') customer, a.branch_code, a.sold_at, a.net_dirhams / 1000.0 ld,
           (a.sold_at at time zone 'Africa/Tripoli')::date d
    from amarsoft_invoices a
    where a.kind in ('sale', 'return') and not a.is_deleted
      and length(regexp_replace(coalesce(a.details->>'phone', ''), '\D', '', 'g')) >= 9
      and not public.amarsoft_internal_customer(a.details->>'customer')
  ),
  per as (
    select p9,
           (array_agg(phone order by sold_at desc))[1] phone,
           (array_agg(customer order by sold_at desc) filter (where customer is not null))[1] customer,
           (select i2.branch_code from inv i2 where i2.p9 = inv.p9 group by i2.branch_code order by count(*) desc limit 1) branch_code,
           count(distinct d) filter (where ld > 0) days, round(sum(ld)) total, max(sold_at) last_at
    from inv group by p9
  ),
  mc as (
    select c.phone9, bool_or(k->>'status' = 'installed') installed,
           max(trim(k->>'level')) filter (where (k->>'template_id')::int = 908119) level
    from mstrmnd_customers c, jsonb_array_elements(c.cards) k where c.phone9 is not null group by c.phone9
  )
  select per.p9, per.phone, coalesce(per.customer, 'بلا اسم'), per.branch_code, regexp_replace(coalesce(b.name, per.branch_code), '^\d+\s*-\s*', ''),
         per.days, per.total, per.last_at, mc.phone9 is not null, mc.level, coalesce(mc.installed, false),
         per.days >= 5, per.total >= 100000, per.total >= 70000 and per.total < 100000,
         coalesce((select array_agg(lc.category) from loyalty_contacts lc where lc.phone9 = per.p9), '{}')
  from per
  left join mc on mc.phone9 = per.p9
  left join amarsoft_branch_map bm on bm.code = per.branch_code
  left join branches b on b.id = bm.branch_id
  where (per.days >= 5 or per.total >= 70000) and public.has_role(auth.uid(), 'admin')
  order by per.total desc;
$$;
revoke execute on function public.loyalty_outreach() from public, anon;
grant execute on function public.loyalty_outreach() to authenticated;
