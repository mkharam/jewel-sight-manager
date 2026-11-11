-- قطع الطاقم: الطاقم في أمارسوفت كود واحد، لكن قطعه (عقد، حلق، خاتم…) قد تُباع منفردة وتُفوتر
-- بالكود العام (18K GEN) فيبقى الطاقم «موجوداً» بوزنه الكامل. هنا نسجّل كل قطعة بصورتها، ونعلّم
-- المباع منها ونربطه بسطر الفاتورة العام، فيظهر الطاقم «ناقصاً» وما بقي منه.
create table if not exists public.product_set_parts (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  image_id uuid references public.product_images(id) on delete set null,
  position int not null default 0,
  name text not null default 'قطعة',
  weight_grams numeric,
  status text not null default 'available' check (status in ('available', 'sold')),
  sold_at timestamptz,
  sold_by uuid references auth.users(id),
  sale_ref jsonb,
  created_at timestamptz not null default now()
);
create index if not exists product_set_parts_product_idx on public.product_set_parts(product_id);

alter table public.product_set_parts enable row level security;

create policy "read set parts" on public.product_set_parts for select to authenticated
  using (public.is_manager_or_admin(auth.uid()) or public.has_branch(auth.uid()));

create policy "manage set parts scoped to branch" on public.product_set_parts for all to authenticated
  using (public.is_admin_or_supervisor(auth.uid()) or exists (
    select 1 from public.products p where p.id = product_set_parts.product_id
      and (p.branch_id = public.current_user_branch_id() or (p.branch_id is null and p.created_by = auth.uid()))))
  with check (public.is_admin_or_supervisor(auth.uid()) or exists (
    select 1 from public.products p where p.id = product_set_parts.product_id
      and (p.branch_id = public.current_user_branch_id() or (p.branch_id is null and p.created_by = auth.uid()))));

-- سطور البيع بالكود العام (بلا باركود) في فرع الطاقم خلال آخر أيام — مرشّحة لقطعة بيعت من الطاقم.
-- بلا أسعار أو تكاليف؛ والسطر المربوط مسبقاً بقطعة أخرى لا يُعرض.
create or replace function public.set_part_sale_candidates(p_product_id uuid, p_days int default 7)
returns table (invoice_id bigint, invoice_no text, invoice_date date, line int, grams numeric, descr text, sman text)
language sql stable security definer set search_path = public as $$
  select i.id, i.invoice_no, i.invoice_date, (it.ord - 1)::int, (it.v->>'grams')::numeric, it.v->>'desc', it.v->>'sman'
  from products p
  join amarsoft_invoices i on i.branch_id = p.branch_id
  cross join lateral jsonb_array_elements(i.items) with ordinality as it(v, ord)
  where p.id = p_product_id
    and auth.uid() is not null
    and (public.is_manager_or_admin(auth.uid()) or public.has_branch(auth.uid()))
    and i.kind = 'sale' and not coalesce(i.is_deleted, false)
    and i.invoice_date >= current_date - greatest(p_days, 1)
    and upper(replace(coalesce(it.v->>'tag', ''), ' ', '')) like '%GEN%'
    and not exists (
      select 1 from product_set_parts sp
      where sp.sale_ref->>'invoice_id' = i.id::text and (sp.sale_ref->>'line')::int = (it.ord - 1)::int)
  order by i.invoice_date desc, i.invoice_no desc;
$$;
revoke all on function public.set_part_sale_candidates(uuid, int) from public, anon;
grant execute on function public.set_part_sale_candidates(uuid, int) to authenticated;
