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

create or replace function public.bekam_collect() returns void
language plpgsql security definer set search_path = public as $$
declare r record; txt text; ck text;
  k18 numeric; k21 numeric; x18 numeric; x21 numeric; m18 numeric; m24 numeric;
  last record;
  pick constant text := ' [0-9: -]{10,25} ([0-9][0-9,]*(\.[0-9]+)?)';
begin
  for r in select q.id, h.status_code, h.content from bekam_requests q join net._http_response h on h.id = q.id loop
    begin
      txt := regexp_replace(regexp_replace(coalesce(r.content, ''), '<[^>]+>', ' ', 'g'), '\s+', ' ', 'g');
      k18 := replace(substring(txt from 'ذهب كسر 18' || pick), ',', '')::numeric;
      k21 := replace(substring(txt from 'ذهب كسر 21' || pick), ',', '')::numeric;
      x18 := replace(substring(txt from 'ذهب خارجي 18' || pick), ',', '')::numeric;
      x21 := replace(substring(txt from 'ذهب خارجي 21' || pick), ',', '')::numeric;
      m18 := replace(substring(txt from 'ذهب مسبوك 18' || pick), ',', '')::numeric;
      m24 := replace(substring(txt from 'ذهب مسبوك 24' || pick), ',', '')::numeric;
      if r.status_code = 200 and coalesce(k18, k21, x18, x21) is not null then
        update bekam_auth set last_ok_at = now(), last_error = null where id = 1;
        select * into last from ly_gold_market where source = 'bekam' order by observed_at desc limit 1;
        -- نسجّلو بس لو حاجة تبدّلت (بكم يحدّث كم مرة في اليوم).
        if last is null or last.kasr18 is distinct from k18 or last.kasr21 is distinct from k21
           or last.kharji18 is distinct from x18 or last.kharji21 is distinct from x21
           or last.masbook18 is distinct from m18 or last.masbook24 is distinct from m24 then
          insert into ly_gold_market (url, observed_at, kasr18, kasr21, kharji18, kharji21, masbook18, masbook24, source, recorded_by)
          values ('bekam:' || to_char(now(), 'YYYYMMDDHH24MISS'), now(), k18, k21, x18, x21, m18, m24, 'bekam', null)
          on conflict (url) do nothing;
        end if;
      else
        update bekam_auth set last_error = 'الدخول لبكم انتهى — حط كوكي PHPSESSID جديد (' || coalesce(r.status_code::text, '?') || ')' where id = 1;
      end if;
    exception when others then
      update bekam_auth set last_error = left(sqlerrm, 200) where id = 1;
    end;
    delete from bekam_requests where id = r.id;
  end loop;
  delete from bekam_requests where created_at < now() - interval '1 hour';
  select cookie into ck from bekam_auth where id = 1;
  if ck is not null then
    insert into bekam_requests (id) values (net.http_get('https://bekam.net/cp/items.php?id=71',
      headers := jsonb_build_object('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Cookie', ck),
      timeout_milliseconds := 20000));
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
