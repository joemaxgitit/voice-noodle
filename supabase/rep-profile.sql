-- ============================================================
-- Rep profiles: private manager notes and files, sales (KPI) reports,
-- and coaching reviews.
--
-- Everything here is managers and admins only. Reps cannot read their
-- own notes, files, KPI rows or reviews -- enforced by row level security,
-- not just hidden in the app.
--
-- Safe to run more than once.
-- ============================================================

-- The name a rep goes by in the CRM's sales reports, when it differs from
-- their account name ("Shawna Muckey" in the report, "Shawna M" here).
alter table public.profiles add column if not exists kpi_name text;

-- ------------------------------------------------------------
-- 1. Manager notes on a rep
-- ------------------------------------------------------------
create table if not exists public.rep_notes (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  rep_id     uuid not null references public.profiles(id) on delete cascade,
  author_id  uuid references public.profiles(id) on delete set null,
  tag        text not null default 'note' check (tag in ('note','one_on_one','win','concern')),
  body       text not null,
  note_date  date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists rep_notes_rep_idx on public.rep_notes(org_id, rep_id, note_date desc);
-- Vaulted: seen only by the manager who wrote it.
alter table public.rep_notes add column if not exists private boolean not null default false;

-- ------------------------------------------------------------
-- 2. Files on a rep (KPI sheets, screenshots, write-ups, anything)
-- ------------------------------------------------------------
create table if not exists public.rep_files (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  rep_id      uuid not null references public.profiles(id) on delete cascade,
  uploaded_by uuid references public.profiles(id) on delete set null,
  name        text not null,
  path        text not null,             -- rep-files/{org_id}/reps/{rep_id}/{uuid}-{name}
  mime        text,
  size_bytes  bigint,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists rep_files_rep_idx on public.rep_files(org_id, rep_id, created_at desc);

-- ------------------------------------------------------------
-- 3. Sales reports: one upload covers the whole team, one row per rep
-- ------------------------------------------------------------
create table if not exists public.kpi_reports (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  kind         text not null default 'other',      -- 'sales_dashboard' | 'sale_report' | 'other'
  title        text not null,
  file_name    text,
  path         text,                               -- the original file, in rep-files/{org_id}/reports/
  period_start date not null,
  period_end   date not null,
  columns      jsonb not null default '[]'::jsonb, -- [{ key, label, type }] in the file's order
  uploaded_by  uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  check (period_end >= period_start)
);
create index if not exists kpi_reports_org_idx on public.kpi_reports(org_id, period_end desc);

create table if not exists public.kpi_rows (
  id        uuid primary key default gen_random_uuid(),
  org_id    uuid not null references public.orgs(id) on delete cascade,
  report_id uuid not null references public.kpi_reports(id) on delete cascade,
  rep_id    uuid references public.profiles(id) on delete set null,  -- null until matched
  salesman  text not null,                                           -- as written in the report
  data      jsonb not null default '{}'::jsonb
);
create index if not exists kpi_rows_rep_idx on public.kpi_rows(org_id, rep_id);
create index if not exists kpi_rows_report_idx on public.kpi_rows(report_id);

-- ------------------------------------------------------------
-- 4. Coaching reviews written by Claude from everything above
-- ------------------------------------------------------------
create table if not exists public.rep_reviews (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  rep_id      uuid not null references public.profiles(id) on delete cascade,
  created_by  uuid references public.profiles(id) on delete set null,
  status      text not null default 'working' check (status in ('working','done','failed')),
  period_from date,
  period_to   date,
  focus       text,                     -- optional "look especially at..." from the manager
  inputs      jsonb,                    -- what was read: counts of calls, notes, reports, files
  review      jsonb,                    -- the result
  model       text,
  error       text,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists rep_reviews_rep_idx on public.rep_reviews(org_id, rep_id, created_at desc);

-- ------------------------------------------------------------
-- 5. Row level security: managers and admins in the same org only
-- ------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['rep_files','kpi_reports','kpi_rows','rep_reviews'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (public.is_admin() and org_id = public.my_org_id())
         with check (public.is_admin() and org_id = public.my_org_id())',
      t || '_admin_all', t);
  end loop;
end $$;

alter table public.rep_notes enable row level security;
drop policy if exists rep_notes_admin_all on public.rep_notes;
drop policy if exists rep_notes_team on public.rep_notes;
create policy rep_notes_team on public.rep_notes for all to authenticated
using (public.is_admin() and org_id = public.my_org_id() and (not private or author_id = auth.uid()))
with check (public.is_admin() and org_id = public.my_org_id() and (not private or author_id = auth.uid()));

-- ------------------------------------------------------------
-- 6. Private storage for rep files and original reports
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('rep-files', 'rep-files', false)
on conflict (id) do update set public = false;

drop policy if exists rep_files_read on storage.objects;
create policy rep_files_read on storage.objects for select to authenticated
using (bucket_id = 'rep-files' and public.is_admin() and (storage.foldername(name))[1] = public.my_org_id()::text);

drop policy if exists rep_files_insert on storage.objects;
create policy rep_files_insert on storage.objects for insert to authenticated
with check (bucket_id = 'rep-files' and public.is_admin() and (storage.foldername(name))[1] = public.my_org_id()::text);

drop policy if exists rep_files_delete on storage.objects;
create policy rep_files_delete on storage.objects for delete to authenticated
using (bucket_id = 'rep-files' and public.is_admin() and (storage.foldername(name))[1] = public.my_org_id()::text);

-- ------------------------------------------------------------
-- 7. Which way is "better" for each KPI category
--    Guessed from the name (cancels and issues: lower is better); a manager
--    can flip it or hide a category from the monthly comparison.
-- ------------------------------------------------------------
create table if not exists public.kpi_metric_prefs (
  org_id     uuid not null references public.orgs(id) on delete cascade,
  metric_key text not null,
  better     text not null default 'up' check (better in ('up','down','none')),
  hidden     boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (org_id, metric_key)
);
alter table public.kpi_metric_prefs enable row level security;
drop policy if exists kpi_metric_prefs_admin_all on public.kpi_metric_prefs;
create policy kpi_metric_prefs_admin_all on public.kpi_metric_prefs for all to authenticated
using (public.is_admin() and org_id = public.my_org_id())
with check (public.is_admin() and org_id = public.my_org_id());
