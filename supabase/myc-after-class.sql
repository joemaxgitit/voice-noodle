-- Master Your Craft, after class: the meeting recording(s) and the leave behind.
alter table public.mastery_weeks add column if not exists recordings jsonb not null default '[]'::jsonb;
alter table public.mastery_weeks add column if not exists leave_behind text;
select 'after class ready' as result;
