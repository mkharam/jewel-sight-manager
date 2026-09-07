-- إضافة فهارس آمنة تماماً (CREATE INDEX فقط) على كل المفاتيح الأجنبية غير المفهرسة التي
-- رصدها مستشار الأداء — تُسرّع عمليات JOIN/فلترة شائعة (مثال: تحويلات فرع، طلبات موظف،
-- مبيعات عميل) دون أي خطر على البيانات أو المنطق الحالي.

create index if not exists idx_customer_inquiries_created_by on public.customer_inquiries(created_by);
create index if not exists idx_customer_inquiries_product_id on public.customer_inquiries(product_id);
create index if not exists idx_customers_branch_id on public.customers(branch_id);
create index if not exists idx_customers_created_by on public.customers(created_by);
create index if not exists idx_gold_prices_updated_by on public.gold_prices(updated_by);
create index if not exists idx_product_images_uploaded_by on public.product_images(uploaded_by);
create index if not exists idx_product_quotes_branch_id on public.product_quotes(branch_id);
create index if not exists idx_product_quotes_quoted_by on public.product_quotes(quoted_by);
create index if not exists idx_reorder_requests_branch_id on public.product_reorder_requests(branch_id);
create index if not exists idx_reorder_requests_handled_by on public.product_reorder_requests(handled_by);
create index if not exists idx_reorder_requests_requested_by on public.product_reorder_requests(requested_by);
create index if not exists idx_products_created_by on public.products(created_by);
create index if not exists idx_products_last_verified_by on public.products(last_verified_by);
create index if not exists idx_products_supplier_id on public.products(supplier_id);
create index if not exists idx_products_updated_by on public.products(updated_by);
create index if not exists idx_profiles_branch_id on public.profiles(branch_id);
create index if not exists idx_reservations_branch_id on public.reservations(branch_id);
create index if not exists idx_reservations_created_by on public.reservations(created_by);
create index if not exists idx_reservations_customer_id on public.reservations(customer_id);
create index if not exists idx_sales_customer_id on public.sales(customer_id);
create index if not exists idx_sales_returned_by on public.sales(returned_by);
create index if not exists idx_sales_sold_by on public.sales(sold_by);
create index if not exists idx_stock_take_items_checked_by on public.stock_take_items(checked_by);
create index if not exists idx_stock_take_items_product_id on public.stock_take_items(product_id);
create index if not exists idx_stock_take_sessions_branch_id on public.stock_take_sessions(branch_id);
create index if not exists idx_stock_take_sessions_closed_by on public.stock_take_sessions(closed_by);
create index if not exists idx_stock_take_sessions_started_by on public.stock_take_sessions(started_by);
create index if not exists idx_transfers_approved_by on public.transfers(approved_by);
create index if not exists idx_transfers_product_id on public.transfers(product_id);
create index if not exists idx_transfers_received_by on public.transfers(received_by);
create index if not exists idx_transfers_requested_by on public.transfers(requested_by);
create index if not exists idx_wishlist_items_created_by on public.wishlist_items(created_by);
create index if not exists idx_wishlist_items_customer_id on public.wishlist_items(customer_id);
create index if not exists idx_wishlist_items_product_id on public.wishlist_items(product_id);
