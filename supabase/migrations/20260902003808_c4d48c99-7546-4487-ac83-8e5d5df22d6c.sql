create extension if not exists pg_net with schema extensions;

do $$
declare sid uuid;
begin
  select id into sid from vault.secrets where name = 'analyze_image_anon_key';
  if sid is null then perform vault.create_secret('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6Z3pkeXB3Y29od3hwYnpoaHR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2MjU3NDMsImV4cCI6MjA5MzIwMTc0M30.2b1OZfO_tiABlh-LaUT9puie4lcmEMySVlq6xgqBXJU', 'analyze_image_anon_key');
  else perform vault.update_secret(sid, 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6Z3pkeXB3Y29od3hwYnpoaHR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2MjU3NDMsImV4cCI6MjA5MzIwMTc0M30.2b1OZfO_tiABlh-LaUT9puie4lcmEMySVlq6xgqBXJU'); end if;

  select id into sid from vault.secrets where name = 'analyze_image_webhook_secret';
  if sid is null then perform vault.create_secret('1f98d3cffea0788633bd7993905bdf51489b0caeb261c0631e51327679fdccbe', 'analyze_image_webhook_secret');
  else perform vault.update_secret(sid, '1f98d3cffea0788633bd7993905bdf51489b0caeb261c0631e51327679fdccbe'); end if;

  select id into sid from vault.secrets where name = 'push_webhook_secret';
  if sid is null then perform vault.create_secret('a2521fac24c795aba3ff3aa08c4e9539f3c47762fd00c7f47a7c3bc59a18dbcf', 'push_webhook_secret');
  else perform vault.update_secret(sid, 'a2521fac24c795aba3ff3aa08c4e9539f3c47762fd00c7f47a7c3bc59a18dbcf'); end if;
end $$;

create or replace function public.trigger_analyze_product_image()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  anon_key text;
  webhook_secret text;
begin
  select decrypted_secret into anon_key
    from vault.decrypted_secrets where name = 'analyze_image_anon_key' limit 1;
  select decrypted_secret into webhook_secret
    from vault.decrypted_secrets where name = 'analyze_image_webhook_secret' limit 1;

  if anon_key is null or webhook_secret is null then
    raise warning 'Vault secrets not set - skipping auto-analyze trigger';
    return NEW;
  end if;

  perform extensions.net.http_post(
    url := 'https://jzgzdypwcohwxpbzhhtw.supabase.co/functions/v1/analyze-product-image',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || anon_key,
      'x-webhook-secret', webhook_secret
    ),
    body := jsonb_build_object('table', 'product_images', 'record', to_jsonb(NEW))
  );
  return NEW;
end;
$$;

drop trigger if exists analyze_product_image_on_insert on public.product_images;
create trigger analyze_product_image_on_insert
after insert on public.product_images
for each row
execute function public.trigger_analyze_product_image();

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions(user_id);

grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;

alter table public.push_subscriptions enable row level security;
drop policy if exists "users manage their own push subscriptions" on public.push_subscriptions;
create policy "users manage their own push subscriptions"
  on public.push_subscriptions for all
  to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.trigger_push_new_transfer()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  anon_key text;
  webhook_secret text;
begin
  select decrypted_secret into anon_key from vault.decrypted_secrets where name = 'analyze_image_anon_key' limit 1;
  select decrypted_secret into webhook_secret from vault.decrypted_secrets where name = 'push_webhook_secret' limit 1;
  if anon_key is null or webhook_secret is null then return NEW; end if;
  perform extensions.net.http_post(
    url := 'https://jzgzdypwcohwxpbzhhtw.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || anon_key, 'x-webhook-secret', webhook_secret),
    body := jsonb_build_object('branchId', NEW.to_branch_id, 'title', 'طلب تحويل جديد', 'body', 'لديك طلب تحويل جديد بانتظار المراجعة', 'url', '/transfers')
  );
  return NEW;
end;
$$;
drop trigger if exists push_on_new_transfer on public.transfers;
create trigger push_on_new_transfer after insert on public.transfers for each row execute function public.trigger_push_new_transfer();

create or replace function public.trigger_push_new_inquiry()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  anon_key text;
  webhook_secret text;
begin
  select decrypted_secret into anon_key from vault.decrypted_secrets where name = 'analyze_image_anon_key' limit 1;
  select decrypted_secret into webhook_secret from vault.decrypted_secrets where name = 'push_webhook_secret' limit 1;
  if anon_key is null or webhook_secret is null then return NEW; end if;
  perform extensions.net.http_post(
    url := 'https://jzgzdypwcohwxpbzhhtw.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || anon_key, 'x-webhook-secret', webhook_secret),
    body := jsonb_build_object('branchId', NEW.branch_id, 'title', 'استفسار عميل جديد', 'body', coalesce('استفسار من: ' || NEW.customer_name, 'لديك استفسار عميل جديد'), 'url', '/inquiries')
  );
  return NEW;
end;
$$;
drop trigger if exists push_on_new_inquiry on public.customer_inquiries;
create trigger push_on_new_inquiry after insert on public.customer_inquiries for each row execute function public.trigger_push_new_inquiry();