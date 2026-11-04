-- Amarsoft logs "E" when an invoice is opened for editing, even if the edit is cancelled, so only
-- deleted sales send an alert; edits are listed on the Amarsoft sales log tab.
create or replace function public.amarsoft_ingest_doc_events(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_new int := 0; v_alerts int := 0; e record; v_branch text;
begin
  for e in
    insert into amarsoft_doc_events as d (branch_code, trn_type, trn_no, trn_date, status, at, user_name, machine, ip)
    select x->>'branch', x->>'type', x->>'no', nullif(x->>'date','')::date, x->>'status',
           ((x->>'at')::timestamp at time zone 'Africa/Tripoli'), nullif(x->>'user',''), nullif(x->>'machine',''), nullif(x->>'ip','')
    from jsonb_array_elements(coalesce(p->'doc_events','[]'::jsonb)) x
    where nullif(x->>'at','') is not null
    on conflict do nothing
    returning d.*
  loop
    v_new := v_new + 1;
    if e.trn_type = 'RSL' and e.status = 'D' and e.at > now() - interval '1 day' then
      select b.name into v_branch from amarsoft_branch_map m join branches b on b.id = m.branch_id where m.code = e.branch_code;
      perform public.send_push_notification(null, null, 'حذف فاتورة في أمارسوفت',
        format('فاتورة #%s — %s%s', e.trn_no, coalesce(v_branch, e.branch_code), coalesce(' — ' || coalesce(e.user_name, e.machine), '')),
        '/pos-sales?tab=log');
      v_alerts := v_alerts + 1;
    end if;
  end loop;
  return jsonb_build_object('doc_events_new', v_new, 'alerts', v_alerts);
end $$;
revoke all on function public.amarsoft_ingest_doc_events(jsonb) from public, anon, authenticated;
grant execute on function public.amarsoft_ingest_doc_events(jsonb) to service_role;
