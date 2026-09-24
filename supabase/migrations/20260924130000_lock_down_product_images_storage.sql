-- إغلاق حاوية product-images: كانت ثلاث سياسات قديمة (auth upload/update/delete product images)
-- تسمح لأي مستخدم مسجّل برفع أو استبدال أو حذف أي صورة قطعة — وسياسات Postgres المسموحة
-- تُجمع بـOR، فكانت تُبطل السياستين المقيّدتين بالفرع اللتين أُضيفتا لاحقاً. التسجيل مفتوح
-- (يوجد فعلاً حساب بلا دور ولا فرع)، فأي شخص كان يستطيع إنشاء حساب ومسح صور المخزون كلها.
--
-- انتبه: كل صور المخزون الفعلية مرفوعة في imports/<معرّف الرافع>/ (الرفع بالجملة والكاميرا)،
-- لا في branch-<id>/ — فسياسة الفرع وحدها كانت ستكسر رفع الموظفين. نسمح بالمجلدين.
--
-- الحذف: يُسمح أيضاً بحذف ملف لا تشير إليه أي قطعة، لأي موظف له دور. deleteProducts يحذف
-- القطعة أولاً ثم ملفاتها — وقد يكون رافعها زميلاً، فبدون هذا تبقى الملفات يتيمة من جديد
-- (أصل مشكلة تجاوز حصة التخزين). ملف بلا قطعة لا قيمة له، فحذفه لا يضر أحداً.

create or replace function public.product_image_write_allowed(obj_name text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    has_role(auth.uid(), 'admin') or has_role(auth.uid(), 'manager')
    or (
      exists (select 1 from user_roles where user_id = auth.uid())
      and (
        ((storage.foldername(obj_name))[1] = 'imports' and (storage.foldername(obj_name))[2] = auth.uid()::text)
        or (storage.foldername(obj_name))[1] = 'branch-' || (select branch_id::text from profiles where id = auth.uid())
      )
    );
$function$;

create or replace function public.product_image_delete_allowed(obj_name text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    public.product_image_write_allowed(obj_name)
    or (
      exists (select 1 from user_roles where user_id = auth.uid())
      and not exists (
        select 1 from product_images pi where pi.storage_path = obj_name or pi.thumb_path = obj_name
      )
    );
$function$;

revoke all on function public.product_image_write_allowed(text) from public, anon;
revoke all on function public.product_image_delete_allowed(text) from public, anon;
grant execute on function public.product_image_write_allowed(text) to authenticated;
grant execute on function public.product_image_delete_allowed(text) to authenticated;

drop policy if exists "auth upload product images" on storage.objects;
drop policy if exists "auth update product images" on storage.objects;
drop policy if exists "auth delete product images" on storage.objects;
drop policy if exists "product-images write own branch" on storage.objects;
drop policy if exists "product-images delete own branch" on storage.objects;

create policy "product-images insert by staff"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and public.product_image_write_allowed(name));

-- upsert (توليد المصغّرات) يمرّ بـUPDATE.
create policy "product-images update by staff"
  on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and public.product_image_write_allowed(name))
  with check (bucket_id = 'product-images' and public.product_image_write_allowed(name));

create policy "product-images delete by staff"
  on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and public.product_image_delete_allowed(name));
