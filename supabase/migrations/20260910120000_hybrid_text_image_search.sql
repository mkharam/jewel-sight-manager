-- بحث هجين: بصمة الصورة وبصمة الوصف معاً بدل بصمة واحدة تخدم غرضين متضاربين.
--
-- الخلفية: كان عمود ai_embedding يحمل بصمة نص الوصف الذي يكتبه الذكاء الاصطناعي عن
-- الصورة، فالبحث بالصورة كان يقارن وصفاً بوصف ويعطي تشابهاً زائفاً بين قطع مختلفة
-- بصرياً. حُوّل العمود لبصمة الصورة نفسها فصار البحث بالصورة دقيقاً — لكن البحث النصي
-- صار يقارن نصاً ببصمة صورة (وسيطان مختلفان)، وقياسنا الفعلي أظهر نتائج متجمّعة حول
-- 0.32–0.34 بفارق ~0.005 بين الأول والسادس وترتيباً بلا معنى.
--
-- الحل: عمودان مستقلان لكل صورة —
--   ai_embedding   = بصمة الصورة (بكسلات) → التطابق البصري.
--   text_embedding = بصمة وصف الذكاء الاصطناعي → التطابق الوصفي (لون الحجر، الشكل...).
-- كلاهما بنفس النموذج (gemini-embedding-2) و 1536 بُعداً، فالمقارنة داخل كل عمود تبقى
-- من نفس الوسيط وتُعطي ترتيباً ذا معنى.
alter table public.product_images
  add column if not exists text_embedding vector(1536);

-- نفس نوع فهرس ai_embedding الموجود (hnsw + cosine) للاتساق والأداء.
create index if not exists product_images_text_embedding_idx
  on public.product_images using hnsw (text_embedding vector_cosine_ops);

-- مطابقة هجينة: تقبل بصمة صورة و/أو بصمة نص وتُعيد الدرجتين منفصلتين مع درجة مركّبة.
-- إبقاء الدرجتين منفصلتين مقصود: يسمح للواجهة بالتمييز بين "مطابق بصرياً" و"يشبه
-- الوصف" بدل رقم واحد يخفي أيّهما السبب.
-- أي معامل NULL يُحيّد جانبه تلقائياً (بحث نصي بحت أو بصري بحت) بدل الحاجة لدالتين.
create or replace function public.match_product_images_hybrid(
  query_image_embedding vector default null,
  query_text_embedding vector default null,
  match_count integer default 24,
  image_weight double precision default 0.6
)
returns table (
  image_id uuid,
  product_id uuid,
  storage_path text,
  thumb_path text,
  visual_similarity double precision,
  text_similarity double precision,
  score double precision
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with scored as (
    select
      pi.id as image_id,
      pi.product_id,
      pi.storage_path,
      pi.thumb_path,
      case when query_image_embedding is null or pi.ai_embedding is null
           then null
           else 1 - (pi.ai_embedding <=> query_image_embedding) end as visual_similarity,
      case when query_text_embedding is null or pi.text_embedding is null
           then null
           else 1 - (pi.text_embedding <=> query_text_embedding) end as text_similarity
    from public.product_images pi
    where pi.ai_embedding is not null or pi.text_embedding is not null
  )
  select
    image_id,
    product_id,
    storage_path,
    thumb_path,
    visual_similarity,
    text_similarity,
    -- عند توفّر الجانبين نمزج بالوزن المطلوب، وعند توفّر جانب واحد فقط نعتمده وحده
    -- بدل معاقبة الصورة لنقص بصمة لم تُولَّد بعد.
    case
      when visual_similarity is not null and text_similarity is not null
        then image_weight * visual_similarity + (1 - image_weight) * text_similarity
      else coalesce(visual_similarity, text_similarity)
    end as score
  from scored
  where visual_similarity is not null or text_similarity is not null
  order by score desc
  limit match_count;
$function$;

revoke all on function public.match_product_images_hybrid(vector, vector, integer, double precision) from public, anon;
grant execute on function public.match_product_images_hybrid(vector, vector, integer, double precision) to authenticated, service_role;
