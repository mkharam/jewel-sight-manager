-- شغّله مرة وحدة في Supabase ← SQL Editor. فيه: سعر المحل التلقائي، وقراءة «بكم» (الذهب والعملات والصكوك والحوالات) كل 10 دقايق.
-- بعدها: صفحة الذهب ← «السوق اليوم» ← «ربط بكم» ← الصق PHPSESSID واضغط حفظ.

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

-- أسعار السوق من «بكم» تلقائياً: الكسر، الخارجي، والمسبوك — بدخول حساب المحل في bekam.net (جلسة PHPSESSID).
-- كل 10 دقايق نقراو صفحة «ذهب و فضة» (items.php?id=71) ونسجّلو الأسعار في ly_gold_market (source = 'bekam')
-- لو تبدّلت. القراية كل 10 دقايق تخلي الجلسة حيّة (PHP يقفلها بعد ~24 دقيقة بلا استعمال).
-- لو الجلسة انتهت (بكم رجّعنا للرئيسية) نسجّلو الغلط في bekam_auth، والصفحة تقول للمدير يحط كوكي جديد.

create table if not exists public.bekam_auth (
  id int primary key default 1 check (id = 1),
  cookie text not null,
  last_ok_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
alter table public.bekam_auth enable row level security;
-- ما فيش قراءة للكوكي من التطبيق؛ الحالة بس عبر bekam_status().
revoke all on public.bekam_auth from anon, authenticated;

create table if not exists public.bekam_requests (id bigint primary key, created_at timestamptz not null default now());
alter table public.bekam_requests enable row level security;
revoke all on public.bekam_requests from anon, authenticated;

-- كل أسعار «بكم» اللي نقراوها: الذهب، العملات (موازي نقداً)، الحوالات، والصكوك — آخر سعر لكل بند.
-- sell/buy للعملات (بيع/شراء)، value للبنود اللي عندها رقم واحد (الذهب، السحب…). bekam_at = وقت تحديثه في «بكم».
create table if not exists public.bekam_prices (
  page text not null,            -- gold | cash | transfer | cheque
  item text not null,
  sell numeric, buy numeric, value numeric, unit text,
  bekam_at timestamp,
  fetched_at timestamptz not null default now(),
  primary key (page, item)
);
alter table public.bekam_prices enable row level security;
grant select on public.bekam_prices to authenticated;
drop policy if exists "read bekam prices" on public.bekam_prices;
create policy "read bekam prices" on public.bekam_prices for select to authenticated using (true);
alter table public.bekam_requests add column if not exists page text;

create or replace function public.bekam_collect() returns void
language plpgsql security definer set search_path = public as $$
declare r record; t text; m text[]; ck text; usd numeric;
  k18 numeric; k21 numeric; x18 numeric; x21 numeric; m18 numeric; m24 numeric; last record;
begin
  for r in select q.id, q.page, h.status_code, h.content from bekam_requests q join net._http_response h on h.id = q.id loop
    begin
      -- الصفحة ← بنود مفصولة بـ «|»: «|اسم|2026-11-24 15:13:58|965.000 د.ل|» ولا «|اسم|التاريخ|بيع|11.15 د.ل|شراء|11.16 د.ل|».
      t := regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(r.content, ''),
             '<script.*?</script>', '', 'g'), '<style.*?</style>', '', 'g'), '<[^>]+>', '|', 'g'), '\s*\|[\s|]*', '|', 'g');
      if r.status_code = 200 and t like '%' || '|20%' then
        for m in select x from regexp_matches(t,
            '\|([^|]+)\|(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\|(?:بيع\|([0-9.,]+)[^|]*\|شراء\|([0-9.,]+)[^|]*|([0-9.,]+) ?([^|]*))', 'g') x loop
          insert into bekam_prices (page, item, sell, buy, value, unit, bekam_at, fetched_at)
          values (r.page, trim(m[1]), replace(m[3], ',', '')::numeric, replace(m[4], ',', '')::numeric,
                  replace(m[5], ',', '')::numeric, nullif(trim(m[6]), ''), m[2]::timestamp, now())
          on conflict (page, item) do update set sell = excluded.sell, buy = excluded.buy, value = excluded.value,
            unit = excluded.unit, bekam_at = excluded.bekam_at, fetched_at = now();
        end loop;
        update bekam_auth set last_ok_at = now(), last_error = null where id = 1;
      elsif r.status_code = 200 or r.status_code in (301, 302) then
        update bekam_auth set last_error = 'الدخول لبكم انتهى — حط كوكي PHPSESSID جديد' where id = 1;
      else
        update bekam_auth set last_error = 'بكم ما ردّش (' || coalesce(r.status_code::text, '?') || ')' where id = 1;
      end if;
    exception when others then
      update bekam_auth set last_error = left(sqlerrm, 200) where id = 1;
    end;
    delete from bekam_requests where id = r.id;
  end loop;

  -- الذهب في سجل السوق (للصفحة والرسم) — بس لو حاجة تبدّلت.
  select value into k18 from bekam_prices where page = 'gold' and item = 'ذهب كسر 18';
  select value into k21 from bekam_prices where page = 'gold' and item = 'ذهب كسر 21';
  select value into x18 from bekam_prices where page = 'gold' and item = 'ذهب خارجي 18';
  select value into x21 from bekam_prices where page = 'gold' and item = 'ذهب خارجي 21';
  select value into m18 from bekam_prices where page = 'gold' and item = 'ذهب مسبوك 18';
  select value into m24 from bekam_prices where page = 'gold' and item = 'ذهب مسبوك 24';
  if coalesce(k18, k21, x18, x21) is not null then
    select * into last from ly_gold_market where source = 'bekam' order by observed_at desc limit 1;
    if last is null or last.kasr18 is distinct from k18 or last.kasr21 is distinct from k21 or last.kharji18 is distinct from x18
       or last.kharji21 is distinct from x21 or last.masbook18 is distinct from m18 or last.masbook24 is distinct from m24 then
      insert into ly_gold_market (url, observed_at, kasr18, kasr21, kharji18, kharji21, masbook18, masbook24, source, recorded_by)
      values ('bekam:' || to_char(now(), 'YYYYMMDDHH24MISS'), now(), k18, k21, x18, x21, m18, m24, 'bekam', null)
      on conflict (url) do nothing;
    end if;
  end if;
  -- الدولار الموازي نقداً من «بكم» (أحدث من باقي المصادر) — لحساب الخام وسعر المحل. ما يغطيش سعر كتبه المدير بيده.
  select sell into usd from bekam_prices where page = 'cash' and item = 'دولار أمريكي' and bekam_at > now() - interval '2 days';
  if usd between 4 and 30 then
    insert into market_rates (day, usd_lyd_market, market_source) values ((now() at time zone 'Africa/Tripoli')::date, usd, 'bekam')
    on conflict (day) do update set usd_lyd_market = excluded.usd_lyd_market, market_source = 'bekam', updated_at = now()
    where market_rates.market_source is distinct from 'manual';
  end if;

  delete from bekam_requests where created_at < now() - interval '1 hour';
  select cookie into ck from bekam_auth where id = 1;
  if ck is not null then
    insert into bekam_requests (id, page)
    select net.http_get(u, headers := jsonb_build_object('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Cookie', ck),
                        timeout_milliseconds := 20000), pg
    from (values ('https://bekam.net/cp/items.php?id=71', 'gold'), ('https://bekam.net/cp/items.php?id=29&type_id=1', 'cash'),
                 ('https://bekam.net/cp/items.php?id=29&type_id=2', 'transfer'), ('https://bekam.net/cp/items.php?id=29&type_id=3', 'cheque')) v(u, pg);
  end if;
end $$;
revoke all on function public.bekam_collect() from public, anon, authenticated;

-- حالة الربط للصفحة (بلا الكوكي نفسه).
create or replace function public.bekam_status() returns table (connected boolean, last_ok_at timestamptz, last_error text)
language sql security definer set search_path = public stable as $$
  select cookie is not null, last_ok_at, last_error from bekam_auth where id = 1
$$;
grant execute on function public.bekam_status() to authenticated;

-- المدير العام يحط كوكي جديد من التطبيق لما الدخول ينتهي.
create or replace function public.bekam_set_cookie(p_cookie text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  insert into bekam_auth (id, cookie, last_error, updated_at) values (1, trim(p_cookie), null, now())
  on conflict (id) do update set cookie = excluded.cookie, last_error = null, updated_at = now();
end $$;
revoke all on function public.bekam_set_cookie(text) from public, anon;
grant execute on function public.bekam_set_cookie(text) to authenticated;

select cron.unschedule('bekam-collect') where exists (select 1 from cron.job where jobname = 'bekam-collect');
select cron.schedule('bekam-collect', '*/10 * * * *', $$select public.bekam_collect()$$);
