-- استثناء صاحب الحدث من إشعاره الخاص.
--
-- المشكلة: trigger_push_staff_message كان يستثني المُرسِل فعلاً من قائمة المستلمين،
-- لكن send_push_notification تُضيف بعدها كل من يحمل دور admin بلا شرط — فالمُرسِل إن
-- كان مديراً عاماً يعود للقائمة من الباب الخلفي ويصله إشعار برسالته هو.
--
-- الحل: معامل استثناء يُطبَّق بعد دمج قائمة المدراء، لا قبلها. نُسقط النسخة ذات الخمسة
-- معاملات ونُنشئ نسخة سادسة بقيمة افتراضية null، فتبقى كل الاستدعاءات الحالية (خمسة
-- معاملات) تعمل كما هي بلا تعديل.
drop function if exists public.send_push_notification(uuid, uuid[], text, text, text);

create or replace function public.send_push_notification(
  p_branch_id uuid,
  p_extra_user_ids uuid[],
  p_title text,
  p_body text,
  p_url text,
  p_exclude_user_id uuid default null
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
  -- الاستثناء هنا بعد الدمج تحديداً — وضعه قبله لا يمنع عودة المُرسِل عبر admin_ids.
  all_ids := (
    select coalesce(array_agg(distinct x), '{}')
    from unnest(coalesce(p_extra_user_ids, '{}') || admin_ids) as x
    where p_exclude_user_id is null or x <> p_exclude_user_id
  );
  -- لا مستلم بعد الاستثناء: لا داعي لاستدعاء الدالة أصلاً. مهم لمحادثة الفريق حين
  -- يكون المُرسِل هو المستخدم الوحيد النشط — وإلا فإن userIds الفارغة مع branchId
  -- الفارغ قد تُفسَّر كبثّ عام.
  if array_length(all_ids, 1) is null and p_branch_id is null then return; end if;
  perform net.http_post(
    url := 'https://iiyaytfdxfvjcvzlnlpp.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || anon_key, 'x-webhook-secret', webhook_secret),
    body := jsonb_build_object('branchId', p_branch_id, 'userIds', to_jsonb(all_ids), 'title', p_title, 'body', p_body, 'url', p_url)
  );
end;
$$;

revoke execute on function public.send_push_notification(uuid, uuid[], text, text, text, uuid) from public, anon, authenticated;

-- محادثة الموظفين: تمرير المُرسِل كمستثنى صراحةً.
create or replace function public.trigger_push_staff_message()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, net, vault
as $$
declare
  sender_name text;
  other_staff uuid[];
begin
  select full_name into sender_name from public.profiles where id = NEW.sender_id;
  select coalesce(array_agg(id), '{}') into other_staff
    from public.profiles where is_active = true and id <> NEW.sender_id;

  perform public.send_push_notification(
    null,
    other_staff,
    coalesce(sender_name, 'موظف') || ' في محادثة الفريق',
    left(NEW.content, 150),
    '/chat',
    NEW.sender_id
  );
  return NEW;
end;
$$;

revoke execute on function public.trigger_push_staff_message() from public, anon, authenticated;
