-- فاتورة بيع بلا رقم الزبون (ولا حتى اسمه). أمارسوفت ما فيهاش إعداد يفرض الزبون، فنفرضوه من عندنا:
--   أول ما توصل الفاتورة (البرنامج اللي يراقب أمارسوفت يبعتها في ثواني) → إشعار لموظفين الفرع وللمدير العام،
--   وتقعد في «لوحة الولاء» لين الموظف يفتحها في أمارسوفت ويختار الزبون:
--   تزاد الرقم → تتقفل وحدها؛ تزاد الاسم بس → تولّي «بلا رقم» (أخف)؛ انحذفت → تتقفل.
create table if not exists public.amarsoft_missing_customer (
  invoice_id bigint primary key references public.amarsoft_invoices(id) on delete cascade,
  branch_code text not null,
  invoice_no text not null,
  sold_at timestamptz not null,
  net_ld numeric,
  sman text,
  missing text not null check (missing in ('phone', 'phone_name')),   -- phone_name: بلا رقم ولا اسم
  alerted_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_how text                                                   -- phone / deleted
);
alter table public.amarsoft_missing_customer enable row level security;
revoke all on public.amarsoft_missing_customer from anon, authenticated;

create or replace function public.amarsoft_invoices_missing_customer()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_branch_id uuid;
  v_branch text;
  v_sman text;
begin
  -- تصلّحت (تزاد الرقم) ولا انحذفت → تتقفل. تزاد الاسم بس → «بلا رقم».
  update amarsoft_missing_customer m
  set resolved_at = now(), resolved_how = case when n.is_deleted then 'deleted' else 'phone' end
  from new_rows n
  where m.invoice_id = n.id and m.resolved_at is null
    and (n.is_deleted or length(regexp_replace(coalesce(n.details->>'phone', ''), '\D', '', 'g')) >= 9);
  update amarsoft_missing_customer m set missing = 'phone'
  from new_rows n
  where m.invoice_id = n.id and m.resolved_at is null and m.missing = 'phone_name'
    and nullif(trim(n.details->>'customer'), '') is not null;

  -- فاتورة بيع توها وصلت بلا رقم → تنبيه (القديمة اللي توصل في مزامنة كاملة ما تنبّهش).
  for r in
    select n.id, n.branch_code, n.invoice_no, n.sold_at, n.net_dirhams, n.sman, nullif(trim(n.details->>'customer'), '') cust
    from new_rows n
    where n.kind = 'sale' and not n.is_deleted
      and n.first_seen_at > now() - interval '30 minutes' and n.sold_at > now() - interval '1 day'
      and length(regexp_replace(coalesce(n.details->>'phone', ''), '\D', '', 'g')) < 9
      and not public.amarsoft_internal_customer(n.details->>'customer')
      and not exists (select 1 from amarsoft_missing_customer m where m.invoice_id = n.id)
  loop
    insert into amarsoft_missing_customer (invoice_id, branch_code, invoice_no, sold_at, net_ld, sman, missing)
    values (r.id, r.branch_code, r.invoice_no, r.sold_at, r.net_dirhams / 1000.0, r.sman,
            case when r.cust is null then 'phone_name' else 'phone' end);
    select bm.branch_id, regexp_replace(coalesce(b.name, bm.code), '^\d+\s*-\s*', '') into v_branch_id, v_branch
    from amarsoft_branch_map bm left join branches b on b.id = bm.branch_id where bm.code = r.branch_code;
    select s.name into v_sman from amarsoft_salesmen s where s.branch_code = r.branch_code and s.sman = r.sman;
    perform public.send_push_notification(v_branch_id, null,
      case when r.cust is null then 'فاتورة بلا اسم ولا رقم الزبون' else 'فاتورة بلا رقم الزبون' end,
      format('%s #%s · %s د.ل%s%s — افتحها في أمارسوفت واختار الزبون', coalesce(v_branch, r.branch_code), r.invoice_no,
             to_char(round(r.net_dirhams / 1000.0), 'FM999,999,990'), coalesce(' · ' || r.cust, ''),
             coalesce(' · ' || coalesce(v_sman, r.sman), '')),
      '/loyalty');
  end loop;
  return null;
end $$;

drop trigger if exists trg_amarsoft_invoices_missing_customer_ins on public.amarsoft_invoices;
drop trigger if exists trg_amarsoft_invoices_missing_customer_upd on public.amarsoft_invoices;
create trigger trg_amarsoft_invoices_missing_customer_ins after insert on public.amarsoft_invoices
  referencing new table as new_rows for each statement execute function public.amarsoft_invoices_missing_customer();
create trigger trg_amarsoft_invoices_missing_customer_upd after update on public.amarsoft_invoices
  referencing new table as new_rows for each statement execute function public.amarsoft_invoices_missing_customer();

-- الفواتير اللي لين توا بلا رقم (آخر 3 أيام)، للفروع اللي يشوفها المستخدم (نفس «لوحة الولاء»).
create or replace function public.amarsoft_missing_customer_open(p_branch text default null)
returns table(invoice_id bigint, branch_code text, branch_name text, invoice_no text, sold_at timestamptz, net_ld numeric,
              sman text, customer text, missing text, alerted_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.invoice_id, m.branch_code, regexp_replace(coalesce(b.name, m.branch_code), '^\d+\s*-\s*', ''), m.invoice_no,
         m.sold_at, m.net_ld, coalesce(s.name, m.sman), nullif(trim(a.details->>'customer'), ''), m.missing, m.alerted_at
  from amarsoft_missing_customer m
  join amarsoft_invoices a on a.id = m.invoice_id
  left join amarsoft_branch_map bm on bm.code = m.branch_code
  left join branches b on b.id = bm.branch_id
  left join amarsoft_salesmen s on s.branch_code = m.branch_code and s.sman = m.sman
  where m.resolved_at is null and m.sold_at > now() - interval '3 days'
    and m.branch_code in (select c.code from public.loyalty_counter_branches() c where p_branch is null or c.code = p_branch)
  order by m.sold_at desc;
$$;

revoke execute on function public.amarsoft_invoices_missing_customer() from public, anon, authenticated;
revoke execute on function public.amarsoft_missing_customer_open(text) from public, anon;
grant execute on function public.amarsoft_missing_customer_open(text) to authenticated;
