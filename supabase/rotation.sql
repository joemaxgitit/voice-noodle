-- ============================================================
-- Rotation and daily activity. One row per rep per working day from the
-- nightly Sales Dashboard upload (or the history import): talk time,
-- calls, deals, the points they add up to, and whether the rep made
-- rotation for the next working day's leads.
-- Managers see everyone; a rep sees only their own rows.
-- Safe to run more than once.
-- ============================================================

create table if not exists public.rep_daily (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  rep_id        uuid references public.profiles(id) on delete cascade,
  salesman      text not null,            -- the rep's name as the report wrote it (tidied)
  day           date not null,            -- the day worked
  for_day       date not null,            -- the leads day it decides (next working day)
  talk_hours    numeric,
  calls         integer,
  deals         numeric,
  points        numeric,                  -- null when the history import had no numbers
  status        text not null default 'worked' check (status in ('worked','absent')),
  made          boolean not null default false,
  override_made boolean,                  -- a manager's call, when it differs from the numbers
  override_note text,
  source        text not null default 'upload' check (source in ('upload','import','manual')),
  report_id     uuid references public.kpi_reports(id) on delete set null,
  updated_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, salesman, day)
);
-- If an earlier version of this table already exists, bring it up to date.
alter table public.rep_daily add column if not exists status text not null default 'worked';
alter table public.rep_daily alter column points drop not null;
alter table public.rep_daily drop constraint if exists rep_daily_status_check;
alter table public.rep_daily add constraint rep_daily_status_check check (status in ('worked','absent'));

create index if not exists rep_daily_rep_idx on public.rep_daily(org_id, rep_id, day desc);
create index if not exists rep_daily_day_idx on public.rep_daily(org_id, day desc);

alter table public.rep_daily enable row level security;

drop policy if exists rep_daily_admin_all on public.rep_daily;
create policy rep_daily_admin_all on public.rep_daily for all to authenticated
using (public.is_admin() and org_id = public.my_org_id())
with check (public.is_admin() and org_id = public.my_org_id());

drop policy if exists rep_daily_own_read on public.rep_daily;
create policy rep_daily_own_read on public.rep_daily for select to authenticated
using (rep_id = auth.uid());

select 'rotation ready' as result;
