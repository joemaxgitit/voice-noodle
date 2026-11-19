-- Managers only ever add people to their own department.
--   * Claiming an account that has no organization yet puts it on the manager's own team.
--   * A manager can't move anyone to another team.
-- (Adding someone new from People & access already does this on the server.) Safe to run more than once.
set lock_timeout = '5s';

create or replace function public.guard_manager_team()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  me_role text := public.my_role();
  me_team text := (select team from public.profiles where id = auth.uid());
begin
  if auth.uid() is null or me_role is distinct from 'manager' then return new; end if;
  if old.org_id is null and new.org_id is not null then
    new.team := coalesce(me_team, 'closers');
    return new;
  end if;
  if new.team is distinct from old.team then
    raise exception 'Managers can only keep people on their own team.';
  end if;
  return new;
end $$;

drop trigger if exists profiles_manager_team on public.profiles;
create trigger profiles_manager_team before update on public.profiles
for each row execute function public.guard_manager_team();
