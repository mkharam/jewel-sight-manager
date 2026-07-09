## هدف

توحيد صفحات الاستيراد في صفحة واحدة (رفع من الجهاز)، إلغاء صفحة العميل/الكشك، تحسين تحليل الصور لتفريق **الذهب الأبيض** عن **الألماس**، إضافة نظام **SKU** مرتبط بالفرع، وإنهاء اللمسات الأخيرة قبل النشر للموظفين.

---

### 1) إلغاء صفحة العميل (Kiosk)
- عدم بناء صفحة `/kiosk` أو دور `kiosk` — يتم إسقاط الميزة كلياً. (لم يُضف كود سابقاً — فقط إسقاط الفكرة.)

### 2) توحيد صفحات الاستيراد في صفحة واحدة
- **حذف** `src/pages/ImportProducts.tsx` (الاستيراد القديم).
- **حذف** `src/pages/ImportSocial.tsx` بشكله الحالي.
- **إنشاء** `src/pages/BulkImport.tsx` جديدة تستقبل فقط **مجلد أو صور من الجهاز** ثم تحلّلها بالذكاء الاصطناعي وتحفظها كمسودات قابلة للتصنيف لاحقاً.
- **حذف** المسارات القديمة `/import` و `/import-social` من `App.tsx` وإبقاء مسار وحيد `/import` يشير إلى `BulkImport`.
- **تحديث** روابط `AppLayout.tsx`: زر واحد فقط باسم "استيراد صور" بأيقونة رفع.
- **حذف** edge function `social-fetch-images` (لم تعد مستخدمة).
- **حذف** `social-analyze-image` واعتماد `analyze-product-image` كمحلل موحّد لجميع الصور (Lovable AI Gateway).

### 3) تحسين المحلل: تمييز الذهب الأبيض من الألماس
تحديث prompt و schema في `supabase/functions/_shared/lovable-ai.ts`:
- إضافة حقل جديد `metal_color` (yellow / white / rose / mixed).
- تحسين تعليمات karat:
  - سطح لامع أبيض/فضي بدون أحجار بارزة ⇒ ذهب أبيض 18K/21K (**ليس ألماس**).
  - "ألماس" تُستخدم فقط عندما تظهر **أحجار كريمة شفافة مقطّعة (facets)** مثبتة في القطعة.
  - "فضة" فقط إذا كان الطراز واضح فضي (تصميم/ختم).
- schema يجبر النموذج على ذكر سبب مختصر في `description_ar` عند اختيار "ألماس".
- تحديث `analysisToEmbeddingText` ليشمل `metal_color` لتحسين البحث بالصورة.

### 4) نظام SKU مرتبط بالفرع
- إضافة عمود `code TEXT` لجدول `branches` (رمز مختصر مثل JRB, AND, BNS, NFL, QDS) وتعبئته للفروع الحالية.
- في `ProductForm.tsx` عند حفظ منتج جديد، توليد SKU تلقائي بصيغة:
  - `{BRANCH_CODE}-{CAT}-{YYMM}-{SEQ4}` مثال: `JRB-RNG-2607-0018`.
  - CAT = أول 3 أحرف لاتينية من `category.name_en` أو أول 3 من الاسم.
  - SEQ4 = عدّاد شهري لكل فرع (count منتجات الفرع في الشهر + 1، مبطّن بأصفار).
- إظهار SKU في `ProductCard` وصفحة `ProductDetail`.

### 5) اللمسات الأخيرة للنشر
- تنظيف imports غير المستخدمة في `App.tsx` و `AppLayout.tsx`.
- إزالة أي مراجع لـ Firecrawl/Instagram/Facebook من الواجهة والنصوص.
- التأكد من مسح فحص الأمان (`security--get_scan_results`) قبل الطلب من المستخدم زر النشر.
- إبقاء أدوار Staff كما هي (admin/manager/employee) بدون kiosk.

---

## ملخص الملفات

**حذف:**
- `src/pages/ImportProducts.tsx`
- `src/pages/ImportSocial.tsx`
- `supabase/functions/social-fetch-images/`
- `supabase/functions/social-analyze-image/`

**إنشاء:**
- `src/pages/BulkImport.tsx`

**تعديل:**
- `src/App.tsx` — تنظيف المسارات.
- `src/components/AppLayout.tsx` — تنظيف روابط التنقل.
- `src/pages/ProductForm.tsx` — توليد SKU تلقائي.
- `src/components/ProductCard.tsx` + `src/pages/ProductDetail.tsx` — إظهار SKU.
- `supabase/functions/_shared/lovable-ai.ts` — تحسين prompt/schema.
- `supabase/functions/analyze-product-image/index.ts` — دعم metal_color.

**Migration:**
- `ALTER TABLE branches ADD COLUMN code TEXT` + UPDATE للرموز.
