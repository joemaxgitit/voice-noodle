-- ============================================================
-- Team-proven patterns (what works in proven sales across 3+ reps) and
-- each rep's experiments: one or two team patterns that fit their style,
-- tried for a fair stretch, then kept or quietly dropped. Managers only.
-- ============================================================
create table if not exists public.team_patterns (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  body       jsonb not null default '{}'::jsonb,   -- { patterns: [{ pattern, how_it_sounds, reps: [ids], evidence }] }
  usd        numeric,
  created_at timestamptz not null default now()
);
alter table public.team_patterns enable row level security;
drop policy if exists team_patterns_manager on public.team_patterns;
create policy team_patterns_manager on public.team_patterns for all to authenticated
using (public.is_admin() and org_id = public.my_org_id())
with check (public.is_admin() and org_id = public.my_org_id());
grant select, insert, delete on public.team_patterns to authenticated;

create table if not exists public.rep_experiments (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  rep_id      uuid not null references public.profiles(id) on delete cascade,
  pattern     text not null,
  how_to_try  text,
  why_fits    text,
  status      text not null default 'trying' check (status in ('trying','kept','dropped')),
  last_check  jsonb,          -- { showing_in, of, effect, note, at }
  started_at  timestamptz not null default now(),
  ended_at    timestamptz
);
create index if not exists rep_experiments_rep_idx on public.rep_experiments(rep_id, started_at desc);
alter table public.rep_experiments enable row level security;
drop policy if exists rep_experiments_manager on public.rep_experiments;
create policy rep_experiments_manager on public.rep_experiments for all to authenticated
using (public.is_admin() and org_id = public.my_org_id() and public.can_see_person(rep_id))
with check (public.is_admin() and org_id = public.my_org_id());
grant select, insert, update, delete on public.rep_experiments to authenticated;

notify pgrst, 'reload schema';
select 'team patterns ready' as result;
