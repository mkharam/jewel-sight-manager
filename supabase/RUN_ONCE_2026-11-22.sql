-- انسخ كل هذا الملف والصقه في Supabase ← SQL Editor ← New query ← Run (مرة وحدة — ولو تعاود تشغّله ما يضرش).
-- ١) الأرباح الحقيقية بسعر الذهب التلقائي.  ٢) تنظيف سجل المهام المجدولة.
-- ٣) «الذهب والسوق»: أسعار المنافسين، وأسعار السوق من «بكم» (كسر، خارجي، مسبوك).
-- ٤) «تسجيل الزبائن»: كل فرع وبائع يسجّل اسم ورقم الزبون في الفواتير ولا لا (يدخل في التقييم).
-- ٥) التقييم: المشرف يقيّم موظفينه كل يوم، والموظفين مرتين في الشهر.
-- الأرباح الحقيقية لكل فرع وعيار (للمدير العام فقط): قيمة البيع − قيمة الذهب الخام يوم البيع
-- (الأونصة ÷ 31.1035 × الدولار الموازي، من market_rates) − مصنعية المورّد (تكلفة القطعة في مخزون
-- أمارسوفت = مصنعية المورّد فقط، لأن الذهب يتبادل وزن بوزن). بدل خانة «سعر الذهب الخام» اللي كان
-- المدير يكتبها بيده. الأيام اللي ما لهاش سعر دولار موازي ما تدخلش في حساب الربح (valued_*).
create or replace function public.amarsoft_profit_summary(p_start timestamptz, p_end timestamptz, p_karat text default null)
returns table (branch_code text, branch_name text, karat text, invoices bigint, grams numeric, pure_grams numeric,
  sales_lyd numeric, valued_grams numeric, valued_sales_lyd numeric, gold_lyd numeric, making_cost_lyd numeric, costed_grams numeric)
language sql stable security definer set search_path = public as $$
  with lines as (
    select a.id, a.branch_code, a.kind, case when a.kind = 'return' then -1 else 1 end sgn,
      (a.sold_at at time zone 'Africa/Tripoli')::date d,
      coalesce(round((i->>'purity')::numeric * 24)::int::text, '?') karat,
      coalesce((i->>'grams')::numeric, 0) g, coalesce((i->>'pure_grams')::numeric, 0) pg,
      abs(coalesce((i->>'amount_dirhams')::numeric, 0)) / 1000 amt,
      st.cost_dirhams / 1000.0 cost
    from amarsoft_invoices a
    cross join jsonb_array_elements(a.items) i
    left join amarsoft_stock st on st.branch_code = a.branch_code and st.tag = i->>'tag'
    where public.has_role(auth.uid(), 'admin')
      and not a.is_deleted and a.sold_at >= p_start and a.sold_at < p_end
  ), rate as (
    select d, public.gold_lyd_per_pure_gram(d) g24 from (select distinct d from lines) x
  )
  select l.branch_code, b.name, l.karat,
    count(distinct l.id) filter (where l.kind = 'sale'),
    round(sum(l.sgn * l.g), 2), round(sum(l.sgn * l.pg), 3), round(sum(l.sgn * l.amt), 0),
    round(coalesce(sum(l.sgn * l.g) filter (where r.g24 is not null), 0), 2),
    round(coalesce(sum(l.sgn * l.amt) filter (where r.g24 is not null), 0), 0),
    round(coalesce(sum(l.sgn * l.pg * r.g24) filter (where r.g24 is not null), 0), 0),
    round(coalesce(sum(l.sgn * l.cost) filter (where r.g24 is not null and l.cost is not null), 0), 0),
    round(coalesce(sum(l.sgn * l.g) filter (where r.g24 is not null and l.cost is not null), 0), 2)
  from lines l
  join rate r on r.d = l.d
  join amarsoft_branch_map m on m.code = l.branch_code
  join branches b on b.id = m.branch_id
  where p_karat is null or l.karat = p_karat
  group by l.branch_code, b.name, l.karat
  order by l.branch_code, l.karat;
$$;
revoke all on function public.amarsoft_profit_summary(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.amarsoft_profit_summary(timestamptz, timestamptz, text) to authenticated;

-- سجل تشغيل المهام المجدولة يكبر بلا حد (أكثر من 40MB): نخلي آخر 3 أيام بس، وننظفه يومياً.
delete from cron.job_run_details where end_time < now() - interval '3 days';
select cron.unschedule('cron-history-cleanup') where exists (select 1 from cron.job where jobname = 'cron-history-cleanup');
select cron.schedule('cron-history-cleanup', '23 3 * * *', $$delete from cron.job_run_details where end_time < now() - interval '3 days'$$);

-- ═══════════════════════════════ ٣) الذهب والسوق ═══════════════════════════════
-- «الذهب والسوق»: أسعار المنافسين (يسجّلها المدير/المشرف) + سعر الكسر في سوق طرابلس (تلقائي كل ساعة
-- من قسم «أسعار الذهب» في أخبار ليبيا — libyaakhbar.com، اللي ينقل أسعار السوق الموازي يومياً) + أسعار
-- السوق اللي يسجّلها المدير من تطبيق «بكم» (الذهب الخارجي والمسبوك — ما يتنشروش مجاناً في أي مكان).

-- ١) أسعار المنافسين: سعر الجرام اللي يبيع بيه محل ثاني (أو يشري بيه الكسر). يسجّله المدير العام أو
-- المشرف أو مدير الفرع لما يسمع أو يشوف سعر. المقارنة تصير بـ«كم فوق الذهب الخام يوم السعر» حتى ما
-- يأثرش طلوع ونزول الذهب على المقارنة.
create table if not exists public.competitor_prices (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  shop text not null check (length(btrim(shop)) between 1 and 80),
  area text check (area is null or length(area) <= 80),
  karat text not null check (karat in ('18', '21', '24')),
  kind text not null default 'sale' check (kind in ('sale', 'scrap')),
  price_per_gram numeric not null check (price_per_gram between 50 and 20000),
  note text check (note is null or length(note) <= 300),
  recorded_by uuid default auth.uid() references public.profiles(id) on delete set null
);
create index if not exists competitor_prices_created_idx on public.competitor_prices (created_at desc);
create index if not exists competitor_prices_recorded_by_idx on public.competitor_prices (recorded_by);
alter table public.competitor_prices enable row level security;
grant select, insert, delete on public.competitor_prices to authenticated;
drop policy if exists "leads read competitor prices" on public.competitor_prices;
create policy "leads read competitor prices" on public.competitor_prices for select to authenticated
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'supervisor') or public.has_role(auth.uid(), 'manager'));
drop policy if exists "leads add competitor prices" on public.competitor_prices;
create policy "leads add competitor prices" on public.competitor_prices for insert to authenticated
  with check (recorded_by = auth.uid()
    and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'supervisor') or public.has_role(auth.uid(), 'manager')));
drop policy if exists "own or admin delete competitor prices" on public.competitor_prices;
create policy "own or admin delete competitor prices" on public.competitor_prices for delete to authenticated
  using (recorded_by = auth.uid() or public.has_role(auth.uid(), 'admin'));

-- ٢) أسعار السوق: سعر الكسر في طرابلس (اللي يدفعوه التجار في جرام الذهب المستعمل، كاش) — صف لكل خبر،
-- والخبر اللي ما فيهش أسعار ينحفظ فارغ حتى ما نرجعوش نجيبوه. ومعاه صفوف يسجّلها المدير من تطبيق «بكم»:
-- ذهب خارجي 18/21 (سعر جرام الذهب المستورد المشغول في السوق) ومسبوك 18/24 (url = 'manual:…').
create table if not exists public.ly_gold_market (
  url text primary key,
  observed_at timestamptz not null,
  kasr18 numeric,
  kasr21 numeric,
  kasr24 numeric,
  fetched_at timestamptz not null default now()
);
alter table public.ly_gold_market add column if not exists kharji18 numeric;
alter table public.ly_gold_market add column if not exists kharji21 numeric;
alter table public.ly_gold_market add column if not exists masbook18 numeric;
alter table public.ly_gold_market add column if not exists masbook24 numeric;
alter table public.ly_gold_market add column if not exists source text not null default 'libyaakhbar';
alter table public.ly_gold_market add column if not exists recorded_by uuid default auth.uid() references public.profiles(id) on delete set null;
create index if not exists ly_gold_market_observed_idx on public.ly_gold_market (observed_at desc);
alter table public.ly_gold_market enable row level security;
grant select, insert, delete on public.ly_gold_market to authenticated;
drop policy if exists "read ly gold market" on public.ly_gold_market;
create policy "read ly gold market" on public.ly_gold_market for select to authenticated using (true);
drop policy if exists "leads add market prices" on public.ly_gold_market;
create policy "leads add market prices" on public.ly_gold_market for insert to authenticated
  with check (source = 'bekam' and url like 'manual:%' and recorded_by = auth.uid()
    and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'supervisor') or public.has_role(auth.uid(), 'manager')));
drop policy if exists "own or admin delete market prices" on public.ly_gold_market;
create policy "own or admin delete market prices" on public.ly_gold_market for delete to authenticated
  using (source = 'bekam' and (recorded_by = auth.uid() or public.has_role(auth.uid(), 'admin')));

alter table public.market_rate_requests add column if not exists url text;

-- ٣) نفس جامع الأسعار (كل ساعة) + خطوتين لسعر الكسر: يجيب قائمة الأخبار، وبعدين الأخبار الجديدة.
create or replace function public.market_rates_collect() returns void
language plpgsql security definer set search_path = public as $$
declare r record; body jsonb; txt text; v numeric; d date; today date := (now() at time zone 'Africa/Tripoli')::date;
  p text; u text; pub timestamptz; k18 numeric; k21 numeric; k24 numeric;
begin
  for r in select q.id, q.kind, q.url, h.content, h.status_code from market_rate_requests q join net._http_response h on h.id = q.id loop
    begin
      if r.status_code = 200 and r.kind = 'gold' then
        body := r.content::jsonb;
        insert into market_rates(day, xau_usd_oz) values (today, (body->>'price')::numeric)
        on conflict (day) do update set xau_usd_oz = excluded.xau_usd_oz, updated_at = now();
      elsif r.status_code = 200 and r.kind = 'fx' then
        body := r.content::jsonb;
        insert into market_rates(day, usd_lyd_official) values (today, (body->'rates'->>'LYD')::numeric)
        on conflict (day) do update set usd_lyd_official = excluded.usd_lyd_official, updated_at = now();
      elsif r.status_code = 200 and r.kind = 'parallel_api' then
        -- آخر 10 قيم يومية من المنصة (تغطي أي أيام فاتت).
        for d, v in select (x->>'period_start')::date, (x->>'value')::numeric
                    from jsonb_array_elements(r.content::jsonb->'data') x
                    order by (x->>'period_start')::date desc limit 10 loop
          if v between 4 and 30 then
            insert into market_rates(day, usd_lyd_market, market_source) values (d, v, 'ecolibya')
            on conflict (day) do update set usd_lyd_market = excluded.usd_lyd_market, market_source = 'ecolibya', updated_at = now()
            where market_rates.market_source is distinct from 'manual';
          end if;
        end loop;
      elsif r.status_code = 200 and r.kind = 'parallel' then
        -- احتياط: صفحة عين ليبيا (لو المنصة ما حدّثتش اليوم). أول مُكمِّم في تعبير Postgres يحدد
        -- الجشع للتعبير كله، فلا مُكمِّم كسول هنا.
        txt := regexp_replace(regexp_replace(r.content, '<[^>]+>', ' ', 'g'), '\s+', ' ', 'g');
        v := substring(txt from 'السوق الموازي[^0-9]{0,120}الدولار ([0-9]+\.?[0-9]*)')::numeric;
        if v between 4 and 30 then
          insert into market_rates(day, usd_lyd_market, market_source) values (today, v, 'eanlibya')
          on conflict (day) do update set usd_lyd_market = excluded.usd_lyd_market, market_source = 'eanlibya', updated_at = now()
          where market_rates.usd_lyd_market is null;
        end if;
      elsif r.status_code = 200 and r.kind = 'ly_gold_list' then
        -- أحدث 8 أخبار في قسم «أسعار الذهب»؛ نطلبو بس اللي ما شفناهاش قبل.
        for p in select x.m[1] from (
                   select t.m, min(t.o) o
                   from regexp_matches(r.content, 'libyaakhbar\.com/([a-z-]+/[0-9]+)\.html', 'g') with ordinality as t(m, o)
                   group by t.m) x
                 order by x.o limit 8 loop
          u := 'https://www.libyaakhbar.com/' || p || '.html';
          if not exists (select 1 from ly_gold_market where url = u) and not exists (select 1 from market_rate_requests where url = u) then
            insert into market_rate_requests(id, kind, url)
            values (net.http_get(u, headers := '{"User-Agent":"Mozilla/5.0"}'::jsonb, timeout_milliseconds := 20000), 'ly_gold_article', u);
          end if;
        end loop;
      elsif r.status_code = 200 and r.kind = 'ly_gold_article' then
        -- «كسر الذهب عيار 18 = 890 د.ل» / «ذهب كسر (عيار 18) 895 دينار» / «الكسر عيار 18 نحو 933 دينارًا».
        txt := regexp_replace(regexp_replace(r.content, '<[^>]+>', ' ', 'g'), '\s+', ' ', 'g');
        pub := coalesce(substring(r.content from 'article:published_time" content="([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}[+-][0-9:]{5})"')::timestamptz, now());
        k18 := substring(txt from 'كسر[^0-9]{0,25}18[^0-9]{1,12}([0-9]{3,4}(\.[0-9]+)?)')::numeric;
        k21 := substring(txt from 'كسر[^0-9]{0,25}21[^0-9]{1,12}([0-9]{3,4}(\.[0-9]+)?)')::numeric;
        k24 := substring(txt from 'كسر[^0-9]{0,25}24[^0-9]{1,12}([0-9]{3,4}(\.[0-9]+)?)')::numeric;
        if not (k18 between 300 and 5000) then k18 := null; end if;
        if not (k21 between 300 and 6000) or k21 <= k18 then k21 := null; end if;
        if not (k24 between 300 and 7000) or k24 <= k18 then k24 := null; end if;
        insert into ly_gold_market(url, observed_at, kasr18, kasr21, kasr24) values (r.url, pub, k18, k21, k24)
        on conflict (url) do nothing;
      end if;
    exception when others then null;
    end;
    delete from market_rate_requests where id = r.id;
  end loop;
  delete from market_rate_requests where created_at < now() - interval '1 day';
  delete from ly_gold_market where source = 'libyaakhbar' and kasr18 is null and kasr21 is null and kasr24 is null and fetched_at < now() - interval '30 days';
  insert into market_rate_requests(id, kind) values (net.http_get('https://api.gold-api.com/price/XAU'), 'gold');
  insert into market_rate_requests(id, kind) values (net.http_get('https://open.er-api.com/v6/latest/USD'), 'fx');
  insert into market_rate_requests(id, kind) values (net.http_get('https://ecolibya.com/api/public/v1/indicators/LY-EXT-MKT-USDPAR/values?limit=1000', headers := '{"User-Agent":"Mozilla/5.0"}'::jsonb), 'parallel_api');
  insert into market_rate_requests(id, kind) values (net.http_get('https://www.eanlibya.com/exchangerate/', headers := '{"User-Agent":"Mozilla/5.0"}'::jsonb), 'parallel');
  -- أخبار ليبيا ترفض طلبات سيرفر Supabase (حماية Cloudflare ضد البرامج) — فما نطلبوهاش. سعر الكسر
  -- يجي من تسجيل المدير من تطبيق «بكم»، والأسطر اللي فوق تبقى لو المصدر انفتح يوم.
end $$;
revoke all on function public.market_rates_collect() from public, anon, authenticated;

-- أسعار الكسر لآخر 3 أيام (من نفس الأخبار) حتى الصفحة تبدا بأرقام.
insert into public.ly_gold_market(url, observed_at, kasr18, kasr21, kasr24) values
('https://www.libyaakhbar.com/business-news/2922872.html', '2026-11-21T22:04:02+02:00', 908, null, null),
('https://www.libyaakhbar.com/breaking/2922648.html', '2026-11-21T16:43:14+02:00', 890, 1036, 1190),
('https://www.libyaakhbar.com/business-news/2922473.html', '2026-11-21T13:08:29+02:00', 898, null, null),
('https://www.libyaakhbar.com/business-news/2922423.html', '2026-11-21T11:49:03+02:00', null, null, null),
('https://www.libyaakhbar.com/breaking/2922221.html', '2026-11-20T22:13:39+02:00', null, null, null),
('https://www.libyaakhbar.com/business-news/2921948.html', '2026-11-20T12:39:02+02:00', 930, 1085, null),
('https://www.libyaakhbar.com/business-news/2921618.html', '2026-11-19T18:22:29+02:00', 933, null, null),
('https://www.libyaakhbar.com/business-news/2921459.html', '2026-11-19T15:49:56+02:00', 950, 1108, null),
('https://www.libyaakhbar.com/business-news/2921389.html', '2026-11-19T14:29:17+02:00', 948, 1106, null),
('https://www.libyaakhbar.com/business-news/2921149.html', '2026-11-19T01:10:42+02:00', 958, null, null)
on conflict (url) do nothing;
-- أسعار «بكم» اللي بعتها المدير (السبت 21 نوفمبر 6:33 م).
insert into public.ly_gold_market(url, observed_at, kasr18, kasr21, kharji18, kharji21, masbook18, masbook24, source, recorded_by) values
('manual:bekam-2026-11-21-1833', '2026-11-21T18:33:00+02:00', 906, 1057, 1250, 1350, 921, 1227, 'bekam', null)
on conflict (url) do nothing;

select public.market_rates_collect();

-- ═══════════════════════════════ ٤) تسجيل الزبائن ═══════════════════════════════
-- «تسجيل الزبائن»: لكل فرع وبائع — كم فاتورة بيع فيها اسم الزبون، وكم فيها رقمه (للمدير العام فقط).
-- اسم حقيقي = 3 حروف على الأقل ومش كلمة عامة («ذهب مسبوك»، «زبون»، «نقدي»…).
-- رقم حقيقي = رقم موبايل ليبي (09x xxx xxxx، أو بـ218 في الأول).
create or replace function public.amarsoft_customer_capture(p_start timestamptz, p_end timestamptz)
returns table (branch_code text, branch_name text, sman text, salesman_name text, is_store boolean,
  invoices bigint, with_name bigint, with_phone bigint, with_both bigint)
language sql stable security definer set search_path = public as $$
  with inv as (
    select a.branch_code, coalesce(a.sman, '') sman,
      length(regexp_replace(coalesce(a.details->>'customer', ''), '[^A-Za-zء-ي]', '', 'g')) >= 3
        and btrim(coalesce(a.details->>'customer', '')) !~* '^(ذهب|مسبوك|كسر|زبون|زبونة|زبونه|عميل|نقدي|نقدا|كاش|cash|customer|guest)' as has_name,
      regexp_replace(coalesce(a.details->>'phone', ''), '[^0-9]', '', 'g') ~ '^(00218|218|0)?9[1-6][0-9]{7}$' as has_phone
    from amarsoft_invoices a
    where public.has_role(auth.uid(), 'admin')
      and a.kind = 'sale' and not a.is_deleted and a.sold_at >= p_start and a.sold_at < p_end
  )
  select i.branch_code, b.name, i.sman, coalesce(s.name, nullif(i.sman, ''), 'بلا بائع'),
    public.amarsoft_is_store_sman(i.branch_code, i.sman),
    count(*), count(*) filter (where i.has_name), count(*) filter (where i.has_phone), count(*) filter (where i.has_name and i.has_phone)
  from inv i
  join amarsoft_branch_map m on m.code = i.branch_code
  join branches b on b.id = m.branch_id
  left join amarsoft_salesmen s on s.branch_code = i.branch_code and s.sman = i.sman
  group by 1, 2, 3, 4, 5
  order by 1, 3;
$$;
revoke all on function public.amarsoft_customer_capture(timestamptz, timestamptz) from public, anon;
grant execute on function public.amarsoft_customer_capture(timestamptz, timestamptz) to authenticated;

-- ═══════════════════════════════ ٥) التقييم اليومي ونص الشهر ═══════════════════════════════
-- التقييم: المشرف يقيّم موظفينه كل يوم، والموظفين (تقييمهم لنفسهم ولمشرفهم) مرتين في الشهر:
-- من 1 لـ 15، ومن 16 لآخر الشهر. تقييم المشرف لنفسه برضو مرتين في الشهر. المدير العام شهري.
--  * period = اليوم (تقييم المشرف اليومي)، ولا أول النص (1 ولا 16)، ولا أول الشهر (المدير العام).
--  * month يبقى = أول شهر الفترة — اللوحة الشهرية تخدم زي ما هي.
alter table public.staff_evaluations add column if not exists period date;
update public.staff_evaluations set period = month where period is null;
alter table public.staff_evaluations alter column period set not null;
alter table public.staff_evaluations drop constraint if exists staff_evaluations_month_kind_evaluator_id_subject_id_key;
create unique index if not exists staff_evaluations_period_key on public.staff_evaluations (period, kind, evaluator_id, subject_id);
create index if not exists staff_evaluations_period_idx on public.staff_evaluations (period);

-- أمان: الشهر دايماً من الفترة.
create or replace function public.staff_evaluations_period() returns trigger language plpgsql as $$
begin
  new.period := coalesce(new.period, new.month);
  new.month := date_trunc('month', new.period)::date;
  return new;
end $$;
drop trigger if exists staff_evaluations_period on public.staff_evaluations;
create trigger staff_evaluations_period before insert or update on public.staff_evaluations
  for each row execute function public.staff_evaluations_period();

-- إرسال التقييم: p = { day: 'YYYY-MM-DD', evaluator_id, entries: [{ kind, subject_id, scores, strengths, improvements, notes }] }
-- (النسخ القديمة تبعت month بدل day — تتقبل). من الرابط: اليوم ولا آخر 3 أيام؛ المسؤول من التطبيق: لين سنة.
create or replace function public.eval_submit(p_token text, p jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  is_rec boolean := public.is_eval_admin(auth.uid());
  v_today date := (now() at time zone 'Africa/Tripoli')::date;
  v_day date := coalesce((p->>'day')::date, (p->>'month')::date, (now() at time zone 'Africa/Tripoli')::date);
  v_half date;
  v_period date;
  v_evaluator uuid := (p->>'evaluator_id')::uuid;
  e jsonb;
  v_avg numeric;
  n int := 0;
begin
  if not is_rec and (p_token is null or p_token <> (select link_token from eval_config)) then
    raise exception 'الرابط غير صالح — اطلب رابط جديد';
  end if;
  if not exists (select 1 from eval_staff where id = v_evaluator and active) then
    raise exception 'اختار اسمك من القائمة';
  end if;
  if v_day > v_today or v_day < v_today - (case when is_rec and p_token is null then 365 else 3 end) then
    raise exception 'التاريخ غير صالح — التقييم لليوم ولا آخر 3 أيام بس';
  end if;
  v_half := case when extract(day from v_day) <= 15 then date_trunc('month', v_day)::date
                 else (date_trunc('month', v_day) + interval '15 days')::date end;
  for e in select * from jsonb_array_elements(coalesce(p->'entries', '[]')) loop
    -- تقييم المدير العام من داخل التطبيق بس، وباسم صف المدير العام.
    if e->>'kind' = 'by_gm' and (not is_rec or not exists (select 1 from eval_staff where id = v_evaluator and role = 'gm')) then
      raise exception 'تقييم المدير العام من لوحة التقييم بس';
    end if;
    select round(avg(v::numeric), 2) into v_avg
    from jsonb_each_text(coalesce(e->'scores', '{}')) as s(k, v) where v ~ '^[1-5]$';
    if v_avg is null then continue; end if;
    v_period := case e->>'kind' when 'by_manager' then v_day when 'by_gm' then date_trunc('month', v_day)::date else v_half end;
    insert into staff_evaluations (period, month, kind, evaluator_id, subject_id, scores, overall, strengths, improvements, notes, source, entered_by)
    values (v_period, date_trunc('month', v_period)::date, e->>'kind', v_evaluator,
            case when e->>'kind' = 'self' then v_evaluator else (e->>'subject_id')::uuid end,
            e->'scores', v_avg, nullif(e->>'strengths', ''), nullif(e->>'improvements', ''), nullif(e->>'notes', ''),
            case when is_rec and p_token is null then 'recorder' else 'link' end, auth.uid())
    on conflict (period, kind, evaluator_id, subject_id) do update
      set scores = excluded.scores, overall = excluded.overall, strengths = excluded.strengths,
          improvements = excluded.improvements, notes = excluded.notes, source = excluded.source,
          entered_by = excluded.entered_by, updated_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.eval_submit(text, jsonb) from public;
grant execute on function public.eval_submit(text, jsonb) to anon, authenticated;

-- شن سلّم اللي يقيّم: مين قيّم في اليوم (للمشرف)، وهل قيّم نفسه/مشرفه في نص الشهر — نعم/لا بس، بلا درجات.
create or replace function public.eval_status(p_token text, p_evaluator uuid, p_day date)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when (p_token is not null and p_token = (select link_token from eval_config)) or public.is_eval_admin(auth.uid()) then
    jsonb_build_object(
      'rated_day', coalesce((select jsonb_agg(subject_id) from staff_evaluations
                             where kind = 'by_manager' and evaluator_id = p_evaluator and period = p_day), '[]'::jsonb),
      'half_done', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'subject', subject_id)) from staff_evaluations
                             where kind in ('self', 'of_manager') and evaluator_id = p_evaluator
                               and period = case when extract(day from p_day) <= 15 then date_trunc('month', p_day)::date
                                                 else (date_trunc('month', p_day) + interval '15 days')::date end), '[]'::jsonb))
  end
$$;
revoke all on function public.eval_status(text, uuid, date) from public;
grant execute on function public.eval_status(text, uuid, date) to anon, authenticated;
