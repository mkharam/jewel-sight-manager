# الخطة: Groq fallback + بحث بالصورة محسّن

## الهدف
1. لا تظهر أخطاء rate limit أثناء استيراد دفعات كبيرة.
2. عند البحث بصورة: يعرض الموظف "قطعة مطابقة" أو "قطع مشابهة" بترتيب وضوح.

---

## الجزء 1: نظام 3-مستويات للتحليل (استيراد بدون أخطاء)

### طلب مفتاح Groq
- تسجيل مجاني في console.groq.com → إنشاء API Key.
- حفظه كـ `GROQ_API_KEY` عبر `add_secret`.
- الحد المجاني: **30 طلب/دقيقة، 14,400/يوم** (ضعف Gemini).

### تعديل `analyze-product-image` edge function
سلسلة fallback تلقائية عند فشل أي مزود بـ 429/5xx:

```text
1. Gemini (google/gemini-flash-latest)     ← الأساسي، أدق للعربية
   ↓ فشل 429
2. Groq (llama-3.2-90b-vision-preview)     ← احتياطي سريع
   ↓ فشل 429
3. Lovable AI Gateway (gemini-3-flash)     ← أخير، مضمون لكن يستهلك credits
```

- لكل مزود schema JSON موحّد: `{ name_ar, category, karat, metal_color, description, weight_estimate }`.
- توحيد الاستجابة قبل إرجاعها للـ frontend.

### تحسين `BulkImport.tsx`
- إبطاء التأخير من 4.5s → **2.5s** بين الصور (Groq يقبل 30 RPM = صورة كل 2s).
- عند فشل صورة: تظهر زر "إعادة محاولة" فقط لتلك الصورة بدل توقف الدفعة.
- شارة تعرض المزود المستخدم لكل صورة (Gemini / Groq / Cloud).

---

## الجزء 2: تحسين البحث بالصورة

الوضع الحالي: `image-search` يستخدم embeddings ويرجع قائمة قطع بترتيب similarity، لكن الموظف ما يعرف أيها **مطابقة** وأيها **مشابهة فقط**.

### تصنيف النتائج بحسب درجة التشابه
في `ProductSearch.tsx` عند نتائج البحث بالصورة:

| Similarity | التصنيف | العرض |
|---|---|---|
| ≥ 0.92 | 🎯 **مطابقة تامة** | بانر أخضر: "قطعة مطابقة موجودة في فرع X" |
| 0.80 - 0.92 | ✨ **مشابهة جداً** | قسم منفصل بعنوان "قطع شبه مطابقة" |
| 0.65 - 0.80 | 📌 **مشابهة** | قسم "قطع مقاربة في الشكل" |
| < 0.65 | يُستبعد | لا تُعرض |

### تحسين `analyze-product-image` لحفظ embeddings أفضل
- توليد embedding للصورة **بعد** التحليل (بدل قبل) — استخدام `google/gemini-embedding-2` مع النص العربي المولّد + الصورة معاً (multimodal input).
- هذا يعطي vectors أدق لأنها تحمل معنى القطعة (سلسلة ذهب 21K) وليس فقط شكلها.

### إضافة "أظهر تفاصيل التشابه"
- عند فتح نتيجة مشابهة: مقارنة جنباً إلى جنب (صورة القطعة الأصلية | القطعة الموجودة) + الاختلافات المكتشفة (وزن، عيار، فرع، سعر آخر).

---

## الملفات المتأثرة
- `supabase/functions/analyze-product-image/index.ts` — fallback chain
- `supabase/functions/image-search/index.ts` — إرجاع similarity score لكل نتيجة
- `src/pages/BulkImport.tsx` — تأخير أقل + retry لكل صورة
- `src/pages/ProductSearch.tsx` — تصنيف النتائج بحسب similarity
- `src/components/ImageSearchButton.tsx` — تمرير scores للـ UI
- سر جديد: `GROQ_API_KEY`

## الشيء المطلوب منك قبل البدء
- إنشاء مفتاح Groq من https://console.groq.com/keys (مجاني، لا يحتاج بطاقة).

بعد موافقتك على الخطة، سأطلب المفتاح ثم أنفّذ كل شي.
