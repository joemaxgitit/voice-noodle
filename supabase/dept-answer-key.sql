-- Answer key for Service and Openers: where each department's lesson test result is kept.
set lock_timeout = '5s';
alter table public.dept_guidance add column if not exists key_agreement numeric;
alter table public.dept_guidance add column if not exists key_hash text;
alter table public.dept_guidance add column if not exists last_test text;
notify pgrst, 'reload schema';
select column_name from information_schema.columns where table_name = 'dept_guidance' and column_name in ('key_agreement','key_hash','last_test');
