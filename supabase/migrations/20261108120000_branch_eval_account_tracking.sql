-- (1) تقييم الفروع من أمارسوفت: المبيعات، الوزن، سعر القرام والمصنعية للقرام (18 و21 منفصلين لأن
--     سعرهم مختلف)، تسجيل البائع واسم الزبون على الفواتير، والفواتير المحذوفة. نفس الدالة تعطي سطر لكل
--     فرع (sman = null) وسطر لكل بائع داخل الفرع.
-- (2) تتبّع الحسابات: كل جهاز يفتح التطبيق يسجّل يومه (touch_presence)، والمدير العام يشوف لكل حساب
--     آخر دخول، أيام النشاط، الأجهزة المفتوحة، المبيعات — وعلامة لو الحساب يبان مستعمل من أكثر من واحد.
-- (3) الأجهزة: المدير العام يشوف وين كل حساب مفتوح، ويطلّعه من جهاز واحد أو من الكل.

-- ===== (1) تقييم الفروع =====
create or replace function public.amarsoft_internal_customer(p_name text)
returns boolean language sql immutable as $$
  select coalesce(p_name, '') ~ '(ذهب|دهب) ?مسبوك|بضاع[ةه]|^كسر|ذهب كسر|دهب كسر'
$$;

create or replace function public.amarsoft_branch_eval(p_start timestamptz, p_end timestamptz)
returns table (branch_code text, branch_name text, sman text, salesman_name text,
               invoices bigint, returns bigint, deleted bigint, pieces numeric, grams numeric, net_dirhams bigint,
               grams_18 numeric, amount_18 numeric, making_18 numeric,
               grams_21 numeric, amount_21 numeric, making_21 numeric,
               tagged bigint, with_customer bigint, active_days bigint)
language sql stable security definer set search_path to 'public'
as $function$
  with inv as (
    select a.id, a.branch_code, nullif(a.sman, '') sman, a.kind, a.is_deleted, a.net_dirhams, a.sold_at, a.items,
           (nullif(trim(a.details->>'customer'), '') is not null or nullif(trim(a.details->>'phone'), '') is not null
              or nullif(a.details->>'guest_code', '') is not null) has_cust
    from amarsoft_invoices a
    where a.sold_at >= p_start and a.sold_at < p_end
      and not public.amarsoft_internal_customer(a.details->>'customer')
      and public.has_role(auth.uid(), 'admin')
  ), lines as (
    select inv.id, (i->>'pcs')::numeric pcs, (i->>'grams')::numeric g, (i->>'purity')::numeric pur,
           (i->>'amount_dirhams')::numeric amt, (i->>'making_dirhams')::numeric mk
    from inv cross join jsonb_array_elements(inv.items) i
    where inv.kind = 'sale' and not inv.is_deleted
  ), per_inv as (
    select inv.id, inv.branch_code, inv.sman, inv.kind, inv.is_deleted, inv.net_dirhams, inv.sold_at, inv.has_cust,
           coalesce(l.pcs, 0) pcs, coalesce(l.g, 0) g,
           coalesce(l.g18, 0) g18, coalesce(l.a18, 0) a18, coalesce(l.m18, 0) m18,
           coalesce(l.g21, 0) g21, coalesce(l.a21, 0) a21, coalesce(l.m21, 0) m21
    from inv left join (
      select id, sum(pcs) pcs, sum(g) g,
             sum(g) filter (where pur = 0.75) g18, sum(amt) filter (where pur = 0.75) a18, sum(mk) filter (where pur = 0.75) m18,
             sum(g) filter (where pur = 0.875) g21, sum(amt) filter (where pur = 0.875) a21, sum(mk) filter (where pur = 0.875) m21
      from lines group by id
    ) l on l.id = inv.id
  ), agg as (
    select p.branch_code, p.sman,
           count(*) filter (where kind = 'sale' and not is_deleted) invoices,
           count(*) filter (where kind = 'return' and not is_deleted) returns,
           count(*) filter (where is_deleted) deleted,
           sum(pcs) pieces, round(sum(g), 2) grams,
           coalesce(sum(net_dirhams) filter (where not is_deleted), 0)::bigint net,
           round(sum(g18), 2) g18, sum(a18) a18, sum(m18) m18, round(sum(g21), 2) g21, sum(a21) a21, sum(m21) m21,
           count(*) filter (where kind = 'sale' and not is_deleted and sman is not null) tagged,
           count(*) filter (where kind = 'sale' and not is_deleted and has_cust) with_cust,
           count(distinct (sold_at at time zone 'Africa/Tripoli')::date) filter (where kind = 'sale' and not is_deleted) days,
           grouping(p.sman) g_sman
    from per_inv p
    group by grouping sets ((p.branch_code), (p.branch_code, p.sman))
  )
  select agg.branch_code, b.name,
         case when agg.g_sman = 1 then null else coalesce(agg.sman, '') end,
         case when agg.g_sman = 1 then null when agg.sman is null then 'بدون بائع'
              else coalesce(nullif(pr.full_name, ''), s.name, agg.sman) end,
         agg.invoices, agg.returns, agg.deleted, agg.pieces, agg.grams, agg.net,
         agg.g18, agg.a18, agg.m18, agg.g21, agg.a21, agg.m21,
         agg.tagged, agg.with_cust, agg.days
  from agg
  join amarsoft_branch_map m on m.code = agg.branch_code
  join branches b on b.id = m.branch_id
  left join amarsoft_salesmen s on s.branch_code = agg.branch_code and s.sman = agg.sman
  left join profiles pr on pr.id = s.profile_id
  where agg.g_sman = 1 or agg.sman is null or not public.amarsoft_is_store_sman(agg.branch_code, agg.sman)
  order by agg.branch_code, agg.g_sman desc, agg.grams desc nulls last;
$function$;
revoke execute on function public.amarsoft_branch_eval(timestamptz, timestamptz) from public, anon;

-- ===== (2) تتبّع الحسابات =====
create table if not exists public.user_presence (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  device text not null,           -- نوع الجهاز من المتصفح (آيفون / ويندوز…)
  ip text,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  hits int not null default 1,
  primary key (user_id, day, device)
);
alter table public.user_presence enable row level security;
create policy "admin read presence" on public.user_presence for select using (public.has_role(auth.uid(), 'admin'));

-- يُنادى من التطبيق عند الفتح وكل كم دقيقة: يسجّل اليوم والجهاز والـIP (من رأس الطلب).
create or replace function public.touch_presence(p_device text)
returns void language plpgsql security definer set search_path to 'public'
as $$
declare
  v_ip text;
begin
  if auth.uid() is null then return; end if;
  begin
    v_ip := split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', ''), ',', 1);
  exception when others then v_ip := null;
  end;
  insert into user_presence (user_id, day, device, ip)
  values (auth.uid(), (now() at time zone 'Africa/Tripoli')::date, left(coalesce(nullif(p_device, ''), '؟'), 80), nullif(v_ip, ''))
  on conflict (user_id, day, device) do update
    set last_at = now(), hits = user_presence.hits + 1, ip = coalesce(excluded.ip, user_presence.ip);
end $$;
revoke execute on function public.touch_presence(text) from public, anon;
grant execute on function public.touch_presence(text) to authenticated;

-- ملخّص كل حساب للمدير العام (آخر 30 يوم إلا لو انبعتت فترة).
create or replace function public.admin_account_activity(p_days int default 30)
returns table (user_id uuid, email text, full_name text, role text, branch_name text,
               created_at timestamptz, last_sign_in_at timestamptz, last_seen timestamptz,
               active_days bigint, devices text, device_count bigint, ip_count bigint, open_sessions bigint,
               shared_days bigint, app_sales bigint, app_added bigint, pos_invoices bigint, pos_grams numeric)
language sql stable security definer set search_path to 'public', 'auth'
as $function$
  with since as (select now() - make_interval(days => p_days) t, ((now() - make_interval(days => p_days)) at time zone 'Africa/Tripoli')::date d)
  select u.id, u.email::text, p.full_name,
         (select string_agg(r.role::text, ',') from user_roles r where r.user_id = u.id),
         b.name, u.created_at, u.last_sign_in_at,
         greatest((select max(last_at) from user_presence x where x.user_id = u.id),
                  (select max(coalesce(s.refreshed_at::timestamptz, s.updated_at)) from auth.sessions s where s.user_id = u.id)),
         (select count(distinct day) from user_presence x, since where x.user_id = u.id and x.day >= since.d),
         (select string_agg(distinct x.device, '، ') from user_presence x, since where x.user_id = u.id and x.day >= since.d),
         (select count(distinct x.device) from user_presence x, since where x.user_id = u.id and x.day >= since.d),
         (select count(distinct x.ip) from user_presence x, since where x.user_id = u.id and x.day >= since.d),
         (select count(*) from auth.sessions s where s.user_id = u.id),
         -- أيام انفتح فيها الحساب من جهازين مختلفين بشبكتين مختلفتين: علامة إنه مستعمل من أكثر من واحد.
         (select count(*) from (
            select x.day from user_presence x, since where x.user_id = u.id and x.day >= since.d
            group by x.day having count(distinct x.device) > 1 and count(distinct x.ip) > 1) q),
         (select count(*) from sales sa, since where sa.sold_by = u.id and sa.sold_at >= since.t and sa.returned_at is null),
         (select count(*) from products pd, since where pd.created_by = u.id and pd.created_at >= since.t and pd.status <> 'archived'),
         (select count(*) from amarsoft_invoices a join amarsoft_salesmen sm on sm.branch_code = a.branch_code and sm.sman = a.sman, since
            where sm.profile_id = u.id and a.kind = 'sale' and not a.is_deleted and a.sold_at >= since.t),
         (select round(coalesce(sum((i->>'grams')::numeric), 0), 1)
            from amarsoft_invoices a join amarsoft_salesmen sm on sm.branch_code = a.branch_code and sm.sman = a.sman
            cross join jsonb_array_elements(a.items) i, since
            where sm.profile_id = u.id and a.kind = 'sale' and not a.is_deleted and a.sold_at >= since.t)
  from auth.users u
  left join profiles p on p.id = u.id
  left join branches b on b.id = p.branch_id
  where public.has_role(auth.uid(), 'admin')
  order by 8 desc nulls last;
$function$;
revoke execute on function public.admin_account_activity(int) from public, anon;

-- ===== (3) الأجهزة =====
create or replace function public.admin_user_sessions(p_user uuid default null)
returns table (session_id uuid, user_id uuid, email text, full_name text, user_agent text, ip text,
               created_at timestamptz, last_active timestamptz, is_current boolean)
language sql stable security definer set search_path to 'public', 'auth'
as $function$
  select s.id, s.user_id, u.email::text, p.full_name, s.user_agent, host(s.ip),
         s.created_at, coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at),
         s.id::text = coalesce(auth.jwt()->>'session_id', '')
  from auth.sessions s
  join auth.users u on u.id = s.user_id
  left join profiles p on p.id = s.user_id
  where public.has_role(auth.uid(), 'admin') and (p_user is null or s.user_id = p_user)
  order by 8 desc;
$function$;
revoke execute on function public.admin_user_sessions(uuid) from public, anon;

-- يطلّع حساب من جهاز واحد (p_session) ولا من كل أجهزته. الجهاز اللي تستعمل فيه توا ما يتطلّعش إلا لو طلبته.
-- ملاحظة: الجهاز يتقفل نهائياً لما يحاول يجدّد دخوله (خلال ساعة على الأكثر).
create or replace function public.admin_revoke_sessions(p_user uuid, p_session uuid default null, p_keep_current boolean default true)
returns int language plpgsql security definer set search_path to 'public', 'auth'
as $$
declare n int;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'forbidden'; end if;
  delete from auth.sessions s
  where s.user_id = p_user
    and (p_session is null or s.id = p_session)
    and not (p_keep_current and s.id::text = coalesce(auth.jwt()->>'session_id', ''));
  get diagnostics n = row_count;
  insert into activity_log (actor_id, action, entity_type, entity_id, details)
  select auth.uid(), 'sessions_revoked', 'user', p_user, jsonb_build_object('count', n, 'session', p_session)
  where n > 0;
  return n;
end $$;
revoke execute on function public.admin_revoke_sessions(uuid, uuid, boolean) from public, anon;
