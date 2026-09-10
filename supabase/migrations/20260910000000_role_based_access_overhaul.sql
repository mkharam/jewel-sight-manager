-- إعادة ضبط الصلاحيات حسب الدور: المدير العام يرى كل شيء، والمشرف والموظف يريان بضاعة
-- كل الفروع والاستفسارات وما يفيد العمل اليومي لكن بدون الأمور الإدارية/الحسابية
-- (تقارير، سجل مبيعات، تكلفة الشراء). المشرف يقدر يعدّل/يحذف قطع فرعه فقط. الموظف لا
-- يعدّل القطعة كاملة إطلاقاً — فقط يضيف صوراً (سياسة موجودة أصلاً) ويحدّث الوزن عبر
-- دالة ضيّقة (update_product_weight) بدل صلاحية UPDATE عامة على الجدول.

-- 1) قراءة القطع: مفتوحة لكل مستخدم مسجّل دخول بغض النظر عن الفرع (بدل الاقتصار على
--    فرع المستخدم) — المشرف والموظف يحتاجان رؤية بضاعة الفروع الأخرى.
drop policy if exists "read products scoped to branch or admin" on public.products;
create policy "read products for any authenticated user"
  on public.products for select
  to authenticated
  using (true);

-- 2) تعديل القطع: المدير العام دائماً، أو المشرف على قطع فرعه فقط. الموظف لم يعد
--    يملك صلاحية UPDATE مباشرة على الجدول إطلاقاً (يستخدم update_product_weight أدناه).
drop policy if exists "update products scoped to branch or admin" on public.products;
create policy "update products admin or manager own branch"
  on public.products for update
  to authenticated
  using (
    public.has_role(auth.uid(), 'admin'::app_role)
    or (
      public.has_role(auth.uid(), 'manager'::app_role)
      and public.current_user_branch_id() is not null
      and branch_id = public.current_user_branch_id()
    )
  )
  with check (
    public.has_role(auth.uid(), 'admin'::app_role)
    or (
      public.has_role(auth.uid(), 'manager'::app_role)
      and public.current_user_branch_id() is not null
      and branch_id = public.current_user_branch_id()
    )
  );

-- 3) حذف القطع: المدير العام، أو المشرف على قطع فرعه فقط (كان مقتصراً على المدير فقط).
drop policy if exists "delete products admin only" on public.products;
create policy "delete products admin or manager own branch"
  on public.products for delete
  to authenticated
  using (
    public.has_role(auth.uid(), 'admin'::app_role)
    or (
      public.has_role(auth.uid(), 'manager'::app_role)
      and public.current_user_branch_id() is not null
      and branch_id = public.current_user_branch_id()
    )
  );

-- 4) دالة ضيّقة لتحديث الوزن فقط — يستخدمها الموظف (والمشرف/المدير أيضاً كاختصار سريع)
--    دون منحه صلاحية تعديل بقية أعمدة القطعة. SECURITY DEFINER يتجاوز RLS عمداً بعد
--    تحقّق صريح من صلاحية الفرع داخل الدالة نفسها.
create or replace function public.update_product_weight(p_product_id uuid, p_weight_grams numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_id uuid;
begin
  select branch_id into v_branch_id from public.products where id = p_product_id;
  if v_branch_id is null then
    raise exception 'القطعة غير موجودة';
  end if;

  if not (
    public.has_role(auth.uid(), 'admin'::app_role)
    or (public.current_user_branch_id() is not null and v_branch_id = public.current_user_branch_id())
  ) then
    raise exception 'لا تملك صلاحية تعديل وزن هذه القطعة';
  end if;

  if p_weight_grams is not null and p_weight_grams < 0 then
    raise exception 'الوزن غير صالح';
  end if;

  update public.products set weight_grams = p_weight_grams where id = p_product_id;
end;
$$;

grant execute on function public.update_product_weight(uuid, numeric) to authenticated;

-- 5) المبيعات: القراءة (السجل/التقرير) للمدير العام فقط الآن — كانت متاحة لأي موظف في
--    فرعه. التسجيل الفعلي (INSERT عند بيع قطعة) يبقى متاحاً للجميع في فرعهم كالسابق —
--    البيع نفسه عمل يومي للموظف، لكن مراجعة سجل/تقرير المبيعات أمر إداري.
drop policy if exists "read sales scoped to branch or admin" on public.sales;
create policy "read sales admin only"
  on public.sales for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role));

drop policy if exists "update sales scoped to branch or admin" on public.sales;
create policy "update sales admin only"
  on public.sales for update
  to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));
