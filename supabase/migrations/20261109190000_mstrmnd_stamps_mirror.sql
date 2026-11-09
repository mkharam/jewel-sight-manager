-- 1) الربط يخدم على أكثر من بطاقة: الولاء (908119، قيمة الفاتورة) والأختام (908120، ختم على كل فاتورة بيع).
--    كل بطاقة عندها سطرها في mstrmnd_sync، فالمفتاح ولّى (invoice_id, mode, template_id).
alter table public.mstrmnd_sync add column if not exists template_id int not null default 908119;
alter table public.mstrmnd_sync drop constraint if exists mstrmnd_sync_pkey;
alter table public.mstrmnd_sync add primary key (invoice_id, mode, template_id);
alter table public.mstrmnd_sync_settings add column if not exists stamp_template_id int default 908120;
alter table public.mstrmnd_sync_settings add column if not exists mirror_at timestamptz;

-- الدوال القديمة (بلا بطاقة) تقعد للنسخة المنشورة قبل هذي؛ الجديدة بالبطاقة.
create or replace function public.mstrmnd_sync_candidates_t(p_mode text, p_template int, p_limit int default 50)
returns table (id bigint, branch_code text, kind text, invoice_no text, net_dirhams bigint, sold_at timestamptz, phone9 text)
language sql stable security definer set search_path to 'public'
as $$
  select a.id, a.branch_code, a.kind, a.invoice_no, a.net_dirhams, a.sold_at,
         right(regexp_replace(a.details->>'phone', '\D', '', 'g'), 9)
  from amarsoft_invoices a
  cross join mstrmnd_sync_settings s
  where s.id = 1
    and a.sold_at >= case when p_mode = 'live' then s.live_start_at else s.dry_start_at end
    and a.kind in ('sale', 'return') and not a.is_deleted
    and length(regexp_replace(coalesce(a.details->>'phone', ''), '\D', '', 'g')) >= 9
    and not public.amarsoft_internal_customer(a.details->>'customer')
    and not exists (select 1 from mstrmnd_sync m where m.invoice_id = a.id and m.mode = p_mode and m.template_id = p_template)
  order by a.sold_at
  limit p_limit;
$$;

create or replace function public.mstrmnd_sync_reversals_t(p_mode text)
returns table (invoice_id bigint, template_id int, amount_ld bigint, card_id bigint, branch_code text, invoice_no text)
language sql stable security definer set search_path to 'public'
as $$
  select m.invoice_id, m.template_id, m.amount_ld, m.card_id, a.branch_code, a.invoice_no
  from mstrmnd_sync m
  join amarsoft_invoices a on a.id = m.invoice_id
  where m.mode = p_mode and m.action = 'add' and m.status in ('sent', 'would_send') and a.is_deleted
  limit 50;
$$;
revoke execute on function public.mstrmnd_sync_candidates_t(text, int, int) from public, anon, authenticated;
revoke execute on function public.mstrmnd_sync_reversals_t(text) from public, anon, authenticated;

-- 2) نسخة من زبائن MSTRMND وبطاقاتهم، تتحدّث من الربط كل نص ساعة، باش صفحة «بطاقات الزبائن» تقراها بلا ما تكلّم MSTRMND.
create table if not exists public.mstrmnd_customers (
  id text primary key,
  full_name text,
  phone9 text,
  created_at timestamptz,
  cards jsonb not null default '[]',   -- [{template_id, card_id, status, expires, level, discount_pct, to_next, visits, stamps, rewards, rewards_received, balance}]
  synced_at timestamptz not null default now()
);
create index if not exists mstrmnd_customers_phone9_idx on public.mstrmnd_customers (phone9);
alter table public.mstrmnd_customers enable row level security;
revoke all on public.mstrmnd_customers from anon;
grant select on public.mstrmnd_customers to authenticated;
create policy "admin read mstrmnd customers" on public.mstrmnd_customers for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- 3) حالة الربط للصفحة (المدير العام بس).
create or replace function public.mstrmnd_link_status()
returns table (mode text, live_start_at timestamptz, last_run_at timestamptz, last_result jsonb, mirror_at timestamptz, auth_error text, auth_updated_at timestamptz)
language sql stable security definer set search_path to 'public'
as $$
  select s.mode, s.live_start_at, s.last_run_at, s.last_result, s.mirror_at, a.last_error, a.updated_at
  from mstrmnd_sync_settings s left join mstrmnd_auth a on a.id = 1
  where s.id = 1 and public.has_role(auth.uid(), 'admin');
$$;
revoke execute on function public.mstrmnd_link_status() from public, anon;
grant execute on function public.mstrmnd_link_status() to authenticated;
