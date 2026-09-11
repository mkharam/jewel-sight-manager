-- إشعار فوري عند رسالة جديدة في محادثة الموظفين — يصل لكل الموظفين النشطين ما عدا
-- المُرسِل نفسه (بث لكل الفروع، بعكس بقية الإشعارات المقيّدة بفرع واحد)، وعنوانه
-- يحمل اسم المُرسِل مباشرة حتى يعرف الموظف من كتب بلمحة من شاشة القفل.
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
    '/chat'
  );
  return NEW;
end;
$$;

create trigger push_on_staff_message after insert on public.staff_messages
for each row execute function public.trigger_push_staff_message();

revoke execute on function public.trigger_push_staff_message() from public, anon, authenticated;
