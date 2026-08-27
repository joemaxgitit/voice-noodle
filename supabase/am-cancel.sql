-- ============================================================
-- Bolton Phone Cancellation Request.
-- Run AFTER am-schema.sql and sections.sql. Safe to re-run.
--
-- Only four things are actually said on this call. The middle of it --
-- "ask genuine questions, do your best to address their concerns" --
-- is unscripted, so it lives in coaching rather than being faked into
-- dialogue a rep would try to read aloud.
-- ============================================================

insert into public.segments
  (module_id, segment_code, sort_order, section, title, script_text, tones,
   coaching, client_should_feel, verbatim, status)
select m.id, v.code, v.sort_order, v.section, v.title, v.script_text, v.tones,
       v.coaching, v.feel, v.verbatim, 'published'
from public.modules m
join public.scripts s on s.id = m.script_id
cross join (values

('am-cancel', 'CANC-001', 10, $t$Taking the Request$t$, $t$Begin the Process$t$,
 $t$I am going to begin the cancellation process now. What I'd like to do is take a few notes to process your request ok?$t$,
 array['CALM'],
 $t$Steady and completely unresistant. A client who expects a fight relaxes the moment they do not get one, and a relaxed client will actually tell you what is wrong. Any hint of pushback here and the real reason never surfaces.$t$,
 $t$They are not going to fight me on this.$t$, false),

('am-cancel', 'CANC-002', 20, $t$Taking the Request$t$, $t$Ask the Reason$t$,
 $t$Just so I can notate it, what's the reason that you would like to cancel?$t$,
 array['I CARE'],
 $t$Ask it, then stop talking completely. Put the specific reason or reasons in the cancellation notes. The first answer is rarely the real one, so leave the silence long enough for a second sentence.$t$,
 $t$They actually want to know why.$t$, false),

('am-cancel', 'CANC-003', 30, $t$Taking the Request$t$, $t$Understand the Situation$t$,
 $t$Ask genuine questions to seek to understand their situation completely. Do your best to address their concerns.$t$,
 array['I CARE'],
 $t$This card has no script because there is no script. It is the only unscripted moment in the whole playbook, and it is where the call is actually won or lost. Listen for whether the problem is the program, the money, or something that has nothing to do with either. Do not sell. Do not recite benefits. Find out what happened.$t$,
 $t$This person is listening to me, not handling me.$t$, false),

('am-cancel', 'CANC-004', 40, $t$If You Cannot Retain Them$t$, $t$Place on Hold$t$,
 $t$I will go ahead and place your account on hold. A Quality Assurance team member will reach out to finalize. When you see a call from an (855) area code, it is important that you answer the call.$t$,
 array['CALM','PT'],
 $t$Say the 855 slowly and clearly. If they miss that call the cancellation stalls and everyone's month gets worse. No disappointment in your voice — you have lost the client, not the relationship.$t$,
 $t$I know exactly what happens next.$t$, true)

) as v(module_slug, code, sort_order, section, title, script_text, tones, coaching, feel, verbatim)
where m.slug = v.module_slug and s.slug = 'bolton-am'
on conflict (module_id, segment_code) do update set
  script_text = excluded.script_text, tones = excluded.tones,
  coaching = excluded.coaching, client_should_feel = excluded.client_should_feel,
  verbatim = excluded.verbatim, section = excluded.section,
  title = excluded.title, sort_order = excluded.sort_order;
