-- The answer key: calls the super admin grades by hand once, and the tests run against them.
set lock_timeout = '5s'; -- gives up instead of freezing the app if busy; just run it again

-- The manager's answers, one row per call.
create table if not exists public.grading_benchmark (
  call_id    uuid primary key references public.calls(id) on delete cascade,
  org_id     uuid not null references public.orgs(id) on delete cascade,
  key        jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One test of the grader against every keyed call.
create table if not exists public.grading_benchmark_runs (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  purpose        text not null,              -- manual | version | rules | baseline
  grader_version integer not null,
  rules          jsonb,
  rules_hash     text,
  status         text not null default 'running', -- running | finishing | done | failed
  expected       integer not null default 0,
  agreement      numeric,
  breakdown      jsonb,
  verdict        text,                       -- promoted | held | approved | rejected
  usd            numeric,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  finished_at    timestamptz
);
create index if not exists grading_benchmark_runs_recent on public.grading_benchmark_runs (org_id, created_at desc);

-- Each call's test grade in a run (never saved onto the call itself).
create table if not exists public.grading_benchmark_results (
  run_id     uuid not null references public.grading_benchmark_runs(id) on delete cascade,
  call_id    uuid not null references public.calls(id) on delete cascade,
  org_id     uuid not null references public.orgs(id) on delete cascade,
  grade      jsonb,
  agreement  numeric,
  items      jsonb,
  error      text,
  usd        numeric,
  created_at timestamptz not null default now(),
  primary key (run_id, call_id)
);

-- New standing rules wait here until tested; every earlier set is kept for rollback.
alter table public.grading_guidance add column if not exists rules_pending jsonb;
alter table public.grading_guidance add column if not exists rules_pending_at timestamptz;
alter table public.grading_guidance add column if not exists rules_history jsonb not null default '[]'::jsonb;

alter table public.grading_benchmark enable row level security;
alter table public.grading_benchmark_runs enable row level security;
alter table public.grading_benchmark_results enable row level security;

drop policy if exists grading_benchmark_admin on public.grading_benchmark;
create policy grading_benchmark_admin on public.grading_benchmark
for all to authenticated
using ((select public.is_admin()) and org_id = (select public.my_org_id()))
with check ((select public.is_admin()) and org_id = (select public.my_org_id()));

drop policy if exists grading_benchmark_runs_admin on public.grading_benchmark_runs;
create policy grading_benchmark_runs_admin on public.grading_benchmark_runs
for all to authenticated
using ((select public.is_admin()) and org_id = (select public.my_org_id()))
with check ((select public.is_admin()) and org_id = (select public.my_org_id()));

drop policy if exists grading_benchmark_results_admin on public.grading_benchmark_results;
create policy grading_benchmark_results_admin on public.grading_benchmark_results
for all to authenticated
using ((select public.is_admin()) and org_id = (select public.my_org_id()))
with check ((select public.is_admin()) and org_id = (select public.my_org_id()));

notify pgrst, 'reload schema';
