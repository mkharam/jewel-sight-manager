-- المدراء العامون (admin) غالباً بدون فرع محدد (branch_id فارغ)، لذا كانت إشعارات الفرع
-- (تحويل/استفسار/إعادة طلب) لا تصلهم إطلاقاً لأن send-push يستهدف حسب الفرع فقط. نضيف
-- كل المدراء العامين كمستلمين إضافيين دائماً بغض النظر عن الفرع.

create or replace function public.trigger_push_new_transfer()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, net, vault
as $$
declare
  anon_key text;
  webhook_secret text;
  admin_ids uuid[];
begin
  select decrypted_secret into anon_key from vault.decrypted_secrets where name = 'analyze_image_anon_key' limit 1;
  select decrypted_secret into webhook_secret from vault.decrypted_secrets where name = 'push_webhook_secret' limit 1;
  if anon_key is null or webhook_secret is null then return NEW; end if;
  select coalesce(array_agg(user_id), '{}') into admin_ids from public.user_roles where role = 'admin';
  perform net.http_post(
    url := 'https://iiyaytfdxfvjcvzlnlpp.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || anon_key, 'x-webhook-secret', webhook_secret),
    body := jsonb_build_object('branchId', NEW.to_branch_id, 'userIds', to_jsonb(admin_ids), 'title', 'طلب تحويل جديد', 'body', 'لديك طلب تحويل جديد بانتظار المراجعة', 'url', '/transfers')
  );
  return NEW;
end;
$$;

create or replace function public.trigger_push_new_inquiry()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, net, vault
as $$
declare
  anon_key text;
  webhook_secret text;
  admin_ids uuid[];
begin
  select decrypted_secret into anon_key from vault.decrypted_secrets where name = 'analyze_image_anon_key' limit 1;
  select decrypted_secret into webhook_secret from vault.decrypted_secrets where name = 'push_webhook_secret' limit 1;
  if anon_key is null or webhook_secret is null then return NEW; end if;
  select coalesce(array_agg(user_id), '{}') into admin_ids from public.user_roles where role = 'admin';
  perform net.http_post(
    url := 'https://iiyaytfdxfvjcvzlnlpp.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || anon_key, 'x-webhook-secret', webhook_secret),
    body := jsonb_build_object('branchId', NEW.branch_id, 'userIds', to_jsonb(admin_ids), 'title', 'استفسار عميل جديد', 'body', coalesce('استفسار من: ' || NEW.customer_name, 'لديك استفسار عميل جديد'), 'url', '/inquiries')
  );
  return NEW;
end;
$$;

create or replace function public.trigger_push_new_reorder()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, net, vault
as $$
declare
  anon_key text;
  webhook_secret text;
  admin_ids uuid[];
begin
  select decrypted_secret into anon_key from vault.decrypted_secrets where name = 'analyze_image_anon_key' limit 1;
  select decrypted_secret into webhook_secret from vault.decrypted_secrets where name = 'push_webhook_secret' limit 1;
  if anon_key is null or webhook_secret is null then return NEW; end if;
  select coalesce(array_agg(user_id), '{}') into admin_ids from public.user_roles where role = 'admin';
  perform net.http_post(
    url := 'https://iiyaytfdxfvjcvzlnlpp.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || anon_key, 'x-webhook-secret', webhook_secret),
    body := jsonb_build_object(
      'branchId', NEW.branch_id,
      'userIds', to_jsonb(admin_ids),
      'title', 'طلب إعادة طلب قطعة',
      'body', coalesce(NEW.product_name_snapshot || ' — لزبون: ' || NEW.customer_name, NEW.product_name_snapshot),
      'url', '/reorders'
    )
  );
  return NEW;
end;
$$;
