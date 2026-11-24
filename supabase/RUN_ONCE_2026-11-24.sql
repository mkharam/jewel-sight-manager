-- شغّله مرة وحدة في Supabase ← SQL Editor (نفس الملف supabase/migrations/20261124120000_auto_gold_price.sql).
-- يضيف: سعر الحوالة، قاعدة السعر التلقائي (18K = الخام + 440، 21K = الخام + 460، مقرّب لأقرب 50، الحوالة +50)،
-- سعر اليوم من المحاسب (18K 1400/1450، 21K 1600/1650)، والحساب التلقائي كل يوم 9:30 الصبح.

-- سعر المحل يتحسب كل يوم بروحه — ما فيش تسجيل يومي.
--
-- سعر بيع الجرام في المحل يمشي مع قيمة الذهب الخام (الأونصة العالمية × الدولار الموازي × العيار)
-- زائد هامش ثابت تقريباً: 18K كان 1450 لما الخام 1010 (9 سبتمبر) و1400 لما الخام 962 (24 نوفمبر) —
-- يعني الخام + 440 مقرّب لأقرب 50. و21K = الخام + 460 مقرّب لأقرب 50 (1600 في المرتين). الحوالة = الكاش + 50.
-- الأونصة والدولار الموازي يتجمعوا كل ساعة تلقائياً (market_rates)، فالسعر يتحسب الصبح كل يوم.
-- المدير يقدر يبدّل الهامش في أي وقت، ولو كتب سعر يوم بيده ما يتغطاش (source = 'manual').

alter table public.gold_prices add column if not exists transfer_price numeric;
alter table public.gold_prices add column if not exists source text not null default 'manual';

create table if not exists public.gold_price_rules (
  karat text primary key,
  margin numeric not null check (margin between 0 and 5000),
  transfer_extra numeric not null default 50 check (transfer_extra between 0 and 1000),
  round_to numeric not null default 50 check (round_to in (1, 5, 10, 25, 50, 100)),
  enabled boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table public.gold_price_rules enable row level security;
grant select, insert, update on public.gold_price_rules to authenticated;
drop policy if exists "read gold price rules" on public.gold_price_rules;
create policy "read gold price rules" on public.gold_price_rules for select to authenticated using (true);
drop policy if exists "admin edits gold price rules" on public.gold_price_rules;
create policy "admin edits gold price rules" on public.gold_price_rules for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

insert into public.gold_price_rules (karat, margin, transfer_extra, round_to) values
  ('18K', 440, 50, 50),
  ('21K', 460, 50, 50)
on conflict (karat) do nothing;

-- سعر اليوم اللي بعثه المحاسب للبائعين (24 نوفمبر 2026).
insert into public.gold_prices (karat, price_per_gram, transfer_price, making_charge, effective_date, source) values
  ('18K', 1400, 1450, 0, '2026-11-24', 'manual'),
  ('21K', 1600, 1650, 0, '2026-11-24', 'manual')
on conflict (karat, effective_date) do update
  set price_per_gram = excluded.price_per_gram, transfer_price = excluded.transfer_price, making_charge = 0, source = 'manual';

-- يحسب سعر اليوم لكل عيار مفعّل: الخام + الهامش، مقرّب، والحوالة فوقه. ما يغطيش سعر كتبه المدير بيده.
-- يرجّع كم عيار تحسب (0 = ما فيش أونصة ولا دولار موازي من آخر 3 أيام — يبقى آخر سعر).
create or replace function public.gold_prices_auto(p_day date default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  d date := coalesce(p_day, (now() at time zone 'Africa/Tripoli')::date);
  oz numeric; usd numeric; g24 numeric; purity numeric; cash numeric; n integer := 0; r record;
begin
  -- من التطبيق: المدير العام بس. المهمة المجدولة تشتغل بلا مستخدم.
  if auth.uid() is not null and not public.has_role(auth.uid(), 'admin') then
    raise exception 'admin only';
  end if;
  select xau_usd_oz into oz from market_rates where day <= d and xau_usd_oz is not null order by day desc limit 1;
  select usd_lyd_market into usd from market_rates
    where day <= d and day >= d - 3 and usd_lyd_market is not null order by day desc limit 1;
  if oz is null or usd is null then return 0; end if;
  g24 := oz / 31.1035 * usd;
  for r in select * from gold_price_rules where enabled loop
    purity := case r.karat when '18K' then 0.75 when '21K' then 0.875 when '22K' then 0.9167 when '24K' then 1 end;
    continue when purity is null;
    cash := round((g24 * purity + r.margin) / r.round_to) * r.round_to;
    insert into gold_prices (karat, price_per_gram, transfer_price, making_charge, effective_date, source)
    values (r.karat, cash, cash + r.transfer_extra, 0, d, 'auto')
    on conflict (karat, effective_date) do update
      set price_per_gram = excluded.price_per_gram, transfer_price = excluded.transfer_price
      where gold_prices.source = 'auto';
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.gold_prices_auto(date) from public, anon;
grant execute on function public.gold_prices_auto(date) to authenticated;

-- كل يوم 9:30 الصبح بتوقيت طرابلس (7:30 UTC) — قبل فتح المحلات، بآخر أونصة ودولار موازي.
select cron.unschedule('gold-prices-auto') where exists (select 1 from cron.job where jobname = 'gold-prices-auto');
select cron.schedule('gold-prices-auto', '30 7 * * *', $$select public.gold_prices_auto()$$);
