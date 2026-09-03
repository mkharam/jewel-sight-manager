create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
alter table public.product_images disable trigger analyze_product_image_on_insert;