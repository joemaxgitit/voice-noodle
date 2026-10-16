-- ============================================================
-- Call review: Straight Line score and call outcome.
-- Safe to run more than once.
-- ============================================================

alter table public.calls
add column if not exists slp_score integer;

-- The grader's reading of how the call ended, and a manager's correction.
alter table public.calls
add column if not exists outcome text;

alter table public.calls
add column if not exists outcome_manual text;

-- Check: should return three rows.
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'calls'
  and column_name in ('slp_score', 'outcome', 'outcome_manual');
