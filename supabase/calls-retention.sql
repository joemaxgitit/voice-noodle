-- ============================================================
-- Call review: did the enrolled client stay?
-- Safe to run more than once.
-- ============================================================

alter table public.calls add column if not exists retention text;      -- 'active' | 'cancelled'
alter table public.calls add column if not exists cancel_date date;
alter table public.calls add column if not exists cancel_reason text;
alter table public.calls add column if not exists cancel_note text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'calls_retention_check') then
    alter table public.calls
      add constraint calls_retention_check
      check (retention is null or retention in ('active', 'cancelled'));
  end if;
end $$;

-- Check: should return four rows.
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'calls'
  and column_name in ('retention', 'cancel_date', 'cancel_reason', 'cancel_note');
