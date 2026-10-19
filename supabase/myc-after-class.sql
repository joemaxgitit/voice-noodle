-- Master Your Craft: each week's content, leave behind and recording link.
alter table public.mastery_weeks add column if not exists content text;
alter table public.mastery_weeks add column if not exists recordings jsonb not null default '[]'::jsonb;
alter table public.mastery_weeks add column if not exists leave_behind text;

-- This week's content was saved on its topic; copy it onto the week.
update public.mastery_weeks w
set content = t.description
from public.training_topics t
where w.topic_id = t.id and w.content is null and t.description is not null;

select week_start, title, content is not null as has_content from public.mastery_weeks order by week_start desc limit 5;
