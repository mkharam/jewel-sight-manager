## الخطة

تحديث نموذج الذكاء الاصطناعي في الدالتين إلى `google/gemini-3-flash-preview` (الأحدث، توازن جيد بين الجودة والسرعة والتكلفة).

### التغييرات

1. **`supabase/functions/social-analyze-image/index.ts`**
   - تغيير `model` من `google/gemini-2.5-pro` إلى `google/gemini-3-flash-preview` في استدعاء AI Gateway.

2. **`supabase/functions/image-search/index.ts`**
   - تغيير `model` من `google/gemini-2.5-pro` إلى `google/gemini-3-flash-preview`.

### لماذا هذا النموذج
- جودة بصرية ممتازة قريبة من Pro.
- أسرع بـ ~2x ويستهلك رصيداً أقل بكثير.
- مناسب للاستيراد الجماعي (مئات الصور) وللبحث الذكي معاً.

### ما لن يتغير
- منطق معالجة الأخطاء (402/429) يبقى كما هو.
- التوازي (concurrency) ومنطق الإيقاف عند نفاد الرصيد دون تعديل.
- لا تغييرات على واجهة المستخدم أو قاعدة البيانات.