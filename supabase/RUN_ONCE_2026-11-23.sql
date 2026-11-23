-- شغّل هذا الملف مرة وحدة في Supabase ← SQL Editor ← Run (2026-11-23).
-- يزيد «من أي تليفون اتبعت التقييم» — باش اللوحة تكشف لو تقييم الموظفين لمشرفهم اتبعت من تليفون المشرف.
-- آمن لو تشغّل أكثر من مرة. التقييم يخدم عادي حتى قبل ما تشغّله (بس من غير الكشف).

-- التقييم: «من أي تليفون اتبعت؟» — كل جهاز يبعت مع التقييم معرّف عشوائي محفوظ في المتصفح (مش رقم التليفون
-- ولا أي معلومة عليه). اللوحة تعلّم 📱 لو تقييم الموظفين لمشرفهم اتبعت من نفس التليفون اللي يقيّم منه المشرف
-- نفسه — يعني ممكن المشرف هو اللي عبّاه باسمهم ولا شاف كم عطوه. ما يتغيّرش أي حاجة ثانية في الإرسال.
alter table public.staff_evaluations add column if not exists device_id text;

-- نفس الدالة اللي قبل (20261122120000_eval_daily_half) + حفظ device_id.
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
    v_period := case e->>'kind' when 'by_manager' then v_day when 'by_gm' then date_trunc('month', v_day)::date else v_half end;
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

-- تحديث ذاكرة الـ API باش يشوف التغيير فوراً.
notify pgrst, 'reload schema';
