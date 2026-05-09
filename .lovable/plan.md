## الهدف
عند استيراد صور من فيسبوك/انستجرام: جلب آخر **200 صورة كحد أقصى**، وتخطّي أي صورة سبق استيرادها في النظام (لأي فرع/مستخدم).

## التغييرات

### 1. قاعدة البيانات (migration)
إضافة عمود `source_url` (نص، nullable) إلى `product_images` مع فهرس فريد جزئي للسرعة:
- `ALTER TABLE product_images ADD COLUMN source_url text`
- `CREATE INDEX idx_product_images_source_url ON product_images(source_url) WHERE source_url IS NOT NULL`

هذا يخزّن رابط الصورة الأصلي على فيسبوك/انستجرام لكل صورة مستوردة، ليصبح المرجع لكشف التكرار.

### 2. Edge Function: `social-fetch-images`
- تقليم النتيجة إلى آخر **200 صورة** (`images.slice(0, 200)`) قبل الإرجاع.
- استلام `excludeUrls?: string[]` اختيارياً من العميل وإقصاء أي رابط موجود فيه (مع تطبيع الرابط: إزالة `&amp;` وتوحيد بدون query عند المقارنة).

### 3. صفحة `ImportSocial.tsx`
قبل استدعاء `social-fetch-images`:
1. جلب كل `source_url` من `product_images` حيث `source_url is not null` (مع pagination إن لزم).
2. إرسالها كـ `excludeUrls` للـ edge function.
3. بعد الفلترة في الخادم، عرض شارة: "تم تخطّي X صورة مستوردة سابقاً" + "تم إيجاد Y صورة جديدة (الحد الأقصى 200)".

عند الحفظ في `saveAll`:
- تمرير `source_url: it.imageUrl` ضمن إدراج `product_images`، حتى تُحسب في المرات القادمة.

### 4. مقارنة الروابط
المفتاح للمقارنة هو **الجزء قبل علامة `?`** من الرابط (لأن CDN فيسبوك يضيف توقيعات متغيّرة لنفس الصورة). نخزّن الرابط الكامل لكن نقارن بالجزء الأساسي.

## الملفات المتأثرة
- migration جديد (إضافة عمود + فهرس)
- `supabase/functions/social-fetch-images/index.ts`
- `src/pages/ImportSocial.tsx`
- `src/integrations/supabase/types.ts` (تلقائي بعد migration)

## ملاحظات
- لن نستخدم hash للصور (بطيء ويتطلب تحميل كامل).
- التخطي على مستوى النظام كاملاً (كل الفروع والمستخدمين).
- الحد 200 يُطبَّق بعد الفلترة من الخادم على المجموعة قبل الإقصاء، أي: نأخذ آخر 200 من الصور الجديدة غير المستوردة.