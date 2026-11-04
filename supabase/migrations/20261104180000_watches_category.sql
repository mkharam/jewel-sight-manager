-- Watches: Amarsoft has no watch stock (its "diamonds and watches" account is empty), so watches are
-- entered in the app as products in their own category, with photo and price, and listed on /watches.
insert into public.categories (name, name_en, sort_order)
select 'ساعات', 'Watches', 7
where not exists (select 1 from public.categories where name = 'ساعات');
