-- Amarsoft operations: keep app pieces in step with Amarsoft, profit/making analytics,
-- invoice edit/delete alerts, Amarsoft payments for the daily closing, and tag-scan stock counts.

-- 1+2. App pieces follow Amarsoft ---------------------------------------------------------------
-- On insert/barcode change: a piece Amarsoft has in stock gets its weight (and karat) filled when
-- empty. On every stock sync: pending pieces are matched, matched pieces Amarsoft has since sold
-- become 'sold' in the app, and missing weights are filled.
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
  select st.branch_code, st.in_stock, coalesce(nullif(st.grams, 0), st.grams_in) grams, st.karat into s
  from amarsoft_stock st where st.tag = v_tag
  order by st.in_stock desc, st.updated_at desc limit 1;
  new.amarsoft_status := case when s.branch_code is null then 'pending' when s.in_stock then 'matched' else 'sold' end;
  new.amarsoft_branch_code := s.branch_code;
  new.amarsoft_checked_at := now();
  if s.in_stock then
    if new.weight_grams is null and s.grams > 0 then new.weight_grams := s.grams; end if;
    if new.karat is null and s.karat in ('18', '21', '24') then new.karat := s.karat || 'K'; end if;
  end if;
  return new;
end $$;

create or replace function public.amarsoft_recheck_pending()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_pending int; v_sold int; v_weights int;
begin
  -- pending -> matched / sold
  with hit as (
    select distinct on (p.id) p.id, st.branch_code, st.in_stock
    from products p join amarsoft_stock st on st.tag = amarsoft_tag_key(p.barcode_value)
    where p.amarsoft_status = 'pending'
    order by p.id, st.in_stock desc, st.updated_at desc
  )
  update products p set amarsoft_status = case when hit.in_stock then 'matched' else 'sold' end,
         amarsoft_branch_code = hit.branch_code, amarsoft_checked_at = now()
  from hit where p.id = hit.id;
  get diagnostics v_pending = row_count;

  -- matched pieces Amarsoft has sold since -> sold in the app too
  update products p set amarsoft_status = 'sold', amarsoft_checked_at = now(),
         status = case when p.status::text = 'available' then 'sold'::product_status else p.status end
  where p.amarsoft_status = 'matched'
    and not exists (select 1 from amarsoft_stock st where st.tag = amarsoft_tag_key(p.barcode_value) and st.in_stock)
    and exists (select 1 from amarsoft_stock st where st.tag = amarsoft_tag_key(p.barcode_value));
  get diagnostics v_sold = row_count;

  -- missing weights / karat from Amarsoft for pieces it has in stock
  with w as (
    select distinct on (p.id) p.id, coalesce(nullif(st.grams, 0), st.grams_in) grams, st.karat
    from products p join amarsoft_stock st on st.tag = amarsoft_tag_key(p.barcode_value) and st.in_stock
    where p.amarsoft_status = 'matched' and (p.weight_grams is null or p.karat is null)
    order by p.id, st.updated_at desc
  )
  update products p set weight_grams = coalesce(p.weight_grams, nullif(w.grams, 0)),
         karat = coalesce(p.karat, case when w.karat in ('18', '21', '24') then w.karat || 'K' end)
  from w where p.id = w.id;
  get diagnostics v_weights = row_count;

  return v_pending + v_sold + v_weights;
end $$;
revoke all on function public.amarsoft_recheck_pending() from public, anon, authenticated;
grant execute on function public.amarsoft_recheck_pending() to service_role;

-- 6. Profit and making analytics (admins) -------------------------------------------------------
-- Per branch and karat: weight, sales, average price per gram, the making charged (sale minus the
-- gold value Amarsoft books), the supplier's making cost of the tagged pieces, and the difference.
create or replace function public.amarsoft_sales_analytics(p_start timestamptz, p_end timestamptz, p_branch text default null)
returns table (branch_code text, branch_name text, karat text, invoices bigint, pieces numeric, grams numeric,
               pure_grams numeric, sales_dirhams bigint, metal_dirhams bigint, making_dirhams bigint,
               making_cost_dirhams bigint, costed_grams numeric)
language sql
stable
security definer
set search_path = public
as $$
  with lines as (
    select a.id, a.branch_code, a.kind,
           case when a.kind = 'return' then -1 else 1 end sgn,
           coalesce(round((i->>'purity')::numeric * 24)::int::text, '?') karat,
           coalesce((i->>'pcs')::numeric, 0) pcs, coalesce((i->>'grams')::numeric, 0) g,
           coalesce((i->>'pure_grams')::numeric, 0) pg,
           abs(coalesce((i->>'amount_dirhams')::bigint, 0)) amt,
           coalesce((i->>'metal_dirhams')::bigint, 0) metal, coalesce((i->>'making_dirhams')::bigint, 0) making,
           st.cost_dirhams cost
    from amarsoft_invoices a
    cross join jsonb_array_elements(a.items) i
    left join amarsoft_stock st on st.branch_code = a.branch_code and st.tag = i->>'tag'
    where not a.is_deleted and a.sold_at >= p_start and a.sold_at < p_end
      and (p_branch is null or a.branch_code = p_branch)
  )
  select l.branch_code, b.name, l.karat,
         count(distinct l.id) filter (where l.kind = 'sale'),
         sum(l.sgn * l.pcs), round(sum(l.sgn * l.g), 2), round(sum(l.sgn * l.pg), 3),
         sum(l.sgn * l.amt)::bigint, sum(l.sgn * l.metal)::bigint, sum(l.sgn * l.making)::bigint,
         sum(l.sgn * coalesce(l.cost, 0))::bigint, round(sum(l.sgn * l.g) filter (where l.cost is not null), 2)
  from lines l
  join amarsoft_branch_map m on m.code = l.branch_code
  join branches b on b.id = m.branch_id
  where public.has_role(auth.uid(), 'admin')
  group by l.branch_code, b.name, l.karat
  order by l.branch_code, l.karat;
$$;
revoke all on function public.amarsoft_sales_analytics(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.amarsoft_sales_analytics(timestamptz, timestamptz, text) to authenticated;

-- 5. Invoice edit/delete log (Amarsoft mst_doclog) and alerts ------------------------------------
create table public.amarsoft_doc_events (
  branch_code text not null references public.amarsoft_branch_map(code),
  trn_type text not null,                      -- RSL = retail sale, TSF = tagging, ...
  trn_no text not null,
  trn_date date,
  status text not null,                        -- A added, E edited, P printed, D deleted
  at timestamptz not null,
  user_name text,
  machine text,
  ip text,
  first_seen_at timestamptz not null default now(),
  primary key (branch_code, trn_type, trn_no, status, at)
);
create index amarsoft_doc_events_at_idx on public.amarsoft_doc_events (at desc);
alter table public.amarsoft_doc_events enable row level security;
create policy "admins read amarsoft doc events" on public.amarsoft_doc_events for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- Called by the edge function with each branch's recent log. Deleted sales, and sales edited after
-- they were printed, notify admins (only events from the last day, so a first import stays quiet).
create or replace function public.amarsoft_ingest_doc_events(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_new int := 0; v_alerts int := 0; e record; v_branch text;
begin
  for e in
    insert into amarsoft_doc_events as d (branch_code, trn_type, trn_no, trn_date, status, at, user_name, machine, ip)
    select x->>'branch', x->>'type', x->>'no', nullif(x->>'date','')::date, x->>'status',
           ((x->>'at')::timestamp at time zone 'Africa/Tripoli'), nullif(x->>'user',''), nullif(x->>'machine',''), nullif(x->>'ip','')
    from jsonb_array_elements(coalesce(p->'doc_events','[]'::jsonb)) x
    where nullif(x->>'at','') is not null
    on conflict do nothing
    returning d.*
  loop
    v_new := v_new + 1;
    if e.trn_type = 'RSL' and e.at > now() - interval '1 day' and (
         e.status = 'D'
         or (e.status = 'E' and exists (select 1 from amarsoft_doc_events p2 where p2.branch_code = e.branch_code
               and p2.trn_type = 'RSL' and p2.trn_no = e.trn_no and p2.status = 'P' and p2.at < e.at))) then
      select b.name into v_branch from amarsoft_branch_map m join branches b on b.id = m.branch_id where m.code = e.branch_code;
      perform public.send_push_notification(null, null,
        case when e.status = 'D' then 'حذف فاتورة في أمارسوفت' else 'تعديل فاتورة بعد طباعتها' end,
        format('فاتورة #%s — %s%s', e.trn_no, coalesce(v_branch, e.branch_code), coalesce(' — ' || e.user_name, '')),
        '/pos-sales?tab=log');
      v_alerts := v_alerts + 1;
    end if;
  end loop;
  return jsonb_build_object('doc_events_new', v_new, 'alerts', v_alerts);
end $$;
revoke all on function public.amarsoft_ingest_doc_events(jsonb) from public, anon, authenticated;
grant execute on function public.amarsoft_ingest_doc_events(jsonb) to service_role;

-- 4. Amarsoft payments for a branch and day, for the daily closing (admins, managers) ------------
create or replace function public.amarsoft_day_payments(p_branch_id uuid, p_date date)
returns table (account text, amount_dirhams bigint, invoices bigint)
language sql
stable
security definer
set search_path = public
as $$
  select pay->>'account', sum(case when a.kind = 'return' then -1 else 1 end * (pay->>'amount_dirhams')::bigint)::bigint,
         count(distinct a.id)
  from amarsoft_invoices a
  join amarsoft_branch_map m on m.code = a.branch_code
  cross join jsonb_array_elements(coalesce(a.details->'payments', '[]'::jsonb)) pay
  where m.branch_id = p_branch_id and a.invoice_date = p_date and not a.is_deleted
    and public.is_manager_or_admin(auth.uid())
  group by 1
  order by 2 desc;
$$;
revoke all on function public.amarsoft_day_payments(uuid, date) from public, anon;
grant execute on function public.amarsoft_day_payments(uuid, date) to authenticated;

-- 3. Stock count by scanning tags against Amarsoft (admins, managers) ---------------------------
create table public.amarsoft_counts (
  id uuid primary key default gen_random_uuid(),
  branch_code text not null references public.amarsoft_branch_map(code),
  started_by uuid default auth.uid() references public.profiles(id) on delete set null,
  started_at timestamptz not null default now(),
  closed_at timestamptz,
  notes text
);
create table public.amarsoft_count_scans (
  count_id uuid not null references public.amarsoft_counts(id) on delete cascade,
  tag text not null,
  scanned_by uuid default auth.uid() references public.profiles(id) on delete set null,
  scanned_at timestamptz not null default now(),
  primary key (count_id, tag)
);
create index amarsoft_counts_branch_idx on public.amarsoft_counts (branch_code, started_at desc);
create index amarsoft_counts_started_by_idx on public.amarsoft_counts (started_by);
create index amarsoft_count_scans_scanned_by_idx on public.amarsoft_count_scans (scanned_by);
alter table public.amarsoft_counts enable row level security;
alter table public.amarsoft_count_scans enable row level security;
create policy "managers manage amarsoft counts" on public.amarsoft_counts for all to authenticated
  using (public.is_manager_or_admin(auth.uid())) with check (public.is_manager_or_admin(auth.uid()));
create policy "managers manage amarsoft count scans" on public.amarsoft_count_scans for all to authenticated
  using (public.is_manager_or_admin(auth.uid())) with check (public.is_manager_or_admin(auth.uid()));

-- Every expected and scanned tag of a count: found / missing / extra (with what Amarsoft knows).
create or replace function public.amarsoft_count_result(p_count_id uuid)
returns table (tag text, result text, type_name text, karat text, grams numeric, in_branch text, sold_on date, scanned_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with c as (select * from amarsoft_counts where id = p_count_id and public.is_manager_or_admin(auth.uid())),
  expected as (select s.* from amarsoft_stock s, c where s.branch_code = c.branch_code and s.in_stock),
  scans as (select sc.* from amarsoft_count_scans sc, c where sc.count_id = c.id)
  select e.tag, case when sc.tag is null then 'missing' else 'found' end, e.type_name, e.karat, e.grams, e.branch_code, null::date, sc.scanned_at
  from expected e left join scans sc on sc.tag = e.tag
  union all
  select sc.tag, 'extra', st.type_name, st.karat, coalesce(nullif(st.grams, 0), st.grams_in), st.branch_code, st.sold_on, sc.scanned_at
  from scans sc
  left join lateral (select * from amarsoft_stock s where s.tag = sc.tag order by s.in_stock desc, s.updated_at desc limit 1) st on true
  where not exists (select 1 from expected e where e.tag = sc.tag);
$$;
revoke all on function public.amarsoft_count_result(uuid) from public, anon;
grant execute on function public.amarsoft_count_result(uuid) to authenticated;
