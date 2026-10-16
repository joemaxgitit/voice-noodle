-- ============================================================
-- Call review: graduated clients, approved lessons, and manager
-- corrections that feed back into grading.
-- Safe to run more than once.
-- ============================================================

-- 1. Graduated joins Active and Cancelled.
alter table public.calls add column if not exists graduated_date date;
alter table public.calls add column if not exists final_credit_score integer;

alter table public.calls drop constraint if exists calls_retention_check;
alter table public.calls
  add constraint calls_retention_check
  check (retention is null or retention in ('active', 'cancelled', 'graduated'));

-- 2. Lessons a manager approved on the Insights page. One row per org.
create table if not exists public.grading_guidance (
  org_id     uuid primary key references public.orgs(id) on delete cascade,
  lessons    text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.grading_guidance enable row level security;

drop policy if exists grading_guidance_admin on public.grading_guidance;
create policy grading_guidance_admin on public.grading_guidance
for all to authenticated
using (public.is_admin() and org_id = public.my_org_id())
with check (public.is_admin() and org_id = public.my_org_id());

-- 3. Corrections to individual report items ("Not right?").
create table if not exists public.call_corrections (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  call_id     uuid not null references public.calls(id) on delete cascade,
  item_kind   text not null,          -- Section, Skill, Roadmap, Flag, Tone, Disclosure, Coaching
  item_key    text not null,          -- which item on that call, so the fix shows in place
  item_label  text,                   -- e.g. the section or skill name
  original    text not null,          -- what the grader said
  correction  text not null,          -- what the manager says it should be
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists call_corrections_org_idx on public.call_corrections(org_id, created_at desc);
create index if not exists call_corrections_call_idx on public.call_corrections(call_id);

alter table public.call_corrections enable row level security;

drop policy if exists call_corrections_admin on public.call_corrections;
create policy call_corrections_admin on public.call_corrections
for all to authenticated
using (public.is_admin() and org_id = public.my_org_id())
with check (public.is_admin() and org_id = public.my_org_id());

-- 4. Check: should return 2 columns, then 2 tables.
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'calls'
  and column_name in ('graduated_date', 'final_credit_score');

select table_name from information_schema.tables
where table_schema = 'public' and table_name in ('grading_guidance', 'call_corrections');
