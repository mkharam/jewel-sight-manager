-- فرع بن عاشور (04) محل لوحده بمنظومته: ما يدخلش في الملخّص اليومي، لوحة الولاء، تنبيه «بلا رقم زبون»، ولا ربط بطاقات الولاء.
alter table public.amarsoft_branch_map add column if not exists separate boolean not null default false;
update public.amarsoft_branch_map set separate = true where code = '04';

-- نزيدو الشرط في الدوال الموجودة بتبديل نص محدد، ونتأكدو إنه تبدّل.
do $$
declare
  f text; def text; new_def text;
  subs text[][] := array[
    ['public.daily_amarsoft(date)', 'where a.kind in (''sale'', ''return'') and a.sold_at >= d0 and a.sold_at < d1',
       'where a.kind in (''sale'', ''return'') and a.sold_at >= d0 and a.sold_at < d1 and a.branch_code not in (select code from amarsoft_branch_map where separate)'],
    ['public.loyalty_counter_branches()', 'where auth.uid() is not null and', 'where auth.uid() is not null and not m.separate and'],
    ['public.mstrmnd_sync_candidates_t(text,integer,integer)', 'and a.kind in (''sale'', ''return'') and not a.is_deleted',
       'and a.kind in (''sale'', ''return'') and not a.is_deleted and a.branch_code not in (select code from amarsoft_branch_map where separate)'],
    ['public.amarsoft_invoices_missing_customer()', 'where n.kind = ''sale'' and not n.is_deleted',
       'where n.kind = ''sale'' and not n.is_deleted and n.branch_code not in (select code from amarsoft_branch_map where separate)']
  ];
  i int;
begin
  for i in 1 .. array_length(subs, 1) loop
    def := pg_get_functiondef(subs[i][1]::regprocedure);
    if position(subs[i][2] in def) = 0 then raise exception 'anchor not found in %: %', subs[i][1], subs[i][2]; end if;
    new_def := replace(def, subs[i][2], subs[i][3]);
    execute new_def;
  end loop;
end $$;

-- فروع الملخّص اليومي: بلا الفروع المنفصلة.
do $$
declare def text := pg_get_functiondef('public.daily_amarsoft(date)'::regprocedure);
begin
  execute replace(def, ') x),
    ''invoices''', ') x where not m.separate),
    ''invoices''');
  if position('where not m.separate' in pg_get_functiondef('public.daily_amarsoft(date)'::regprocedure)) = 0 then
    raise exception 'daily branches filter not applied';
  end if;
end $$;
