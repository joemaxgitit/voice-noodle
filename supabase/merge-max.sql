-- Merge Max's work account into the main one (joemax_sharp@live.com).
do $$
declare
  keep uuid := (select id from public.profiles where email = 'joemax_sharp@live.com');
  drop_id uuid := (select id from public.profiles where email in ('max@lionsidefinancial.com', 'msharp@lionsidefinancial.com') limit 1);
  c record;
begin
  if keep is null or drop_id is null then raise notice 'nothing to merge'; return; end if;
  -- Every column that points at a person: move the work account's records over.
  for c in
    select tc.table_name, kcu.column_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
    where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
      and ccu.column_name = 'id' and ccu.table_name in ('profiles', 'users')
      and tc.table_name <> 'profiles'
  loop
    begin
      execute format('update public.%I set %I = $1 where %I = $2', c.table_name, c.column_name, c.column_name) using keep, drop_id;
    exception when others then
      raise notice 'kept % on %.% (%)', 'as is', c.table_name, c.column_name, sqlerrm;
    end;
  end loop;
  -- Lists of people (e.g. who teaches a training session).
  if to_regclass('public.training_events') is not null then
    update public.training_events set instructor_ids = array_replace(instructor_ids, drop_id, keep) where drop_id = any(instructor_ids);
  end if;
  -- Turn the work account off; the main account stays super admin.
  update public.profiles set active = false, super_admin = false, role = 'rep' where id = drop_id;
  update public.profiles set super_admin = true, role = 'admin', active = true where id = keep;
end $$;

select email, full_name, role, active, super_admin from public.profiles where lower(trim(full_name)) = 'max sharp';
