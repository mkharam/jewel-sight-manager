-- مراجعة البطاقات: المسحة اللي الموظف رجّعها بيده بعدها (Refund of amount spent بنفس المبلغ في يومين) ما تتحسبش
-- زيادة، والزيادة على البطاقة (واللي ينقص منها) ما تتعداش مجموعها.

create or replace function public.loyalty_card_review()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  cfg mstrmnd_sync_settings;
  res jsonb;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'admins only'; end if;
  select * into cfg from mstrmnd_sync_settings where id = 1;

  with mem as (
    select c.id, c.full_name, c.phone9, c.synced_at, k lc, (k->>'card_id')::bigint card_id,
           coalesce((k->>'purchases')::numeric, 0) card_total, nullif(trim(k->>'level'), '') lvl,
           (k->>'discount_pct')::numeric pct, to_timestamp((k->>'card_created')::bigint) card_at,
           translate(coalesce(c.full_name, ''), 'أإآةى', 'اااهي') nm
    from mstrmnd_customers c cross join jsonb_array_elements(c.cards) k
    where (k->>'template_id')::int = cfg.template_id
  ),
  inv as (
    select a.id, a.branch_code, a.invoice_no, a.invoice_date, a.sold_at, a.first_seen_at, a.kind, a.net_dirhams / 1000.0 ld,
           a.details->>'customer' cust, translate(coalesce(a.details->>'customer', ''), 'أإآةى', 'اااهي') cnm,
           case when length(regexp_replace(coalesce(a.details->>'phone', ''), '\D', '', 'g')) >= 9
                then right(regexp_replace(a.details->>'phone', '\D', '', 'g'), 9) end p9,
           (coalesce((a.details->>'discount_dirhams')::numeric, 0)
            + coalesce((select sum((it->>'discount_dirhams')::numeric) from jsonb_array_elements(a.items) it), 0)) / 1000.0 disc
    from amarsoft_invoices a
    where a.kind in ('sale', 'return') and not a.is_deleted and not public.amarsoft_internal_customer(a.details->>'customer')
  ),
  scans as (
    select t.id tx_id, t.customer_id cid, t.amount, t.created_at, (t.created_at at time zone 'Africa/Tripoli')::date d, t.location
    from mstrmnd_transactions t join mem m on m.id = t.customer_id
    where t.template_id = cfg.template_id and t.operation = 'Transaction amount' and not t.reversed and t.amount > 0
      -- اللي زادهم الربط ولا تصحيح 9 نوفمبر (بلا فرع ولا موظف) مربوطين بفواتيرهم أصلاً.
      and not (t.manager is null and t.location is null and t.created_at >= cfg.live_start_at - interval '1 day')
      -- الموظف رجّعها بيده بعدها (Refund بنفس المبلغ في يومين): مش على البطاقة.
      and not exists (select 1 from mstrmnd_transactions r where r.customer_id = t.customer_id and r.template_id = t.template_id
                        and r.operation = 'Refund of amount spent' and not r.reversed and abs(r.amount - t.amount) < 1
                        and r.created_at between t.created_at and t.created_at + interval '2 days')
  ),
  matched as (
    select s.*, mt.inv_id, mt.inv, mt.inv_date, mt.inv_ld, mt.inv_cust, mt.how, mt.other_phone
    from scans s
    join mem m on m.id = s.cid
    left join lateral (
      select i.id inv_id, i.branch_code || '-' || i.invoice_no inv, i.invoice_date inv_date, i.ld inv_ld, i.cust inv_cust,
             case when abs(i.ld - s.amount) > greatest(5, s.amount * 0.02) then 'partial'
                  when i.p9 = m.phone9 then 'phone' else 'no_phone' end how,
             coalesce(i.p9 <> m.phone9, false) other_phone
      from inv i
      where i.kind = 'sale' and i.invoice_date between s.d - 1 and s.d + 1
        and (abs(i.ld - s.amount) <= greatest(5, s.amount * 0.02)
             or (abs(i.ld - s.amount) <= s.amount * 0.1
                 and (i.p9 = m.phone9 or exists (
                   select 1 from regexp_split_to_table(m.nm, '\s+') w
                   where length(w) >= 4 and w not in ('محمد', 'احمد', 'محمود', 'مصطفي', 'عبدالله', 'عبدالرحمن')
                     and i.cnm like '%' || w || '%'))))
      order by (i.p9 = m.phone9) desc nulls last, abs(i.ld - s.amount), abs(i.invoice_date - s.d)
      limit 1
    ) mt on true
  ),
  items as (
    select x.*,
           greatest(case x.how2 when 'none' then x.amount when 'duplicate' then x.amount
                                when 'partial' then x.amount - x.inv_ld else 0 end, 0) extra,
           r.decision, r.decided_at, r.amount removed,
           (select coalesce(b.http_status, h.status_code) from mstrmnd_backfill b left join net._http_response h on h.id = b.request_id
            where b.seq = r.backfill_seq) removal_http
    from (
      select mm.*,
             case when mm.inv_id is null then 'none'
                  when row_number() over (partition by mm.cid, mm.inv_id order by abs(mm.amount - mm.inv_ld), mm.created_at) > 1
                    or exists (select 1 from mstrmnd_sync z where z.invoice_id = mm.inv_id and z.mode = 'live'
                                 and z.template_id = cfg.template_id and z.status = 'sent') then 'duplicate'
                  else mm.how end how2
      from matched mm
    ) x
    left join loyalty_card_review_decisions r on r.tx_id = x.tx_id
  ),
  cards as (
    select m.*,
           (select coalesce(sum(i.ld), 0) from inv i where i.p9 = m.phone9) by_phone,
           -- الزيادة ما تتعداش مجموع البطاقة (لو تنقص شي بيد في MSTRMND).
           least(m.card_total, (select coalesce(sum(it.extra), 0) from items it where it.cid = m.id and it.decision is null)) open_extra,
           (select count(*) from items it where it.cid = m.id and it.how2 = 'no_phone' and not it.other_phone) phone_fix
    from mem m
  )
  select jsonb_build_object(
    'synced_at', (select max(synced_at) from mem),
    'cards', coalesce((select jsonb_agg(jsonb_build_object(
        'customer_id', c.id, 'card_id', c.card_id, 'name', c.full_name, 'phone9', c.phone9, 'level', c.lvl, 'pct', c.pct,
        'card_at', c.card_at, 'card_total', c.card_total, 'by_phone', c.by_phone, 'open_extra', c.open_extra,
        'phone_fix', c.phone_fix,
        'tier_without', case when c.open_extra > 0 then (select t.tier from public.loyalty_tier_for(c.card_total - c.open_extra) t) end,
        'scans', coalesce((select jsonb_agg(jsonb_build_object(
            'tx_id', it.tx_id, 'at', it.created_at, 'amount', it.amount, 'how', it.how2, 'inv', it.inv, 'inv_date', it.inv_date,
            'inv_ld', it.inv_ld, 'inv_cust', it.inv_cust, 'other_phone', it.other_phone, 'extra', it.extra,
            'decision', it.decision, 'decided_at', it.decided_at, 'removed', it.removed, 'removal_http', it.removal_http)
            order by it.created_at) from items it where it.cid = c.id), '[]'::jsonb),
        -- فواتيره برقمه من وقت البطاقة: الخصم المسجّل في أمارسوفت مقابل اللي يستاهله (القديمة تقريبية).
        'invoices', coalesce((select jsonb_agg(jsonb_build_object(
            'inv', i.branch_code || '-' || i.invoice_no, 'date', i.invoice_date, 'ld', i.ld, 'disc', i.disc,
            'pct', public.loyalty_card_pct_at(c.lc, i.sold_at, i.first_seen_at),
            'approx', i.sold_at < cfg.live_start_at) order by i.sold_at desc)
            from inv i where i.p9 = c.phone9 and i.kind = 'sale' and i.sold_at >= c.card_at), '[]'::jsonb)
      ) order by c.open_extra desc, c.phone_fix desc, c.card_total desc) from cards c), '[]'::jsonb)
  ) into res;
  return res;
end $$;

-- قرار المدير على مسحة: keep (خليها) / remove (نقّص الزيادة من البطاقة) / undo (رجّع «خليها» للمراجعة).
-- المبلغ اللي ينقص يتحسب هنا من loyalty_card_review، مش من المتصفح.
create or replace function public.loyalty_card_review_decide(p_tx bigint, p_decision text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c jsonb;
  it jsonb;
  tok text;
  amt numeric;
  v_seq int;
  cur text;
  again boolean;
  note text;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'admins only'; end if;
  if p_decision not in ('keep', 'remove', 'undo') then raise exception 'unknown decision %', p_decision; end if;
  select r.decision into cur from loyalty_card_review_decisions r where r.tx_id = p_tx;
  if cur = 'remove' then raise exception 'المسحة هذي تنقصت من البطاقة قبل'; end if;
  if p_decision = 'undo' then
    delete from loyalty_card_review_decisions where tx_id = p_tx;
    return jsonb_build_object('ok', true);
  end if;

  select x.value, y.value into c, it
  from jsonb_array_elements(public.loyalty_card_review()->'cards') x, jsonb_array_elements(x.value->'scans') y
  where (y.value->>'tx_id')::bigint = p_tx;
  if it is null then raise exception 'المسحة مش موجودة'; end if;

  if p_decision = 'keep' then
    insert into loyalty_card_review_decisions (tx_id, customer_id, decision, amount, decided_by)
    values (p_tx, c->>'customer_id', 'keep', 0, auth.uid())
    on conflict (tx_id) do update set decision = 'keep', amount = 0, decided_by = excluded.decided_by, decided_at = now();
    return jsonb_build_object('ok', true);
  end if;

  amt := least(round((it->>'extra')::numeric), floor((c->>'card_total')::numeric));
  if amt is null or amt < 1 then raise exception 'ما فيش زيادة تنقص من المسحة هذي'; end if;
  select a.access_token into tok from mstrmnd_auth a where a.id = 1 and a.access_expires_at > now() + interval '3 minutes';
  if tok is null then raise exception 'الربط مع MSTRMND قاعد يجدد الدخول، جرب بعد دقيقتين'; end if;
  if not public.mstrmnd_link_acquire(60) then raise exception 'الربط قاعد يبعت فواتير توا، جرب بعد دقيقة'; end if;

  note := 'مراجعة البطاقات: ' || case it->>'how'
    when 'partial' then 'فرق على فاتورة ' || (it->>'inv')
    when 'duplicate' then 'مسحة مكررة لفاتورة ' || (it->>'inv')
    else 'مسحة ' || to_char((it->>'at')::timestamptz at time zone 'Africa/Tripoli', 'YYYY-MM-DD') || ' بلا فاتورة' end;
  insert into mstrmnd_backfill (op, customer_id, customer_name, card_id, tx_id, amount, note, request_id)
  values ('review_remove', c->>'customer_id', c->>'name', (c->>'card_id')::bigint, p_tx, amt, note,
    net.http_post(url := 'https://api.digitalwallet.cards/cards/' || (c->>'card_id') || '/subtract-point',
      headers := jsonb_build_object('Authorization', 'Bearer ' || tok, 'Accept', 'application/json', 'Content-Type', 'application/json'),
      body := jsonb_build_object('sourceType', 1, 'points', amt::int, 'comment', note, 'purchaseSum', null),
      timeout_milliseconds := 60000))
  returning seq into v_seq;
  insert into loyalty_card_review_decisions (tx_id, customer_id, decision, amount, backfill_seq, decided_by)
  values (p_tx, c->>'customer_id', 'remove', amt, v_seq, auth.uid())
  on conflict (tx_id) do update set decision = 'remove', amount = excluded.amount, backfill_seq = excluded.backfill_seq,
    decided_by = excluded.decided_by, decided_at = now();

  -- نفكو القفل، ونسخة البطاقات تتعاود كاملة في دورة الربط الجاية (≤ 10 دقايق) باش المجموع والمستوى الجديد يبانو.
  select s.rerun into again from mstrmnd_sync_settings s where s.id = 1 for update;
  update mstrmnd_sync_settings set run_until = null, rerun = false, mirror_at = null where id = 1;
  if again then perform public.mstrmnd_kick(); end if;
  return jsonb_build_object('ok', true, 'amount', amt);
end $$;
