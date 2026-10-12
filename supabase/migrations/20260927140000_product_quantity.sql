-- الكمية: قطع متطابقة (خواتم، أساور…) تُسجَّل مرة واحدة بعدد بدل صف لكل قطعة.
-- كل ما كان يفترض "صف = قطعة واحدة" يُحدَّث هنا: البيع يُنقص الكمية ولا تصير القطعة "مبيعة"
-- إلا عند نفادها، الإرجاع يعيدها، والحجز لا يقفل كل الكمية، والتقارير تعدّ بالكمية.

alter table public.products add column if not exists quantity integer not null default 1;
alter table public.products drop constraint if exists products_quantity_nonneg;
alter table public.products add constraint products_quantity_nonneg check (quantity >= 0);

-- القطع المبيعة سابقاً: كميتها صفر (لا متوفر منها)، حتى لا يُعاد "بيعها" بالخطأ.
update public.products set quantity = 0 where status = 'sold';

-- كم قطعة في هذا البيع (السعر النهائي = إجمالي البيع كله).
alter table public.sales add column if not exists quantity integer not null default 1;
alter table public.sales drop constraint if exists sales_quantity_positive;
alter table public.sales add constraint sales_quantity_positive check (quantity > 0);

-- البيع: يُنقص الكمية، ويرفض بيع أكثر من المتوفر. "مبيع" فقط عند النفاد، وحينها فقط
-- يتحوّل الحجز النشط إلى "مُنفَّذ" (كما كان لقطعة الكمية 1).
create or replace function public.apply_sale_status()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare cur integer; left_qty integer;
begin
  if new.product_id is not null then
    -- نفحص قبل الإنقاص (مع قفل الصف ضد بيعين متزامنين) لتظهر رسالة عربية واضحة بدل خطأ
    -- قيد "الكمية لا تقل عن صفر".
    select quantity into cur from public.products where id = new.product_id for update;
    if cur is not null and cur < new.quantity then
      raise exception 'المتوفر من هذه القطعة % فقط', cur;
    end if;
    update public.products
       set quantity = quantity - new.quantity,
           status = case when quantity - new.quantity <= 0 then 'sold'::product_status else status end
     where id = new.product_id
     returning quantity into left_qty;
    if left_qty = 0 then
      update public.reservations set status = 'converted'
        where product_id = new.product_id and status = 'active';
    end if;
  end if;
  return new;
end; $function$;

-- الحجز يقفل القطعة فقط إن كانت آخر قطعة؛ الكمية الأكبر تبقى متاحة لبقية الزبائن.
create or replace function public.apply_reservation_status()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' and new.status = 'active' then
    update public.products set status = 'reserved' where id = new.product_id and status = 'available' and quantity <= 1;
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'active' then
      update public.products set status = 'reserved' where id = new.product_id and status = 'available' and quantity <= 1;
    elsif new.status in ('cancelled','expired') then
      update public.products set status = 'available' where id = new.product_id and status = 'reserved';
    end if;
  end if;
  return new;
end; $function$;

-- الإرجاع يعيد الكمية المُباعة ويجعل القطعة متوفرة.
create or replace function public.return_sale(_sale_id uuid, _reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare s record;
begin
  if not public.is_manager_or_admin(auth.uid()) then
    raise exception 'إرجاع البيع متاح للمدير فقط';
  end if;
  if _reason is null or btrim(_reason) = '' then
    raise exception 'سبب الإرجاع مطلوب';
  end if;

  select * into s from public.sales where id = _sale_id;
  if s is null then raise exception 'البيعة غير موجودة'; end if;
  if s.returned_at is not null then raise exception 'تم إرجاع هذه البيعة مسبقاً'; end if;

  update public.sales
     set returned_at = now(), returned_by = auth.uid(), return_reason = _reason
   where id = _sale_id;

  if s.product_id is not null then
    update public.products
       set status = 'available', quantity = quantity + coalesce(s.quantity, 1)
     where id = s.product_id;
  end if;

  insert into public.activity_log (actor_id, entity_type, entity_id, action, details)
  values (auth.uid(), 'sales', _sale_id, 'sale_returned',
          jsonb_build_object('product_id', s.product_id, 'reference', s.amar_invoice_number,
                             'final_price', s.final_price, 'reason', _reason, 'quantity', s.quantity));
end $function$;

-- جرد المخزون بالكمية: 5 خواتم = 5 قطع و5 أضعاف السعر.
create or replace function public.report_inventory_snapshot()
returns table(branch_id uuid, count bigint, value_sale numeric, value_cost numeric, age60 bigint, age90 bigint, age180 bigint, age_plus bigint)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if not has_role(auth.uid(), 'admin'::app_role) then
    raise exception 'هذا التقرير للمدير العام فقط';
  end if;

  return query
  select
    b.id,
    coalesce(sum(p.quantity), 0)::bigint,
    coalesce(sum(p.sale_price * p.quantity), 0),
    coalesce(sum(p.cost_price * p.quantity), 0),
    coalesce(sum(p.quantity) filter (where now() - p.created_at < interval '60 days'), 0)::bigint,
    coalesce(sum(p.quantity) filter (where now() - p.created_at >= interval '60 days' and now() - p.created_at < interval '90 days'), 0)::bigint,
    coalesce(sum(p.quantity) filter (where now() - p.created_at >= interval '90 days' and now() - p.created_at < interval '180 days'), 0)::bigint,
    coalesce(sum(p.quantity) filter (where now() - p.created_at >= interval '180 days'), 0)::bigint
  from branches b
  left join products p on p.branch_id = b.id and p.status = 'available'::product_status
  group by b.id;
end;
$function$;
