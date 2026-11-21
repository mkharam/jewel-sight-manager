-- ١) الدولار الموازي من منصة بيانات اقتصاد ليبيا (ecolibya.com — API رسمي للمنصة، يومي)، وعين ليبيا احتياط.
-- ٢) تاريخ الدولار الموازي والرسمي من 13 أغسطس 2026.
-- ٣) دالة «فوق سعر الذهب» للتقييم: كم باع البائع فوق قيمة الذهب الصافي يوم البيع.

-- سعر الدولار ليوم: السوق الموازي فقط (هو اللي يحدد سعر الذهب في ليبيا). قبل أول سعر موازي معروف
-- ترجع فارغ — نفضّل «ما نعرفش» على رقم غلط.
create or replace function public.usd_lyd_on(p_day date) returns numeric
language sql stable set search_path = public as $$
  select usd_lyd_market from market_rates
  where day <= p_day and usd_lyd_market is not null and day >= p_day - 10
  order by day desc limit 1;
$$;

create or replace function public.market_rates_collect() returns void
language plpgsql security definer set search_path = public as $$
declare r record; body jsonb; txt text; v numeric; d date; today date := (now() at time zone 'Africa/Tripoli')::date;
begin
  for r in select q.id, q.kind, h.content, h.status_code from market_rate_requests q join net._http_response h on h.id = q.id loop
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
      end if;
    exception when others then null;
    end;
    delete from market_rate_requests where id = r.id;
  end loop;
  delete from market_rate_requests where created_at < now() - interval '1 day';
  insert into market_rate_requests(id, kind) values (net.http_get('https://api.gold-api.com/price/XAU'), 'gold');
  insert into market_rate_requests(id, kind) values (net.http_get('https://open.er-api.com/v6/latest/USD'), 'fx');
  insert into market_rate_requests(id, kind) values (net.http_get('https://ecolibya.com/api/public/v1/indicators/LY-EXT-MKT-USDPAR/values?limit=1000', headers := '{"User-Agent":"Mozilla/5.0"}'::jsonb), 'parallel_api');
  insert into market_rate_requests(id, kind) values (net.http_get('https://www.eanlibya.com/exchangerate/', headers := '{"User-Agent":"Mozilla/5.0"}'::jsonb), 'parallel');
end $$;
revoke all on function public.market_rates_collect() from public, anon, authenticated;

-- تاريخ الدولار (الموازي، الرسمي) من منصة بيانات اقتصاد ليبيا.
insert into public.market_rates(day, usd_lyd_market, usd_lyd_official) values
('2026-08-13', 8.91, null),
('2026-08-14', 8.87, null),
('2026-08-16', null, 6.3742),
('2026-08-17', 9.12, 6.3676),
('2026-08-18', null, 6.3677),
('2026-08-19', null, 6.3518),
('2026-08-20', null, 6.36),
('2026-08-21', null, 6.3603),
('2026-08-23', 9.24, 6.2888),
('2026-08-24', 9.35, 6.3252),
('2026-08-25', null, 6.3304),
('2026-08-26', null, 6.3267),
('2026-08-27', 9.17, 6.336),
('2026-08-28', null, 6.336),
('2026-08-29', 9.08, 6.3361),
('2026-08-30', null, 6.3361),
('2026-08-31', 9.1, 6.3376),
('2026-09-01', 9.18, 6.3376),
('2026-09-02', 9.23, 6.3518),
('2026-09-03', 9.23, 6.3501),
('2026-09-04', null, 6.3527),
('2026-09-05', 9.22, 6.3527),
('2026-09-06', 9.27, 6.3527),
('2026-09-07', null, 6.346),
('2026-09-08', null, 6.3459),
('2026-09-09', null, 6.3458),
('2026-09-10', 9.32, 6.3313),
('2026-09-11', null, 6.3274),
('2026-09-12', 9.4, 6.3273),
('2026-09-13', null, 6.3272),
('2026-09-14', null, 6.3257),
('2026-09-15', null, 6.3254),
('2026-09-16', null, 6.335),
('2026-09-17', 9.56, 6.3547),
('2026-09-18', null, 6.3537),
('2026-09-19', 9.56, 6.3536),
('2026-09-20', 9.65, 6.4125),
('2026-09-21', 9.7, 6.3795),
('2026-09-22', 9.8, 6.3667),
('2026-09-23', 9.61, 6.3732),
('2026-09-24', 9.52, 6.3678),
('2026-09-25', null, 6.3751),
('2026-09-26', 9.64, 6.3752),
('2026-09-27', 9.54, 6.3754),
('2026-09-28', 9.57, 6.3914),
('2026-09-29', 9.58, 6.3922),
('2026-09-30', 9.59, 6.3937),
('2026-10-01', 9.57, 6.3949),
('2026-10-02', 9.58, 6.3943),
('2026-10-03', 9.59, 6.3943),
('2026-10-04', null, 6.3943),
('2026-10-05', null, 6.4034),
('2026-10-06', 9.68, 6.4037),
('2026-10-07', 9.71, 6.4295),
('2026-10-08', 9.76, 6.4156),
('2026-10-09', null, 6.4099),
('2026-10-10', 9.82, 6.4099),
('2026-10-11', 9.87, 6.41),
('2026-10-12', null, 6.423),
('2026-10-14', 9.98, 6.423),
('2026-10-15', 10.3, 6.4285),
('2026-10-16', null, 6.4243),
('2026-10-17', null, 6.4242),
('2026-10-18', 10.26, 6.4242),
('2026-10-19', 10.1, 6.4223),
('2026-10-20', 10.06, 6.4221),
('2026-10-21', 9.96, 6.416),
('2026-10-22', 9.95, 6.4188),
('2026-10-23', 9.65, 6.4176),
('2026-10-24', 9.72, 6.4175),
('2026-10-25', 9.98, 6.4174),
('2026-10-26', 10.08, 6.4059),
('2026-10-27', 9.91, 6.4053),
('2026-10-28', 9.9, 6.4102),
('2026-10-29', 9.92, 6.4251),
('2026-10-30', 10.01, 6.4301),
('2026-10-31', 10.11, 6.4301),
('2026-11-01', 9.92, 6.4302),
('2026-11-02', 9.93, 6.428),
('2026-11-03', 9.98, 6.428),
('2026-11-04', 9.93, 6.4159),
('2026-11-05', 9.86, 6.4267),
('2026-11-06', 9.92, 6.4197),
('2026-11-07', 9.95, 6.4196),
('2026-11-08', 9.92, 6.4193),
('2026-11-09', 10.04, 6.4022),
('2026-11-10', 10.08, 6.4012),
('2026-11-11', 10.17, 6.426),
('2026-11-12', 10.17, 6.4165),
('2026-11-13', 10.17, 6.4277),
('2026-11-14', 10.24, 6.4277),
('2026-11-15', 10.17, 6.4277),
('2026-11-16', 10.42, 6.445),
('2026-11-17', 10.57, 6.4455),
('2026-11-18', 10.63, 6.4584),
('2026-11-19', 10.65, 6.4575),
('2026-11-20', 10.67, 6.4611)
on conflict (day) do update set
  usd_lyd_market = coalesce(excluded.usd_lyd_market, market_rates.usd_lyd_market),
  usd_lyd_official = coalesce(market_rates.usd_lyd_official, excluded.usd_lyd_official),
  market_source = case when excluded.usd_lyd_market is not null then 'ecolibya' else market_rates.market_source end;
update public.market_rates set market_source = 'ecolibya' where usd_lyd_market is not null and market_source is null;

-- «فوق سعر الذهب» لكل بائع (للمدير العام فقط): قيمة البيع مقابل قيمة الذهب الصافي يوم البيع
-- (الأونصة ÷ 31.1035 × الدولار الموازي). القطع القديمة = أكثر من 180 يوم في المخزون قبل البيع.
create or replace function public.amarsoft_staff_eval_gold(p_start timestamptz, p_end timestamptz, p_branch text default null)
returns table (branch_code text, sman text, valued_grams numeric, amount_lyd numeric, gold_lyd numeric,
  old_grams numeric, old_amount_lyd numeric, old_gold_lyd numeric)
language sql stable security definer set search_path = public as $$
  with inv as (
    select a.branch_code, a.sman, a.items, (a.sold_at at time zone 'Africa/Tripoli')::date d
    from amarsoft_invoices a
    where public.has_role(auth.uid(), 'admin')
      and a.kind = 'sale' and not a.is_deleted and a.sman is not null
      and a.sold_at >= p_start and a.sold_at < p_end
      and (p_branch is null or a.branch_code = p_branch)
      and not public.amarsoft_is_store_sman(a.branch_code, a.sman)
  ), rate as (
    select d, public.gold_lyd_per_pure_gram(d) g from (select distinct d from inv) x
  ), ln as (
    select i.branch_code, i.sman, i.d,
      coalesce((it->>'grams')::numeric, 0) g, coalesce((it->>'pure_grams')::numeric, 0) pg,
      coalesce((it->>'amount_dirhams')::numeric, 0) / 1000 amt,
      (select st.received_on from amarsoft_stock st where st.tag = it->>'tag'
        order by (st.branch_code = i.branch_code) desc, st.updated_at desc limit 1) received_on
    from inv i, jsonb_array_elements(i.items) it
  )
  select l.branch_code, l.sman,
    round(sum(l.g), 2), round(sum(l.amt), 0), round(sum(l.pg * r.g), 0),
    round(coalesce(sum(l.g) filter (where l.d - l.received_on > 180), 0), 2),
    round(coalesce(sum(l.amt) filter (where l.d - l.received_on > 180), 0), 0),
    round(coalesce(sum(l.pg * r.g) filter (where l.d - l.received_on > 180), 0), 0)
  from ln l join rate r on r.d = l.d
  where r.g is not null and l.g > 0 and l.pg > 0
  group by 1, 2;
$$;
revoke all on function public.amarsoft_staff_eval_gold(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.amarsoft_staff_eval_gold(timestamptz, timestamptz, text) to authenticated;

select public.market_rates_collect();
