-- ============================================================
-- Call review: English translation of Spanish calls, and voice
-- measurements for tonality grading.
-- Safe to run more than once.
-- ============================================================

alter table public.calls
add column if not exists translation jsonb;

-- Pitch and loudness timeline measured from the recording (lib/voice.ts).
alter table public.calls
add column if not exists voice jsonb;

-- Check: should return two rows.
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'calls' and column_name in ('translation', 'voice');
