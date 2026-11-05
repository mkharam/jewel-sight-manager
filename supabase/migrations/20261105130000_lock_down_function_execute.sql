-- أمان: دوال SECURITY DEFINER كانت قابلة للنداء من غير تسجيل دخول (anon) عبر /rest/v1/rpc.
--  * دوال الـtrigger: ما تتناداش إلا كـtrigger، والصلاحية ما تنفحصش وقت التشغيل (بس وقت إنشاء
--    الـtrigger) — فنسحبها من الكل ما عدا service_role بلا أي أثر على عملها.
--  * دوال الصلاحيات (has_role…): تستعملها سياسات RLS للمستخدم المسجّل — نسحبها من anon بس.
-- ومعها: search_path ثابت لدوال ما كانش عندها (تحذير مدقق Supabase).
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;

  for f in
    select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and p.proname in ('current_user_branch_id', 'has_branch', 'has_role', 'is_branch_manager', 'is_manager_or_admin')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;

  for f in
    select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('loyalty_tier', 'amarsoft_phone_key', 'amarsoft_tag_key', 'amarsoft_name_key', 'amarsoft_supplier_internal')
  loop
    execute format('alter function %s set search_path = public', f.sig);
  end loop;
end $$;
