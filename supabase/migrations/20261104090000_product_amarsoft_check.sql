-- Check each product's scanned barcode against Amarsoft's tagged stock.
--   matched: the tag is in Amarsoft stock      sold: Amarsoft has it, already sold
--   pending: not in Amarsoft yet; re-checked on every stock sync until it shows up
-- The barcode on the shop label is Amarsoft's ITEMSUB tag (e.g. 01003888).

alter table public.products
  add column amarsoft_status text check (amarsoft_status in ('matched', 'sold', 'pending')),
  add column amarsoft_branch_code text,
  add column amarsoft_checked_at timestamptz;
create index products_amarsoft_pending_idx on public.products (amarsoft_status) where amarsoft_status = 'pending';

create or replace function public.amarsoft_tag_key(p text)
returns text language sql immutable as $$
  select nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '')
$$;

create or replace function public.products_check_amarsoft()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tag text := amarsoft_tag_key(new.barcode_value);
  s record;
begin
  if tg_op = 'UPDATE' and new.barcode_value is not distinct from old.barcode_value then
    return new;
  end if;
  if v_tag is null then
    new.amarsoft_status := null; new.amarsoft_branch_code := null; new.amarsoft_checked_at := null;
    return new;
  end if;
  select st.branch_code, st.in_stock into s from amarsoft_stock st where st.tag = v_tag
  order by st.in_stock desc, st.updated_at desc limit 1;
  new.amarsoft_status := case when s.branch_code is null then 'pending' when s.in_stock then 'matched' else 'sold' end;
  new.amarsoft_branch_code := s.branch_code;
  new.amarsoft_checked_at := now();
  return new;
end $$;

create trigger trg_products_check_amarsoft
  before insert or update of barcode_value on public.products
  for each row execute function public.products_check_amarsoft();

-- Re-check pending pieces (called after every stock batch from the shop server).
create or replace function public.amarsoft_recheck_pending()
returns int
language sql
security definer
set search_path = public
as $$
  with hit as (
    select distinct on (p.id) p.id, st.branch_code, st.in_stock
    from products p
    join amarsoft_stock st on st.tag = amarsoft_tag_key(p.barcode_value)
    where p.amarsoft_status = 'pending'
    order by p.id, st.in_stock desc, st.updated_at desc
  ), upd as (
    update products p set amarsoft_status = case when hit.in_stock then 'matched' else 'sold' end,
           amarsoft_branch_code = hit.branch_code, amarsoft_checked_at = now()
    from hit where p.id = hit.id
    returning 1
  )
  select count(*)::int from upd;
$$;
revoke all on function public.amarsoft_recheck_pending() from public, anon, authenticated;
grant execute on function public.amarsoft_recheck_pending() to service_role;

-- Scan lookup for the add-product screen: any signed-in staff member. No cost fields.
create or replace function public.amarsoft_lookup_tag(p_code text)
returns table (found boolean, in_stock boolean, branch_code text, branch_name text, tag text, item_code text,
               type_name text, karat text, grams numeric, pure_grams numeric, received_on date, sold_on date,
               existing_product_id uuid, existing_product_name text)
language sql
stable
security definer
set search_path = public
as $$
  with k as (select amarsoft_tag_key(p_code) tag),
  st as (
    select s.* from amarsoft_stock s, k where s.tag = k.tag
    order by s.in_stock desc, s.updated_at desc limit 1
  ),
  dup as (
    select p.id, p.name from products p, k
    where amarsoft_tag_key(p.barcode_value) = k.tag and p.status::text <> 'archived'
    order by p.created_at desc limit 1
  )
  select (st.tag is not null), coalesce(st.in_stock, false), st.branch_code, b.name, coalesce(st.tag, (select tag from k)),
         st.item_code, st.type_name, st.karat, coalesce(nullif(st.grams, 0), st.grams_in), coalesce(nullif(st.pure_grams, 0), st.pure_grams_in),
         st.received_on, st.sold_on, (select id from dup), (select name from dup)
  from k
  left join st on true
  left join branches b on b.id = st.branch_id
  where auth.uid() is not null;
$$;
revoke all on function public.amarsoft_lookup_tag(text) from public, anon;
grant execute on function public.amarsoft_lookup_tag(text) to authenticated;
