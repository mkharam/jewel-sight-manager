-- Leaderboard with weight and pieces, per branch or all branches, plus how many sales are tagged.
-- Amounts only for admins; weight/pieces/invoices for every signed-in staff member.

create or replace function public.amarsoft_leaderboard_v2(p_start timestamptz, p_end timestamptz, p_branch text default null)
returns table (branch_code text, branch_name text, sman text, salesman_name text, profile_id uuid,
               invoices bigint, returns bigint, pieces numeric, grams numeric, pure_grams numeric, net_dirhams bigint)
language sql
stable
security definer
set search_path = public
as $$
  with inv as (
    select a.branch_code, a.sman, a.kind, a.net_dirhams,
           (select coalesce(sum((i->>'pcs')::numeric), 0) from jsonb_array_elements(a.items) i) pcs,
           (select coalesce(sum((i->>'grams')::numeric), 0) from jsonb_array_elements(a.items) i) g,
           (select coalesce(sum((i->>'pure_grams')::numeric), 0) from jsonb_array_elements(a.items) i) pg
    from amarsoft_invoices a
    where not a.is_deleted and a.sman is not null and a.sold_at >= p_start and a.sold_at < p_end
      and (p_branch is null or a.branch_code = p_branch)
  ), t as (
    select branch_code, sman,
           count(*) filter (where kind = 'sale') invoices,
           count(*) filter (where kind = 'return') returns,
           sum(case when kind = 'return' then -pcs else pcs end) pieces,
           sum(case when kind = 'return' then -g else g end) grams,
           sum(case when kind = 'return' then -pg else pg end) pure_grams,
           sum(net_dirhams)::bigint net
    from inv group by 1, 2
  )
  select t.branch_code, b.name, t.sman, coalesce(nullif(pr.full_name, ''), s.name, t.sman), s.profile_id,
         t.invoices, t.returns, t.pieces, round(t.grams, 2), round(t.pure_grams, 3),
         case when public.has_role(auth.uid(), 'admin') then t.net end
  from t
  join amarsoft_branch_map m on m.code = t.branch_code
  join branches b on b.id = m.branch_id
  left join amarsoft_salesmen s on s.branch_code = t.branch_code and s.sman = t.sman
  left join profiles pr on pr.id = s.profile_id
  where auth.uid() is not null
  order by t.net desc;
$$;
revoke all on function public.amarsoft_leaderboard_v2(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.amarsoft_leaderboard_v2(timestamptz, timestamptz, text) to authenticated;

-- Per branch: sales in the period and how many carry a salesman (the Carrier box in Amarsoft).
create or replace function public.amarsoft_branch_tagging(p_start timestamptz, p_end timestamptz)
returns table (branch_code text, branch_name text, invoices bigint, tagged bigint, salesmen bigint)
language sql
stable
security definer
set search_path = public
as $$
  select m.code, b.name,
         count(a.id) filter (where a.kind = 'sale'),
         count(a.id) filter (where a.kind = 'sale' and a.sman is not null),
         (select count(*) from amarsoft_salesmen s where s.branch_code = m.code and s.is_active)
  from amarsoft_branch_map m
  join branches b on b.id = m.branch_id
  left join amarsoft_invoices a on a.branch_code = m.code and not a.is_deleted and a.sold_at >= p_start and a.sold_at < p_end
  where auth.uid() is not null
  group by m.code, b.name
  order by m.code;
$$;
revoke all on function public.amarsoft_branch_tagging(timestamptz, timestamptz) from public, anon;
grant execute on function public.amarsoft_branch_tagging(timestamptz, timestamptz) to authenticated;

-- New Amarsoft salesmen link themselves to the app employee of the same branch with the same
-- name (spaces, hamza and ta marbuta forms ignored). Admins can still change it in the app.
create or replace function public.amarsoft_name_key(p text)
returns text language sql immutable as $$
  select nullif(translate(regexp_replace(lower(coalesce(p, '')), '\s+', '', 'g'), 'أإآةى', 'اااهي'), '')
$$;

create or replace function public.amarsoft_salesmen_autolink()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.profile_id is null and new.name is not null then
    select p.id into new.profile_id
    from profiles p
    join amarsoft_branch_map m on m.code = new.branch_code
    where p.branch_id = m.branch_id and amarsoft_name_key(p.full_name) = amarsoft_name_key(new.name)
    order by p.created_at limit 1;
  end if;
  return new;
end $$;

create trigger trg_amarsoft_salesmen_autolink
  before insert or update of name on public.amarsoft_salesmen
  for each row execute function public.amarsoft_salesmen_autolink();
