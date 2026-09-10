-- استكمال معايرة صلاحيات الرفع: إعادة توجيه أفعال الموظف على قطعة قائمة (باركود، تحقّق
-- وجود القطعة أثناء الجرد) عبر دوال ضيّقة SECURITY DEFINER بدل UPDATE عام على الجدول،
-- بعد أن أصبح UPDATE مقتصراً على المدير العام والمشرف على فرعه فقط.

create or replace function public.update_product_barcode(p_product_id uuid, p_barcode_value text)
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
    raise exception 'لا تملك صلاحية تعديل باركود هذه القطعة';
  end if;

  update public.products set barcode_value = p_barcode_value where id = p_product_id;
end;
$$;

grant execute on function public.update_product_barcode(uuid, text) to authenticated;

-- تحقّق وجود القطعة (زر "تحقق من وجود القطعة" أثناء الجرد الميداني) — إجراء تشغيلي يومي
-- لأي موظف في فرع القطعة، لا يحتاج صلاحية تعديل كاملة.
create or replace function public.verify_product_presence(p_product_id uuid)
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
    raise exception 'لا تملك صلاحية التحقق من هذه القطعة';
  end if;

  update public.products
  set last_verified_at = now(), last_verified_by = auth.uid()
  where id = p_product_id;
end;
$$;

grant execute on function public.verify_product_presence(uuid) to authenticated;
