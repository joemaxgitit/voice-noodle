-- ============================================================
-- People management: email on profiles + claim unassigned accounts
-- Safe to run more than once.
-- ============================================================

-- 1. Store the email on the profile so the app can show it without
--    querying auth.users, which clients cannot read.
alter table public.profiles
add column if not exists email text;

update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id and (p.email is null or p.email <> u.email);

-- 2. Keep it in sync for new signups.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, org_id, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.email,
    (new.raw_user_meta_data->>'org_id')::uuid,
    coalesce(new.raw_user_meta_data->>'role', 'rep')
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- 3. Let admins see and claim accounts that have no organization yet.
--    Permissive policies are OR'd, so this adds to the existing rules
--    rather than replacing them.
drop policy if exists profiles_see_unassigned on public.profiles;
create policy profiles_see_unassigned on public.profiles
for select to authenticated
using (org_id is null and public.is_admin());

drop policy if exists profiles_claim_unassigned on public.profiles;
create policy profiles_claim_unassigned on public.profiles
for update to authenticated
using (org_id is null and public.is_admin())
with check (org_id = public.my_org_id());
