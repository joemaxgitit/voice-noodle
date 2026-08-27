-- ============================================================
-- Bolton 60-Day & General Monthly Call.
-- Run AFTER am-schema.sql and sections.sql. Safe to re-run.
--
-- This is the template the 90, 120 and 150 day calls reuse. Only the
-- budget section changes between them, plus the summons passage which
-- belongs to the 60-day.
-- ============================================================

insert into public.segments
  (module_id, segment_code, sort_order, section, title, script_text, tones,
   coaching, client_should_feel, verbatim, status)
select m.id, v.code, v.sort_order, v.section, v.title, v.script_text, v.tones,
       v.coaching, v.feel, v.verbatim, 'published'
from public.modules m
join public.scripts s on s.id = m.script_id
cross join (values

-- ---------- Section 1: Monthly Call Introduction ----------

('am-60', 'AM60-001', 10, $t$Monthly Call Introduction$t$, $t$Pull Up the File$t$,
 $t$This is [your name] with Bolton Services Group. Could you please give me a minute so I can pull up your file? Great!$t$,
 array['CALM'],
 $t$SLOW DOWN. The script says it and it matters — this is the first thing they hear after a month of silence, and rushing it makes the whole call feel transactional.$t$,
 $t$My person is calling.$t$, false),

('am-60', 'AM60-002', 20, $t$Monthly Call Introduction$t$, $t$How Are You Doing$t$,
 $t$Hello [Client Name]. How are you doing?$t$,
 array['I CARE'],
 $t$Wait for the answer. A real one. This is the only genuinely open question in the call and it is where you find out if something has gone wrong.$t$,
 $t$They actually want to know.$t$, false),

('am-60', 'AM60-003', 30, $t$Monthly Call Introduction$t$, $t$Agenda and Open Floor$t$,
 $t$Great! The goal of our call today is to discuss the status of your enrolled accounts, any documents and calls you may be receiving and continue the Financial Wellness portion of the program. Sound good? ... Before we get started, do you have any questions outside of our regular topics?$t$,
 array['AC','I CARE'],
 $t$Agenda, then genuinely open the floor. Answer whatever they raise before you start, or it will sit in their head through the whole call.$t$,
 $t$There is room for my questions.$t$, false),

-- ---------- Section 2: Debt Status ----------

('am-60', 'AM60-004', 40, $t$Debt Status$t$, $t$When to Expect Letters$t$,
 $t$30 days late — this account is going to begin to be put into the creditor's collection process. Your next statement will probably look a little different than normal. 60 days late — you'll probably get an additional statement between periods. 90 to 120 days late — this is the timing where they may sell your account to a third party collector. You're likely to receive that collection letter we're looking for soon. Keep an eye out.$t$,
 array['PT'],
 $t$Open the Debt/Creditor tab and Smart Credit first. Only say the stage that applies to their accounts. Land "the collection letter we're looking for" — it reframes a frightening envelope as the thing you have been waiting for.$t$,
 $t$The scary letter is actually good news.$t$, false),

('am-60', 'AM60-005', 50, $t$Debt Status$t$, $t$Status — Fully Disputed$t$,
 $t$We have [list creditors] fully disputed and the collectors failed to provide proper validation of the account. The dispute process is complete with the collectors, but if you receive any future letters regarding the accounts, don't worry. Just send them over and we will continue the process for you.$t$,
 array['AC'],
 $t$Only read the statuses that apply to their file. "Don't worry" needs to sound like you mean it, not like a throwaway.$t$,
 $t$That one is handled.$t$, false),

('am-60', 'AM60-006', 60, $t$Debt Status$t$, $t$Status — Initial Dispute Sent$t$,
 $t$This means that we received the collector's information that you sent us or found on the credit report, and we are currently demanding the collector prove they have the right to collect on your account. The majority of the time you will see this status change in the next 60 days.$t$,
 array['AC'],
 $t$Weight "demanding". This is the moment the program stops being passive, and clients should hear that.$t$,
 $t$Somebody is on the offensive for me.$t$, false),

('am-60', 'AM60-007', 70, $t$Debt Status$t$, $t$Status — Wait for Initial Dispute Response$t$,
 $t$This means we sent out the dispute packet demanding the collectors prove they have the right to collect on your account. We are now waiting on their response so please keep an eye out for any letters you may receive from the collectors.$t$,
 array['PT'],
 $t$Ends in an instruction. Make sure the "keep an eye out" lands as a task, not a sign-off.$t$,
 $t$I have something to do.$t$, false),

('am-60', 'AM60-008', 80, $t$Debt Status$t$, $t$Status — Wait for Sold Package Response$t$,
 $t$The account was fully disputed with a collector, but we received a new collection letter from a new collector. This letter informs the new collector of the previous dispute and requires proper information to validate the debt. We will continue the dispute process as usual from here.$t$,
 array['CALM'],
 $t$A new collector feels like going backwards to a client. "As usual from here" is doing the work — say it calmly, like it is routine, because it is.$t$,
 $t$This is not a setback.$t$, false),

('am-60', 'AM60-009', 90, $t$Debt Status$t$, $t$Status — Wait for Response Type$t$,
 $t$Based on the collection letters and validation responses you've sent us, we are actively working on your [list creditors] accounts. Please send us any other responses from them so we can make sure we respond ASAP.$t$,
 array['AC'],
 $t$"Actively working" is only credible if you sound busy on their behalf. Then the ask.$t$,
 $t$My file is not sitting in a pile.$t$, false),

('am-60', 'AM60-010', 100, $t$Debt Status$t$, $t$Status — Took Action in Smartcredit Only$t$,
 $t$It looks like your [list creditors] accounts have been charged off. We requested some updated information from them, so please be sure to keep an eye out for any letters.$t$,
 array['PT'],
 $t$"Charged off" sounds alarming if you have not explained it. Say it flatly and move to the action.$t$,
 $t$That is a normal step.$t$, false),

('am-60', 'AM60-011', 110, $t$Debt Status$t$, $t$Status — Under Attorney Review$t$,
 $t$Resolve Law Group was able to put a suit together for consumer rights violations on the part of the creditor or collector. We do not remove these debts if the suit is successful; they are considered resolved on our part, as the client was in connection with RLG due to our referral.$t$,
 array['PT'],
 $t$The second half is the part clients misunderstand. Say "we do not remove these debts" clearly — letting them assume otherwise creates a dispute later.$t$,
 $t$I understand what the suit does and does not do.$t$, true),

-- ---------- Section 3: Summons and Collection Letters ----------

('am-60', 'AM60-012', 120, $t$Summons and Collection Letters$t$, $t$Summons$t$,
 $t$Every once in a while, a creditor may decide to go through the court to settle an account. It is very rare, but if it does happen we can still help you, as it is merely a force to negotiate with you. We can talk about that in detail if it ever happens. But, again, the good news is, while we can't predict what will happen in every case, we have planned for any event that could happen.$t$,
 array['CALM','AC'],
 $t$60-day call only. Stay completely calm through this — any tension in your voice turns a rare possibility into their new worry. Land "we have planned for any event that could happen."$t$,
 $t$Even the worst case has a plan.$t$, false),

('am-60', 'AM60-013', 130, $t$Summons and Collection Letters$t$, $t$Any Letters Outstanding$t$,
 $t$Have you received any collection letters since we last spoke that you haven't sent yet? ... Please continue sending in your letters so we can be sure to get working on your accounts as soon as possible.$t$,
 array['PT'],
 $t$Ask, then genuinely wait. Clients sit on letters, and the only way you find out is silence long enough for them to admit it.$t$,
 $t$I should go dig those out.$t$, false),

('am-60', 'AM60-014', 140, $t$Summons and Collection Letters$t$, $t$Are They Still Calling$t$,
 $t$How are things going with the phone calls? Have you been receiving any since the last time we spoke?$t$,
 array['I CARE'],
 $t$Genuine concern, not a checklist item. Collection calls are the part of this that wears people down.$t$,
 $t$They know what this is like.$t$, false),

('am-60', 'AM60-015', 150, $t$Summons and Collection Letters$t$, $t$Calls — Working With RLG$t$,
 $t$Have you been working with Resolve Law Group to stop them? ... Good to hear. How are things going with them so far? ... Great! I am glad to see you are engaged in the process!$t$,
 array['AC'],
 $t$If things are going well, say so warmly. Engagement is the strongest predictor you have of a client who finishes.$t$,
 $t$I am doing this right.$t$, false),

('am-60', 'AM60-016', 160, $t$Summons and Collection Letters$t$, $t$Calls — Not Going Well$t$,
 $t$What is the issue?$t$,
 array['I CARE'],
 $t$Ask and stop. See what you can actually help with rather than defending RLG.$t$,
 $t$Someone will sort this out.$t$, false),

('am-60', 'AM60-017', 170, $t$Summons and Collection Letters$t$, $t$Calls — Not With RLG Yet$t$,
 $t$Well then I have some really good news. You may be a victim of predatory creditors, and could be awarded monetary damages. We're able to provide you a free consultation with Resolve. They're a nationwide law firm we've partnered with to help protect our client's legal rights. This often results in our clients like you getting paid when the creditors break the law. You can find their contact number in your Client Portal in the Resources tab, or I can give it to you now — (818) 600-5386. Please give them a call when you can as it could literally mean money in your pocket so don't miss this opportunity.$t$,
 array['AC'],
 $t$Lift on "really good news". Slow right down on the phone number and offer to email it as well.$t$,
 $t$This could actually pay me.$t$, false),

('am-60', 'AM60-018', 180, $t$Summons and Collection Letters$t$, $t$Calls — None$t$,
 $t$That's great to hear! If you receive any more calls in the future, don't hesitate to let me know.$t$,
 array['AC'],
 $t$Short and genuinely pleased. Do not go looking for a problem that is not there.$t$,
 $t$Good news is allowed.$t$, false),

('am-60', 'AM60-019', 190, $t$Summons and Collection Letters$t$, $t$Check In$t$,
 $t$Do you have any questions for me before we move on to your budget?$t$,
 array['I CARE'],
 $t$A real pause between the two halves of the call. Answer anything they raise before moving on.$t$,
 $t$I can stop them and ask.$t$, false),

-- ---------- Section 4: Budget ----------

('am-60', 'AM60-020', 200, $t$Budget$t$, $t$Open the Budget$t$,
 $t$Now, let's take a look at your budgeting, ok?$t$,
 array['CALM'],
 $t$Short signpost. Budget talk makes people defensive, so arrive gently.$t$,
 $t$This is a normal part of the call.$t$, false),

('am-60', 'AM60-021', 210, $t$Budget$t$, $t$Day 60 — Track Spending$t$,
 $t$The goal is to establish a budget and look for savings. You can check your account statements like your checking accounts and credit cards you have to identify where you are spending.$t$,
 array['PT'],
 $t$Plain and practical. This is the 60-day budget task — later calls revisit it rather than repeat it.$t$,
 $t$That is something I can actually do.$t$, false),

('am-60', 'AM60-022', 220, $t$Budget$t$, $t$Categorise the Spending$t$,
 $t$It is also recommended to categorize your expenses. By doing this you may find you are paying for a monthly subscription you could do without, or your daily lunch run is costing you more than you thought. Also, look for ways to adjust your expenses that vary month to month like food, clothing, and travel. Sound good?$t$,
 array['CALM','RM'],
 $t$The subscription and the lunch run are deliberately small and unembarrassing. Keep it light — nobody takes budgeting advice from someone who sounds like they are judging.$t$,
 $t$Nobody is scolding me.$t$, false),

('am-60', 'AM60-023', 230, $t$Budget$t$, $t$Tools$t$,
 $t$Great! You can use free budgeting apps such as Rocket Money, YNAB, or Monarch Money to help with money management and tracking. You can also track your expenses using free budget templates found online. Again, the idea is to pinpoint where you can adjust to start saving! Any questions?$t$,
 array['AC'],
 $t$Say the app names clearly — people write them down. Then the reminder of why.$t$,
 $t$There are free tools for this.$t$, false),

('am-60', 'AM60-024', 240, $t$Budget$t$, $t$Anything Change This Month$t$,
 $t$Have you had any changes in your budget or unexpected expenses in the last month?$t$,
 array['I CARE'],
 $t$Discuss it properly. This question is how you catch a payment problem before it becomes a missed draft.$t$,
 $t$I can tell them if things got tight.$t$, false),

('am-60', 'AM60-025', 250, $t$Budget$t$, $t$Positive Net Income — Did They Save$t$,
 $t$Have you been able to set anything aside for the month into your savings?$t$,
 array['CALM'],
 $t$Only if they have positive net income. Ask without any implication about what the answer should be.$t$,
 $t$Either answer is safe.$t$, false),

('am-60', 'AM60-026', 260, $t$Budget$t$, $t$Saved — If Yes$t$,
 $t$Perfect! Let's keep that on track.$t$,
 array['AC'],
 $t$Brief and genuinely pleased. Do not oversell a small win.$t$,
 $t$That counted.$t$, false),

('am-60', 'AM60-027', 270, $t$Budget$t$, $t$Saved — If No$t$,
 $t$Ok, one of our goals is to get you to financial independence. Part of this will be by building up an emergency savings account in case anything comes up. We want you to be able to afford to pay for emergencies with your own money and not credit. How much do you reasonably feel you can set aside per month? ... Ok great, let's work on that for next month.$t$,
 array['CALM','RM'],
 $t$No disappointment in your voice. Let them name the number — a figure they chose is one they might actually hit.$t$,
 $t$I set that target, not them.$t$, false),

-- ---------- Section 5: Closing and Next Appointment ----------

('am-60', 'AM60-028', 280, $t$Closing and Next Appointment$t$, $t$Schedule the Next Call$t$,
 $t$Let's get you scheduled for your next appointment. For our next call... let me look at my schedule. How does [weekday & date] at [time, their time zone] work for you?$t$,
 array['CALM','RM'],
 $t$Refer to their best time to contact before proposing one.$t$,
 $t$That fits my month.$t$, false),

('am-60', 'AM60-029', 290, $t$Closing and Next Appointment$t$, $t$Homework$t$,
 $t$Before our next call I would like for you to have [budget item] ready. Also, should you receive Collection Notices very soon, please don't wait to send those to us. Send them as soon as you receive them, ok?$t$,
 array['PT'],
 $t$SLOW DOWN. The script marks it here for a reason — these are the two things that decide whether the next month moves the file forward.$t$,
 $t$I know my two jobs.$t$, false),

('am-60', 'AM60-030', 300, $t$Closing and Next Appointment$t$, $t$Close$t$,
 $t$Thanks for taking the time today and I look forward to our next call. Have a great rest of your day!$t$,
 array['CALM'],
 $t$Answer any questions before this. Then end warm and unhurried.$t$,
 $t$That was a good call.$t$, false)

) as v(module_slug, code, sort_order, section, title, script_text, tones, coaching, feel, verbatim)
where m.slug = v.module_slug and s.slug = 'bolton-am'
on conflict (module_id, segment_code) do update set
  script_text = excluded.script_text, tones = excluded.tones,
  coaching = excluded.coaching, client_should_feel = excluded.client_should_feel,
  verbatim = excluded.verbatim, section = excluded.section,
  title = excluded.title, sort_order = excluded.sort_order;
