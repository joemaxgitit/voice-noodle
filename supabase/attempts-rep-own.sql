-- Reps save and see their own practice takes. (link-by-name.sql replaced every attempts policy that
-- mentioned is_admin, which also took out the rep's own "mine, or a manager" policy.)
set lock_timeout = '5s';

alter table public.attempts alter column user_id set default auth.uid();

drop policy if exists attempts_own on public.attempts;
create policy attempts_own on public.attempts
for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

notify pgrst, 'reload schema';

-- Check: should list attempts_own and attempts_manager_side.
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'attempts';
