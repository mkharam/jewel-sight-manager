-- تنبيه «فاتورة بلا رقم الزبون»: لو الزبون مشى ولا ما بغاش يعطي رقمه، الموظف يسكّره بالسبب (يتسجّل مين سكّره)
-- بدل ما يقعد قدامه. والمربع الأحمر يورّي فواتير اليوم بس.
alter table public.amarsoft_missing_customer
  add column if not exists close_reason text check (close_reason in ('left', 'refused')),
  add column if not exists closed_by uuid;

create or replace function public.amarsoft_missing_customer_open(p_branch text default null)
returns table(invoice_id bigint, branch_code text, branch_name text, invoice_no text, sold_at timestamptz, net_ld numeric,
              sman text, customer text, missing text, alerted_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.invoice_id, m.branch_code, regexp_replace(coalesce(b.name, m.branch_code), '^\d+\s*-\s*', ''), m.invoice_no,
         m.sold_at, m.net_ld, coalesce(s.name, m.sman), nullif(trim(a.details->>'customer'), ''), m.missing, m.alerted_at
  from amarsoft_missing_customer m
  join amarsoft_invoices a on a.id = m.invoice_id
  left join amarsoft_branch_map bm on bm.code = m.branch_code
  left join branches b on b.id = bm.branch_id
  left join amarsoft_salesmen s on s.branch_code = m.branch_code and s.sman = m.sman
  where m.resolved_at is null
    and m.sold_at >= (date_trunc('day', now() at time zone 'Africa/Tripoli') at time zone 'Africa/Tripoli')
    and m.branch_code in (select c.code from public.loyalty_counter_branches() c where p_branch is null or c.code = p_branch)
  order by m.sold_at desc;
$$;

-- p_reason: left (الزبون مشى) / refused (ما عطاش رقمه). بس للفروع اللي يشوفها المستخدم.
create or replace function public.amarsoft_missing_customer_close(p_invoice bigint, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_reason not in ('left', 'refused') then raise exception 'unknown reason %', p_reason; end if;
  update amarsoft_missing_customer m
  set resolved_at = now(), resolved_how = 'closed', close_reason = p_reason, closed_by = auth.uid()
  where m.invoice_id = p_invoice and m.resolved_at is null
    and m.branch_code in (select c.code from public.loyalty_counter_branches() c);
  if not found then raise exception 'التنبيه تسكّر قبل'; end if;
end $$;

revoke execute on function public.amarsoft_missing_customer_close(bigint, text) from public, anon;
grant execute on function public.amarsoft_missing_customer_close(bigint, text) to authenticated;
