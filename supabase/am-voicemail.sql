-- ============================================================
-- Bolton Voicemail Recordings.
-- Run AFTER am-schema.sql and sections.sql. Safe to re-run.
--
-- No sections -- three cards is short enough that tabs would be noise.
-- Word for word from Bolton's document, including the doubled "as as"
-- in the vacation greeting.
-- ============================================================

insert into public.segments
  (module_id, segment_code, sort_order, title, script_text, tones,
   coaching, client_should_feel, verbatim, status)
select m.id, v.code, v.sort_order, v.title, v.script_text, v.tones,
       v.coaching, v.feel, v.verbatim, 'published'
from public.modules m
join public.scripts s on s.id = m.script_id
cross join (values

('am-voicemail', 'VM-001', 10, $t$Unavailable$t$,
 $t$Thank you for calling Bolton Services Group, you've reached [Your Name]. My hours are Monday through Friday, [hours] Pacific time. Sorry I've missed your call. Please leave your name, phone number, and a detailed message, and I will get back to you as soon as I can. You can also reach us through chat and messaging on your client portal. Talk to you soon.$t$,
 array['CALM'],
 $t$This is the only thing on this floor you record rather than perform, so it is worth several takes. Warm and unhurried — a client calling their AM is usually calling because something worried them, and this greeting is what they get instead of a person. Slow down on the hours; people write them down.$t$,
 $t$That sounded like a person who will call me back.$t$, false),

('am-voicemail', 'VM-002', 20, $t$Busy$t$,
 $t$This is [Your Name] with Bolton Services Group. I'm currently on another line or away from my desk. Please leave your name, number, and a detailed message, and I'll return your call as soon as possible. Talk to you soon.$t$,
 array['CALM'],
 $t$Shorter than the unavailable greeting on purpose — this one plays when you are at your desk but on a call, so the client is likely to try again shortly. Brisk but still warm.$t$,
 $t$They are around, just busy.$t$, false),

('am-voicemail', 'VM-003', 30, $t$Temporary / Vacation Greeting$t$,
 $t$Thank you for calling Bolton Services Group, you've reached [Your Name]. Sorry I've missed your call. I will be out of the office from [date] to [date], but if you leave your name, phone number, and a detailed message, a team member will reach out to you as as soon as possible. You can also reach us through chat and messaging on your client portal. Thank you.$t$,
 array['CALM','PT'],
 $t$Re-record this every time the dates change — a stale vacation greeting tells a client nobody is minding their file. Say both dates slowly, and make "a team member will reach out" sound like a promise rather than a deflection.$t$,
 $t$Someone is still covering my account.$t$, false)

) as v(module_slug, code, sort_order, title, script_text, tones, coaching, feel, verbatim)
where m.slug = v.module_slug and s.slug = 'bolton-am'
on conflict (module_id, segment_code) do update set
  script_text = excluded.script_text, tones = excluded.tones,
  coaching = excluded.coaching, client_should_feel = excluded.client_should_feel,
  verbatim = excluded.verbatim,
  title = excluded.title, sort_order = excluded.sort_order;
