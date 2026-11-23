-- ============================================================
-- Link every call by the client's phone number, read from the recording's
-- file name. Sales and Service files (Convoso) and Opener files each carry
-- the lead's number, even though their lead / file IDs differ:
--   Convoso: ..._3473287197_<caller id>_10132026_055606.mp3
--   Opener:  Camp3175_Conv_(347)328-7197_LO6666661133_Oct13-055606PM.mp3
-- The lead ID field stays as it is; the phone is an extra link on top.
-- Fills in every call already uploaded. Safe to run more than once.
-- ============================================================
set lock_timeout = '5s';

alter table public.calls add column if not exists phone text;

create or replace function public.phone_from_file(p_name text)
returns text language sql immutable as $$
  select coalesce(
    -- Opener: (347)328-7197
    (select m[1] || m[2] || m[3] from regexp_match(p_name, '\((\d{3})\)\s*(\d{3})-(\d{4})') m),
    -- Convoso: _<client number>[_<caller id>]_MMDDYYYY_HHMMSS
    (select right(m[1], 10) from regexp_match(regexp_replace(p_name, '\s*(\(\d+\)|-\s*copy(\s*\(\d+\))?)(?=\.\w+$)', '', 'i'), '_(\d{10,11})(_\d{10,11})?_\d{8}_\d{6}\.\w+$') m)
  )
$$;

-- Every call already uploaded.
update public.calls set phone = public.phone_from_file(file_name)
 where phone is null and file_name is not null and public.phone_from_file(file_name) is not null;

-- And every new one, whatever the page sends.
create or replace function public.set_call_phone()
returns trigger language plpgsql as $$
begin
  if new.phone is null and new.file_name is not null then new.phone := public.phone_from_file(new.file_name); end if;
  return new;
end $$;
drop trigger if exists calls_phone on public.calls;
create trigger calls_phone before insert or update of file_name on public.calls
for each row execute function public.set_call_phone();

create index if not exists calls_phone_idx on public.calls(org_id, phone) where phone is not null;

-- What became of each client, by phone, across every department and the
-- cancel reports (matched through the lead IDs on that phone's calls).
-- Managers only see their own department's calls, so this hands back just
-- the result per phone -- no names, no calls.
create or replace function public.phone_results(p_phones text[])
returns table (phone text, enrolled boolean, retention text, cancelled_on date)
language sql stable security definer set search_path = public as $$
  with asked as (select distinct right(regexp_replace(x, '\D', '', 'g'), 10) as phone from unnest(p_phones) x),
  pc as (
    select c.phone, c.client_label, c.outcome, c.outcome_manual, c.retention, c.cancel_date
    from public.calls c join asked a on a.phone = c.phone
    where public.is_admin() and c.org_id = public.my_org_id() and c.source <> 'roleplay'
  ),
  agg as (
    select phone,
           bool_or(coalesce(outcome_manual, outcome) = 'enrolled') as enrolled,
           (array_agg(retention order by case retention when 'graduated' then 1 when 'paid6' then 2 when 'cancelled' then 3 when 'active' then 4 else 5 end))[1] as retention,
           min(cancel_date) as cancel_date
    from pc group by phone
  ),
  r as (
    select pc.phone, min(r.requested) as requested
    from pc join public.retention_cancels r
      on lower(trim(r.client_id)) = lower(trim(pc.client_label)) and r.org_id = public.my_org_id()
    where pc.client_label is not null
    group by pc.phone
  )
  select agg.phone,
         coalesce(agg.enrolled, false),
         case when r.requested is not null and coalesce(agg.retention, '') <> 'graduated' then 'cancelled' else agg.retention end,
         case when agg.cancel_date is null then r.requested when r.requested is null then agg.cancel_date else least(agg.cancel_date, r.requested) end
  from agg left join r on r.phone = agg.phone
$$;
grant execute on function public.phone_results(text[]) to authenticated;

-- Every call on one phone number, in every department, for the call page --
-- just enough to link to (admins can open any of them; managers only their side's).
create or replace function public.calls_on_phone(p_phone text)
returns table (id uuid, call_date date, created_at timestamptz, dept text, rep text, result text, score integer)
language sql stable security definer set search_path = public as $$
  select c.id, c.call_date, c.created_at,
         case s.team when 'ams' then 'Service' when 'openers' then 'Openers' else 'Sales' end,
         coalesce(p.full_name, c.rep_name),
         coalesce(c.outcome_manual, c.outcome),
         round(c.score)::integer
  from public.calls c
  left join public.scripts s on s.id = c.script_id
  left join public.profiles p on p.id = c.rep_id
  where public.is_admin() and c.org_id = public.my_org_id() and c.source <> 'roleplay'
    and c.phone = right(regexp_replace(p_phone, '\D', '', 'g'), 10)
  order by coalesce(c.call_date, c.created_at::date), c.created_at
$$;
grant execute on function public.calls_on_phone(text) to authenticated;

notify pgrst, 'reload schema';

-- Check: how many calls now carry a phone, by department.
select case s.team when 'ams' then 'Service' when 'openers' then 'Openers' else 'Sales' end as dept,
       count(*) as calls, count(c.phone) as with_phone, count(distinct c.phone) as phones
from public.calls c left join public.scripts s on s.id = c.script_id
where c.source <> 'roleplay'
group by 1 order by 1;
