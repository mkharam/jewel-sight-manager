-- إصلاح: الدوال الخلفية (تحليل تلقائي + إشعارات Push) كانت تستدعي مشروع Supabase
-- قديم/مختلف (jzgzdypwcohwxpbzhhtw) بدل هذا المشروع (iiyaytfdxfvjcvzlnlpp) —
-- ما يعني أن التحليل التلقائي عبر الـ trigger وكل إشعارات الـ Push كانت تفشل
-- بصمت منذ البداية بغض النظر عن الجهاز. نصحّح الرابط ومفتاح anon المخزّن معاً،
-- ونضيف مشغّل push جديد لطلبات إعادة الطلب حتى يعرف المدير فوراً.

do $$
declare sid uuid;
begin
  select id into sid from vault.secrets where name = 'analyze_image_anon_key';
  if sid is null then
    perform vault.create_secret('sb_publishable_QKc39JrtZOOvnjICFx_5Lw_DD33A7Ha', 'analyze_image_anon_key');
  else
    perform vault.update_secret(sid, 'sb_publishable_QKc39JrtZOOvnjICFx_5Lw_DD33A7Ha');
  end if;
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
    url := 'https://iiyaytfdxfvjcvzlnlpp.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || anon_key, 'x-webhook-secret', webhook_secret),
    body := jsonb_build_object('branchId', NEW.branch_id, 'title', 'استفسار عميل جديد', 'body', coalesce('استفسار من: ' || NEW.customer_name, 'لديك استفسار عميل جديد'), 'url', '/inquiries')
  );
  return NEW;
end;
$$;

-- جديد: إشعار Push فوري للمدراء عند طلب موظف إعادة طلب قطعة لزبون.
-- ملاحظة: send-push يستهدف حالياً بفرع (branchId)، وليس بدور (role) — لذا نرسل
-- لكل موظفي فرع القطعة كأقرب تقريب عملي (المدراء غالباً ضمنهم)، بدل عدم الإرسال إطلاقاً.
create or replace function public.trigger_push_new_reorder()
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
drop trigger if exists push_on_new_reorder on public.product_reorder_requests;
create trigger push_on_new_reorder after insert on public.product_reorder_requests
  for each row execute function public.trigger_push_new_reorder();
