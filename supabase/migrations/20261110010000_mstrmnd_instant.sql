-- البطاقة تتبدّل وقت الفاتورة توصل، بدل ما تستنى دورة الربط (كل 10 دقايق).
--  1) قفل للربط: الفاتورة الجديدة تشغّله فوراً، والدورة كل 10 دقايق تبقى احتياط، وما يشتغلوش مع بعض
--     (لو اشتغلوا مع بعض ممكن نفس الفاتورة تتزاد مرتين). اللي يجي والربط شغال يطلب منه يعاود دورة بعد ما يكمّل.
--  2) فاتورة تعدّلت قيمتها في أمارسوفت بعد ما تبعتت → الفرق يتزاد ولا ينقص من نفس البطاقة.
--  3) كل ما فاتورة فيها رقم زبون تدخل ولا تتبدّل، قاعدة البيانات تنادي الربط في نفس اللحظة.

alter table public.mstrmnd_sync_settings
  add column if not exists run_until timestamptz,
  add column if not exists rerun boolean not null default false;

-- يرجّع true لو خدا القفل. لو الربط شغال، يطلب منه دورة زيادة ويرجّع false.
create or replace function public.mstrmnd_link_acquire(p_seconds int default 150)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update mstrmnd_sync_settings set run_until = now() + make_interval(secs => p_seconds), rerun = false
  where id = 1 and (run_until is null or run_until < now());
  if found then return true; end if;
  update mstrmnd_sync_settings set rerun = true where id = 1;
  return false;
end $$;

-- يرجّع true لو حد طلب دورة زيادة وقت الربط كان شغال (والقفل يبقى عنده)، وإلا يفك القفل.
create or replace function public.mstrmnd_link_release(p_keep boolean default true, p_seconds int default 150)
returns boolean language plpgsql security definer set search_path = public as $$
declare again boolean;
begin
  select rerun into again from mstrmnd_sync_settings where id = 1 for update;
  again := coalesce(again, false) and p_keep;
  update mstrmnd_sync_settings
  set run_until = case when again then now() + make_interval(secs => p_seconds) end, rerun = false
  where id = 1;
  return again;
end $$;

-- فواتير تبعتت لبطاقة الولاء وقيمتها في أمارسوفت تبدّلت من بعد (الموظف عدّل الفاتورة).
create or replace function public.mstrmnd_sync_adjustments_t(p_mode text)
returns table(invoice_id bigint, template_id integer, card_id bigint, action text, amount_ld bigint, ld_now bigint,
              branch_code text, invoice_no text)
language sql stable security definer set search_path = public as $$
  select m.invoice_id, m.template_id, m.card_id, m.action, m.amount_ld,
         round(abs(a.net_dirhams) / 1000.0)::bigint, a.branch_code, a.invoice_no
  from mstrmnd_sync m
  join mstrmnd_sync_settings s on s.id = 1
  join amarsoft_invoices a on a.id = m.invoice_id
  where m.mode = p_mode and m.template_id = s.template_id and m.status = 'sent' and m.card_id is not null
    and not a.is_deleted and round(abs(a.net_dirhams) / 1000.0) <> m.amount_ld
  limit 50;
$$;

-- ينادي mstrmnd-link?action=sync (نفس اللي يديره الـ cron).
create or replace function public.mstrmnd_kick()
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select mode from mstrmnd_sync_settings where id = 1) is distinct from 'live' then return; end if;
  perform net.http_post(
    url := 'https://iiyaytfdxfvjcvzlnlpp.supabase.co/functions/v1/mstrmnd-link?action=sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-key', (select cron_key from mstrmnd_sync_settings where id = 1)),
    body := '{"kick": true}'::jsonb,
    timeout_milliseconds := 120000);
end $$;

revoke execute on function public.mstrmnd_link_acquire(int), public.mstrmnd_link_release(boolean, int),
  public.mstrmnd_sync_adjustments_t(text), public.mstrmnd_kick() from public, anon, authenticated;
