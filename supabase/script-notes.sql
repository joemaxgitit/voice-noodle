-- ============================================================
-- Script notes: the master script's own directions.
-- Run AFTER conditions.sql. Safe to run more than once.
--
-- These are the parentheticals and all-caps instructions written
-- into the script itself — distinct from the coaching notes, which
-- are ours. They are shown verbatim and never spoken, so they
-- cannot live in script_text.
-- ============================================================

alter table public.segments
add column if not exists script_note text;

-- ---------- directions ----------

update public.segments set script_note = $t$(Dig into the hardship SLOW DOWN)$t$
where segment_code = 'DISC-004';

update public.segments set
  script_text = $t$How long has this been going on? Are you at least able to keep up with basic expenses? What are you going to do if it doesn't get better? How is it affecting your family? How is it affecting your health?$t$,
  tone_map = $j$[{"tone":"","text":"How long has this been going on? Are you at least able to keep up with basic expenses? What are you going to do if it doesn't get better? How is it affecting your family? How is it affecting your health?"}]$j$::jsonb,
  title = $t$Sample Questions$t$,
  script_note = $t$Sample Questions. (Summarize what they told you and show empathy, so they know you were listening)$t$
where segment_code = 'DISC-005';

update public.segments set script_note = $t$(WALK THEM THROUGH SUPERMONEY. THEY MUST BE AVAILABLE TO DO IT WITH YOU ON THE PHONE. IF NOT, SCHEDULE A BETTER TIME WITH THEM)$t$
where segment_code = 'LOAN-002';

update public.segments set script_note = $t$REVIEW CREDIT REPORT — Talk about things that benefit your close... highlight maxed out, and over the limit accounts$t$
where segment_code = 'REV-001';

update public.segments set script_note = $t$(Lock down a date and move on)$t$
where segment_code = 'ENR-003';

update public.segments set script_note = $t$(Collect ACH info)$t$
where segment_code = 'ENR-004';

update public.segments set script_note = $t$CREDITOR EXAMPLE IF NEED TO FURTHER CLARIFY$t$
where segment_code = 'BOLT-009';

update public.segments set script_note = $t$Send Client Portal Login information (the client will sign the agreement through it)$t$
where segment_code = 'CON-001';

update public.segments set script_note = $t$Once receive contract back$t$
where segment_code = 'CMP-001';

update public.segments set script_note = $t$When you come back on the line with the AM$t$
where segment_code = 'FIN-004';

update public.segments set script_note = $t$As soon as the AM is done and invites you back on the line. (Say your goodbyes)$t$
where segment_code = 'FIN-005';


-- ---------- spoken text that was missing ----------

-- Creditor example: the second paragraph never made it in.
insert into public.segments
  (module_id, segment_code, sort_order, section, title, script_text, tones,
   tone_map, coaching, client_should_feel, script_note, verbatim, status)
select m.id, 'BOLT-010', 95, null, $t$Creditor Example, Part Two$t$,
 $t$When they purchase your debt from (Creditor), they simply receive a spreadsheet with your contact info, account number and how much you owed (creditor). Their only goal is to make as much money off you as possible. Once the collections company has your info, you'll get a letter in the mail stating that they took over your debt and they are trying to collect on behalf of (creditor). We know that all of the time that is not true because (creditor) has already sold this debt to them, made their money, and is out of the picture. Once you get that letter, you simply forward it to us and allow our team to handle the dispute process on your behalf from A to Z. Pretty straightforward right?$t$,
 '{}'::text[],
 $j$[{"tone":"","text":"When they purchase your debt from (Creditor), they simply receive a spreadsheet with your contact info, account number and how much you owed (creditor). Their only goal is to make as much money off you as possible. Once the collections company has your info, you'll get a letter in the mail stating that they took over your debt and they are trying to collect on behalf of (creditor). We know that all of the time that is not true because (creditor) has already sold this debt to them, made their money, and is out of the picture. Once you get that letter, you simply forward it to us and allow our team to handle the dispute process on your behalf from A to Z. Pretty straightforward right?"}]$j$::jsonb,
 $t$The pivot from indignation to instruction. "You simply forward it to us" is the whole point — everything before it exists to make that one action feel easy.$t$,
 $t$All I have to do is forward the letter.$t$,
 $t$WAIT FOR AN ANSWER — BE PREPARED TO FILL IN ANY GAPS HERE$t$,
 false, 'published'
from public.modules m
join public.scripts s on s.id = m.script_id
where m.slug = 'bolton' and s.slug = 'options-june-2026'
on conflict (module_id, segment_code) do update set
  script_text = excluded.script_text, tone_map = excluded.tone_map,
  coaching = excluded.coaching, client_should_feel = excluded.client_should_feel,
  script_note = excluded.script_note, title = excluded.title,
  sort_order = excluded.sort_order;
