-- ثغرة حقيقية من معايرة الصلاحيات السابقة: فُتحت قراءة products لكل الفروع، لكن
-- product_images بقيت مقتصرة على فرع المستخدم — فكانت قطع الفروع الأخرى تظهر للمشرف/
-- الموظف بلا صور إطلاقاً في كل مكان (شبكة البحث، الأسعار المعروضة، الاستفسارات...).
-- الإضافة/التعديل/الحذف تبقى محدودة كما هي عبر سياسة "manage product images scoped to
-- branch" (ALL) — هذا التعديل يفتح القراءة فقط.
drop policy if exists "read product images scoped to branch" on public.product_images;
create policy "read product images for any authenticated user"
  on public.product_images for select
  to authenticated
  using (true);
