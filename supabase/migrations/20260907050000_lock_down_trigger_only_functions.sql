-- تقوية أمنية: هذه الدوال تعمل حصرياً كمشغّلات triggers داخلية — لا تُستدعى مباشرةً
-- من الواجهة أو عبر .rpc() ولا تظهر في أي سياسة RLS. مشغّلات Trigger تعمل دائماً بغض
-- النظر عن صلاحيات EXECUTE للدور المُطلقة، لذا سحب هذا آمن ولا يؤثر على وظيفتها — تحقّقنا
-- منه تجريبياً بإدراج صف واختبار أن الـ trigger ما زال يعمل. لا نلمس دوال المساعدة
-- المستخدمة داخل RLS (has_role, has_branch, is_branch_manager, is_manager_or_admin,
-- current_user_branch_id) ولا الدوال المستدعاة من التطبيق عبر .rpc() (match_similar_products,
-- match_product_images, expire_due_reservations, return_sale, sku_type_letter, next_sku,
-- tags_from_ai_labels) حتى لا نكسر أي شيء في التطبيق.

revoke execute on function public.guard_product_changes() from public, anon, authenticated;
revoke execute on function public.guard_reservation_product() from public, anon, authenticated;
revoke execute on function public.guard_transfer_rules() from public, anon, authenticated;
revoke execute on function public.guard_transfer_status_transition() from public, anon, authenticated;
revoke execute on function public.log_activity() from public, anon, authenticated;
revoke execute on function public.log_luxury_activity() from public, anon, authenticated;
revoke execute on function public.log_product_movement() from public, anon, authenticated;
revoke execute on function public.log_reorder_activity() from public, anon, authenticated;
revoke execute on function public.sync_product_search_tags() from public, anon, authenticated;
revoke execute on function public.trigger_analyze_product_image() from public, anon, authenticated;
revoke execute on function public.trigger_push_new_inquiry() from public, anon, authenticated;
revoke execute on function public.trigger_push_new_reorder() from public, anon, authenticated;
revoke execute on function public.trigger_push_new_transfer() from public, anon, authenticated;
revoke execute on function public.apply_reservation_status() from public, anon, authenticated;
revoke execute on function public.apply_sale_status() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
