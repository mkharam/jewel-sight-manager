-- يسمح بإنشاء طلب إعادة طلب مباشرة من صورة يرسلها العميل (صفحة الاستفسارات)
-- بدل إجبار الموظف على البحث عن القطعة في الكتالوج أولاً.
ALTER TABLE public.product_reorder_requests ADD COLUMN IF NOT EXISTS image_path text;
