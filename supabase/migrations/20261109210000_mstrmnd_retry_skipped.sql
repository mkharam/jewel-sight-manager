-- الزبون كثير يشري وبعدين يطلّع البطاقة عند الكاونتر: لو الربط شاف الفاتورة قبل البطاقة يسجّلها «تخطّاها»
-- (no_mstrmnd_customer / no_loyalty_card / no_stamp_card). نعاودو نجربوها لين 48 ساعة من وقت الفاتورة.
-- الفواتير الجديدة أولاً، وبعدها اللي تنعاد.
create or replace function public.mstrmnd_sync_candidates_t(p_mode text, p_template int, p_limit int default 50)
returns table (id bigint, branch_code text, kind text, invoice_no text, net_dirhams bigint, sold_at timestamptz, phone9 text)
language sql stable security definer set search_path to 'public'
as $$
  select a.id, a.branch_code, a.kind, a.invoice_no, a.net_dirhams, a.sold_at,
         right(regexp_replace(a.details->>'phone', '\D', '', 'g'), 9)
  from amarsoft_invoices a
  cross join mstrmnd_sync_settings s
  left join mstrmnd_sync m on m.invoice_id = a.id and m.mode = p_mode and m.template_id = p_template
  where s.id = 1
    and a.sold_at >= case when p_mode = 'live' then s.live_start_at else s.dry_start_at end
    and a.kind in ('sale', 'return') and not a.is_deleted
    and length(regexp_replace(coalesce(a.details->>'phone', ''), '\D', '', 'g')) >= 9
    and not public.amarsoft_internal_customer(a.details->>'customer')
    and (m.invoice_id is null
         or (m.status = 'skipped' and m.reason in ('no_mstrmnd_customer', 'no_loyalty_card', 'no_stamp_card')
             and a.sold_at > now() - interval '48 hours'))
  order by (m.invoice_id is not null), a.sold_at
  limit p_limit;
$$;
