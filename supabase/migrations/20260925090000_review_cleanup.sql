-- مراجعة مستشار Supabase (25 سبتمبر):
--
-- 1) دوال SECURITY DEFINER يستطيع أي زائر غير مسجّل استدعاءها عبر /rest/v1/rpc. الدوال التي
--    تعدّل بيانات (return_sale, update_product_weight/barcode, verify_product_presence) تتحقق
--    من auth.uid() داخلياً فترفض الزائر أصلاً، لكن match_product_images/match_similar_products
--    كانت تكشف معرّفات القطع ودرجات التشابه لأي أحد، وexpire_due_reservations يشغّلها أي أحد.
--    نسحب التنفيذ من anon و PUBLIC (منح PUBLIC الافتراضي يبقي anon قادراً حتى بعد سحب anon
--    وحده). authenticated يبقى كما هو — التطبيق يستدعيها بعد تسجيل الدخول فقط.
--    دوال الصلاحيات (has_role, current_user_branch_id…) تبقى: سياسات RLS تستدعيها لكل دور.
--    دوال المشغّلات (trigger) لا تُستدعى عبر RPC أصلاً فتنبيهها بلا أثر.
revoke execute on function public.return_sale(uuid, text) from public, anon;
revoke execute on function public.update_product_weight(uuid, numeric) from public, anon;
revoke execute on function public.update_product_barcode(uuid, text) from public, anon;
revoke execute on function public.verify_product_presence(uuid) from public, anon;
revoke execute on function public.expire_due_reservations() from public, anon;
revoke execute on function public.match_product_images(vector, integer) from public, anon;
revoke execute on function public.match_similar_products(uuid, integer) from public, anon;

-- 2) فهارس مكرّرة على products: نفس العمود ونفس النوع مرتين — كل كتابة تحدّث الاثنين بلا فائدة.
--    products_sku_key يبقى لأنه يدعم قيد التفرّد نفسه.
drop index if exists public.products_sku_unique;
drop index if exists public.products_status_idx;
