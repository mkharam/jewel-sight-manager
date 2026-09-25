-- فحص صحة يومي: حين أوقفت جوجل موديلات Gemini تعطّل البحث بالصورة ولم يعرف أحد حتى
-- اصطدم به موظف أمام زبون. دالة health-check تفحص كل صباح وترسل إشعاراً للمدراء عند أي خلل.

-- لقطة واحدة من قاعدة البيانات لكل ما تحتاجه دالة الفحص — ذات صلاحيات لأن مخطط storage
-- غير مكشوف عبر الـAPI. لمفتاح الخدمة فقط.
create or replace function public.health_snapshot()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'products', (select count(*) from products),
    -- صور لم يحلّلها الذكاء الاصطناعي بعد ساعتين من رفعها = طابور التحليل متوقف.
    'unanalyzed_images_2h', (
      select count(*) from product_images
      where (ai_labels is null or ai_labels = '{}'::jsonb) and created_at < now() - interval '2 hours'
    ),
    'storage_bytes', (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects),
    'storage_by_bucket', (
      select coalesce(jsonb_object_agg(bucket_id, bytes), '{}'::jsonb)
      from (select bucket_id, sum((metadata->>'size')::bigint) bytes from storage.objects group by 1) b
    )
  );
$function$;
revoke all on function public.health_snapshot() from public, anon, authenticated;
grant execute on function public.health_snapshot() to service_role;

-- كل صباح 07:00 بتوقيت طرابلس (05:00 UTC). نفس سرّ طابور التحليل (Vault) لحماية الدالة
-- من الاستدعاء العشوائي — لا سرّ جديد ولا سرّ مكتوب نصاً هنا.
select cron.schedule(
  'daily-health-check',
  '0 5 * * *',
  $cron$
    select net.http_post(
      url := 'https://iiyaytfdxfvjcvzlnlpp.supabase.co/functions/v1/health-check',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-queue-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'analysis_queue_secret' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $cron$
);
