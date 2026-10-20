-- Super mode: the extras beyond voice, tone, script and Straight Line training.
-- Only the super admin can switch it, for anyone (including themselves).
alter table public.profiles add column if not exists super_mode boolean not null default false;

create or replace function public.guard_super_mode() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.super_mode is distinct from old.super_mode and not public.is_super_admin() then
    raise exception 'Only the super admin can switch super mode.';
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard_super_mode on public.profiles;
create trigger profiles_guard_super_mode before update of super_mode on public.profiles
for each row execute function public.guard_super_mode();

-- You start in super mode; everyone else starts in core.
update public.profiles set super_mode = true where super_admin;

select full_name, role, super_mode from public.profiles where role in ('admin','manager') and active order by full_name;
