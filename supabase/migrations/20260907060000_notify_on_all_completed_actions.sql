-- توسيع الإشعارات الفورية لتغطي كل الأحداث المهمة: تسجيل سعر (طلب سعر)، تغيّر حالة
-- التحويلات، تغيّر حالة طلبات إعادة الطلب، تغيّر حالة استفسار العميل، بيع جديد، وإرجاع
-- بيعة — بدل الاقتصار على "إنشاء" فقط (تحويل/استفسار/إعادة طلب جديدة). كل دالة تشمل
-- المدراء العامين دائماً (admin) بالإضافة لموظفي الفرع المعني، بنفس نمط الدوال الحالية.

-- دالة مساعدة مشتركة لتقليل التكرار: تقرأ المفاتيح من vault وتستدعي send-push.
create or replace function public.send_push_notification(
  p_branch_id uuid,
  p_extra_user_ids uuid[],
  p_title text,
  p_body text,
  p_url text
)
returns void
language plpgsql
security definer
set search_path = public, extensions, net, vault
as $$
declare
  anon_key text;
  webhook_secret text;
  admin_ids uuid[];
  all_ids uuid[];
begin
  select decrypted_secret into anon_key from vault.decrypted_secrets where name = 'analyze_image_anon_key' limit 1;
  select decrypted_secret into webhook_secret from vault.decrypted_secrets where name = 'push_webhook_secret' limit 1;
  if anon_key is null or webhook_secret is null then return; end if;
  select coalesce(array_agg(user_id), '{}') into admin_ids from public.user_roles where role = 'admin';
  all_ids := (select coalesce(array_agg(distinct x), '{}') from unnest(coalesce(p_extra_user_ids, '{}') || admin_ids) as x);
  perform net.http_post(
    url := 'https://iiyaytfdxfvjcvzlnlpp.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || anon_key, 'x-webhook-secret', webhook_secret),
    body := jsonb_build_object('branchId', p_branch_id, 'userIds', to_jsonb(all_ids), 'title', p_title, 'body', p_body, 'url', p_url)
  );
end;
$$;

revoke execute on function public.send_push_notification(uuid, uuid[], text, text, text) from public, anon, authenticated;

-- 1) طلب سعر (تسجيل سعر معروض على عميل) — يصل لباقي موظفي الفرع والمدراء فوراً
-- لمنع تخبط الأسعار بين الفروع.
create or replace function public.trigger_push_new_quote()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, net, vault
as $$
begin
  perform public.send_push_notification(
    NEW.branch_id,
    '{}',
    'سعر جديد مُسجَّل',
    coalesce('تم عرض سعر' || case when NEW.customer_name is not null then ' على: ' || NEW.customer_name else '' end, 'تم تسجيل سعر جديد'),
    '/products/' || NEW.product_id
  );
  return NEW;
end;
$$;

create trigger push_on_new_quote after insert on public.product_quotes
for each row execute function public.trigger_push_new_quote();

-- 2) تغيّر حالة التحويل (موافقة/شحن/استلام/رفض/إلغاء) — يصل لصاحب الطلب الأصلي
-- (عبر الفرعين) والمدراء.
create or replace function public.trigger_push_transfer_status()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, net, vault
as $$
declare
  label text;
  target_branch uuid;
begin
  if NEW.status = OLD.status then return NEW; end if;
  label := case NEW.status
    when 'approved' then 'تمت الموافقة على التحويل'
    when 'in_transit' then 'التحويل في الطريق'
    when 'received' then 'تم استلام التحويل'
    when 'rejected' then 'تم رفض التحويل'
    when 'cancelled' then 'تم إلغاء التحويل'
    else null
  end;
  if label is null then return NEW; end if;
  -- الوجهة المناسبة للإشعار: الفرع المُرسِل عند الموافقة/الرفض/الإلغاء، والفرع
  -- المستقبِل عند الشحن، وكلاهما فعلياً مغطى عبر extra_users (طالب/موافق/مستلم).
  target_branch := case when NEW.status = 'in_transit' then NEW.to_branch_id else NEW.from_branch_id end;
  perform public.send_push_notification(
    target_branch,
    array_remove(array[NEW.requested_by, NEW.approved_by, NEW.received_by], null),
    label,
    coalesce(NEW.product_name_snapshot, 'تحويل قطعة'),
    '/transfers'
  );
  return NEW;
end;
$$;

create trigger push_on_transfer_status_change after update of status on public.transfers
for each row execute function public.trigger_push_transfer_status();

-- 3) تغيّر حالة طلب إعادة الطلب (تم الطلب من المورد/تم الاستلام/أُلغي) — يصل لمن
-- طلبها والمدراء.
create or replace function public.trigger_push_reorder_status()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, net, vault
as $$
declare
  label text;
begin
  if NEW.status = OLD.status then return NEW; end if;
  label := case NEW.status
    when 'ordered' then 'تم طلب القطعة من المورد'
    when 'received' then 'وصلت القطعة المطلوبة'
    when 'cancelled' then 'أُلغي طلب إعادة الطلب'
    else null
  end;
  if label is null then return NEW; end if;
  perform public.send_push_notification(
    NEW.branch_id,
    array_remove(array[NEW.requested_by, NEW.handled_by], null),
    label,
    coalesce(NEW.product_name_snapshot || case when NEW.customer_name is not null then ' — لزبون: ' || NEW.customer_name else '' end, NEW.product_name_snapshot),
    '/reorders'
  );
  return NEW;
end;
$$;

create trigger push_on_reorder_status_change after update of status on public.product_reorder_requests
for each row execute function public.trigger_push_reorder_status();

-- 4) تغيّر حالة استفسار عميل (تم إيجاد القطعة/تم عرض السعر/تم البيع/فُقد) — يصل
-- لمن أنشأ الاستفسار والمدراء.
create or replace function public.trigger_push_inquiry_status()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, net, vault
as $$
declare
  label text;
begin
  if NEW.status = OLD.status then return NEW; end if;
  label := case NEW.status
    when 'found' then 'تم إيجاد قطعة مطابقة للاستفسار'
    when 'quoted' then 'تم عرض سعر على الاستفسار'
    when 'shown' then 'تم عرض القطعة على العميل'
    when 'sold' then 'تم بيع القطعة — استفسار مكتمل'
    when 'lost' then 'استفسار مفقود'
    else null
  end;
  if label is null then return NEW; end if;
  perform public.send_push_notification(
    NEW.branch_id,
    array_remove(array[NEW.created_by], null),
    label,
    coalesce('استفسار: ' || NEW.customer_name, 'تحديث استفسار'),
    '/inquiries'
  );
  return NEW;
end;
$$;

create trigger push_on_inquiry_status_change after update of status on public.customer_inquiries
for each row execute function public.trigger_push_inquiry_status();

-- 5) بيعة جديدة — تصل للمدراء (رقابة فورية على المبيعات).
create or replace function public.trigger_push_new_sale()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, net, vault
as $$
begin
  perform public.send_push_notification(
    null,
    array_remove(array[NEW.sold_by], null),
    'بيعة جديدة',
    coalesce(NEW.product_name_snapshot || ' — ' || NEW.final_price::text || ' د.ل', 'تمت بيعة جديدة'),
    '/sales'
  );
  return NEW;
end;
$$;

create trigger push_on_new_sale after insert on public.sales
for each row execute function public.trigger_push_new_sale();

-- 6) إرجاع بيعة — تصل للمدراء.
create or replace function public.trigger_push_sale_returned()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, net, vault
as $$
begin
  if NEW.returned_at is null or OLD.returned_at is not null then return NEW; end if;
  perform public.send_push_notification(
    null,
    array_remove(array[NEW.sold_by, NEW.returned_by], null),
    'تم إرجاع بيعة',
    coalesce(NEW.product_name_snapshot || case when NEW.return_reason is not null then ' — ' || NEW.return_reason else '' end, 'تم إرجاع بيعة'),
    '/sales'
  );
  return NEW;
end;
$$;

create trigger push_on_sale_returned after update of returned_at on public.sales
for each row execute function public.trigger_push_sale_returned();

-- قفل تنفيذ كل دوال المشغّلات الجديدة — نفس نمط الدوال الحالية، لا تُستدعى مباشرة
-- من الواجهة أو RLS.
revoke execute on function public.trigger_push_new_quote() from public, anon, authenticated;
revoke execute on function public.trigger_push_transfer_status() from public, anon, authenticated;
revoke execute on function public.trigger_push_reorder_status() from public, anon, authenticated;
revoke execute on function public.trigger_push_inquiry_status() from public, anon, authenticated;
revoke execute on function public.trigger_push_new_sale() from public, anon, authenticated;
revoke execute on function public.trigger_push_sale_returned() from public, anon, authenticated;
