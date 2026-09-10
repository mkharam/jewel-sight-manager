-- شبكتا الأمان الخلفيتان (trigger تحليل الصورة عند الإدراج + طابور pg_cron) كانتا معطّلتين
-- بالكامل: الدالتان تتحققان من سرّ عبر متغيّرات البيئة PRODUCT_IMAGE_WEBHOOK_SECRET و
-- QUEUE_SECRET، وهذان المتغيّران لم يُضبطا أصلاً في إعدادات الدوال — فكان كل نداء يرجع 401.
-- النتيجة: نداء فاشل كل 15 ثانية (~5760 يومياً) وشبكة أمان غير موجودة فعلياً؛ التحليل كان
-- يعمل فقط عبر مسار المتصفح المباشر، فلو أغلق الموظف التبويب أثناء الرفع لا شيء يلتقط الباقي.
--
-- السرّان موجودان أصلاً في Vault (analyze_image_webhook_secret و analysis_queue_secret)
-- ويستخدمهما الـ trigger والـ cron. فبدل نسخ القيم إلى مكان ثانٍ (ومصدرَي حقيقة يتباعدان
-- مع الوقت كما حصل هنا)، تتحقق الدوال الآن من Vault مباشرة عبر هذه الدالة.
create or replace function public.verify_internal_secret(_name text, _value text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'vault'
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = _name and decrypted_secret = _value
  );
$$;

-- الدالة تقارن أسراراً داخلية — يستدعيها service_role من الـ edge functions فقط.
revoke all on function public.verify_internal_secret(text, text) from public, anon, authenticated;
grant execute on function public.verify_internal_secret(text, text) to service_role;
