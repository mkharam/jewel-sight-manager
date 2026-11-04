-- Suppliers (admins). Amarsoft records which supplier every tagged piece came from and its making
-- cost, but not what is owed to the supplier (its supplier ledgers are practically empty). So:
--   * the report (what came in, what sold, how fast, what sits unsold) comes from amarsoft_stock and
--     the sales invoices, matched by tag;
--   * the account lives here: an opening balance once per supplier, then payments. Every piece that
--     arrives after the opening date adds its pure gold and making cost to what is owed.
-- Sources that are not suppliers (branches, customers' gold) are flagged internal.

create table public.amarsoft_supplier_entries (
  id bigint generated always as identity primary key,
  supplier_code text not null,
  entry_date date not null default (now() at time zone 'Africa/Tripoli')::date,
  kind text not null check (kind in ('opening', 'payment')),
  -- opening: what we owed on entry_date. payment: what we gave (gold or cash), lowering the debt.
  gold_pure_grams numeric(12, 3) not null default 0,
  money_dirhams bigint not null default 0,
  note text,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index amarsoft_supplier_entries_code_idx on public.amarsoft_supplier_entries (supplier_code, entry_date);
create index amarsoft_supplier_entries_created_by_idx on public.amarsoft_supplier_entries (created_by);
create unique index amarsoft_supplier_entries_one_opening on public.amarsoft_supplier_entries (supplier_code) where kind = 'opening';
alter table public.amarsoft_supplier_entries enable row level security;
create policy "admins manage supplier entries" on public.amarsoft_supplier_entries for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

create index if not exists amarsoft_stock_supplier_idx on public.amarsoft_stock (supplier_code);

create or replace function public.amarsoft_supplier_internal(p_name text)
returns boolean language sql immutable as $$
  select coalesce(p_name, '') ~ '(زبائن|زبون|النوفل|الجراب|الاندلس|الأندلس|القادسي|عاشور|فرع)'
$$;

create or replace function public.amarsoft_suppliers(p_start date, p_end date)
returns table (supplier_code text, name text, internal boolean, branches text,
               received_pcs bigint, received_grams numeric, received_pure numeric, making_cost_dirhams bigint,
               sold_pcs bigint, sold_grams numeric, sales_dirhams bigint, sale_grams numeric,
               stock_pcs bigint, stock_grams numeric, stale_pcs bigint,
               life_received_pcs bigint, life_sold_pcs bigint, avg_days_to_sell numeric,
               making_rate numeric, first_received date, last_received date,
               has_opening boolean, owed_gold numeric, owed_dirhams bigint)
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select st.*, coalesce(nullif(st.supplier_code, ''), '—') code
    from amarsoft_stock st
    where public.has_role(auth.uid(), 'admin')
  ), lines as (
    -- Sale lines of these pieces in the period: the real price per gram they went for.
    select coalesce(nullif(st.supplier_code, ''), '—') code,
           sum((i->>'amount_dirhams')::bigint) amt, sum((i->>'grams')::numeric) g
    from amarsoft_invoices a
    cross join jsonb_array_elements(a.items) i
    join amarsoft_stock st on st.branch_code = a.branch_code and st.tag = i->>'tag'
    where not a.is_deleted and a.kind = 'sale'
      and a.invoice_date >= p_start and a.invoice_date <= p_end
      and public.has_role(auth.uid(), 'admin')
    group by 1
  ), acct as (
    select o.supplier_code code, o.entry_date opened, o.gold_pure_grams og, o.money_dirhams om,
           coalesce((select sum(p.gold_pure_grams) from amarsoft_supplier_entries p
                     where p.supplier_code = o.supplier_code and p.kind = 'payment' and p.entry_date >= o.entry_date), 0) pg,
           coalesce((select sum(p.money_dirhams) from amarsoft_supplier_entries p
                     where p.supplier_code = o.supplier_code and p.kind = 'payment' and p.entry_date >= o.entry_date), 0) pm
    from amarsoft_supplier_entries o
    where o.kind = 'opening' and public.has_role(auth.uid(), 'admin')
  )
  select s.code,
         (array_agg(s.supplier_name order by s.received_on desc nulls last) filter (where s.supplier_name is not null))[1],
         public.amarsoft_supplier_internal((array_agg(s.supplier_name) filter (where s.supplier_name is not null))[1]),
         (select string_agg(b.name, '، ' order by b.name) from branches b
           where b.id in (select distinct s2.branch_id from s s2 where s2.code = s.code)),
         count(*) filter (where s.received_on between p_start and p_end),
         round(coalesce(sum(s.grams_in) filter (where s.received_on between p_start and p_end), 0), 2),
         round(coalesce(sum(s.pure_grams_in) filter (where s.received_on between p_start and p_end), 0), 2),
         coalesce(sum(s.cost_dirhams) filter (where s.received_on between p_start and p_end), 0)::bigint,
         count(*) filter (where not s.in_stock and s.sold_on between p_start and p_end),
         round(coalesce(sum(s.grams_in) filter (where not s.in_stock and s.sold_on between p_start and p_end), 0), 2),
         coalesce(max(l.amt), 0)::bigint, round(coalesce(max(l.g), 0), 2),
         count(*) filter (where s.in_stock),
         round(coalesce(sum(s.grams) filter (where s.in_stock), 0), 2),
         count(*) filter (where s.in_stock and s.received_on < current_date - 180),
         count(*), count(*) filter (where not s.in_stock),
         round(avg(s.sold_on - s.received_on) filter (where not s.in_stock and s.sold_on >= s.received_on), 0),
         round(sum(s.cost_dirhams) / 1000.0 / nullif(sum(s.grams_in), 0), 2),
         min(s.received_on), max(s.received_on),
         max(a.code) is not null,
         round(max(a.og) + coalesce(sum(s.pure_grams_in) filter (where s.received_on > a.opened), 0) - max(a.pg), 3),
         (max(a.om) + coalesce(sum(s.cost_dirhams) filter (where s.received_on > a.opened), 0) - max(a.pm))::bigint
  from s
  left join lines l on l.code = s.code
  left join acct a on a.code = s.code
  group by s.code, a.opened;
$$;
revoke all on function public.amarsoft_suppliers(date, date) from public, anon;
grant execute on function public.amarsoft_suppliers(date, date) to authenticated;

-- One supplier: what came in by month and by type, and its account entries.
create or replace function public.amarsoft_supplier_detail(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.has_role(auth.uid(), 'admin') then null else jsonb_build_object(
    'months', (select coalesce(jsonb_agg(m order by m.month desc), '[]') from (
        select to_char(received_on, 'YYYY-MM') as month, count(*) pcs, round(sum(grams_in), 2) grams,
               round(sum(pure_grams_in), 2) as pure, sum(cost_dirhams)::bigint making_cost_dirhams,
               count(*) filter (where not in_stock) sold_pcs
        from amarsoft_stock where coalesce(nullif(supplier_code, ''), '—') = p_code and received_on is not null
        group by 1 order by 1 desc limit 18) m),
    'types', (select coalesce(jsonb_agg(t order by t.pcs desc), '[]') from (
        select coalesce(type_name, type_code, '—') as type, karat, count(*) pcs, round(sum(grams_in), 2) grams,
               count(*) filter (where not in_stock) sold_pcs, count(*) filter (where in_stock) stock_pcs,
               round(avg(sold_on - received_on) filter (where not in_stock and sold_on >= received_on), 0) as days
        from amarsoft_stock where coalesce(nullif(supplier_code, ''), '—') = p_code
        group by 1, 2) t),
    'entries', (select coalesce(jsonb_agg(e order by e.entry_date desc, e.id desc), '[]') from (
        select e.id, e.entry_date, e.kind, e.gold_pure_grams, e.money_dirhams, e.note, p.full_name by_name
        from amarsoft_supplier_entries e left join profiles p on p.id = e.created_by
        where e.supplier_code = p_code) e)
  ) end;
$$;
revoke all on function public.amarsoft_supplier_detail(text) from public, anon;
grant execute on function public.amarsoft_supplier_detail(text) to authenticated;
