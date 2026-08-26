-- ============================================================
-- Teams: closers and account managers see different scripts.
-- Safe to run more than once.
--
-- Enforced in ROW LEVEL SECURITY, not in the UI. Hiding a script
-- in the interface would still leave it readable from the API.
-- ============================================================

-- 1. Who is on which team, and who each script is for.
alter table public.profiles
add column if not exists team text;

alter table public.scripts
add column if not exists team text;

alter table public.scripts
add column if not exists logo_url text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_team_check') then
    alter table public.profiles
      add constraint profiles_team_check
      check (team is null or team in ('closers','ams'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'scripts_team_check') then
    alter table public.scripts
      add constraint scripts_team_check
      check (team is null or team in ('closers','ams'));
  end if;
end $$;

-- 2. Modules are either part of the linear call or an objection loop.
alter table public.modules
add column if not exists kind text not null default 'sequence';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'modules_kind_check') then
    alter table public.modules
      add constraint modules_kind_check
      check (kind in ('sequence','loop'));
  end if;
end $$;

-- 3. Helpers
create or replace function public.my_team()
returns text language sql stable security definer set search_path = public as $$
  select team from public.profiles where id = auth.uid() and active = true
$$;

-- A script with no team is for everyone. Admins and managers see all.
create or replace function public.can_see_script(script_team text)
returns boolean language sql stable security definer set search_path = public as $$
  select script_team is null
      or public.is_admin()
      or script_team = public.my_team()
$$;

-- 4. Re-scope the read policies to respect team
drop policy if exists scripts_read on public.scripts;
create policy scripts_read on public.scripts
for select to authenticated
using (
  org_id = public.my_org_id()
  and active = true
  and public.can_see_script(team)
);

drop policy if exists modules_read on public.modules;
create policy modules_read on public.modules
for select to authenticated
using (active = true and exists (
  select 1 from public.scripts s
  where s.id = modules.script_id
    and s.org_id = public.my_org_id()
    and public.can_see_script(s.team)
));

drop policy if exists segments_read on public.segments;
create policy segments_read on public.segments
for select to authenticated
using (
  active = true
  and (status = 'published' or public.is_admin())
  and exists (
    select 1 from public.modules m
    join public.scripts s on s.id = m.script_id
    where m.id = segments.module_id
      and s.org_id = public.my_org_id()
      and public.can_see_script(s.team)
  )
);

-- 5. Existing script belongs to the closers
update public.scripts
set team = 'closers',
    logo_url = '/lionside-logo.png'
where slug = 'options-june-2026';
