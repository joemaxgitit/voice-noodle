-- Whole-script run-throughs: a rep records the entire script in one take from the Whole script page.
set lock_timeout = '5s';

create table if not exists public.script_takes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  script_id   uuid references public.scripts(id) on delete cascade,
  audio_path  text not null,
  seconds     numeric,
  created_at  timestamptz not null default now()
);
create index if not exists script_takes_user on public.script_takes (user_id, created_at desc);

alter table public.script_takes enable row level security;

-- A rep: their own takes.
drop policy if exists script_takes_own on public.script_takes;
create policy script_takes_own on public.script_takes
for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- Managers: listen to the reps they can see (same rule as script practice takes).
drop policy if exists script_takes_manager on public.script_takes;
create policy script_takes_manager on public.script_takes
for select to authenticated
using (public.is_admin() and public.can_see_person(user_id));

notify pgrst, 'reload schema';
