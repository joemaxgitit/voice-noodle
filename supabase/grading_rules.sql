-- Standing grading rules the app writes from ALL of a manager's "Not right?" corrections.
set lock_timeout = '5s'; -- gives up instead of freezing the app if busy; just run it again
alter table public.grading_guidance add column if not exists rules jsonb;
alter table public.grading_guidance add column if not exists rules_updated_at timestamptz;
alter table public.grading_guidance add column if not exists rules_from integer;
notify pgrst, 'reload schema';
