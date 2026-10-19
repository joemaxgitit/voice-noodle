-- ============================================================
-- The Friday Retention Lookback, sales side only.
--   retention_reports: one per upload (the window it covers + team totals)
--   retention_reps:    each rep's cancelled-before-1st rate, its change,
--                      requests, and the point-of-sale reasons clients left
-- No client names, no escalations, no retention AM numbers.
-- Managers see only their own side's reps. Safe to run more than once.
-- ============================================================

create table if not exists public.retention_reports (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  period_start date not null,
  period_end   date not null,
  team         jsonb not null default '{}'::jsonb,
  file_name    text,
  path         text,
  uploaded_by  uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (org_id, period_start, period_end)
);

create table if not exists public.retention_reps (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  report_id     uuid not null references public.retention_reports(id) on delete cascade,
  rep_id        uuid references public.profiles(id) on delete set null,
  salesman      text not null,
  deals         numeric,
  before1_rate  numeric,
  prior_rate    numeric,
  pending_share numeric,
  requests      integer,
  pos_lost      integer not null default 0,
  pos_reasons   jsonb not null default '{}'::jsonb
);
create index if not exists retention_reps_rep_idx on public.retention_reps(org_id, rep_id);

alter table public.retention_reports enable row level security;
alter table public.retention_reps enable row level security;
grant select, insert, update, delete on public.retention_reports, public.retention_reps to authenticated;

drop policy if exists retention_reports_admin_all on public.retention_reports;
create policy retention_reports_admin_all on public.retention_reports for all to authenticated
using (public.is_admin() and org_id = public.my_org_id())
with check (public.is_admin() and org_id = public.my_org_id());

drop policy if exists retention_reps_admin_all on public.retention_reps;
create policy retention_reps_admin_all on public.retention_reps for all to authenticated
using (public.is_admin() and org_id = public.my_org_id() and public.can_see_person(rep_id))
with check (public.is_admin() and org_id = public.my_org_id() and public.can_see_person(rep_id));

select 'retention ready' as result;
