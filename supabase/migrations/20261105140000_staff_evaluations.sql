-- تقييم الموظفين الشهري.
--  * eval_staff: قائمة اللي يتقيّموا — مستقلة عن حسابات التطبيق (فيه موظفين ما عندهمش حساب).
--  * eval_recorders: المسؤولين على التقييم (أيمن) — يشوفوا اللوحة ويسجّلوا نيابة عن غيرهم.
--  * staff_evaluations: كل تقييم: شهر، نوع (self = تقييم ذاتي، by_manager = المشرف يقيّم موظف،
--    of_manager = الموظف يقيّم مشرفه)، اللي قيّم، اللي اتقيّم، الدرجات (1–5 لكل بند)، وملاحظات.
--  * eval_config: الرمز السري للرابط اللي يتبعت للموظفين — يفتح الاستمارة بلا تسجيل دخول.
-- المدير العام والمسؤولين بس يقروا التقييمات؛ الموظف يرسل من الرابط بدالة eval_submit.

create table public.eval_staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  branch_id uuid references public.branches(id) on delete set null,
  role text not null default 'employee' check (role in ('employee', 'manager')),
  profile_id uuid references public.profiles(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index eval_staff_branch_idx on public.eval_staff (branch_id);
create index eval_staff_profile_idx on public.eval_staff (profile_id);

create table public.eval_recorders (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.staff_evaluations (
  id uuid primary key default gen_random_uuid(),
  month date not null check (extract(day from month) = 1),
  kind text not null check (kind in ('self', 'by_manager', 'of_manager')),
  evaluator_id uuid not null references public.eval_staff(id) on delete cascade,
  subject_id uuid not null references public.eval_staff(id) on delete cascade,
  scores jsonb not null default '{}',
  overall numeric(3, 2),
  strengths text,
  improvements text,
  notes text,
  source text not null default 'link' check (source in ('link', 'recorder')),
  entered_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (month, kind, evaluator_id, subject_id)
);
create index staff_evaluations_month_idx on public.staff_evaluations (month);
create index staff_evaluations_subject_idx on public.staff_evaluations (subject_id);
create index staff_evaluations_evaluator_idx on public.staff_evaluations (evaluator_id);
create index staff_evaluations_entered_by_idx on public.staff_evaluations (entered_by);

create table public.eval_config (
  id boolean primary key default true check (id),
  link_token text not null default substr(md5(random()::text || clock_timestamp()::text), 1, 24)
);
insert into public.eval_config default values;

create or replace function public.is_eval_admin(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(uid, 'admin') or exists (select 1 from eval_recorders r where r.profile_id = uid)
$$;
revoke all on function public.is_eval_admin(uuid) from public, anon;
grant execute on function public.is_eval_admin(uuid) to authenticated;

alter table public.eval_staff enable row level security;
alter table public.eval_recorders enable row level security;
alter table public.staff_evaluations enable row level security;
alter table public.eval_config enable row level security;
create policy "eval admins manage staff" on public.eval_staff for all to authenticated
  using (public.is_eval_admin(auth.uid())) with check (public.is_eval_admin(auth.uid()));
create policy "eval admins read recorders" on public.eval_recorders for select to authenticated
  using (public.is_eval_admin(auth.uid()));
create policy "admin manages recorders" on public.eval_recorders for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
create policy "eval admins manage evaluations" on public.staff_evaluations for all to authenticated
  using (public.is_eval_admin(auth.uid())) with check (public.is_eval_admin(auth.uid()));
create policy "eval admins read config" on public.eval_config for select to authenticated
  using (public.is_eval_admin(auth.uid()));
create policy "admin updates config" on public.eval_config for update to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

-- أول قائمة: موظفين ومشرفين التطبيق (بلا المدير العام وحساب «Staff» العام). الباقي يتزاد من اللوحة.
insert into public.eval_staff (name, branch_id, role, profile_id)
select p.full_name, p.branch_id,
       case when exists (select 1 from user_roles r where r.user_id = p.id and r.role = 'manager') then 'manager' else 'employee' end,
       p.id
from profiles p
where p.is_active and p.full_name <> 'Staff'
  and not exists (select 1 from user_roles r where r.user_id = p.id and r.role = 'admin');

-- الاستمارة: القائمة والشهر. بالرمز السري (الرابط) ولا لمسؤول مسجّل الدخول.
create or replace function public.eval_form(p_token text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when (p_token is not null and p_token = (select link_token from eval_config)) or public.is_eval_admin(auth.uid())
    then jsonb_build_object(
      'staff', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'role', s.role,
                                'branch_id', s.branch_id, 'branch_name', b.name) order by b.name nulls last, s.role desc, s.name), '[]')
                from eval_staff s left join branches b on b.id = s.branch_id where s.active),
      'today', (now() at time zone 'Africa/Tripoli')::date)
    end
$$;
revoke all on function public.eval_form(text) from public;
grant execute on function public.eval_form(text) to anon, authenticated;

-- إرسال تقييم واحد ولا عدة تقييمات من نفس الشخص في نفس الشهر (يحدّث لو اترسل قبل).
-- p: { month: 'YYYY-MM-01', evaluator_id, entries: [{ kind, subject_id, scores: {key: 1..5}, strengths, improvements, notes }] }
create or replace function public.eval_submit(p_token text, p jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  is_rec boolean := public.is_eval_admin(auth.uid());
  v_month date := date_trunc('month', (p->>'month')::date)::date;
  v_evaluator uuid := (p->>'evaluator_id')::uuid;
  e jsonb;
  v_avg numeric;
  n int := 0;
begin
  if not is_rec and (p_token is null or p_token <> (select link_token from eval_config)) then
    raise exception 'الرابط غير صالح — اطلب رابط جديد';
  end if;
  if not exists (select 1 from eval_staff where id = v_evaluator and active) then
    raise exception 'اختار اسمك من القائمة';
  end if;
  if v_month > date_trunc('month', now() at time zone 'Africa/Tripoli')::date
     or v_month < (date_trunc('month', now() at time zone 'Africa/Tripoli') - interval '12 months')::date then
    raise exception 'الشهر غير صالح';
  end if;
  for e in select * from jsonb_array_elements(coalesce(p->'entries', '[]')) loop
    select round(avg(v::numeric), 2) into v_avg
    from jsonb_each_text(coalesce(e->'scores', '{}')) as s(k, v) where v ~ '^[1-5]$';
    if v_avg is null then continue; end if;
    insert into staff_evaluations (month, kind, evaluator_id, subject_id, scores, overall, strengths, improvements, notes, source, entered_by)
    values (v_month, e->>'kind', v_evaluator,
            case when e->>'kind' = 'self' then v_evaluator else (e->>'subject_id')::uuid end,
            e->'scores', v_avg, nullif(e->>'strengths', ''), nullif(e->>'improvements', ''), nullif(e->>'notes', ''),
            case when is_rec and p_token is null then 'recorder' else 'link' end, auth.uid())
    on conflict (month, kind, evaluator_id, subject_id) do update
      set scores = excluded.scores, overall = excluded.overall, strengths = excluded.strengths,
          improvements = excluded.improvements, notes = excluded.notes, source = excluded.source,
          entered_by = excluded.entered_by, updated_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.eval_submit(text, jsonb) from public;
grant execute on function public.eval_submit(text, jsonb) to anon, authenticated;
