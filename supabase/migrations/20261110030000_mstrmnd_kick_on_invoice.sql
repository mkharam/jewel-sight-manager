-- الفاتورة اللي فيها رقم زبون توصل من أمارسوفت (ولا تتبدّل) → الربط مع MSTRMND يشتغل في نفس اللحظة.
-- مرة وحدة لكل دفعة (statement)، مش لكل فاتورة. يطلب قفل mstrmnd_link_acquire في mstrmnd-link (لازم يتنشر قبل هذا).
create or replace function public.amarsoft_invoices_kick_mstrmnd()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from new_rows n
             where n.kind in ('sale', 'return') and n.sold_at > now() - interval '3 days'
               and length(regexp_replace(coalesce(n.details->>'phone', ''), '\D', '', 'g')) >= 9) then
    perform public.mstrmnd_kick();
  end if;
  return null;
end $$;

drop trigger if exists trg_amarsoft_invoices_kick_ins on public.amarsoft_invoices;
drop trigger if exists trg_amarsoft_invoices_kick_upd on public.amarsoft_invoices;
create trigger trg_amarsoft_invoices_kick_ins after insert on public.amarsoft_invoices
  referencing new table as new_rows for each statement execute function public.amarsoft_invoices_kick_mstrmnd();
create trigger trg_amarsoft_invoices_kick_upd after update on public.amarsoft_invoices
  referencing new table as new_rows for each statement execute function public.amarsoft_invoices_kick_mstrmnd();
