-- ============================================================
-- Call review: keep earlier grades, and record what each call cost.
-- Safe to run more than once.
-- ============================================================

alter table public.calls
add column if not exists grade_history jsonb not null default '[]'::jsonb;

alter table public.calls
add column if not exists cost jsonb;

-- Check: should list both columns.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'calls'
  and column_name in ('grade_history', 'cost');
