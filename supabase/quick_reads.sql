-- Voicemails and short calls get a cheap read instead of the full grade,
-- kept apart from every score and average (status 'read').
set lock_timeout = '5s'; -- gives up instead of freezing the app if calls are busy; just run it again
alter table public.calls drop constraint if exists calls_status_check;
alter table public.calls add constraint calls_status_check
  check (status in ('live','uploading','uploaded','transcribing','transcribed','grading','graded','read','failed')) not valid;
alter table public.calls add column if not exists kind text;        -- 'voicemail' | 'short' (null = a full call)
alter table public.calls add column if not exists quick jsonb;      -- the voicemail score or short-call read
alter table public.calls add column if not exists call_time text;   -- 'HH:MM' (24h) when the call was made, from the call log or file name
notify pgrst, 'reload schema';
