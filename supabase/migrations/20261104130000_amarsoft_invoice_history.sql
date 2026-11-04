-- What deleted and edited Amarsoft invoices contained. FoxPro keeps deleted rows in the file until
-- the table is packed, so the sync sends: whole deleted invoices ('deleted'), and the old lines of
-- invoices that were edited ('old_lines'). A trigger also keeps the app's previous copy whenever a
-- synced invoice changes ('previous'), so edits stay visible even after Amarsoft packs its files.

create table public.amarsoft_invoice_history (
  id bigint generated always as identity primary key,
  branch_code text not null references public.amarsoft_branch_map(code),
  year_folder text not null,
  kind text not null,
  invoice_no text not null,
  source text not null check (source in ('deleted', 'old_version', 'old_lines', 'previous')),
  content_hash text not null,
  invoice_date date,
  sman text,
  customer text,
  net_dirhams bigint,
  items jsonb not null default '[]'::jsonb,
  first_seen_at timestamptz not null default now(),
  unique (branch_code, year_folder, kind, invoice_no, source, content_hash)
);
create index amarsoft_invoice_history_lookup_idx on public.amarsoft_invoice_history (branch_code, invoice_no);
alter table public.amarsoft_invoice_history enable row level security;
create policy "admins read amarsoft invoice history" on public.amarsoft_invoice_history for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create or replace function public.amarsoft_ingest_history(p jsonb)
returns int
language sql
security definer
set search_path = public
as $$
  with ins as (
    insert into amarsoft_invoice_history (branch_code, year_folder, kind, invoice_no, source, content_hash,
                                          invoice_date, sman, customer, net_dirhams, items)
    select h->>'branch', h->>'year', h->>'kind', h->>'no', h->>'source',
           md5(coalesce(h->>'net_dirhams', '') || coalesce(h->>'sman', '') || coalesce(h->>'customer', '') || coalesce(h->'items', '[]'::jsonb)::text),
           nullif(h->>'date', '')::date, nullif(h->>'sman', ''), nullif(h->>'customer', ''),
           (h->>'net_dirhams')::numeric::bigint, coalesce(h->'items', '[]'::jsonb)
    from jsonb_array_elements(coalesce(p->'history', '[]'::jsonb)) h
    where exists (select 1 from amarsoft_branch_map m where m.code = h->>'branch')
    on conflict do nothing
    returning 1
  )
  select count(*)::int from ins;
$$;
revoke all on function public.amarsoft_ingest_history(jsonb) from public, anon, authenticated;
grant execute on function public.amarsoft_ingest_history(jsonb) to service_role;

-- Keep the app's previous copy of an invoice whenever the synced content changes.
create or replace function public.amarsoft_invoices_keep_previous()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (old.net_dirhams, old.items, old.sman) is distinct from (new.net_dirhams, new.items, new.sman) or (new.is_deleted and not old.is_deleted) then
    insert into amarsoft_invoice_history (branch_code, year_folder, kind, invoice_no, source, content_hash,
                                          invoice_date, sman, customer, net_dirhams, items)
    values (old.branch_code, old.year_folder, old.kind, old.invoice_no, 'previous',
            md5(old.net_dirhams::text || coalesce(old.sman, '') || coalesce(old.details->>'customer', '') || old.items::text),
            old.invoice_date, old.sman, old.details->>'customer', old.net_dirhams, old.items)
    on conflict do nothing;
  end if;
  return new;
end $$;
create trigger trg_amarsoft_invoices_keep_previous
  before update on public.amarsoft_invoices
  for each row execute function public.amarsoft_invoices_keep_previous();
