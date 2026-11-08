-- صلاحيات «المشرف العام» (supervisor): نفس الإدارة في الشغل اليومي، بلا فلوس.
--  * يقرا كل اللي يقراه مدير الفرع (is_manager_or_admin) من كل الفروع.
--  * سياسات البضاعة والتحويلات والاستفسارات والحجوزات والجرد والصيانة والساعات والمحادثة والصور
--    اللي كانت للإدارة بس، تولّي للإدارة والمشرف العام (is_admin_or_supervisor).
--  * المبيعات وفواتير أمارسوفت والمحاسب والموردين وسعر القرام والإقفال وشراء الكسر تبقى للإدارة.
create or replace function public.is_admin_or_supervisor(_user_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role in ('admin', 'supervisor'));
$$;
revoke execute on function public.is_admin_or_supervisor(uuid) from public, anon;
grant execute on function public.is_admin_or_supervisor(uuid) to authenticated;

create or replace function public.is_manager_or_admin(_user_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role in ('admin', 'supervisor', 'manager'));
$$;

-- دفعات اليوم (فلوس) وإرجاع البيع: لمدير الفرع والإدارة بس، مش للمشرف العام.
do $$
declare def text;
begin
  foreach def in array array[
    pg_get_functiondef('public.amarsoft_day_payments(uuid, date)'::regprocedure),
    pg_get_functiondef('public.return_sale(uuid, text)'::regprocedure)]
  loop
    execute replace(def, 'public.is_manager_or_admin(auth.uid())',
                    '(public.has_role(auth.uid(), ''admin'') or public.has_role(auth.uid(), ''manager''))');
  end loop;
end $$;

-- السياسات: has_role(admin) ← is_admin_or_supervisor في جداول الشغل اليومي.
do $$
declare
  p record;
  needle text := 'has_role(auth.uid(), ''admin''::app_role)';
  repl text := 'is_admin_or_supervisor(auth.uid())';
  q text; c text; sql text;
begin
  for p in
    select * from pg_policies
    where schemaname = 'public'
      and tablename in ('products', 'transfers', 'customer_inquiries', 'product_quotes', 'product_reorder_requests',
                        'reservations', 'stock_take_items', 'stock_take_sessions', 'repair_tickets', 'watches',
                        'staff_messages', 'profiles', 'product_images')
      and (position(needle in coalesce(qual, '')) > 0 or position(needle in coalesce(with_check, '')) > 0)
      and policyname <> 'admin manage profiles'
  loop
    q := replace(p.qual, needle, repl);
    c := replace(p.with_check, needle, repl);
    sql := format('alter policy %I on public.%I', p.policyname, p.tablename);
    if q is not null then sql := sql || format(' using (%s)', q); end if;
    if c is not null then sql := sql || format(' with check (%s)', c); end if;
    execute sql;
  end loop;
end $$;

-- الدوال: تعديل الوزن/الباركود/التأكد من القطعة/تحليل الصور/التحويلات/التقييم + إشعارات الجهاز.
do $$
declare
  fn text; def text;
begin
  foreach fn in array array[
    'public.apply_ai_analysis(uuid, jsonb)', 'public.guard_transfer_status_transition()', 'public.is_eval_admin(uuid)',
    'public.product_image_write_allowed(text)', 'public.update_own_product_details(uuid, jsonb)',
    'public.update_product_barcode(uuid, text)', 'public.update_product_weight(uuid, numeric)',
    'public.verify_product_presence(uuid)']
  loop
    def := pg_get_functiondef(fn::regprocedure);
    def := replace(def, 'has_role(auth.uid(), ''admin''::app_role)', 'is_admin_or_supervisor(auth.uid())');
    def := replace(def, 'has_role(auth.uid(), ''admin'')', 'is_admin_or_supervisor(auth.uid())');
    def := replace(def, 'has_role(uid, ''admin'')', 'is_admin_or_supervisor(uid)');
    execute def;
  end loop;
  foreach fn in array array['public.trigger_push_new_inquiry()', 'public.trigger_push_new_reorder()', 'public.trigger_push_new_transfer()']
  loop
    def := pg_get_functiondef(fn::regprocedure);
    execute replace(def, 'where role = ''admin''', 'where role in (''admin'', ''supervisor'')');
  end loop;
end $$;
