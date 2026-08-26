-- ============================================================
-- The three objection loops.
-- Run AFTER the teams migration. Safe to run more than once.
--
-- These are NOT part of the linear call, so they carry kind='loop'
-- and render in their own group. Each rebuilds a different one of
-- Belfort's Three Tens: the product, you, the company.
-- ============================================================

insert into public.modules (script_id, slug, title, sort_order, kind)
select s.id, v.slug, v.title, v.sort_order, 'loop'
from public.scripts s
cross join (values
  ('loop-1', 'Loop 1 — Rebuild the Product',  210),
  ('loop-2', 'Loop 2 — Rebuild Trust in You', 220),
  ('loop-3', 'Loop 3 — Rebuild the Company',  230)
) as v(slug, title, sort_order)
where s.slug = 'options-june-2026'
on conflict (script_id, slug) do update set
  title = excluded.title,
  sort_order = excluded.sort_order,
  kind = 'loop';


-- ---------- LOOP 1: the product ----------

insert into public.segments
  (module_id, segment_code, sort_order, title, script_text, tones,
   coaching, client_should_feel, status)
select m.id, v.code, v.sort_order, v.title, v.script_text, v.tones,
       v.coaching, v.feel, 'published'
from public.modules m
join public.scripts s on s.id = m.script_id
cross join (values

('loop-1', 'LOOP1-001', 10, $t$Deflect and Ask$t$,
 $t$I hear what you're saying. Let me ask you a question: Does the program make sense? Do you like the idea?$t$,
 array['AC'],
 $t$Deflect, do not argue. The question is the whole move. Ask it and stop — you need the yes before anything else works.$t$,
 $t$He is not fighting me.$t$),

('loop-1', 'LOOP1-002', 20, $t$Back Into the Money$t$,
 $t$Exactly! It's a great program! In fact, one of the true beauties here is that you will be putting $XXX of hard-earned cash back into your pocket every month. Let me tell you exactly what you're going to get for that, ok?$t$,
 array['AC'],
 $t$Energy comes back up on "Exactly!" You are re-presenting, not defending. Land the dollar figure clean.$t$,
 $t$I forgot how much this actually saves me.$t$),

('loop-1', 'LOOP1-003', 30, $t$What They Get$t$,
 $t$We dispute the debt once it goes to collections, because it's the cheapest way; we monitor and analyze your credit because we want to increase your lending power; and we educate you on your rights because we want to empower you and set you up for financial success for the rest of your life. You see what I am saying here, FIRST NAME?$t$,
 array['AC'],
 $t$Three beats, each with a because. Do not rush the list — the reasons are what raise certainty, not the features.$t$,
 $t$Every part of this has a purpose.$t$),

('loop-1', 'LOOP1-004', 40, $t$Why Didn't We Do It Sooner$t$,
 $t$Exactly! This finally puts you back in the driver's seat. Now FIRST NAME, let me ask you another question... If I'd been able to put this plan together when this all started for you, and you had been able to save thousands of dollars, eliminated all the stress so you can focus on what really matters, then you probably wouldn't be saying "Let me think about it" right now. You'd be saying "Why didn't we do it sooner." Am I right?$t$,
 array['AC'],
 $t$Real pause before the question. This is a long pattern — hold your pace to the end and do not step on the last line.$t$,
 $t$Waiting is what has been costing me.$t$),

('loop-1', 'LOOP1-005', 50, $t$Reintroduce Yourself$t$,
 $t$Look. You don't know me, and I don't have the luxury of a track record, so let me take a moment to reintroduce myself. My name is FULL NAME. I'm a senior consultant at Lionside Financial and I pride myself on helping every single client improve their financial future. Not only am I going to help you get enrolled, but we will be here every step of the way even after you graduate. As far as my company goes, we are the leader in the industry with cutting edge education and decades of experience. And believe me, if I'm even half right, the only problem you will have is I didn't call you six months ago and help you then. Fair enough?$t$,
 array['AC','CALM','RM'],
 $t$This is the bridge from the product to you. Drop into CALM on "believe me", then Reasonable Man on the close.$t$,
 $t$I know who I am dealing with now.$t$)

) as v(module_slug, code, sort_order, title, script_text, tones, coaching, feel)
where m.slug = v.module_slug and s.slug = 'options-june-2026'
on conflict (module_id, segment_code) do update set
  script_text = excluded.script_text, tones = excluded.tones,
  coaching = excluded.coaching, client_should_feel = excluded.client_should_feel,
  title = excluded.title, sort_order = excluded.sort_order;


-- ---------- LOOP 2: trust in you ----------

insert into public.segments
  (module_id, segment_code, sort_order, title, script_text, tones,
   coaching, client_should_feel, status)
select m.id, v.code, v.sort_order, v.title, v.script_text, v.tones,
       v.coaching, v.feel, 'published'
from public.modules m
join public.scripts s on s.id = m.script_id
cross join (values

('loop-2', 'LOOP2-001', 10, $t$Same Page$t$,
 $t$I hear what you're saying, but I've been doing this for a long time. FIRST NAME, this program is tailor made for you. You have one low payment that finally gives you breathing room, and is the fastest way to get your credit back on track. So let's make sure we're on the same page here. Ok?$t$,
 array['CALM','AC'],
 $t$Open CALM so it does not read as pushback, then step into certainty on "tailor made for you."$t$,
 $t$He is not brushing me off, he knows what he is doing.$t$),

('loop-2', 'LOOP2-002', 20, $t$That's a Good Thing$t$,
 $t$Your accounts will fall behind and go to collection, and that's a good thing, because this allows us to dispute the debt and get it resolved. And that's what really matters to you right?$t$,
 array['AC','PT'],
 $t$"And that's a good thing" is Presupposing — said flat, like it goes without saying. Any hesitation here and they hear a problem.$t$,
 $t$That part is supposed to happen.$t$),

('loop-2', 'LOOP2-003', 30, $t$Success and Support$t$,
 $t$Exactly! All without damaging your credit any further. Our goal is to stop all collection activity as quickly as possible. You see, we've had such high success doing this it's almost unbelievable. In addition to resolving the debt you'll also be empowered with education, support, protection, advice, and finally a plan for your future.$t$,
 array['AC'],
 $t$Build across the list at the end. Do not flatten it — each item should sound like it was worth mentioning.$t$,
 $t$This is more than a payment plan.$t$),

('loop-2', 'LOOP2-004', 40, $t$I've Been There Too$t$,
 $t$One of the things that I love about this job is seeing clients transform. Come from a place of stress and become inspired through education and most importantly... results. Look, I've been there too. It almost ruined me. But I also know how amazing it feels on the other side and not having this debt burden hanging over me. The reason that I chose to work for Lionside Financial is because... we actually care about our clients. And it's important that you are working with a trustworthy company right?$t$,
 array['AC','I CARE'],
 $t$The two pauses carry this one. Drop right down on "I've been there too" — this is the most personal thing you will say on the call, so do not perform it.$t$,
 $t$He is a person, not a script.$t$),

('loop-2', 'LOOP2-005', 50, $t$What's the Worst That Can Happen$t$,
 $t$Now let me ask you a question. Let's say I'm wrong, which is highly, HIGHLY unlikely. What's the worst that can happen? You're out $MONTHLY PROGRAM PAYMENT and you cancel the program. That's not going to ruin you financially. You still get all of the other benefits out of the gate. If I'm even half right, on the upside, having us as an asset to you and your family, you get credit monitoring, ID theft protection, financial education, the lifestyle benefits we discussed, a consultation with the best consumer protection law firm in the nation. We pride ourselves on long term relationships and we will be there to hold your hand every step of the way. Does that make sense?$t$,
 array['CALM','AC','I CARE','RM'],
 $t$This lowers the risk of saying yes. Stay CALM through the downside so it sounds small, then lift through the upside. "Hold your hand every step of the way" should be warm, not throwaway.$t$,
 $t$The downside is tiny and the upside is not.$t$),

('loop-2', 'LOOP2-006', 60, $t$One Percent of Your Trust$t$,
 $t$FIRST NAME, put your trust in me, my program, and my company. You will finally be done with this debt, your credit will be back to where you need it to be, and you'll have an extra $PROGRAM SAVINGS in the bank. So, all I ask you is this: if you give me 1 percent of your trust, I'll earn the other 99 percent. Fair enough?$t$,
 array['AC','CALM'],
 $t$Certainty through the promise, then drop into CALM for the last line. Say the 1 and 99 slowly. Then stop completely.$t$,
 $t$He is only asking me for a little.$t$)

) as v(module_slug, code, sort_order, title, script_text, tones, coaching, feel)
where m.slug = v.module_slug and s.slug = 'options-june-2026'
on conflict (module_id, segment_code) do update set
  script_text = excluded.script_text, tones = excluded.tones,
  coaching = excluded.coaching, client_should_feel = excluded.client_should_feel,
  title = excluded.title, sort_order = excluded.sort_order;


-- ---------- LOOP 3: the company ----------

insert into public.segments
  (module_id, segment_code, sort_order, title, script_text, tones,
   coaching, client_should_feel, status)
select m.id, v.code, v.sort_order, v.title, v.script_text, v.tones,
       v.coaching, v.feel, 'published'
from public.modules m
join public.scripts s on s.id = m.script_id
cross join (values

('loop-3', 'LOOP3-001', 10, $t$Not Pressure$t$,
 $t$FIRST NAME, I hear you. Please don't mistake my enthusiasm for pressure. I see the pain you're in and this is the remedy. Give me one shot and you'll see, just like all my other clients, this is the best financial decision.$t$,
 array['I CARE','AC'],
 $t$Say the pressure line gently and mean it. If it sounds defensive it confirms exactly what they were thinking.$t$,
 $t$He is not pushing me, he believes this.$t$),

('loop-3', 'LOOP3-002', 20, $t$You Never Borrowed From Them$t$,
 $t$The program is simple. As the accounts fall behind the creditors simply write off the debt as a loss. Trust me, they never lose money. Then, when they sell the debt to a collector, they don't have the documents they need to collect the debt from you. You never borrowed any money from a collection agency right?$t$,
 array['PT','AC'],
 $t$Open flat on "the program is simple" — Plain Talk. The closing question should sound obvious, because it is.$t$,
 $t$I never agreed to anything with a collector.$t$),

('loop-3', 'LOOP3-003', 30, $t$Where We Earn Our Money$t$,
 $t$Exactly! Why would you pay someone you didn't even owe? You wouldn't. Look, getting you out of debt is the easy part. Remember, our success rate is off the charts. Where we earn our money is the long term relationship. We work with you to design a very specific and detailed plan to save you money and improve your credit, and that's important to you as well, right?$t$,
 array['AC','CALM','RM'],
 $t$Drop into CALM on "getting you out of debt is the easy part" — that contrast is what makes the relationship sound like the real product.$t$,
 $t$They are not just going to disappear after I sign.$t$),

('loop-3', 'LOOP3-004', 40, $t$My Reputation$t$,
 $t$Of course it is! Just so you know, I don't offer this program to everybody. It's for a select few. Because you're with us for the long run, if there were a problem it would reflect on my reputation, which is sterling, and I am not willing to have even one client fail. My entire company feels this way. And you want to work with a company that stands behind their service right?$t$,
 array['AC','S','CALM'],
 $t$Drop your voice on "it's for a select few" — that is Scarcity, and it only works quiet. Then back up into certainty on the reputation line.$t$,
 $t$I am being let into something.$t$),

('loop-3', 'LOOP3-005', 50, $t$A Year From Now$t$,
 $t$FIRST NAME, the last thing I want to see is you continue to struggle month after month just to make ends meet. Imagine how you will feel in a year when this is still keeping you up at night. That feeling in the pit of your stomach. But, I want you to focus on how amazing it will be when you are back on your feet again, have plenty of money in your bank account, and you can even take a vacation without worrying. Won't that be amazing?$t$,
 array['I CARE','AC'],
 $t$Slow and quiet through the pain, then genuinely lift on the future. The turn between those two halves is the whole segment.$t$,
 $t$I do not want to still feel like this next year.$t$),

('loop-3', 'LOOP3-006', 60, $t$Very, VERY Impressed$t$,
 $t$If you do even half as well as my clients you will be very, VERY impressed. Sound fair enough?$t$,
 array['AC','CALM','RM'],
 $t$Short and final. Land the second VERY, drop into CALM, then Reasonable Man on the close. Then silence.$t$,
 $t$That is an easy yes.$t$)

) as v(module_slug, code, sort_order, title, script_text, tones, coaching, feel)
where m.slug = v.module_slug and s.slug = 'options-june-2026'
on conflict (module_id, segment_code) do update set
  script_text = excluded.script_text, tones = excluded.tones,
  coaching = excluded.coaching, client_should_feel = excluded.client_should_feel,
  title = excluded.title, sort_order = excluded.sort_order;
