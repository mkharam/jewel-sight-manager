-- amarsoft_lookup_tag also returns the app branch id, so the add screen can pick the branch
-- (the app's branch codes don't match Amarsoft's 01..05 folders).
drop function public.amarsoft_lookup_tag(text);
create function public.amarsoft_lookup_tag(p_code text)
returns table (found boolean, in_stock boolean, branch_code text, branch_id uuid, branch_name text, tag text, item_code text,
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
  select (st.tag is not null), coalesce(st.in_stock, false), st.branch_code, st.branch_id, b.name, coalesce(st.tag, (select tag from k)),
         st.item_code, st.type_name, st.karat, coalesce(nullif(st.grams, 0), st.grams_in), coalesce(nullif(st.pure_grams, 0), st.pure_grams_in),
         st.received_on, st.sold_on, (select id from dup), (select name from dup)
  from k
  left join st on true
  left join branches b on b.id = st.branch_id
  where auth.uid() is not null;
$$;
revoke all on function public.amarsoft_lookup_tag(text) from public, anon;
grant execute on function public.amarsoft_lookup_tag(text) to authenticated;
