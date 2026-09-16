# عقد واجهة تطبيق الصيانة (`repair-api`)

واجهة HTTP تربط **تطبيق الصيانة** (مستودع `Goldsystem`، تطبيق Next.js بقاعدة بيانات
Supabase خاصة به) بنظام المخزون هذا. تطبيق الصيانة لا يملك وصولاً مباشراً لقاعدة بيانات
المخزون ولا لمفاتيحها — كل التكامل يمرّ من هنا.

المصدر: `supabase/functions/repair-api/index.ts`

## المصادقة

كل الطلبات تحمل ترويسة:

```
x-api-key: <REPAIR_API_KEY>
```

المفتاح سرّ يُضبط على مشروع Supabase الخاص بالمخزون:

```bash
supabase secrets set REPAIR_API_KEY="$(openssl rand -hex 32)"
```

نفس القيمة تُضبط في تطبيق الصيانة باسم `INVENTORY_API_KEY` (على الخادم فقط — لا تصل
المتصفح أبداً). إن لم يكن المفتاح مضبوطاً تردّ الدالة `503 repair_api_not_configured`
وتبقى مقفلة بالكامل.

عنوان الأساس:

```
https://<project-ref>.supabase.co/functions/v1/repair-api
```

## المسارات

### `POST /auth/login`

تسجيل دخول الموظف بحساب المخزون نفسه. تطبيق الصيانة لا يخزّن كلمات المرور — يمرّرها مرة
واحدة هنا ثم يُصدر جلسته الخاصة. الجلسة التي تنشأ في المخزون تُغلق فوراً بعد التحقق.

```jsonc
// الطلب
{ "email": "staff@example.com", "password": "..." }

// الرد 200
{ "staff": { "staff_id": "uuid", "full_name": "…", "role": "admin|manager|employee",
             "branch_id": "uuid|null", "branch_name": "…|null" } }
```

أخطاء: `400 missing_credentials`، `401 invalid_credentials`، `403 no_profile`.

### `GET /auth/staff?staff_id=<uuid>`

إعادة قراءة بيانات موظف (لتحديث الاسم/الفرع إن تغيّرا في المخزون). نفس شكل `staff` أعلاه.
أخطاء: `400 missing_staff_id`، `404 not_found`.

### `GET /branches`

الفروع الفعّالة فقط، مرتّبة بالكود.

```jsonc
{ "branches": [ { "id": "uuid", "name": "…", "name_en": "…|null",
                  "code": "01", "phone": "…|null", "is_active": true } ] }
```

### `GET /customers/lookup?phone=<رقم>`

بحث الزبون بالهاتف. الهاتف **غير فريد** في المخزون فالرد قائمة (حتى 10) والاختيار للموظف.
المطابقة تتم على آخر 6 أرقام حتى لا تفشل بسبب صيغة الرقم (مقدمة دولية، صفر بادئ، فراغات).

```jsonc
{ "customers": [ { "id": "uuid", "full_name": "…", "phone": "…", "branch_id": "uuid|null" } ] }
```

أخطاء: `400 phone_too_short` (أقل من 3 محارف).

### `POST /customers`

إنشاء زبون في المخزون حين يكون جديداً تماماً، ليبقى سجل الزبائن موحّداً بين النظامين.

```jsonc
// الطلب
{ "full_name": "…", "phone": "…|null", "branch_id": "uuid|null", "notes": "…|null" }
// الرد 200
{ "customer": { "id": "uuid", "full_name": "…", "phone": "…", "branch_id": "uuid|null" } }
```

### `GET /items/lookup?code=<SKU>`

بحث القطعة بالكود لتعبئة الوزن والعيار تلقائياً. يبحث في `products.sku` أولاً ثم في
`sales.sku_snapshot` (قطعة بيعت وحُذفت لاحقاً من المخزون).

عند وجود سجل بيع يُفضَّل وزن/عيار **لحظة البيع** على الحالي، لأن سجل البيع لقطة مجمّدة
لا تتغيّر بتعديلات لاحقة على المنتج.

```jsonc
{ "item": {
    "source": "product" | "sale",
    "product_id": "uuid|null", "sku": "…", "name": "…",
    "item_type": "…|null", "karat": "21K|null", "weight_grams": 12.345,
    "ring_size": "…|null", "branch_id": "uuid|null", "status": "sold|available|…",
    "sale": { "sale_id": "uuid", "sold_at": "ISO", "customer_id": "uuid|null",
              "customer_name": "…|null", "customer_phone": "…|null" } | null
} }
```

رد `404 { "item": null }` حين لا يوجد كود مطابق — وهذه **ليست حالة خطأ** في تطبيق
الصيانة، بل يتحوّل عندها للإدخال اليدوي.

### `POST /items/status`

تحديث حالة القطعة في المخزون عند دخولها الصيانة أو خروجها منها. اختياري: فشله لا يمنع
فتح التذكرة أو تسليمها.

```jsonc
{ "product_id": "uuid", "status": "in_repair" | "available" | "sold" }
// الرد: { "ok": true }
```

### `GET /health`

`{ "ok": true }` — يستخدمه تطبيق الصيانة لعرض حالة الاتصال بالمخزون.

## التدهور اللطيف

تطبيق الصيانة **يجب أن يعمل كاملاً** بلا هذه الواجهة. عند أي فشل (انقطاع، مهلة، 5xx،
مفتاح خاطئ) يتحوّل إلى الإدخال اليدوي: اسم الزبون وهاتفه والوزن والعيار تُكتب باليد،
والفروع تُقرأ من النسخة المخزّنة محلياً في قاعدة بيانات الصيانة. التذكرة تُحفظ عندها
بـ `item_source = 'manual'` ويمكن ربطها بالمخزون لاحقاً.
