-- الموظفين يقيّموا مشرفهم كل خميس بدل مرتين في الشهر. التقييم الذاتي يبقى مرتين في الشهر.
-- كل خميس: period = الخميس (التقييم يتسلّم الخميس، ولا الجمعة/السبت لو فات).
-- التقييمات القديمة (بالنص: 1 و16) تنحسب على أسبوعها بنفس الدالة.
create or replace function public.eval_week(d date) returns date language sql immutable as $$
  select d - ((extract(dow from d)::int - 4 + 7) % 7)
$$;

-- نفس الدالة (20261123100000_eval_device) — بس تقييم المشرف بالأسبوع.
create or replace function public.eval_submit(p_token text, p jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  is_rec boolean := public.is_eval_admin(auth.uid());
  v_today date := (now() at time zone 'Africa/Tripoli')::date;
  v_day date := coalesce((p->>'day')::date, (p->>'month')::date, (now() at time zone 'Africa/Tripoli')::date);
  v_half date;
  v_week date := public.eval_week(coalesce((p->>'day')::date, (p->>'month')::date, (now() at time zone 'Africa/Tripoli')::date));
  v_period date;
  v_evaluator uuid := (p->>'evaluator_id')::uuid;
  e jsonb;
  v_avg numeric;
  v_absent boolean;
  -- معرّف الجهاز اللي اتبعت منه (عشوائي من المتصفح) — النسخ القديمة ما تبعتهوش.
  v_device text := nullif(left(btrim(coalesce(p->>'device', '')), 64), '');
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
    v_absent := e->>'kind' = 'by_manager' and coalesce((e->>'absent')::boolean, false);
    if v_absent then
      if nullif(btrim(coalesce(e->>'absence_reason', '')), '') is null then
        raise exception 'اكتب سبب الغياب';
      end if;
      v_avg := null;
    else
      select round(avg(v::numeric), 2) into v_avg
      from jsonb_each_text(coalesce(e->'scores', '{}')) as s(k, v) where v ~ '^[1-5]$';
      if v_avg is null then continue; end if;
    end if;
    v_period := case e->>'kind' when 'by_manager' then v_day when 'by_gm' then date_trunc('month', v_day)::date
                    when 'of_manager' then v_week else v_half end;
    -- تقييم قديم بالنص (16) في نفس الأسبوع: التقييم الجديد يحلّ محله، ما يتحسبش مرتين.
    if e->>'kind' = 'of_manager' then
      delete from staff_evaluations where kind = 'of_manager' and evaluator_id = v_evaluator
        and subject_id = (e->>'subject_id')::uuid and period <> v_week and public.eval_week(period) = v_week;
    end if;
    insert into staff_evaluations (period, month, kind, evaluator_id, subject_id, scores, overall, strengths, improvements, notes,
                                   absent, absence_reason, source, entered_by, device_id)
    values (v_period, date_trunc('month', v_period)::date, e->>'kind', v_evaluator,
            case when e->>'kind' = 'self' then v_evaluator else (e->>'subject_id')::uuid end,
            case when v_absent then '{}'::jsonb else e->'scores' end, v_avg,
            nullif(e->>'strengths', ''), nullif(e->>'improvements', ''), nullif(e->>'notes', ''),
            v_absent, case when v_absent then left(btrim(e->>'absence_reason'), 300) end,
            case when is_rec and p_token is null then 'recorder' else 'link' end, auth.uid(), v_device)
    on conflict (period, kind, evaluator_id, subject_id) do update
      set scores = excluded.scores, overall = excluded.overall, strengths = excluded.strengths,
          improvements = excluded.improvements, notes = excluded.notes, absent = excluded.absent,
          absence_reason = excluded.absence_reason, source = excluded.source,
          entered_by = excluded.entered_by, device_id = excluded.device_id, updated_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.eval_submit(text, jsonb) from public;
grant execute on function public.eval_submit(text, jsonb) to anon, authenticated;

-- شن سلّم اللي يقيّم: مين قيّم في اليوم (للمشرف، ومين سجّله غايب)، وهل قيّم نفسه/مشرفه في نص الشهر — بلا درجات.
create or replace function public.eval_status(p_token text, p_evaluator uuid, p_day date)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when (p_token is not null and p_token = (select link_token from eval_config)) or public.is_eval_admin(auth.uid()) then
    jsonb_build_object(
      'rated_day', coalesce((select jsonb_agg(subject_id) from staff_evaluations
                             where kind = 'by_manager' and evaluator_id = p_evaluator and period = p_day), '[]'::jsonb),
      'absent_day', coalesce((select jsonb_agg(subject_id) from staff_evaluations
                             where kind = 'by_manager' and evaluator_id = p_evaluator and period = p_day and absent), '[]'::jsonb),
      'half_done', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'subject', subject_id)) from staff_evaluations
                             where evaluator_id = p_evaluator and (
                               (kind = 'self' and period = case when extract(day from p_day) <= 15 then date_trunc('month', p_day)::date
                                                                else (date_trunc('month', p_day) + interval '15 days')::date end)
                               or (kind = 'of_manager' and public.eval_week(period) = public.eval_week(p_day)))), '[]'::jsonb))
  end
$$;
revoke all on function public.eval_status(text, uuid, date) from public;
grant execute on function public.eval_status(text, uuid, date) to anon, authenticated;
