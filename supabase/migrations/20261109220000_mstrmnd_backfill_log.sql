-- سجل التعبئة لمرة وحدة (9-11-2026): مشتريات أمارسوفت القديمة لأعضاء MSTRMND اللي ما تمسحتش، وتصحيح المبالغ
-- اللي الموظفين مسحوها غلط (300,000,000 / 19,000,000 / 2,000,000 / 38 بدل 3,800...). كل سطر عملية وحدة على MSTRMND:
-- reverse = إلغاء عملية الماسح الغلط، add = add-point بمبلغ أمارسوفت الصحيح. البيعات المضافة تسجّلت في mstrmnd_sync
-- (reason «شرية قديمة» / «تصحيح مبلغ قديم») باش لو الفاتورة انحذفت بعدين الربط ينقصها. 12 إلغاء + 17 إضافة، كلهم نجحوا.
create table if not exists public.mstrmnd_backfill (
  seq serial primary key, op text not null, customer_id text, customer_name text, card_id bigint, tx_id bigint, invoice_id bigint,
  amount numeric, note text, request_id bigint, http_status int, created_at timestamptz default now()
);
alter table public.mstrmnd_backfill enable row level security;
revoke all on public.mstrmnd_backfill from anon, authenticated;
