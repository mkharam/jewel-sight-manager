-- تقييم المدير العام: يقيّم كل موظف ومشرف على اللي يهمّه هو (الحضور والانصراف، الالتزام بالقوانين،
-- النتائج…) — منفصل على تقييم المشرف. «المدير العام» صف في eval_staff بدور gm (ما يطلعش في قائمة
-- الرابط)، والنوع by_gm ما يتسجّلش إلا من المدير العام ولا مسؤول التقييم داخل التطبيق.
alter table public.eval_staff drop constraint eval_staff_role_check;
alter table public.eval_staff add constraint eval_staff_role_check check (role in ('employee', 'manager', 'gm'));
alter table public.staff_evaluations drop constraint staff_evaluations_kind_check;
alter table public.staff_evaluations add constraint staff_evaluations_kind_check check (kind in ('self', 'by_manager', 'of_manager', 'by_gm'));

insert into public.eval_staff (name, role, profile_id)
select 'المدير العام', 'gm', p.id from profiles p
where p.full_name = 'المدير العام' and not exists (select 1 from eval_staff where role = 'gm')
limit 1;

create or replace function public.eval_form(p_token text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when (p_token is not null and p_token = (select link_token from eval_config)) or public.is_eval_admin(auth.uid())
    then jsonb_build_object(
      'staff', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'role', s.role,
                                'branch_id', s.branch_id, 'branch_name', b.name) order by b.name nulls last, s.role desc, s.name), '[]')
                from eval_staff s left join branches b on b.id = s.branch_id where s.active and s.role <> 'gm'),
      'gm_id', case when public.is_eval_admin(auth.uid()) then (select id from eval_staff where role = 'gm' and active limit 1) end,
      'today', (now() at time zone 'Africa/Tripoli')::date)
    end
$$;

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
    -- تقييم المدير العام من داخل التطبيق بس، وباسم صف المدير العام.
    if e->>'kind' = 'by_gm' and (not is_rec or not exists (select 1 from eval_staff where id = v_evaluator and role = 'gm')) then
      raise exception 'تقييم المدير العام من لوحة التقييم بس';
    end if;
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
