-- ============================================================
-- Renew script: outbound call to a lead Lionside spoke with months
-- ago who was already DQ'd for the loan. Opens on its own, then
-- continues on the Options Script from Phase 2 (BOLT-003) and closes.
-- Source: "Outbound Renew Script 5-19-26" (Renew Process).
-- Safe to run more than once.
-- ============================================================

-- 1. Scripts that hand off to another script, and a note for the grader.
alter table public.scripts add column if not exists continues_into uuid references public.scripts(id) on delete set null;
alter table public.scripts add column if not exists continues_from text;   -- segment code where the call picks up
alter table public.scripts add column if not exists grading_note text;

-- 2. The script.
insert into public.scripts (org_id, slug, title, kind, sort_order, team, logo_url, continues_into, continues_from, grading_note)
select o.id, 'renew-may-2026', 'Renew Script — May 2026', 'sales', 15, 'closers', '/lionside-logo.png',
       (select id from public.scripts where slug = 'options-june-2026' and org_id = o.id),
       'BOLT-003',
       $n$This is a renew call: an outbound call to a lead Lionside spoke with months ago, who was already declined for the SuperMoney loan. The rep re-introduces, re-qualifies, offers Financial Wellness directly, gives Phase 1, and then continues on the Options Script from Phase 2.
How the emotional roadmap applies on a renew call:
- Intro: re-establishing trust with someone who should remember the first call.
- Intelligence gathering (hardship): the short re-qualification -- are they still dealing with the debt? A deeper hardship dig is a plus, not required.
- Create the villain, Hope spike and Hopeless are not part of this script. Mark them "not_reached" unless the rep actually ran them.
- Light at the end of the tunnel: the Financial Wellness offer. There is one option here, so the choice handed back is whether to move forward -- judge relief and whether the client says it would help.
- Everything from The pitch onward follows the Options Script.
If the client says they found another way to handle the debt, the script says to pitch against it; if they haven't, the rep should find what is holding them back and overcome it with the objection loops.$n$
from public.orgs o
where o.slug = 'lionside'
on conflict (org_id, slug) do update set
  title = excluded.title,
  sort_order = excluded.sort_order,
  team = excluded.team,
  logo_url = excluded.logo_url,
  continues_into = excluded.continues_into,
  continues_from = excluded.continues_from,
  grading_note = excluded.grading_note;

-- 3. Sections.
insert into public.modules (script_id, slug, title, sort_order, kind, language)
select s.id, v.slug, v.title, v.sort_order, 'sequence', 'en'
from public.scripts s
cross join (values
  ('renew-opening',   'Renew — Opening',      10),
  ('renew-requalify', 'Renew — Re-qualify',   20),
  ('renew-offer',     'Renew — The Offer',    30),
  ('renew-phase-one', 'Renew — Phase One',    40)
) as v(slug, title, sort_order)
where s.slug = 'renew-may-2026'
on conflict (script_id, slug) do update set
  title = excluded.title,
  sort_order = excluded.sort_order;

-- 4. Lines. Spoken words exactly as the script has them; AC where the
--    script marks AC. Coaching and "should feel" are drafts for review.
insert into public.segments
  (module_id, segment_code, sort_order, section, title, script_text, tones,
   tone_map, coaching, client_should_feel, script_note, condition, verbatim, status)
select m.id, v.code, v.sort_order, null, v.title, v.script_text, v.tones,
       v.tone_map::jsonb, v.coaching, v.feel, v.note, v.cond, v.verbatim, 'published'
from public.modules m
join public.scripts s on s.id = m.script_id
cross join (values

('renew-opening', 'RENEW-001', 10, $t$Ask for the Client$t$,
 $t$Hello, may I speak with [client name]?$t$,
 '{}'::text[],
 $j$[{"tone":"","text":"Hello, may I speak with [client name]?"}]$j$,
 $t$Friendly and neutral. Confirm you have the right person before you say anything about debt.$t$,
 $t$Just a normal call.$t$,
 $t$If the lead is already DQ'd for the loan$t$, null, false),

('renew-opening', 'RENEW-002', 20, $t$Reintroduce Yourself$t$,
 $t$Hello [client name], Happy [day of the week]! My name is [your name], from Lionside Financial, we spoke to you a few months ago about a program we offer that would get you out of debt in less than 2 years and get your credit back to the 700s. Do you remember that conversation?$t$,
 array['AC'],
 $j$[{"tone":"AC","text":"Hello [client name], Happy [day of the week]! My name is [your name], from Lionside Financial, we spoke to you a few months ago about a program we offer that would get you out of debt in less than 2 years and get your credit back to the 700s. Do you remember that conversation?"}]$j$,
 $t$They have heard from you before, so lead with familiarity, not a cold open. Ask the question and wait for the answer: what they remember tells you where to pick up.$t$,
 $t$Oh right, these are the people who were going to help me.$t$,
 null, null, false),

('renew-opening', 'RENEW-003', 30, $t$Recording Notice$t$,
 $t$For training and quality assurance this call will be recorded, ok?$t$,
 '{}'::text[],
 $j$[{"tone":"","text":"For training and quality assurance this call will be recorded, ok?"}]$j$,
 $t$Read it as written and get the OK before going further.$t$,
 $t$This is a real, professional company.$t$,
 null, null, true),

('renew-requalify', 'RENEW-004', 10, $t$Still Dealing with the Debt?$t$,
 $t$From looking at the notes in the file, it looks like it was something you were interested in, but then we kind of lost touch with you. I just wanted to reach out to see if you're still dealing with the $[amount] of debt across these [number] accounts?$t$,
 '{}'::text[],
 $j$[{"tone":"","text":"From looking at the notes in the file, it looks like it was something you were interested in, but then we kind of lost touch with you. I just wanted to reach out to see if you're still dealing with the $[amount] of debt across these [number] accounts?"}]$j$,
 $t$Read the balance and account count from the file. You are confirming the pain is still there, not re-running the whole hardship dig, but if they open up, listen and summarize it back.$t$,
 $t$Nothing has changed. The debt is still there.$t$,
 null, null, false),

('renew-requalify', 'RENEW-005', 20, $t$Found Another Way?$t$,
 $t$Did you find another way to take care of the debt?$t$,
 '{}'::text[],
 $j$[{"tone":"","text":"Did you find another way to take care of the debt?"}]$j$,
 $t$Curious, not defensive. If they found something, learn exactly what it is so you can pitch against it. If they haven't, find out what is holding them back and use the loops.$t$,
 $t$Maybe I haven't actually solved this.$t$,
 $t$If they have, pitch against that. If they haven't, ask them what's holding them back from taking advantage of the program and try to overcome the objection.$t$,
 'IF NO', false),

('renew-offer', 'RENEW-006', 10, $t$Financial Wellness$t$,
 $t$Well, based on everything I'm seeing here we can still get you approved for an option called Financial Wellness... This is a program for consumers who want to get out of debt quickly and fully restore their credit. With Financial Wellness [first name] you'll be able to resolve your debt in less than two years and heal your credit with a payment around $[amount] a month. Would that help?$t$,
 array['AC'],
 $j$[{"tone":"","text":"Well, based on everything I'm seeing here we can still get you approved for an option called Financial Wellness... This is a program for consumers who want to get out of debt quickly and fully restore their credit. "},{"tone":"AC","text":"With Financial Wellness [first name] you'll be able to resolve your debt in less than two years and heal your credit with a payment around $[amount] a month. Would that help?"}]$j$,
 $t$The loan is already off the table, so this is the light at the end of the tunnel. Certainty on the AC line, then stop and let them answer "Would that help?"$t$,
 $t$There is still a way out, and it is within reach.$t$,
 null, 'IF YES', false),

('renew-phase-one', 'RENEW-007', 10, $t$Bolton — Phase One$t$,
 $t$Great! The company that offers this option is Bolton Services Group. The program consists of 2 phases. Phase 1 begins immediately upon your enrollment and continues until you graduate. They will work with you to restore your monthly savings with robust financial education. They will set up monthly credit monitoring to track your progress. And put you in touch with a law firm that will make sure to protect your consumer rights. Most of the work in this phase is to set the groundwork for resolving the debt and improving the credit in Phase 2. Does it make sense so far?$t$,
 array['AC'],
 $j$[{"tone":"AC","text":"Great! The company that offers this option is Bolton Services Group. The program consists of 2 phases. Phase 1 begins immediately upon your enrollment and continues until you graduate. They will work with you to restore your monthly savings with robust financial education. They will set up monthly credit monitoring to track your progress. And put you in touch with a law firm that will make sure to protect your consumer rights. Most of the work in this phase is to set the groundwork for resolving the debt and improving the credit in Phase 2. Does it make sense so far?"}]$j$,
 $t$Same Phase 1 as the Options Script. Wait for the yes on "Does it make sense so far?" before moving into Phase 2.$t$,
 $t$This is a real program with a clear plan.$t$,
 $t$CONTINUE ON THE OPTIONS SCRIPT AT PHASE 2 AND CLOSE$t$,
 null, false)

) as v(module_slug, code, sort_order, title, script_text, tones, tone_map, coaching, feel, note, cond, verbatim)
where m.slug = v.module_slug and s.slug = 'renew-may-2026'
on conflict (module_id, segment_code) do update set
  script_text = excluded.script_text, tones = excluded.tones,
  tone_map = excluded.tone_map, coaching = excluded.coaching,
  client_should_feel = excluded.client_should_feel,
  script_note = excluded.script_note, condition = excluded.condition,
  verbatim = excluded.verbatim, title = excluded.title,
  sort_order = excluded.sort_order;

-- 5. Check: the script, where it hands off, and its 7 lines.
select s.title, o.title as continues_into, s.continues_from,
       (select count(*) from public.segments g join public.modules m on m.id = g.module_id where m.script_id = s.id) as lines
from public.scripts s
left join public.scripts o on o.id = s.continues_into
where s.slug = 'renew-may-2026';
