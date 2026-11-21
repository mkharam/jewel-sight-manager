-- انسخ كل هذا الملف والصقه في Supabase ← SQL Editor ← New query ← Run (مرة وحدة).
-- ١) الأرباح الحقيقية بسعر الذهب التلقائي.  ٢) تنظيف سجل المهام المجدولة.
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
