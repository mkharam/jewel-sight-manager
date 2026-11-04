-- Watches live in their own table, apart from the gold products: no SKU, karat, weight or Amarsoft
-- check, and they never show up in the product search. Everyone signed in sees them; admins and branch
-- managers add, edit and remove. Photos go to product-images under watches/<id>/.
-- Replaces the 'ساعات' product category added earlier (no product used it).
delete from public.categories c
where c.name = 'ساعات' and not exists (select 1 from public.products p where p.category_id = c.id);

create table public.watches (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  model text,
  reference text,
  gender text check (gender in ('men', 'women', 'unisex')),
  movement text,
  color text,
  price numeric(12, 2),
  promo_price numeric(12, 2),
  quantity integer not null default 1 check (quantity >= 0),
  status text not null default 'available' check (status in ('available', 'reserved', 'sold')),
  branch_id uuid references public.branches(id) on delete set null,
  notes text,
  photo_path text,
  thumb_path text,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index watches_branch_idx on public.watches (branch_id);
create index watches_status_idx on public.watches (status);
create index watches_created_by_idx on public.watches (created_by);

alter table public.watches enable row level security;
create policy "staff read watches" on public.watches for select to authenticated
  using (exists (select 1 from public.user_roles where user_id = auth.uid()));
create policy "admins and managers write watches" on public.watches for all to authenticated
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager'))
  with check (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager'));

create or replace function public.watches_touch() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
create trigger watches_touch before update on public.watches for each row execute function public.watches_touch();
