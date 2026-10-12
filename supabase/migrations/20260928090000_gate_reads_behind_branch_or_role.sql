-- ثغرة حرجة (مراجعة أمنية 28 سبتمبر): التسجيل مفتوح، وأي حساب جديد بلا دور ولا فرع كان
-- يقرأ مباشرةً من الـAPI كل الزبائن (أسماء وأرقام هواتف)، وكل القطع، ومحادثة الموظفين،
-- والأسعار المعروضة، وإعدادات التطبيق — لأن سياسات القراءة كانت "true" (أي مسجّل).
-- الشاشة كانت تُخفي ذلك خلف «حسابك قيد المراجعة»، لكن الفحص كان في الواجهة فقط.
--
-- الآن تفرض قاعدة البيانات نفس شرط الواجهة (ProtectedRoute): فرع مُسنَد نشط، أو دور
-- مدير/مشرف. الموظفون الحاليون كلهم لديهم فرع فلا يتغيّر لهم شيء؛ الحساب المعلّق لا يرى
-- شيئاً. تحقّقنا: حساب بلا دور 0 صف في كل جدول، موظف ومدير كما كانا تماماً.

alter policy "auth read customers" on public.customers using (public.is_manager_or_admin(auth.uid()) or public.has_branch(auth.uid()));
alter policy "read inquiries for any authenticated user" on public.customer_inquiries using (public.is_manager_or_admin(auth.uid()) or public.has_branch(auth.uid()));
alter policy "read quotes for any authenticated user" on public.product_quotes using (public.is_manager_or_admin(auth.uid()) or public.has_branch(auth.uid()));
alter policy "read products for any authenticated user" on public.products using (public.is_manager_or_admin(auth.uid()) or public.has_branch(auth.uid()));
alter policy "read product images for any authenticated user" on public.product_images using (public.is_manager_or_admin(auth.uid()) or public.has_branch(auth.uid()));
alter policy "auth read stones" on public.product_stones using (public.is_manager_or_admin(auth.uid()) or public.has_branch(auth.uid()));
alter policy "auth read certs" on public.product_certificates using (public.is_manager_or_admin(auth.uid()) or public.has_branch(auth.uid()));
alter policy "auth read reorder requests" on public.product_reorder_requests using (public.is_manager_or_admin(auth.uid()) or public.has_branch(auth.uid()));
alter policy "auth read reservations" on public.reservations using (public.is_manager_or_admin(auth.uid()) or public.has_branch(auth.uid()));
alter policy "auth read staff chat" on public.staff_messages using (public.is_manager_or_admin(auth.uid()) or public.has_branch(auth.uid()));
alter policy "auth read suppliers" on public.suppliers using (public.is_manager_or_admin(auth.uid()) or public.has_branch(auth.uid()));
alter policy "auth read wishlist" on public.wishlist_items using (public.is_manager_or_admin(auth.uid()) or public.has_branch(auth.uid()));
alter policy "auth read gold prices" on public.gold_prices using (public.is_manager_or_admin(auth.uid()) or public.has_branch(auth.uid()));
alter policy "read settings for any authenticated user" on public.app_settings using (public.is_manager_or_admin(auth.uid()) or public.has_branch(auth.uid()));
alter policy "auth read activity" on public.activity_log using (public.is_manager_or_admin(auth.uid()) or public.has_branch(auth.uid()));
alter policy "auth read branches" on public.branches using (public.is_manager_or_admin(auth.uid()) or public.has_branch(auth.uid()));
alter policy "auth read categories" on public.categories using (public.is_manager_or_admin(auth.uid()) or public.has_branch(auth.uid()));
-- سياسات الكتابة الواسعة (auth.uid() IS NOT NULL) على الأحجار والشهادات وقائمة الأمنيات بنفس الشرط.
alter policy "auth manage certs" on public.product_certificates using (public.is_manager_or_admin(auth.uid()) or public.has_branch(auth.uid())) with check (public.is_manager_or_admin(auth.uid()) or public.has_branch(auth.uid()));
alter policy "auth manage stones" on public.product_stones using (public.is_manager_or_admin(auth.uid()) or public.has_branch(auth.uid())) with check (public.is_manager_or_admin(auth.uid()) or public.has_branch(auth.uid()));
alter policy "auth manage wishlist" on public.wishlist_items using (public.is_manager_or_admin(auth.uid()) or public.has_branch(auth.uid())) with check (public.is_manager_or_admin(auth.uid()) or public.has_branch(auth.uid()));
