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
-- The review: transcript, code checks and the AI read (filled in automatically after a take is kept).
alter table public.script_takes add column if not exists status     text not null default 'saved';  -- saved | transcribing | reviewing | done | failed
alter table public.script_takes add column if not exists error      text;
alter table public.script_takes add column if not exists transcript jsonb;
alter table public.script_takes add column if not exists review     jsonb;
alter table public.script_takes add column if not exists voice      jsonb;  -- pitch and loudness, measured in the browser
alter table public.script_takes add column if not exists score      int;
alter table public.script_takes add column if not exists cost       jsonb;
alter table public.script_takes add column if not exists updated_at timestamptz not null default now();
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
for all to authenticated
using (public.is_admin() and public.can_see_person(user_id))
with check (public.is_admin() and public.can_see_person(user_id));

-- What each review cost goes to the spending log, whoever kept the take (reps can't write there themselves).
create or replace function public.log_script_take_spend()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  org uuid := (select org_id from public.profiles where id = new.user_id);
  d numeric;
begin
  if org is null then return new; end if;
  d := coalesce((new.cost->>'transcribe_usd')::numeric, 0) - coalesce((case when tg_op = 'UPDATE' then old.cost->>'transcribe_usd' end)::numeric, 0);
  if d > 0 then insert into public.spend_log(org_id, kind, usd, user_id, ref_id, note) values (org, 'runthrough', d, new.user_id, new.id, 'transcribe'); end if;
  d := coalesce((new.cost->>'review_usd')::numeric, 0) - coalesce((case when tg_op = 'UPDATE' then old.cost->>'review_usd' end)::numeric, 0);
  if d > 0 then insert into public.spend_log(org_id, kind, usd, user_id, ref_id, note) values (org, 'runthrough', d, new.user_id, new.id, 'review'); end if;
  return new;
end $$;

drop trigger if exists script_takes_spend on public.script_takes;
create trigger script_takes_spend after insert or update of cost on public.script_takes
for each row execute function public.log_script_take_spend();

notify pgrst, 'reload schema';
