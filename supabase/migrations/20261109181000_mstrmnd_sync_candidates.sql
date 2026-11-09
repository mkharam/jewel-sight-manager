-- فواتير ما تبعتتش بعد لوضع معيّن: بيع أو مرتجع، مش محذوفة، فيها رقم هاتف، مش زبون داخلي، ومن تاريخ بداية الوضع.
create or replace function public.mstrmnd_sync_candidates(p_mode text, p_limit int default 50)
returns table (id bigint, branch_code text, kind text, invoice_no text, net_dirhams bigint, sold_at timestamptz, phone9 text)
language sql stable security definer set search_path to 'public'
as $$
  select a.id, a.branch_code, a.kind, a.invoice_no, a.net_dirhams, a.sold_at,
         right(regexp_replace(a.details->>'phone', '\D', '', 'g'), 9)
  from amarsoft_invoices a
  cross join mstrmnd_sync_settings s
  where s.id = 1
    and a.sold_at >= case when p_mode = 'live' then s.live_start_at else s.dry_start_at end
    and a.kind in ('sale', 'return') and not a.is_deleted
    and length(regexp_replace(coalesce(a.details->>'phone', ''), '\D', '', 'g')) >= 9
    and not public.amarsoft_internal_customer(a.details->>'customer')
    and not exists (select 1 from mstrmnd_sync m where m.invoice_id = a.id and m.mode = p_mode)
  order by a.sold_at
  limit p_limit;
$$;

-- فواتير تبعتت (أو كانت بتتبعت في التجربة) وبعدها انحذفت في أمارسوفت → لازم ينقص مبلغها من البطاقة.
create or replace function public.mstrmnd_sync_reversals(p_mode text)
returns table (invoice_id bigint, amount_ld bigint, card_id bigint, branch_code text, invoice_no text)
language sql stable security definer set search_path to 'public'
as $$
  select m.invoice_id, m.amount_ld, m.card_id, a.branch_code, a.invoice_no
  from mstrmnd_sync m
  join amarsoft_invoices a on a.id = m.invoice_id
  where m.mode = p_mode and m.action = 'add' and m.status in ('sent', 'would_send') and a.is_deleted
  limit 50;
$$;

revoke execute on function public.mstrmnd_sync_candidates(text, int) from public, anon, authenticated;
revoke execute on function public.mstrmnd_sync_reversals(text) from public, anon, authenticated;
