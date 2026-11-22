-- التقييم: المشرف يقيّم موظفينه كل يوم، والموظفين (تقييمهم لنفسهم ولمشرفهم) مرتين في الشهر:
-- من 1 لـ 15، ومن 16 لآخر الشهر. تقييم المشرف لنفسه برضو مرتين في الشهر. المدير العام شهري.
--  * period = اليوم (تقييم المشرف اليومي)، ولا أول النص (1 ولا 16)، ولا أول الشهر (المدير العام).
--  * month يبقى = أول شهر الفترة — اللوحة الشهرية تخدم زي ما هي.
alter table public.staff_evaluations add column if not exists period date;
update public.staff_evaluations set period = month where period is null;
alter table public.staff_evaluations alter column period set not null;
alter table public.staff_evaluations drop constraint if exists staff_evaluations_month_kind_evaluator_id_subject_id_key;
create unique index if not exists staff_evaluations_period_key on public.staff_evaluations (period, kind, evaluator_id, subject_id);
create index if not exists staff_evaluations_period_idx on public.staff_evaluations (period);

-- أمان: الشهر دايماً من الفترة.
create or replace function public.staff_evaluations_period() returns trigger language plpgsql as $$
begin
  new.period := coalesce(new.period, new.month);
  new.month := date_trunc('month', new.period)::date;
  return new;
end $$;
drop trigger if exists staff_evaluations_period on public.staff_evaluations;
create trigger staff_evaluations_period before insert or update on public.staff_evaluations
  for each row execute function public.staff_evaluations_period();

-- إرسال التقييم: p = { day: 'YYYY-MM-DD', evaluator_id, entries: [{ kind, subject_id, scores, strengths, improvements, notes }] }
-- (النسخ القديمة تبعت month بدل day — تتقبل). من الرابط: اليوم ولا آخر 3 أيام؛ المسؤول من التطبيق: لين سنة.
create or replace function public.eval_submit(p_token text, p jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  is_rec boolean := public.is_eval_admin(auth.uid());
  v_today date := (now() at time zone 'Africa/Tripoli')::date;
  v_day date := coalesce((p->>'day')::date, (p->>'month')::date, (now() at time zone 'Africa/Tripoli')::date);
  v_half date;
  v_period date;
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
  if v_day > v_today or v_day < v_today - (case when is_rec and p_token is null then 365 else 3 end) then
    raise exception 'التاريخ غير صالح — التقييم لليوم ولا آخر 3 أيام بس';
  end if;
  v_half := case when extract(day from v_day) <= 15 then date_trunc('month', v_day)::date
                 else (date_trunc('month', v_day) + interval '15 days')::date end;
  for e in select * from jsonb_array_elements(coalesce(p->'entries', '[]')) loop
    -- تقييم المدير العام من داخل التطبيق بس، وباسم صف المدير العام.
    if e->>'kind' = 'by_gm' and (not is_rec or not exists (select 1 from eval_staff where id = v_evaluator and role = 'gm')) then
      raise exception 'تقييم المدير العام من لوحة التقييم بس';
    end if;
    select round(avg(v::numeric), 2) into v_avg
    from jsonb_each_text(coalesce(e->'scores', '{}')) as s(k, v) where v ~ '^[1-5]$';
    if v_avg is null then continue; end if;
    v_period := case e->>'kind' when 'by_manager' then v_day when 'by_gm' then date_trunc('month', v_day)::date else v_half end;
    insert into staff_evaluations (period, month, kind, evaluator_id, subject_id, scores, overall, strengths, improvements, notes, source, entered_by)
    values (v_period, date_trunc('month', v_period)::date, e->>'kind', v_evaluator,
            case when e->>'kind' = 'self' then v_evaluator else (e->>'subject_id')::uuid end,
            e->'scores', v_avg, nullif(e->>'strengths', ''), nullif(e->>'improvements', ''), nullif(e->>'notes', ''),
            case when is_rec and p_token is null then 'recorder' else 'link' end, auth.uid())
    on conflict (period, kind, evaluator_id, subject_id) do update
      set scores = excluded.scores, overall = excluded.overall, strengths = excluded.strengths,
          improvements = excluded.improvements, notes = excluded.notes, source = excluded.source,
          entered_by = excluded.entered_by, updated_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.eval_submit(text, jsonb) from public;
grant execute on function public.eval_submit(text, jsonb) to anon, authenticated;

-- شن سلّم اللي يقيّم: مين قيّم في اليوم (للمشرف)، وهل قيّم نفسه/مشرفه في نص الشهر — نعم/لا بس، بلا درجات.
create or replace function public.eval_status(p_token text, p_evaluator uuid, p_day date)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when (p_token is not null and p_token = (select link_token from eval_config)) or public.is_eval_admin(auth.uid()) then
    jsonb_build_object(
      'rated_day', coalesce((select jsonb_agg(subject_id) from staff_evaluations
                             where kind = 'by_manager' and evaluator_id = p_evaluator and period = p_day), '[]'::jsonb),
      'half_done', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'subject', subject_id)) from staff_evaluations
                             where kind in ('self', 'of_manager') and evaluator_id = p_evaluator
                               and period = case when extract(day from p_day) <= 15 then date_trunc('month', p_day)::date
                                                 else (date_trunc('month', p_day) + interval '15 days')::date end), '[]'::jsonb))
  end
$$;
revoke all on function public.eval_status(text, uuid, date) from public;
grant execute on function public.eval_status(text, uuid, date) to anon, authenticated;
