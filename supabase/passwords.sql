-- ============================================================
-- Passwords: a manager can set a temporary password, and the person is
-- asked to pick their own the next time they sign in.
-- Safe to run more than once.
-- ============================================================

alter table public.profiles add column if not exists must_change_password boolean not null default false;

-- Clears the flag for the signed-in person only, once they've set their own password.
create or replace function public.password_changed()
returns void language sql security definer set search_path = public as $$
  update public.profiles set must_change_password = false where id = auth.uid();
$$;
grant execute on function public.password_changed() to authenticated;

select 'passwords ready' as result;
