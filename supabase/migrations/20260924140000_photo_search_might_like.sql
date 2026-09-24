-- مستوى خامس للبحث بالصورة: "قطع ممكن تعجب الزبون"، ونتائج أكثر في كل مستوى.
-- الحدود: مطابقة 10، قريبة جداً 20 (كانت 15)، شكل مشابه/نفس الأوصاف 30 (كانت 24)، ممكن تعجبه 30.
-- التوقيع لم يتغيّر فتبقى الصلاحيات كما هي. راجع 20260924120000_photo_search_tiers.sql للمعايرة.

create or replace function public.match_products_tiered(
  q_image vector default null,
  q_text vector default null,
  q_labels jsonb default null,
  -- "قطع مشابهة لهذه القطعة": نأخذ بصمتي وأوصاف صورتها الرئيسية ونستثنيها من النتائج.
  anchor_product uuid default null,
  max_results integer default 140
)
returns table (
  product_id uuid,
  kind text,
  score double precision,
  visual double precision,
  textual double precision,
  visual_z double precision,
  text_z double precision,
  reasons text[]
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  qi vector := q_image;
  qt vector := q_text;
  ql jsonb := q_labels;
begin
  if anchor_product is not null and qi is null then
    select pi.ai_embedding, pi.text_embedding, pi.ai_labels
      into qi, qt, ql
    from product_images pi
    where pi.product_id = anchor_product and pi.ai_embedding is not null
    order by pi.is_primary desc, pi.sort_order nulls last
    limit 1;
  end if;
  if qi is null and qt is null then
    return;
  end if;

  return query
  with sims as (
    select
      pi.product_id,
      pi.ai_labels,
      case when qi is null or pi.ai_embedding is null then null else 1 - (pi.ai_embedding <=> qi) end as vis,
      case when qt is null or pi.text_embedding is null then null else 1 - (pi.text_embedding <=> qt) end as txt
    from product_images pi
    where anchor_product is null or pi.product_id <> anchor_product
  ),
  stats as (
    select avg(vis) mv, nullif(stddev(vis), 0) sv, avg(txt) mt, nullif(stddev(txt), 0) st from sims
  ),
  -- عدة صور لنفس القطعة: نُبقي أقربها بصرياً.
  best as (
    select distinct on (s.product_id)
      s.product_id, s.ai_labels, s.vis, s.txt,
      coalesce((s.vis - st.mv) / st.sv, 0) as vz,
      coalesce((s.txt - st.mt) / st.st, 0) as tz
    from sims s cross join stats st
    order by s.product_id, s.vis desc nulls last, s.txt desc nulls last
  ),
  attrs as (
    select b.*,
      (ql->>'metal_color') is not null and (ql->>'metal_color') = (b.ai_labels->>'metal_color') as metal_same,
      public.stone_color_families(ql->'gemstones') as q_stones,
      public.stone_color_families(b.ai_labels->'gemstones') as p_stones,
      (ql->>'item_type') is not null and (ql->>'item_type') = (b.ai_labels->>'item_type') as type_same,
      array(
        select x from jsonb_array_elements_text(coalesce(ql->'style', '[]')) x
        intersect
        select y from jsonb_array_elements_text(coalesce(b.ai_labels->'style', '[]')) y
      ) as styles
    from best b
  ),
  tiered as (
    select a.*,
      array(select unnest(a.q_stones) intersect select unnest(a.p_stones)) as shared_stones,
      case
        when (a.vis >= 0.955 and a.vz >= 3) or (a.vz >= 4.5 and a.metal_same) then 'exact'
        when a.vz >= 2.6 or a.vis >= 0.935 then 'very_close'
        when a.vz >= 1.8 then 'similar_look'
        when a.metal_same
             and (cardinality(a.q_stones) = 0
                  or cardinality(array(select unnest(a.q_stones) intersect select unnest(a.p_stones))) > 0)
             and (a.vz >= 0.5 or a.tz >= 1.5) then 'same_attributes'
        -- "ممكن تعجب الزبون": ذوق قريب لا تطابق — يشترك في شيء واحد على الأقل (لون الذهب، لون
        -- الأحجار، الطراز) وليس أبعد من المتوسط شكلاً. خيارات إضافية يعرضها الموظف حين لا يجد
        -- الزبون طلبه بالضبط. محاكاة على 40 صورة: ~94 مرشحاً لكل بحث (أقلها 20) → نعرض أفضل 30.
        when a.vz >= -0.3
             and (a.metal_same
                  or cardinality(array(select unnest(a.q_stones) intersect select unnest(a.p_stones))) > 0
                  or cardinality(a.styles) > 0)
             and (a.vz >= 0.3 or a.tz >= 0.8) then 'might_like'
      end as tier
    from attrs a
  ),
  ranked as (
    select t.*,
      t.vz * 0.7 + t.tz * 0.3
        + case when t.metal_same then 0.3 else 0 end
        + case when cardinality(t.shared_stones) > 0 then 0.3 else 0 end
        + case when cardinality(t.styles) > 0 then 0.2 else 0 end as rank_score,
      row_number() over (
        partition by t.tier
        order by t.vz * 0.7 + t.tz * 0.3
          + case when t.metal_same then 0.3 else 0 end
          + case when cardinality(t.shared_stones) > 0 then 0.3 else 0 end
          + case when cardinality(t.styles) > 0 then 0.2 else 0 end desc
      ) as rn
    from tiered t
    where t.tier is not null
  )
  select
    r.product_id,
    r.tier,
    r.rank_score,
    r.vis,
    r.txt,
    r.vz,
    r.tz,
    -- أسباب يقرؤها الموظف ويقولها للزبون مباشرة: "نفس لون الذهب، نفس الأحجار الخضراء".
    array_remove(array[
      case when r.metal_same then 'نفس لون الذهب' end,
      case when cardinality(r.shared_stones) > 0 then
        'نفس الأحجار: ' || array_to_string(array(
          select case f
            when 'white' then 'بيضاء' when 'green' then 'خضراء' when 'red' then 'حمراء'
            when 'blue' then 'زرقاء' when 'yellow' then 'صفراء' when 'pink' then 'وردية'
            when 'purple' then 'بنفسجية' when 'turquoise' then 'فيروزية' when 'pearl' then 'لؤلؤ'
            when 'black' then 'سوداء' end
          from unnest(r.shared_stones) f), '، ')
      end,
      -- نوع القطعة يُذكر فقط إن لم يكن "طقم": أغلب المخزون أطقم فالسبب لا يميّز شيئاً.
      case when r.type_same and (r.ai_labels->>'item_type') <> 'طقم' then 'نفس النوع: ' || (r.ai_labels->>'item_type') end,
      case when cardinality(r.styles) > 0 then 'نفس الطراز: ' || r.styles[1] end
    ], null)
  from ranked r
  where r.rn <= case r.tier when 'exact' then 10 when 'very_close' then 20 else 30 end
  order by case r.tier when 'exact' then 0 when 'very_close' then 1 when 'similar_look' then 2
                       when 'same_attributes' then 3 else 4 end,
           r.rank_score desc
  limit max_results;
end;
$function$;
