-- ============================================================
-- One Training hub per department: Sales, Service (account managers)
-- and Openers. Topics, the library, the calendar and learning tracks
-- belong to a department. A department's managers see and manage only
-- theirs; reps see only theirs; admins see all three. A material marked
-- 'all' (admins only) shows in every department.
-- Master Your Craft and the Thursday meeting stay sales-only.
-- Enforced in row level security. Safe to run more than once.
-- ============================================================
set lock_timeout = '5s';

-- The signed-in person's department: sales | service | openers.
create or replace function public.my_side()
returns text language sql stable security definer set search_path = public as $$
  select public.side_of(auth.uid())
$$;

-- 1. A department on each piece of the hub. Existing content: Account
--    Manager items go to Service, Opener items to Openers, the rest to Sales.
do $$
declare t text;
begin
  foreach t in array array['training_topics','training_materials','training_events','training_tracks'] loop
    execute format('alter table public.%I add column if not exists dept text not null default ''sales''', t);
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_dept_check');
    execute format('alter table public.%I add constraint %I check (dept in (''sales'',''service'',''openers'',''all''))', t, t || '_dept_check');
    -- New rows land in the department of whoever adds them (admins pick on screen).
    execute format('alter table public.%I alter column dept set default coalesce(public.my_side(), ''sales'')', t);
  end loop;
end $$;

update public.training_materials set dept = case audience when 'ams' then 'service' when 'openers' then 'openers' else 'sales' end
 where dept = 'sales' and audience in ('ams','openers');
update public.training_events set dept = case audience when 'ams' then 'service' when 'openers' then 'openers' else 'sales' end
 where dept = 'sales' and audience in ('ams','openers');

-- 2. Managers: their own department only. Admins: everything.
do $$
declare t text;
begin
  foreach t in array array['training_topics','training_materials','training_events','training_tracks'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (public.is_admin() and org_id = public.my_org_id() and (public.my_role() = ''admin'' or dept = public.my_side()))
         with check (public.is_admin() and org_id = public.my_org_id() and (public.my_role() = ''admin'' or dept = public.my_side()))',
      t || '_admin', t);
  end loop;
end $$;

-- Quiz questions and track items follow the material / track they belong to.
drop policy if exists training_quiz_questions_admin on public.training_quiz_questions;
create policy training_quiz_questions_admin on public.training_quiz_questions for all to authenticated
using (public.is_admin() and org_id = public.my_org_id() and (public.my_role() = 'admin'
       or exists (select 1 from public.training_materials m where m.id = material_id and m.dept = public.my_side())))
with check (public.is_admin() and org_id = public.my_org_id() and (public.my_role() = 'admin'
       or exists (select 1 from public.training_materials m where m.id = material_id and m.dept = public.my_side())));

drop policy if exists training_track_items_admin on public.training_track_items;
create policy training_track_items_admin on public.training_track_items for all to authenticated
using (public.is_admin() and org_id = public.my_org_id() and (public.my_role() = 'admin'
       or exists (select 1 from public.training_tracks k where k.id = track_id and k.dept = public.my_side())))
with check (public.is_admin() and org_id = public.my_org_id() and (public.my_role() = 'admin'
       or exists (select 1 from public.training_tracks k where k.id = track_id and k.dept = public.my_side())));

-- 3. What everyone reads: their own department, plus anything marked for all departments.
drop policy if exists training_topics_read on public.training_topics;
create policy training_topics_read on public.training_topics for select to authenticated
using (org_id = public.my_org_id() and (dept in ('all', public.my_side()) or public.my_role() = 'admin'));

drop policy if exists training_materials_read on public.training_materials;
create policy training_materials_read on public.training_materials for select to authenticated
using (org_id = public.my_org_id() and published and (dept in ('all', public.my_side()) or public.my_role() = 'admin'));

drop policy if exists training_events_read on public.training_events;
create policy training_events_read on public.training_events for select to authenticated
using (org_id = public.my_org_id() and status = 'published' and (dept in ('all', public.my_side()) or public.my_role() = 'admin'));

drop policy if exists training_tracks_read on public.training_tracks;
create policy training_tracks_read on public.training_tracks for select to authenticated
using (org_id = public.my_org_id() and (dept in ('all', public.my_side()) or public.my_role() = 'admin'));

drop policy if exists training_track_items_read on public.training_track_items;
create policy training_track_items_read on public.training_track_items for select to authenticated
using (org_id = public.my_org_id() and exists (select 1 from public.training_tracks k where k.id = track_id
       and (k.dept in ('all', public.my_side()) or public.my_role() = 'admin')));

-- 4. Master Your Craft and the Thursday meeting: sales managers and admins only.
do $$
declare t text;
begin
  foreach t in array array['mastery_weeks','meetings','meeting_items'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (public.is_admin() and org_id = public.my_org_id() and (public.my_role() = ''admin'' or public.my_side() = ''sales''))
         with check (public.is_admin() and org_id = public.my_org_id() and (public.my_role() = ''admin'' or public.my_side() = ''sales''))',
      t || '_admin', t);
  end loop;
end $$;

-- Service and opener reps don't see the sales routines on their calendar.
drop policy if exists mastery_weeks_read on public.mastery_weeks;
create policy mastery_weeks_read on public.mastery_weeks for select to authenticated
using (org_id = public.my_org_id() and status = 'published' and (public.my_side() = 'sales' or public.my_role() = 'admin'));

drop policy if exists meetings_read on public.meetings;
create policy meetings_read on public.meetings for select to authenticated
using (org_id = public.my_org_id() and status = 'published' and (public.my_side() = 'sales' or public.my_role() = 'admin'));

notify pgrst, 'reload schema';

-- Check: how the existing hub split up.
select 'materials' as what, dept, count(*) from public.training_materials group by dept
union all select 'calendar', dept, count(*) from public.training_events group by dept
union all select 'topics', dept, count(*) from public.training_topics group by dept
order by 1, 2;
