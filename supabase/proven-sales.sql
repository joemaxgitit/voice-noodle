-- "Made 6+ payments": a proven sale, as strong as graduated for grading lessons and training.
alter table public.calls drop constraint if exists calls_retention_check;
alter table public.calls
  add constraint calls_retention_check
  check (retention is null or retention in ('active', 'cancelled', 'graduated', 'paid6'));
notify pgrst, 'reload schema';
select 'proven sales ready' as result;
