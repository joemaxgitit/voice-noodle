-- ============================================================
-- Reps in training. They don't go to Master Your Craft until they
-- graduate; managers tick "In training" on People & access.
-- Safe to run more than once.
-- ============================================================

alter table public.profiles add column if not exists in_training boolean not null default false;

select 'in training ready' as result;
