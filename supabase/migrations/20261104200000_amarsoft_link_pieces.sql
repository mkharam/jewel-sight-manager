-- Linking the app's pieces to Amarsoft. A piece is linked when its barcode_value holds the Amarsoft tag:
-- products_check_amarsoft fills its Amarsoft status on save, and every sync (amarsoft_recheck_pending)
-- turns it sold once Amarsoft sells it. Old pieces were saved without a tag, so:
--   * amarsoft_link_suggestions: for each available piece with no tag, the Amarsoft pieces in stock with
--     the same weight (to 0.005 g) and karat, same branch first, minus tags another piece already has;
--   * amarsoft_link_products: the admin confirms a batch of {id, tag} pairs in one go.
-- Staff may also write a tag on a piece that has none (the camera upload types it after the photo saves);
-- changing an existing tag stays with managers.

create or replace function public.amarsoft_link_suggestions()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with used as (
    select amarsoft_tag_key(barcode_value) tag from products where amarsoft_tag_key(barcode_value) is not null
  ), p as (
    select p.id, p.name, p.sku, p.weight_grams w, replace(coalesce(p.karat, ''), 'K', '') k, p.created_at,
           p.branch_id, b.name branch_name, left(coalesce(b.code, ''), 2) bcode,
           (select coalesce(i.thumb_path, i.storage_path) from product_images i where i.product_id = p.id
             order by i.is_primary desc nulls last, i.sort_order nulls last limit 1) thumb
    from products p left join branches b on b.id = p.branch_id
    where p.status = 'available' and amarsoft_tag_key(p.barcode_value) is null
      and public.has_role(auth.uid(), 'admin')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'sku', p.sku, 'weight', p.w, 'karat', nullif(p.k, ''), 'branch_name', p.branch_name,
      'branch_code', p.bcode, 'thumb', p.thumb, 'candidates', coalesce(c.list, '[]'::jsonb))
    order by jsonb_array_length(coalesce(c.list, '[]'::jsonb)) = 1 desc, p.created_at desc), '[]')
  from p
  left join lateral (
    select jsonb_agg(jsonb_build_object(
             'tag', s.tag, 'branch_code', s.branch_code, 'type', coalesce(s.type_name, s.type_code), 'karat', s.karat,
             'grams', coalesce(nullif(s.grams, 0), s.grams_in), 'received_on', s.received_on,
             'supplier', s.supplier_name, 'same_branch', s.branch_code = p.bcode)
           order by s.branch_code = p.bcode desc, s.received_on desc) list
    from amarsoft_stock s
    where p.w > 0 and s.in_stock
      and abs(coalesce(nullif(s.grams, 0), s.grams_in) - p.w) < 0.006
      and (p.k = '' or s.karat = p.k)
      and s.tag not in (select tag from used)
      -- same branch only, unless the piece has no match there at all
      and (s.branch_code = p.bcode or not exists (
        select 1 from amarsoft_stock s2 where s2.in_stock and s2.branch_code = p.bcode
          and abs(coalesce(nullif(s2.grams, 0), s2.grams_in) - p.w) < 0.006 and (p.k = '' or s2.karat = p.k)))
  ) c on true;
$$;
revoke all on function public.amarsoft_link_suggestions() from public, anon;
grant execute on function public.amarsoft_link_suggestions() to authenticated;

create or replace function public.amarsoft_link_products(p_links jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v int;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'للمدير فقط'; end if;
  update products p set barcode_value = l.tag
  from jsonb_to_recordset(p_links) as l(id uuid, tag text)
  where p.id = l.id and amarsoft_tag_key(l.tag) is not null;
  get diagnostics v = row_count;
  return v;
end $$;
revoke all on function public.amarsoft_link_products(jsonb) from public, anon;
grant execute on function public.amarsoft_link_products(jsonb) to authenticated;

create or replace function public.guard_product_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare is_mgr boolean := public.is_manager_or_admin(auth.uid());
begin
  if auth.uid() is null then
    return new;
  end if;

  if not is_mgr then
    if new.sku is distinct from old.sku
       or new.serial_number is distinct from old.serial_number
       -- writing the Amarsoft tag on a piece that has none is allowed; changing or clearing one is not
       or (new.barcode_value is distinct from old.barcode_value and coalesce(old.barcode_value, '') <> ''
           -- whoever photographed the piece may still fix its tag the same day (typing is saved as it goes)
           and not (old.created_by = auth.uid() and old.created_at > now() - interval '1 day')) then
      raise exception 'تعديل رقم القطعة أو التسلسلي أو الباركود متاح للمدير فقط';
    end if;
    if new.status::text = 'archived' and old.status::text <> 'archived' then
      raise exception 'أرشفة القطع متاحة للمدير فقط';
    end if;
    if old.status::text = 'stock_discrepancy' and new.status::text <> 'stock_discrepancy' then
      raise exception 'إغلاق فرق الجرد متاح للمدير فقط';
    end if;
  end if;

  return new;
end $$;
