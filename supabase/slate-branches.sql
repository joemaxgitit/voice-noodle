-- ============================================================
-- Response trees the script has and the app was missing.
-- Run AFTER tone-rewrite.sql. Safe to run more than once.
-- ============================================================

-- Slate: "you've heard of them right?"  YES / NO
insert into public.segments
  (module_id, segment_code, sort_order, section, title, script_text, tones,
   tone_map, coaching, client_should_feel, verbatim, status)
select m.id, v.code, v.sort_order, null, v.title, v.script_text, v.tones,
       v.tone_map::jsonb, v.coaching, v.feel, false, 'published'
from public.modules m
join public.scripts s on s.id = m.script_id
cross join (values

('believe', 'WHY-003A', 35, $t$Slate — if yes$t$,
 $t$Of course you have!$t$,
 '{}'::text[],
 $j$[{"tone":"","text":"Of course you have!"}]$j$,
 $t$Quick and warm, like you expected it. Do not dwell — the point is to move on having gained the credibility.$t$,
 $t$I already knew that name.$t$),

('believe', 'WHY-003B', 36, $t$Slate — if no$t$,
 $t$You will. They're one of the fastest growing financial advocacy groups.$t$,
 '{}'::text[],
 $j$[{"tone":"","text":"You will. They're one of the fastest growing financial advocacy groups."}]$j$,
 $t$"You will" is the whole line — said with certainty it turns not knowing them into being early rather than being uninformed. Never make the client feel behind.$t$,
 $t$I am hearing about them before everyone else.$t$)

) as v(module_slug, code, sort_order, title, script_text, tones, tone_map, coaching, feel)
where m.slug = v.module_slug and s.slug = 'options-june-2026'
on conflict (module_id, segment_code) do update set
  script_text = excluded.script_text, tones = excluded.tones,
  tone_map = excluded.tone_map, coaching = excluded.coaching,
  client_should_feel = excluded.client_should_feel,
  title = excluded.title, sort_order = excluded.sort_order;


-- Loop 1: the "If No" continuation on the "why didn't we do it sooner" pattern
insert into public.segments
  (module_id, segment_code, sort_order, section, title, script_text, tones,
   tone_map, coaching, client_should_feel, verbatim, status)
select m.id, v.code, v.sort_order, null, v.title, v.script_text, v.tones,
       v.tone_map::jsonb, v.coaching, v.feel, false, 'published'
from public.modules m
join public.scripts s on s.id = m.script_id
cross join (values

('loop-1', 'LOOP1-004A', 45, $t$If they say no$t$,
 $t$If we had resolved the debt for a fraction of what you owed, improved your credit and educated you so this could never happen again, you wouldn't be screaming from the mountain tops. Come on?$t$,
 '{}'::text[],
 $j$[{"tone":"","text":"If we had resolved the debt for a fraction of what you owed, improved your credit and educated you so this could never happen again, you wouldn't be screaming from the mountain tops. Come on?"}]$j$,
 $t$Only used if they do not agree with the pattern before it. "Come on?" is warm and slightly incredulous, never sarcastic — you are inviting them to admit the obvious, not scoring a point.$t$,
 $t$Alright, fair.$t$)

) as v(module_slug, code, sort_order, title, script_text, tones, tone_map, coaching, feel)
where m.slug = v.module_slug and s.slug = 'options-june-2026'
on conflict (module_id, segment_code) do update set
  script_text = excluded.script_text, tones = excluded.tones,
  tone_map = excluded.tone_map, coaching = excluded.coaching,
  client_should_feel = excluded.client_should_feel,
  title = excluded.title, sort_order = excluded.sort_order;
