-- ============================================================
-- Sales side and service side, and the super admin.
--
--   * A manager belongs to a side through their team:
--       Closers           -> sales manager
--       Account Managers  -> service manager
--     (no team counts as sales, which is everyone today).
--   * A manager sees only the reps on their own side -- calls, notes,
--     one-on-ones, KPIs, rotation, training records, everything.
--   * Admins see both sides.
--   * The super admin is an admin who also decides who is an admin.
--
-- Enforced in row level security, so it holds no matter which page or
-- API asks. Safe to run more than once.
-- ============================================================

-- 1. The super admin flag.
alter table public.profiles add column if not exists super_admin boolean not null default false;

-- Max is the super admin.
update public.profiles set super_admin = true, role = 'admin'
where lower(trim(full_name)) = 'max sharp';

-- 2. Which side someone is on.
create or replace function public.side_of(uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select case when team = 'ams' then 'service' else 'sales' end from public.profiles where id = uid
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select super_admin from public.profiles where id = auth.uid()), false)
$$;

-- Can the signed-in person see this rep's records?
--   admins: anyone.  managers: reps on their own side.  everyone: themselves.
--   Rows not tied to an account yet (rep_id null) stay visible to managers.
create or replace function public.can_see_person(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when uid = auth.uid() then true
    when public.my_role() = 'admin' then true
    when public.my_role() = 'manager' then uid is null or public.side_of(uid) = public.side_of(auth.uid())
    else false
  end
$$;

-- 3. Tighten every manager policy on rep records to the manager's side.
do $$
declare
  t record;
  old record;
begin
  for t in
    select * from (values
      ('calls',                  'calls_admin_all',                'rep_id'),
      ('coaching_sessions',      'coaching_sessions_team',         'rep_id'),
      ('kpi_rows',               'kpi_rows_admin_all',             'rep_id'),
      ('mastery_attendance',     'mastery_attendance_admin',       'rep_id'),
      ('mastery_moves',          'mastery_moves_admin',            'rep_id'),
      ('mastery_regular',        'mastery_regular_admin',          'rep_id'),
      ('mastery_requests',       'mastery_requests_admin',         'rep_id'),
      ('rep_daily',              'rep_daily_admin_all',            'rep_id'),
      ('rep_files',              'rep_files_admin_all',            'rep_id'),
      ('rep_notes',              'rep_notes_team',                 'rep_id'),
      ('rep_reviews',            'rep_reviews_admin_all',          'rep_id'),
      ('training_cards',         'training_cards_admin_all',       'rep_id'),
      ('training_enrollments',   'training_enrollments_admin',     'rep_id'),
      ('training_progress',      'training_progress_admin',        'user_id'),
      ('training_quiz_attempts', 'training_quiz_attempts_admin',   'user_id')
    ) as v(tbl, pol, col)
  loop
    if to_regclass('public.' || t.tbl) is null then continue; end if;
    -- Any older manager policy on this table would still let a manager through; remove it.
    for old in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t.tbl and policyname <> t.pol
        and (coalesce(qual, '') like '%is_admin%' or coalesce(with_check, '') like '%is_admin%')
    loop
      execute format('drop policy if exists %I on public.%I', old.policyname, t.tbl);
    end loop;
    execute format('drop policy if exists %I on public.%I', t.pol, t.tbl);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (public.is_admin() and org_id = public.my_org_id() and public.can_see_person(%I))
         with check (public.is_admin() and org_id = public.my_org_id() and public.can_see_person(%I))',
      t.pol, t.tbl, t.col, t.col);
  end loop;
end $$;

-- Script practice progress.
drop policy if exists progress_manager_read on public.progress;
create policy progress_manager_read on public.progress
for select to authenticated
using (public.is_admin() and public.can_see_person(user_id) and exists (
  select 1 from public.profiles p
  where p.id = progress.user_id and p.org_id = public.my_org_id()
));

-- 4. People. Managers see every manager and admin (for names), and the reps
--    on their own side.
alter table public.profiles enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
for select to authenticated
using (
  id = auth.uid()
  or (public.is_admin() and org_id = public.my_org_id() and (role <> 'rep' or public.can_see_person(id)))
);

drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles
for update to authenticated
using (public.is_admin() and org_id = public.my_org_id() and (public.my_role() = 'admin' or (role = 'rep' and public.can_see_person(id))))
with check (org_id = public.my_org_id());

-- 5. Who may change roles, sides and the super admin flag.
--    Run from the SQL Editor (no signed-in user), anything goes.
create or replace function public.guard_profile_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  caller_role text := coalesce(public.my_role(), '');
  caller_super boolean := public.is_super_admin();
begin
  if auth.uid() is null then return new; end if;

  if new.super_admin is distinct from old.super_admin and not caller_super then
    raise exception 'Only the super admin can change who is super admin.';
  end if;

  if new.role is distinct from old.role then
    if (new.role = 'admin' or old.role = 'admin') and not caller_super then
      raise exception 'Only the super admin can make someone an admin or take it away.';
    end if;
    if caller_role <> 'admin' then
      raise exception 'Only admins can change roles.';
    end if;
  end if;

  if new.team is distinct from old.team and caller_role <> 'admin' then
    -- A manager can move a rep between Closers and no team, but never to the other side.
    if public.side_of(old.id) is distinct from (case when new.team = 'ams' then 'service' else 'sales' end) then
      raise exception 'Only admins can move someone to the other side.';
    end if;
  end if;

  if old.super_admin and new.id <> auth.uid() and not caller_super then
    raise exception 'Only the super admin can change the super admin''s account.';
  end if;

  return new;
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
for each row execute function public.guard_profile_change();

select full_name, role, team, super_admin from public.profiles where super_admin;
