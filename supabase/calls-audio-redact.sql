-- ============================================================
-- Call review: bleep bank, card and ID numbers out of recordings.
-- Safe to run more than once.
-- ============================================================

alter table public.calls add column if not exists audio_redact_state text;   -- null | working | done | failed
alter table public.calls add column if not exists audio_redacted_at timestamptz;
alter table public.calls add column if not exists audio_redact_note text;

-- Check: should return three rows.
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'calls'
  and column_name in ('audio_redact_state', 'audio_redacted_at', 'audio_redact_note');
