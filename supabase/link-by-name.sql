-- ============================================================
-- Anything tied to a rep's name lands on their profile.
--
-- Sales reports, rotation days and retention lookbacks come in by the
-- name the CRM prints ("GregVarey (Greg  Varey)"). When that name matches
-- exactly one account -- by its name or the dashboard name it learned --
-- the row is linked to that rep automatically:
--   * on every new row, and
--   * whenever an account's name or dashboard name is set or changed,
--     which links everything that came in before the account existed.
-- Also puts script-practice recordings behind the sales/service wall.
-- Safe to run more than once.
-- ============================================================

create or replace function public.name_keys(raw text)
returns text[] language sql immutable as $$
  select array_remove(array[
    regexp_replace(lower(coalesce(raw, '')), '[^a-z]', '', 'g'),
    regexp_replace(lower(regexp_replace(coalesce(raw, ''), '\(.*$', '')), '[^a-z]', '', 'g'),
    regexp_replace(lower(coalesce(substring(raw from '\(([^)]*)\)'), '')), '[^a-z]', '', 'g')
  ], '')
$$;

-- The one account this name belongs to, or null when none or several match.
create or replace function public.match_rep_by_name(org uuid, raw text)
returns uuid language sql stable security definer set search_path = public as $$
  with hits as (
    select distinct p.id from public.profiles p
    where p.org_id = org
      and (regexp_replace(lower(coalesce(p.full_name, '')), '[^a-z]', '', 'g') = any(public.name_keys(raw))
        or regexp_replace(lower(coalesce(p.kpi_name, '')), '[^a-z]', '', 'g') = any(public.name_keys(raw)))
  )
  select case when (select count(*) from hits) = 1 then (select id from hits) end
$$;

-- New rows link themselves.
create or replace function public.link_row_by_name()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.rep_id is null then
    new.rep_id := public.match_rep_by_name(new.org_id, new.salesman);
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['kpi_rows', 'rep_daily', 'retention_reps'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop trigger if exists %I on public.%I', t || '_link_name', t);
    execute format('create trigger %I before insert on public.%I for each row execute function public.link_row_by_name()', t || '_link_name', t);
  end loop;
end $$;

-- A name set or changed on an account picks up everything that came in under it.
create or replace function public.link_rows_for_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.org_id is null then return new; end if;
  update public.kpi_rows r set rep_id = new.id
   where r.rep_id is null and r.org_id = new.org_id and public.match_rep_by_name(r.org_id, r.salesman) = new.id;
  update public.rep_daily r set rep_id = new.id
   where r.rep_id is null and r.org_id = new.org_id and public.match_rep_by_name(r.org_id, r.salesman) = new.id;
  if to_regclass('public.retention_reps') is not null then
    execute 'update public.retention_reps r set rep_id = $1
              where r.rep_id is null and r.org_id = $2 and public.match_rep_by_name(r.org_id, r.salesman) = $1'
      using new.id, new.org_id;
  end if;
  return new;
end $$;

drop trigger if exists profiles_link_names on public.profiles;
create trigger profiles_link_names
after insert or update of full_name, kpi_name, org_id on public.profiles
for each row execute function public.link_rows_for_profile();

-- Link everything already waiting.
update public.kpi_rows r set rep_id = public.match_rep_by_name(r.org_id, r.salesman)
 where r.rep_id is null and public.match_rep_by_name(r.org_id, r.salesman) is not null;
update public.rep_daily r set rep_id = public.match_rep_by_name(r.org_id, r.salesman)
 where r.rep_id is null and public.match_rep_by_name(r.org_id, r.salesman) is not null;
do $$ begin
  if to_regclass('public.retention_reps') is not null then
    update public.retention_reps r set rep_id = public.match_rep_by_name(r.org_id, r.salesman)
     where r.rep_id is null and public.match_rep_by_name(r.org_id, r.salesman) is not null;
  end if;
end $$;

-- Script-practice recordings: managers see only their own side.
do $$
declare p record;
begin
  if to_regclass('public.attempts') is null then return; end if;
  for p in select policyname from pg_policies
           where schemaname = 'public' and tablename = 'attempts'
             and (coalesce(qual, '') like '%is_admin%' or coalesce(with_check, '') like '%is_admin%')
  loop
    execute format('drop policy if exists %I on public.attempts', p.policyname);
  end loop;
  execute 'create policy attempts_manager_side on public.attempts for all to authenticated
             using (public.is_admin() and public.can_see_person(user_id))
             with check (public.is_admin() and public.can_see_person(user_id))';
end $$;

-- Check: what's still not on anyone's profile, by name.
select 'sales reports' as what, salesman, count(*) from public.kpi_rows where rep_id is null group by salesman
union all
select 'rotation', salesman, count(*) from public.rep_daily where rep_id is null group by salesman
order by 1, 3 desc;
