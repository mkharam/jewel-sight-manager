-- Amarsoft tagged-piece stock (stk4wd) and customers (guest list), sent by scripts/amarsoft-sync.ps1.

-- One row per tagged piece per branch. in_stock flips to false when Amarsoft sells it.
create table public.amarsoft_stock (
  branch_code text not null references public.amarsoft_branch_map(code),
  tag text not null,                           -- Amarsoft ITEMSUB, the number on the label
  branch_id uuid not null references public.branches(id),
  item_code text,                              -- e.g. 18KB
  type_code text,
  type_name text,
  karat text,
  purity numeric,
  grams_in numeric,                            -- gross weight when it came in
  pure_grams_in numeric,
  grams numeric,                               -- gross weight still in stock (0 once sold)
  pure_grams numeric,
  in_stock boolean not null,
  making_cost_rate numeric,                    -- making cost per gram paid to the supplier
  making_sale_rate numeric,                    -- making price per gram charged to the customer
  cost_dirhams bigint,                         -- making cost value; 1 LD = 1000 dirhams
  supplier_code text,
  supplier_name text,
  received_on date,
  sold_on date,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (branch_code, tag)
);
create index amarsoft_stock_tag_idx on public.amarsoft_stock (tag);
create index amarsoft_stock_branch_in_stock_idx on public.amarsoft_stock (branch_code, in_stock);
create index amarsoft_stock_branch_id_idx on public.amarsoft_stock (branch_id);

-- Amarsoft guest code -> app customer. Customers are created in public.customers (or matched by
-- phone to an existing one), so they show on the Customers page; the app never overwrites a
-- customer's name or phone after that.
create table public.amarsoft_customer_links (
  branch_code text not null references public.amarsoft_branch_map(code),
  guest_code text not null,
  customer_id uuid references public.customers(id) on delete set null,
  name text,
  phone text,
  data jsonb not null default '{}'::jsonb,     -- city, area, dob, gender, opened, last sale, total spent ...
  updated_at timestamptz not null default now(),
  primary key (branch_code, guest_code)
);
create index amarsoft_customer_links_customer_id_idx on public.amarsoft_customer_links (customer_id);

alter table public.amarsoft_stock enable row level security;
alter table public.amarsoft_customer_links enable row level security;

create policy "managers read amarsoft stock" on public.amarsoft_stock for select to authenticated
  using (public.is_manager_or_admin(auth.uid()));
create policy "staff read amarsoft customer links" on public.amarsoft_customer_links for select to authenticated
  using (public.is_manager_or_admin(auth.uid()) or public.has_branch(auth.uid()));

create or replace function public.amarsoft_phone_key(p text)
returns text language sql immutable as $$
  select nullif(right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 9), '')
$$;

-- Stock + customers for one branch. p: {branch, full, stock: [...], customers: [...]}
create or replace function public.amarsoft_ingest_master(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch text := p->>'branch';
  v_branch_id uuid;
  v_stock int := 0; v_links int := 0; v_created int := 0; v_matched int := 0;
  g record; v_cust uuid;
begin
  select branch_id into v_branch_id from amarsoft_branch_map where code = v_branch;
  if v_branch_id is null then raise exception 'unknown branch %', v_branch; end if;

  with src as (
    select s->>'tag' tag, nullif(s->>'item_code','') item_code, nullif(s->>'type_code','') type_code,
           nullif(s->>'type_name','') type_name, nullif(s->>'karat','') karat, (s->>'purity')::numeric purity,
           (s->>'grams_in')::numeric grams_in, (s->>'pure_grams_in')::numeric pure_grams_in,
           (s->>'grams')::numeric grams, (s->>'pure_grams')::numeric pure_grams, (s->>'in_stock')::boolean in_stock,
           (s->>'making_cost_rate')::numeric making_cost_rate, (s->>'making_sale_rate')::numeric making_sale_rate,
           (s->>'cost_dirhams')::bigint cost_dirhams, nullif(s->>'supplier_code','') supplier_code,
           nullif(s->>'supplier_name','') supplier_name, nullif(s->>'received_on','')::date received_on,
           nullif(s->>'sold_on','')::date sold_on
    from jsonb_array_elements(coalesce(p->'stock','[]'::jsonb)) s
  )
  insert into amarsoft_stock as t (branch_code, tag, branch_id, item_code, type_code, type_name, karat, purity, grams_in,
         pure_grams_in, grams, pure_grams, in_stock, making_cost_rate, making_sale_rate, cost_dirhams, supplier_code,
         supplier_name, received_on, sold_on)
  select v_branch, tag, v_branch_id, item_code, type_code, type_name, karat, purity, grams_in, pure_grams_in, grams,
         pure_grams, in_stock, making_cost_rate, making_sale_rate, cost_dirhams, supplier_code, supplier_name,
         received_on, sold_on
  from src
  on conflict (branch_code, tag) do update
    set item_code = excluded.item_code, type_code = excluded.type_code, type_name = excluded.type_name,
        karat = excluded.karat, purity = excluded.purity, grams_in = excluded.grams_in,
        pure_grams_in = excluded.pure_grams_in, grams = excluded.grams, pure_grams = excluded.pure_grams,
        in_stock = excluded.in_stock, making_cost_rate = excluded.making_cost_rate,
        making_sale_rate = excluded.making_sale_rate, cost_dirhams = excluded.cost_dirhams,
        supplier_code = excluded.supplier_code, supplier_name = excluded.supplier_name,
        received_on = excluded.received_on, sold_on = excluded.sold_on, updated_at = now()
    where (t.item_code, t.type_code, t.type_name, t.karat, t.purity, t.grams_in, t.pure_grams_in, t.grams, t.pure_grams,
           t.in_stock, t.making_cost_rate, t.making_sale_rate, t.cost_dirhams, t.supplier_code, t.supplier_name,
           t.received_on, t.sold_on)
      is distinct from
          (excluded.item_code, excluded.type_code, excluded.type_name, excluded.karat, excluded.purity, excluded.grams_in,
           excluded.pure_grams_in, excluded.grams, excluded.pure_grams, excluded.in_stock, excluded.making_cost_rate,
           excluded.making_sale_rate, excluded.cost_dirhams, excluded.supplier_code, excluded.supplier_name,
           excluded.received_on, excluded.sold_on);
  get diagnostics v_stock = row_count;

  -- A full stock snapshot is authoritative: tags no longer in it are gone from Amarsoft.
  if coalesce((p->>'full')::boolean, false) then
    update amarsoft_stock t set in_stock = false, grams = 0, pure_grams = 0, updated_at = now()
    where t.branch_code = v_branch and t.in_stock
      and not exists (select 1 from jsonb_array_elements(coalesce(p->'stock','[]'::jsonb)) s where s->>'tag' = t.tag);
  end if;

  for g in
    select c->>'code' code, nullif(trim(c->>'name'),'') name, nullif(trim(c->>'phone'),'') phone, coalesce(c->'data','{}'::jsonb) data
    from jsonb_array_elements(coalesce(p->'customers','[]'::jsonb)) c
    where nullif(c->>'code','') is not null
  loop
    insert into amarsoft_customer_links as l (branch_code, guest_code, name, phone, data)
    values (v_branch, g.code, g.name, g.phone, g.data)
    on conflict (branch_code, guest_code) do update
      set name = excluded.name, phone = excluded.phone, data = excluded.data, updated_at = now()
      where (l.name, l.phone, l.data) is distinct from (excluded.name, excluded.phone, excluded.data);
    if found then v_links := v_links + 1; end if;

    select customer_id into v_cust from amarsoft_customer_links where branch_code = v_branch and guest_code = g.code;
    if v_cust is null and g.name is not null then
      select id into v_cust from customers
      where amarsoft_phone_key(phone) is not null and amarsoft_phone_key(phone) = amarsoft_phone_key(g.phone)
      order by created_at limit 1;
      if v_cust is not null then
        v_matched := v_matched + 1;
      else
        insert into customers (full_name, phone, branch_id, notes)
        values (g.name, g.phone, v_branch_id, 'من أمارسوفت — فرع ' || v_branch || '، رمز الزبون ' || g.code)
        returning id into v_cust;
        v_created := v_created + 1;
      end if;
      update amarsoft_customer_links set customer_id = v_cust where branch_code = v_branch and guest_code = g.code;
    end if;
  end loop;

  insert into amarsoft_sync_log (invoices, upserted, marked_deleted, salesmen, note)
  values (0, v_stock, 0, 0, format('master %s: stock %s, customers %s (new %s, matched %s)', v_branch, v_stock, v_links, v_created, v_matched));
  return jsonb_build_object('stock_changed', v_stock, 'customers_changed', v_links,
                            'customers_created', v_created, 'customers_matched', v_matched);
end $$;
revoke all on function public.amarsoft_ingest_master(jsonb) from public, anon, authenticated;
grant execute on function public.amarsoft_ingest_master(jsonb) to service_role;
