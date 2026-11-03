-- Amarsoft (shop POS) sales mirrored into the app. Written only by the amarsoft-sync edge function.

create table public.amarsoft_branch_map (
  code text primary key,                       -- Amarsoft branch folder: 01..05
  branch_id uuid not null references public.branches(id),
  amarsoft_name text
);
insert into public.amarsoft_branch_map (code, branch_id, amarsoft_name) values
  ('01', 'f6f83474-7f79-4a25-8c13-fa2ac2b9c7d9', 'حي الاندلس'),
  ('02', '98496b7a-6a0a-4360-8bdf-350f25666b12', 'القادسية'),
  ('03', '2ac024a6-bdac-4de8-88aa-54f86bc8c7af', 'الجرابه'),
  ('04', '1ff09bfe-de69-4323-9529-3870d9172b32', 'بن عاشور'),
  ('05', '1a113553-602b-433f-abaf-d4230bd70fa0', 'النوفلين');

create table public.amarsoft_salesmen (
  branch_code text not null references public.amarsoft_branch_map(code),
  sman text not null,
  name text,
  is_active boolean not null default true,
  profile_id uuid references public.profiles(id) on delete set null,  -- optional link to an app user
  updated_at timestamptz not null default now(),
  primary key (branch_code, sman)
);

create table public.amarsoft_invoices (
  id bigint generated always as identity primary key,
  branch_code text not null references public.amarsoft_branch_map(code),
  branch_id uuid not null references public.branches(id),
  year_folder text not null,
  kind text not null check (kind in ('sale','return')),
  invoice_no text not null,
  invoice_date date not null,
  invoice_time text,
  sold_at timestamptz not null,
  sman text,
  currency text,
  net_dirhams bigint not null,                 -- 1 LD = 1000 dirhams; returns are negative
  items jsonb not null default '[]'::jsonb,
  is_deleted boolean not null default false,   -- removed in Amarsoft
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_code, year_folder, kind, invoice_no)
);
create index amarsoft_invoices_sold_at_idx on public.amarsoft_invoices (sold_at desc);
create index amarsoft_invoices_sman_idx on public.amarsoft_invoices (branch_code, sman, sold_at);
create index amarsoft_invoices_branch_id_idx on public.amarsoft_invoices (branch_id);
create index amarsoft_salesmen_profile_id_idx on public.amarsoft_salesmen (profile_id);

create table public.amarsoft_sync_keys (
  key_hash text primary key,                   -- sha256 hex of the server's sync key
  label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table public.amarsoft_sync_log (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  invoices int, upserted int, marked_deleted int, salesmen int, note text
);

alter table public.amarsoft_branch_map enable row level security;
alter table public.amarsoft_salesmen enable row level security;
alter table public.amarsoft_invoices enable row level security;
alter table public.amarsoft_sync_keys enable row level security;
alter table public.amarsoft_sync_log enable row level security;

create policy "admins read branch map" on public.amarsoft_branch_map for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));
create policy "admins read salesmen" on public.amarsoft_salesmen for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));
create policy "admins link salesmen" on public.amarsoft_salesmen for update to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
create policy "admins read invoices" on public.amarsoft_invoices for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));
create policy "admins read sync log" on public.amarsoft_sync_log for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));
-- amarsoft_sync_keys: no policies; service role only.

-- Ingest a batch from the server. Called by the edge function with the service role.
create or replace function public.amarsoft_ingest(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from date := (p->>'window_from')::date;
  v_branches text[] := array(select jsonb_array_elements_text(coalesce(p->'branches_scanned','[]'::jsonb)));
  v_upserted int; v_deleted int; v_smen int; v_count int;
begin
  insert into amarsoft_salesmen (branch_code, sman, name, is_active, updated_at)
  select s->>'branch', s->>'sman', nullif(s->>'name',''), coalesce((s->>'active')::boolean, true), now()
  from jsonb_array_elements(coalesce(p->'salesmen','[]'::jsonb)) s
  on conflict (branch_code, sman) do update
    set name = excluded.name, is_active = excluded.is_active, updated_at = now()
    where amarsoft_salesmen.name is distinct from excluded.name or amarsoft_salesmen.is_active is distinct from excluded.is_active;
  get diagnostics v_smen = row_count;

  with src as (
    select i->>'branch' branch_code, i->>'year' year_folder, i->>'kind' kind, i->>'no' invoice_no,
           (i->>'date')::date invoice_date, nullif(i->>'time','') invoice_time,
           nullif(i->>'sman','') sman, nullif(i->>'currency','') currency,
           (i->>'net_dirhams')::bigint net_dirhams, coalesce(i->'items','[]'::jsonb) items
    from jsonb_array_elements(coalesce(p->'invoices','[]'::jsonb)) i
  )
  insert into amarsoft_invoices (branch_code, branch_id, year_folder, kind, invoice_no, invoice_date, invoice_time,
                                 sold_at, sman, currency, net_dirhams, items)
  select s.branch_code, m.branch_id, s.year_folder, s.kind, s.invoice_no, s.invoice_date, s.invoice_time,
         ((s.invoice_date + coalesce(nullif(s.invoice_time,'')::time, '12:00'::time))::timestamp at time zone 'Africa/Tripoli'),
         s.sman, s.currency, s.net_dirhams, s.items
  from src s join amarsoft_branch_map m on m.code = s.branch_code
  on conflict (branch_code, year_folder, kind, invoice_no) do update
    set invoice_date = excluded.invoice_date, invoice_time = excluded.invoice_time, sold_at = excluded.sold_at,
        sman = excluded.sman, currency = excluded.currency, net_dirhams = excluded.net_dirhams,
        items = excluded.items, is_deleted = false, updated_at = now()
    where (amarsoft_invoices.sman, amarsoft_invoices.net_dirhams, amarsoft_invoices.items, amarsoft_invoices.is_deleted, amarsoft_invoices.invoice_date)
          is distinct from (excluded.sman, excluded.net_dirhams, excluded.items, false, excluded.invoice_date);
  get diagnostics v_upserted = row_count;

  -- Anything in the scanned window that the server no longer has was deleted in Amarsoft.
  update amarsoft_invoices a set is_deleted = true, updated_at = now()
  where v_from is not null and a.branch_code = any(v_branches) and a.invoice_date >= v_from and not a.is_deleted
    and not exists (
      select 1 from jsonb_array_elements(coalesce(p->'invoices','[]'::jsonb)) i
      where i->>'branch' = a.branch_code and i->>'year' = a.year_folder and i->>'kind' = a.kind and i->>'no' = a.invoice_no);
  get diagnostics v_deleted = row_count;

  v_count := jsonb_array_length(coalesce(p->'invoices','[]'::jsonb));
  insert into amarsoft_sync_log (invoices, upserted, marked_deleted, salesmen) values (v_count, v_upserted, v_deleted, v_smen);
  return jsonb_build_object('invoices', v_count, 'upserted', v_upserted, 'marked_deleted', v_deleted, 'salesmen', v_smen);
end $$;
revoke all on function public.amarsoft_ingest(jsonb) from public, anon, authenticated;
grant execute on function public.amarsoft_ingest(jsonb) to service_role;

-- Leaderboard for any signed-in staff member. Amounts only for admins.
create or replace function public.amarsoft_leaderboard(p_start timestamptz, p_end timestamptz)
returns table (rank bigint, branch_code text, branch_name text, sman text, salesman_name text,
               invoices bigint, net_dirhams bigint)
language sql
stable
security definer
set search_path = public
as $$
  with t as (
    select a.branch_code, a.sman,
           count(*) filter (where a.kind = 'sale') invoices,
           sum(a.net_dirhams)::bigint net
    from amarsoft_invoices a
    where not a.is_deleted and a.sman is not null and a.sold_at >= p_start and a.sold_at < p_end
    group by 1, 2
  )
  select rank() over (order by t.net desc), t.branch_code, b.name, t.sman, coalesce(s.name, t.sman),
         t.invoices, case when public.has_role(auth.uid(), 'admin') then t.net end
  from t
  join amarsoft_branch_map m on m.code = t.branch_code
  join branches b on b.id = m.branch_id
  left join amarsoft_salesmen s on s.branch_code = t.branch_code and s.sman = t.sman
  where auth.uid() is not null
  order by 1;
$$;
revoke all on function public.amarsoft_leaderboard(timestamptz, timestamptz) from public, anon;
grant execute on function public.amarsoft_leaderboard(timestamptz, timestamptz) to authenticated;
