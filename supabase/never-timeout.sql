-- Accounts that never get signed out for being idle.
set lock_timeout = '5s';
alter table public.profiles add column if not exists never_timeout boolean not null default false;

update public.profiles set never_timeout = true
where role = 'admin' and (full_name ilike 'max %' or full_name ilike 'patrick %');

notify pgrst, 'reload schema';

-- Check: should be you and Patrick only.
select full_name, role, never_timeout from public.profiles where never_timeout;
