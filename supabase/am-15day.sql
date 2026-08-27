-- ============================================================
-- Bolton 15-Day Call. Run AFTER am-schema.sql and sections.sql.
-- Safe to run more than once.
-- ============================================================

insert into public.segments
  (module_id, segment_code, sort_order, section, title, script_text, tones,
   coaching, client_should_feel, verbatim, status)
select m.id, v.code, v.sort_order, v.section, v.title, v.script_text, v.tones,
       v.coaching, v.feel, v.verbatim, 'published'
from public.modules m
join public.scripts s on s.id = m.script_id
cross join (values

-- ---------- Section 1: Introduction ----------

('am-15', 'AM15-001', 10, $t$Introduction$t$, $t$Pull Up the File$t$,
 $t$Hello, this is [your name] with Bolton Services Group. Could you please give me a minute so I can pull up your file?$t$,
 array['CALM'],
 $t$Warm and unhurried. They have not spoken to you in two weeks, so re-establish who you are before anything else.$t$,
 $t$I remember this person.$t$, false),

('am-15', 'AM15-002', 20, $t$Introduction$t$, $t$Set the Agenda$t$,
 $t$Great! The goal of our call today is to review our overall goals and start developing a game plan to improve your finances, resolve your debt, and improve your credit. Sound good?$t$,
 array['AC','RM'],
 $t$Three outcomes in one breath, then a soft check. It tells them the call has a shape.$t$,
 $t$There is a plan for today.$t$, false),

('am-15', 'AM15-003', 30, $t$Introduction$t$, $t$Anything First$t$,
 $t$Before we get started, do you have any questions for me?$t$,
 array['I CARE'],
 $t$Pause and get a real answer. Anything worrying them will derail the rest of the call if you skip past it now.$t$,
 $t$I can raise things.$t$, false),

-- ---------- Section 2: Financial Wellness Plan ----------

('am-15', 'AM15-004', 40, $t$Financial Wellness Plan$t$, $t$Not a Settlement Company$t$,
 $t$I just want to go over a few things before we begin today's call. Bolton Services Group is not a debt settlement company. We do not pay your debts, we dispute your debts. I will go over that in more detail in a few minutes.$t$,
 array['PT'],
 $t$Flat and clear. Say "we do not pay your debts, we dispute your debts" at full clarity — it is the single most misunderstood fact in the whole program.$t$,
 $t$I understand what this company actually does.$t$, true),

('am-15', 'AM15-005', 50, $t$Financial Wellness Plan$t$, $t$Phase One — Budget and Savings$t$,
 $t$First off, let's take a moment to review the overall plan. The first phase is working on budgeting and savings. We pride ourselves on educating clients to make strong financial decisions, so the first step is for me to understand your monthly spending. We are going to start that on our next call. This is a really important phase of the program because we're putting structure in place so that you don't have to worry about money again. And that's important to you, right?$t$,
 array['AC'],
 $t$Land "so that you don't have to worry about money again" — that is the outcome they actually want, underneath the debt.$t$,
 $t$This is about more than the debt.$t$, false),

('am-15', 'AM15-006', 60, $t$Financial Wellness Plan$t$, $t$Behind the Scenes$t$,
 $t$While we're engaged in improving your immediate financial situation, our team will be doing a lot behind the scenes for you. We will be monitoring your credit to make sure the accounts are moving towards collections. We will also be sending disputes to the credit bureaus and making sure there are no inaccurate items. Although I will track your credit score, and the score is important to a lot of my clients, we're going to work on your credit as our last goal, because we have a lot of work to do first. Does that make sense?$t$,
 array['CALM','PT'],
 $t$Setting the expectation that credit comes last is what prevents the month-three panic call. Do not rush it.$t$,
 $t$Work is happening even when I cannot see it.$t$, false),

('am-15', 'AM15-007', 70, $t$Financial Wellness Plan$t$, $t$The FDCPA$t$,
 $t$As soon as we receive a collection letter, that's when the dispute process begins. This is a powerful process that will resolve your debt and the collection letters are the key to getting this debt resolved. This entire process is based on the Fair Debt Collection Practices Act of 1977, also known as the FDCPA. It is a law designed to protect consumers against debt collectors that were not following the rules. Based on the FDCPA, we have the right to request proof that they have all the documentation on file about your debt BEFORE they collect any money. We know that they don't, and that is why we have such a high success rate. They just assume most consumers don't know their rights, and 9 times out of 10 they don't even attempt to provide any documentation. Just to give you an idea, there were over 81,000 complaints filed with the government last year alone. And we know many of our clients will have their rights violated as well, which is why we work with the nation's top consumer protection law firms. So, not only will this resolve your debt, but you will also be receiving an education along the way. How does that sound?$t$,
 array['AC'],
 $t$Long passage — vary your pace or it becomes a lecture. Weight the word BEFORE, and let the 81,000 figure land on its own.$t$,
 $t$There is real law behind this.$t$, false),

-- ---------- Section 3: Client Portal and Letters ----------

('am-15', 'AM15-008', 80, $t$Client Portal and Letters$t$, $t$Introduce the Portal$t$,
 $t$Next, I'm going to transition to how we can work together. I'm going to review the Client Portal and how to send in documents. You can access the portal on your computer or phone. I'll send you a link once we're done today. Ok?$t$,
 array['CALM'],
 $t$Short signpost before a long walkthrough.$t$,
 $t$I know what is coming next.$t$, false),

('am-15', 'AM15-009', 90, $t$Client Portal and Letters$t$, $t$Portal Tour$t$,
 $t$I'd like to point out there's a lot of useful information on your Dashboard that will guide you through the program. You can view credit updates and program savings, along with some helpful articles on how to improve your finances. On the left-hand side, you'll see when your next payment will be drafted and the amount. You'll also see the date for our next appointment. The documents tab will show you all documentation for the program, including your contract and any other documents you may sign. Then, at the bottom, it shows my contact information to get ahold of me. There's a tab for your monthly budget, which we'll be working on right in the beginning. And lastly, you can use Live Chat if you have any basic questions. Any questions about the portal so far?$t$,
 array['CALM'],
 $t$SLOW DOWN and bullet-point these. One item, small pause, next item. Running them together is how a client ends up never opening the portal.$t$,
 $t$I could find my way around that.$t$, false),

('am-15', 'AM15-010', 100, $t$Client Portal and Letters$t$, $t$Three Ways to Send Letters$t$,
 $t$As I said earlier, sending us the collector letters is very important to your success in the program. You can do this by taking a picture with your smartphone and texting them to our direct line, emailing them as an attachment to info@BoltonServiceGroup.com, or uploading them to the client portal. If you need help with how to upload a document, let me know and I'll be glad to walk you through it. Ok?$t$,
 array['PT'],
 $t$Three options, said slowly enough that they can pick one. Most people will choose the photo and text.$t$,
 $t$That is easy enough to do.$t$, false),

('am-15', 'AM15-011', 110, $t$Client Portal and Letters$t$, $t$Confirmation$t$,
 $t$Once you send in the documents, I will send you a message confirming we received it. Do you have any questions about getting documents to us?$t$,
 array['CALM'],
 $t$Small promise, easy to keep, and it is what makes them send the second letter.$t$,
 $t$I will know it arrived.$t$, false),

('am-15', 'AM15-012', 120, $t$Client Portal and Letters$t$, $t$The 30-Day Notice$t$,
 $t$The most important letters come from third-party collection agencies. By law, they allow you to exercise your rights. What this means is that you can dispute the validity of the debt once your accounts go to collections. On those letters, you'll notice this phrase: "Unless you notify us within 30 days after receiving this notice that you dispute the validity of this debt or any portion thereof, we will assume this debt is valid." This is key to resolving your debt and we need to take action quickly, so please send those letters to us as soon as you receive them. If you receive any letters, please don't wait until our next appointment to send them.$t$,
 array['PT','AC'],
 $t$The quoted phrase is statutory language — read it exactly, and slow down through it. Everything after it is urgency, so let that lift.$t$,
 $t$There is a clock on this and I should not sit on the mail.$t$, true),

('am-15', 'AM15-013', 130, $t$Client Portal and Letters$t$, $t$Check In$t$,
 $t$Do you have any questions for me?$t$,
 array['I CARE'],
 $t$Pause and wait. This comes right after the heaviest part of the call.$t$,
 $t$I am allowed to be confused.$t$, false),

('am-15', 'AM15-014', 140, $t$Client Portal and Letters$t$, $t$This Will Take Time$t$,
 $t$I want to make sure you know that the Financial Wellness Plan is going to take time. Generally, it takes about 2 years to fully recover from issues regarding debt. One of our goals is to raise your credit score, but I need to make sure you understand that your credit score will likely drop in the beginning. That's ok, because we're going to be working on your finances first. One of our goals is to help you save money. The key indicator of success for us is you making your program payments, since they'll save you money in the long run. If there's a problem with the payments, it tells us that we still have work to do. So, keeping you on track is a priority for me, and I hope it is for you as well.$t$,
 array['CALM','PT'],
 $t$"Your credit score will likely drop in the beginning" has to be said plainly and without flinching. Softening it here is what causes the cancellation later.$t$,
 $t$Nobody is pretending this is instant.$t$, true),

-- ---------- Section 4: Closing and Next Appointment ----------

('am-15', 'AM15-015', 150, $t$Closing and Next Appointment$t$, $t$Chirp$t$,
 $t$The last thing I want to cover with you is Chirp. It's a program that helps protect you from NSF and overdraft fees if you don't have enough money in your account when your payment date comes around. Once I send you the link, all you would need to do is follow the prompts to select your bank and then log in to choose the account that's in your file here. Is Chirp something you'd be interested in signing up for?$t$,
 array['CALM'],
 $t$Offer it, do not sell it. Check the BANK tab first to see whether they are already connected.$t$,
 $t$That would save me a headache.$t$, false),

('am-15', 'AM15-016', 160, $t$Closing and Next Appointment$t$, $t$Chirp — If Yes$t$,
 $t$Great, I will send the link to you via email... one moment.$t$,
 array['AC'],
 $t$Offer to walk them through it right there while you have them on the phone.$t$,
 $t$That was easy.$t$, false),

('am-15', 'AM15-017', 170, $t$Closing and Next Appointment$t$, $t$Chirp — If No$t$,
 $t$Not a problem at all. If you change your mind, I'll be happy to help you get it set up.$t$,
 array['RM'],
 $t$Genuinely no pressure. Pushing here costs you goodwill you will need later.$t$,
 $t$They did not push me.$t$, false),

('am-15', 'AM15-018', 180, $t$Closing and Next Appointment$t$, $t$The Next 60 Days$t$,
 $t$Our next appointment will be about two weeks from now, and then we'll move to monthly calls, but if you need anything in between our appointments, don't hesitate to call, text or email. I'll be working quite a bit between our calls as well, which you'll be able to see in the client portal. I'd like to take the next 60 days to work on budgeting and savings while we wait for those debts to go to collections.$t$,
 array['CALM'],
 $t$Naming the cadence now is what stops them wondering whether they have been forgotten.$t$,
 $t$I know when I will hear from them.$t$, false),

('am-15', 'AM15-019', 190, $t$Closing and Next Appointment$t$, $t$Schedule It$t$,
 $t$Do you have any questions for me before we schedule the next call? ... Ok, let's schedule our next appointment, which will be about two weeks from now. Our hours are Monday through Friday, 8am-5pm PST. How does [day of the week/date] at [time, their time zone] AM/PM work for you?$t$,
 array['CALM','RM'],
 $t$Refer to their best time to contact. If they have not given one, ask what day and time frame they prefer and note it in Special Notes.$t$,
 $t$That fits my week.$t$, false),

('am-15', 'AM15-020', 200, $t$Closing and Next Appointment$t$, $t$Close$t$,
 $t$You'll receive appointment reminders before our next appointment. As always, if you need to reschedule our call for any reason, please let me know as soon as possible, ok? Thank you for taking the time today and I look forward to our next call.$t$,
 array['CALM'],
 $t$Warm and brief. End the call sounding like you will actually be there next time.$t$,
 $t$That was worth the twenty minutes.$t$, false)

) as v(module_slug, code, sort_order, section, title, script_text, tones, coaching, feel, verbatim)
where m.slug = v.module_slug and s.slug = 'bolton-am'
on conflict (module_id, segment_code) do update set
  script_text = excluded.script_text, tones = excluded.tones,
  coaching = excluded.coaching, client_should_feel = excluded.client_should_feel,
  verbatim = excluded.verbatim, section = excluded.section,
  title = excluded.title, sort_order = excluded.sort_order;
