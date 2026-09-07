-- extensions.net.http_post كان اسماً غير صحيح (خطأ Postgres: "cross-database
-- references are not implemented") — pg_net يُنشئ دالته الفعلية في مخطط net
-- مباشرة، وليس extensions.net. بما أن أجسام دوال PL/pgSQL لا تُتحقّق من صحتها
-- إلا عند التنفيذ الفعلي، كان هذا يمر بصمت عند create/replace ثم يُسقط المعاملة
-- بالكامل (rollback) في كل مرة يُدرَج فيها صف في transfers أو customer_inquiries
-- أو product_images — أي أن التحويلات والاستفسارات والتحليل التلقائي للصور
-- كانت جميعها معطّلة فعلياً منذ إنشاء هذه المُشغّلات.

create or replace function public.trigger_analyze_product_image()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, net, vault
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

  perform net.http_post(
    url := 'https://iiyaytfdxfvjcvzlnlpp.supabase.co/functions/v1/analyze-product-image',
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

create or replace function public.trigger_push_new_transfer()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, net, vault
as $$
declare
  anon_key text;
  webhook_secret text;
begin
  select decrypted_secret into anon_key from vault.decrypted_secrets where name = 'analyze_image_anon_key' limit 1;
  select decrypted_secret into webhook_secret from vault.decrypted_secrets where name = 'push_webhook_secret' limit 1;
  if anon_key is null or webhook_secret is null then return NEW; end if;
  perform net.http_post(
    url := 'https://iiyaytfdxfvjcvzlnlpp.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || anon_key, 'x-webhook-secret', webhook_secret),
    body := jsonb_build_object('branchId', NEW.to_branch_id, 'title', 'طلب تحويل جديد', 'body', 'لديك طلب تحويل جديد بانتظار المراجعة', 'url', '/transfers')
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
begin
  select decrypted_secret into anon_key from vault.decrypted_secrets where name = 'analyze_image_anon_key' limit 1;
  select decrypted_secret into webhook_secret from vault.decrypted_secrets where name = 'push_webhook_secret' limit 1;
  if anon_key is null or webhook_secret is null then return NEW; end if;
  perform net.http_post(
    url := 'https://iiyaytfdxfvjcvzlnlpp.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || anon_key, 'x-webhook-secret', webhook_secret),
    body := jsonb_build_object('branchId', NEW.branch_id, 'title', 'استفسار عميل جديد', 'body', coalesce('استفسار من: ' || NEW.customer_name, 'لديك استفسار عميل جديد'), 'url', '/inquiries')
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
begin
  select decrypted_secret into anon_key from vault.decrypted_secrets where name = 'analyze_image_anon_key' limit 1;
  select decrypted_secret into webhook_secret from vault.decrypted_secrets where name = 'push_webhook_secret' limit 1;
  if anon_key is null or webhook_secret is null then return NEW; end if;
  perform net.http_post(
    url := 'https://iiyaytfdxfvjcvzlnlpp.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || anon_key, 'x-webhook-secret', webhook_secret),
    body := jsonb_build_object(
      'branchId', NEW.branch_id,
      'title', 'طلب إعادة طلب قطعة',
      'body', coalesce(NEW.product_name_snapshot || ' — لزبون: ' || NEW.customer_name, NEW.product_name_snapshot),
      'url', '/reorders'
    )
  );
  return NEW;
end;
$$;
