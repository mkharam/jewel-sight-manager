-- الربط التلقائي أمارسوفت ← MSTRMND: كل فاتورة بيع فيها رقم زبون عنده «بطاقة مخرم للولاء» تتزاد قيمتها على بطاقته
-- (نفس «add-point» اللي يديره الماسح لبطاقة الخصم)، والمرتجع والفاتورة المحذوفة ينقصوا منها.
-- mode: off = واقف، dry = يسجّل شن كان بيبعت بلا ما يكتب في MSTRMND، live = يكتب فعلاً.
-- كل وضع عنده سطوره (invoice_id, mode) باش التجربة ما تمنعش الإرسال الحقيقي بعدين، والإرسال الحقيقي يبدا من live_start_at بس.
create table if not exists public.mstrmnd_sync_settings (
  id int primary key default 1 check (id = 1),
  mode text not null default 'dry' check (mode in ('off', 'dry', 'live')),
  dry_start_at timestamptz not null default now() - interval '14 days',
  live_start_at timestamptz,
  template_id int not null default 908119,
  cron_key text not null default replace(gen_random_uuid()::text, '-', ''),
  last_run_at timestamptz,
  last_result jsonb,
  updated_at timestamptz not null default now()
);
insert into public.mstrmnd_sync_settings (id) values (1) on conflict do nothing;
alter table public.mstrmnd_sync_settings enable row level security;
revoke all on public.mstrmnd_sync_settings from anon, authenticated;

create table if not exists public.mstrmnd_sync (
  invoice_id bigint not null references public.amarsoft_invoices(id) on delete cascade,
  mode text not null check (mode in ('dry', 'live')),
  action text not null check (action in ('add', 'subtract')),   -- add = بيع، subtract = مرتجع
  amount_ld bigint not null,
  status text not null,          -- would_send / sent / reversed / would_reverse / skipped / error
  reason text,                   -- سبب التخطي أو الخطأ
  mstrmnd_customer_id text,
  card_id bigint,
  http_status int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (invoice_id, mode)
);
create index if not exists mstrmnd_sync_status_idx on public.mstrmnd_sync (mode, status);
alter table public.mstrmnd_sync enable row level security;
revoke all on public.mstrmnd_sync from anon;
grant select on public.mstrmnd_sync to authenticated;
create policy "admin read mstrmnd sync" on public.mstrmnd_sync for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));
