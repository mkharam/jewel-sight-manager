-- ===== 1) ترتيب القطع الجديدة في البحث: تاريخ دخول القطعة للكتالوج باسم حقيقي =====
alter table public.products add column if not exists cataloged_at timestamptz;
update public.products set cataloged_at = created_at where cataloged_at is null;
update public.products set cataloged_at = updated_at where barcode_value in ('03000081','03000076');
alter table public.products alter column cataloged_at set default now();
create index if not exists products_cataloged_at_idx on public.products (cataloged_at desc);
create or replace function public.products_set_cataloged_at() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.cataloged_at := coalesce(new.cataloged_at, now());
  elsif old.name = 'قطعة جديدة' and new.name is distinct from 'قطعة جديدة' then
    new.cataloged_at := now();
  end if;
  return new;
end $$;
drop trigger if exists products_cataloged_at on public.products;
create trigger products_cataloged_at before insert or update of name on public.products
  for each row execute function public.products_set_cataloged_at();

