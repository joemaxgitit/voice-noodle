-- ============================================================
-- Self-tuning grading for Service and Openers (Sales already has it).
-- 1. Each correction ("Not right?") belongs to a department, by the script
--    the call was graded against, so Sales rules never shape opener or
--    service grades and the other way round.
-- 2. One row of learned lessons per department, written by itself from
--    calls with proven results (chained by lead ID).
-- Safe to run more than once.
-- ============================================================
set lock_timeout = '5s';

-- 1. Department on corrections.
alter table public.call_corrections add column if not exists dept text not null default 'sales';
alter table public.call_corrections drop constraint if exists call_corrections_dept_check;
alter table public.call_corrections add constraint call_corrections_dept_check check (dept in ('sales','service','openers'));

create or replace function public.dept_of_call(p_call uuid)
returns text language sql stable security definer set search_path = public as $$
  select case s.team when 'ams' then 'service' when 'openers' then 'openers' else 'sales' end
  from public.calls c left join public.scripts s on s.id = c.script_id
  where c.id = p_call
$$;

create or replace function public.set_correction_dept()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.dept := coalesce(public.dept_of_call(new.call_id), 'sales');
  return new;
end $$;

drop trigger if exists call_corrections_dept on public.call_corrections;
create trigger call_corrections_dept before insert on public.call_corrections
for each row execute function public.set_correction_dept();

update public.call_corrections c set dept = coalesce(public.dept_of_call(c.call_id), 'sales')
 where dept is distinct from coalesce(public.dept_of_call(c.call_id), 'sales');

create index if not exists call_corrections_dept_idx on public.call_corrections(org_id, dept, created_at desc);

-- 2. Learned lessons per department.
create table if not exists public.dept_guidance (
  org_id      uuid not null references public.orgs(id) on delete cascade,
  dept        text not null check (dept in ('service','openers')),
  lessons     text,
  good_n      integer not null default 0,
  bad_n       integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (org_id, dept)
);

alter table public.dept_guidance enable row level security;

drop policy if exists dept_guidance_admin on public.dept_guidance;
create policy dept_guidance_admin on public.dept_guidance
for all to authenticated
using (public.is_admin() and org_id = public.my_org_id() and (public.my_role() = 'admin' or dept = public.my_side()))
with check (public.is_admin() and org_id = public.my_org_id() and (public.my_role() = 'admin' or dept = public.my_side()));

-- 3. What became of each lead, across every department and the cancel reports.
--    Managers only see their own department's calls, so this hands back just
--    the result per lead ID (enrolled? still paying? cancelled when?) for the
--    lead IDs asked about -- no names, no calls.
create or replace function public.lead_results(p_leads text[])
returns table (lead text, enrolled boolean, retention text, cancelled_on date)
language sql stable security definer set search_path = public as $$
  with asked as (select distinct lower(trim(x)) as lead from unnest(p_leads) x where trim(coalesce(x, '')) <> ''),
  c as (
    select lower(trim(c.client_label)) as lead,
           bool_or(coalesce(c.outcome_manual, c.outcome) = 'enrolled') as enrolled,
           (array_agg(c.retention order by case c.retention when 'graduated' then 1 when 'paid6' then 2 when 'cancelled' then 3 when 'active' then 4 else 5 end))[1] as retention,
           min(c.cancel_date) as cancel_date
    from public.calls c
    join asked a on a.lead = lower(trim(c.client_label))
    where public.is_admin() and c.org_id = public.my_org_id() and c.source <> 'roleplay'
    group by 1
  ),
  r as (
    select lower(trim(r.client_id)) as lead, min(r.requested) as requested
    from public.retention_cancels r
    join asked a on a.lead = lower(trim(r.client_id))
    where public.is_admin() and r.org_id = public.my_org_id()
    group by 1
  )
  select a.lead,
         coalesce(c.enrolled, false),
         case when r.requested is not null and coalesce(c.retention, '') not in ('graduated') then 'cancelled' else c.retention end,
         case when c.cancel_date is null then r.requested when r.requested is null then c.cancel_date else least(c.cancel_date, r.requested) end
  from asked a left join c on c.lead = a.lead left join r on r.lead = a.lead
  where c.lead is not null or r.lead is not null
$$;
grant execute on function public.lead_results(text[]) to authenticated;

notify pgrst, 'reload schema';

-- Check: corrections per department, and the new table.
select dept, count(*) from public.call_corrections group by dept
union all select 'dept_guidance rows', count(*) from public.dept_guidance;
