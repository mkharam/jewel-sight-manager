-- Full Amarsoft invoice header (customer, payments, gold rate, weights, making/metal split)
-- alongside the existing per-line items. Sent by scripts/amarsoft-sync.ps1.

alter table public.amarsoft_invoices add column details jsonb not null default '{}'::jsonb;

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
           (i->>'net_dirhams')::bigint net_dirhams, coalesce(i->'items','[]'::jsonb) items,
           coalesce(i->'details','{}'::jsonb) details
    from jsonb_array_elements(coalesce(p->'invoices','[]'::jsonb)) i
  )
  insert into amarsoft_invoices (branch_code, branch_id, year_folder, kind, invoice_no, invoice_date, invoice_time,
                                 sold_at, sman, currency, net_dirhams, items, details)
  select s.branch_code, m.branch_id, s.year_folder, s.kind, s.invoice_no, s.invoice_date, s.invoice_time,
         ((s.invoice_date + coalesce(nullif(s.invoice_time,'')::time, '12:00'::time))::timestamp at time zone 'Africa/Tripoli'),
         s.sman, s.currency, s.net_dirhams, s.items, s.details
  from src s join amarsoft_branch_map m on m.code = s.branch_code
  on conflict (branch_code, year_folder, kind, invoice_no) do update
    set invoice_date = excluded.invoice_date, invoice_time = excluded.invoice_time, sold_at = excluded.sold_at,
        sman = excluded.sman, currency = excluded.currency, net_dirhams = excluded.net_dirhams,
        items = excluded.items, details = excluded.details, is_deleted = false, updated_at = now()
    where (amarsoft_invoices.sman, amarsoft_invoices.net_dirhams, amarsoft_invoices.items, amarsoft_invoices.details,
           amarsoft_invoices.is_deleted, amarsoft_invoices.invoice_date)
          is distinct from (excluded.sman, excluded.net_dirhams, excluded.items, excluded.details, false, excluded.invoice_date);
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

-- Leaderboard: a salesman linked to an app user shows under that user's name.
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
  select rank() over (order by t.net desc), t.branch_code, b.name, t.sman,
         coalesce(nullif(pr.full_name, ''), s.name, t.sman),
         t.invoices, case when public.has_role(auth.uid(), 'admin') then t.net end
  from t
  join amarsoft_branch_map m on m.code = t.branch_code
  join branches b on b.id = m.branch_id
  left join amarsoft_salesmen s on s.branch_code = t.branch_code and s.sman = t.sman
  left join profiles pr on pr.id = s.profile_id
  where auth.uid() is not null
  order by 1;
$$;
revoke all on function public.amarsoft_leaderboard(timestamptz, timestamptz) from public, anon;
grant execute on function public.amarsoft_leaderboard(timestamptz, timestamptz) to authenticated;
