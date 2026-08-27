-- ============================================================
-- Bolton 150-Day Call. Run AFTER am-schema.sql and sections.sql.
-- Safe to run more than once.
--
-- Same shape as the 90 and 120 day calls, but the budget section is
-- much larger: the positive net income branch runs to four beats and
-- includes a savings timeline worked out live with the client.
-- Script text is word for word; rep instructions live in coaching.
-- ============================================================

insert into public.segments
  (module_id, segment_code, sort_order, section, title, script_text, tones,
   coaching, client_should_feel, verbatim, status)
select m.id, v.code, v.sort_order, v.section, v.title, v.script_text, v.tones,
       v.coaching, v.feel, v.verbatim, 'published'
from public.modules m
join public.scripts s on s.id = m.script_id
cross join (values

-- Section 1: Monthly Call Introduction

('am-150', 'AM150-001', 10, $t$Monthly Call Introduction$t$, $t$Pull Up the File$t$,
 $t$This is [your name] with Bolton Services Group. Could you please give me a minute so I can pull up your file? Great!$t$,
 array['CALM'],
 $t$SLOW DOWN. Five months in, familiarity is an asset — routine is not.$t$,
 $t$My person is calling.$t$, false),

('am-150', 'AM150-002', 20, $t$Monthly Call Introduction$t$, $t$How Are You Doing$t$,
 $t$Hello [Client Name]. How are you doing?$t$,
 array['I CARE'],
 $t$Wait for the client response.$t$,
 $t$They actually want to know.$t$, false),

('am-150', 'AM150-003', 30, $t$Monthly Call Introduction$t$, $t$Agenda and Open Floor$t$,
 $t$Great! The goal of our call today is to discuss the status of your enrolled accounts, any documents and calls you may be receiving and continue the Financial Wellness portion of the program. Sound good? Before we get started, do you have any questions outside of our regular topics?$t$,
 array['AC','I CARE'],
 $t$Answer any questions the client may have before you start.$t$,
 $t$There is room for my questions.$t$, false),

-- Section 2: Debt Status

('am-150', 'AM150-004', 40, $t$Debt Status$t$, $t$When to Expect Letters$t$,
 $t$30 days late – this account is going to begin to be put into the creditor's collection process. Your next statement will probably look a little different than normal. 60 days late – You'll probably get an additional statement between periods. 90-120 days late – This is the timing where they may sell your account to a third party collector. You're likely to receive that collection letter we're looking for soon. Keep an eye out.$t$,
 array['PT'],
 $t$Open the Debt/Creditor tab and Smart Credit. Go over whichever average debt age is applicable.$t$,
 $t$The scary letter is actually good news.$t$, false),

('am-150', 'AM150-005', 50, $t$Debt Status$t$, $t$Status — Fully Disputed$t$,
 $t$We have [list creditors] fully disputed and the collectors failed to provide proper validation of the account. The dispute process is complete with the collectors, but if you receive any future letters regarding the account[s], don't worry. Just send them over and we will continue the process for you.$t$,
 array['AC'],
 $t$Only read the statuses that apply to their file.$t$,
 $t$That one is handled.$t$, false),

('am-150', 'AM150-006', 60, $t$Debt Status$t$, $t$Status — Initial Dispute Sent$t$,
 $t$This means that we received the collector's information that you sent us or found on the credit report, and we are currently demanding the collector prove they have the right to collect on your account. The majority of the time you will see this status change in the next 60 days.$t$,
 array['AC'],
 $t$Weight "demanding".$t$,
 $t$Somebody is on the offensive for me.$t$, false),

('am-150', 'AM150-007', 70, $t$Debt Status$t$, $t$Status — Wait for Initial Dispute Response$t$,
 $t$This means we sent out the dispute packet demanding the collector[s] prove they have the right to collect on your account. We are now waiting on their response so please keep an eye out for any letters you may receive from the collector[s].$t$,
 array['PT'],
 $t$Make "keep an eye out" land as a task.$t$,
 $t$I have something to do.$t$, false),

('am-150', 'AM150-008', 80, $t$Debt Status$t$, $t$Status — Wait for Sold Package Response$t$,
 $t$The account was fully disputed with a collector, but we received a new collection letter from a new collector. This letter informs the new collector of the previous dispute and requires proper information to validate the debt. We will continue the dispute process as usual from here.$t$,
 array['CALM'],
 $t$Say "as usual from here" like it is routine, because it is.$t$,
 $t$This is not a setback.$t$, false),

('am-150', 'AM150-009', 90, $t$Debt Status$t$, $t$Status — Wait for Response Type$t$,
 $t$Based on the collection letters/validation responses you've sent us, we are actively working on your [list creditors] account[s]. Please send us any other responses from them so we can make sure we respond ASAP.$t$,
 array['AC'],
 $t$"Actively working" is only credible if you sound busy on their behalf.$t$,
 $t$My file is not sitting in a pile.$t$, false),

('am-150', 'AM150-010', 100, $t$Debt Status$t$, $t$Status — Took Action in Smartcredit Only$t$,
 $t$It looks like your [list creditors] account[s] has been charged off. We requested some updated information from them, so please be sure to keep an eye out for any letters.$t$,
 array['PT'],
 $t$Say "charged off" flatly and move to the action.$t$,
 $t$That is a normal step.$t$, false),

('am-150', 'AM150-011', 110, $t$Debt Status$t$, $t$Status — Under Attorney Review$t$,
 $t$Resolve Law Group was able to put a suit together for consumer rights violations on the part of the creditor/collector. We do not remove these debts if the suit is successful; they are considered resolved on our part, as the client was in connection with RLG due to our referral.$t$,
 array['PT'],
 $t$Say "we do not remove these debts" clearly. Letting them assume otherwise creates a dispute later.$t$,
 $t$I understand what the suit does and does not do.$t$, true),

-- Section 3: Collection Letters/Calls

('am-150', 'AM150-012', 120, $t$Collection Letters and Calls$t$, $t$Any Letters Outstanding$t$,
 $t$Have you received any collection letters since we last spoke that you haven't sent yet? Please continue sending in your letters so we can be sure to get working on your accounts as soon as possible.$t$,
 array['PT'],
 $t$Wait for the client's response.$t$,
 $t$I should go dig those out.$t$, false),

('am-150', 'AM150-013', 130, $t$Collection Letters and Calls$t$, $t$Are They Still Calling$t$,
 $t$How are things going with the phone calls? Have you been receiving any since the last time we spoke?$t$,
 array['I CARE'],
 $t$Genuine concern. By month five the calls have usually stopped, so this may be a good news question.$t$,
 $t$They know what this is like.$t$, false),

('am-150', 'AM150-014', 140, $t$Collection Letters and Calls$t$, $t$Calls — Working With RLG$t$,
 $t$Have you been working with Resolve Law Group to stop them? Good to hear. How are things going with them so far? Great! I am glad to see you are engaged in the process!$t$,
 array['AC'],
 $t$If it is going well, say so warmly.$t$,
 $t$I am doing this right.$t$, false),

('am-150', 'AM150-015', 150, $t$Collection Letters and Calls$t$, $t$Calls — Not Going Well$t$,
 $t$What is the issue?$t$,
 array['I CARE'],
 $t$Ask and stop. See how you can help.$t$,
 $t$Someone will sort this out.$t$, false),

('am-150', 'AM150-016', 160, $t$Collection Letters and Calls$t$, $t$Calls — Not With RLG Yet$t$,
 $t$Well then I have some really good news. You may be a victim of predatory creditors, and could be awarded monetary damages. We're able to provide you a free consultation with Resolve. They're a nationwide law firm we've partnered with to help protect our client's legal rights. This often results in our clients like you getting paid when the creditors break the law. You can find their contact number in your Client Portal in the Resources tab. Please give them a call when you can as it could literally mean money in your pocket so don't miss this opportunity.$t$,
 array['AC'],
 $t$Lift on "really good news". Offer to provide the number to the client over the phone or via email: (818) 600-5386.$t$,
 $t$This could actually pay me.$t$, false),

('am-150', 'AM150-017', 170, $t$Collection Letters and Calls$t$, $t$Calls — None$t$,
 $t$That's great to hear! If you receive any more calls in the future, don't hesitate to let me know.$t$,
 array['AC'],
 $t$Short and genuinely pleased.$t$,
 $t$Good news is allowed.$t$, false),

('am-150', 'AM150-018', 180, $t$Collection Letters and Calls$t$, $t$Check In$t$,
 $t$Do you have any questions for me before we move on to your budget?$t$,
 array['I CARE'],
 $t$Answer any questions the client may have before moving on.$t$,
 $t$I can stop them and ask.$t$, false),

-- Section 4: Budget  (Day 150 — goals and the savings timeline)

('am-150', 'AM150-019', 190, $t$Budget$t$, $t$Open the Budget$t$,
 $t$Now, let's take a look at your budgeting, ok?$t$,
 array['CALM'],
 $t$Short signpost. Review the Budget Tab and Goals.$t$,
 $t$This is a normal part of the call.$t$, false),

('am-150', 'AM150-020', 200, $t$Budget$t$, $t$Anything Changed$t$,
 $t$Has anything changed over the last month?$t$,
 array['I CARE'],
 $t$Update the budget if needed before going further. The numbers you use next have to be current.$t$,
 $t$They are working from real figures.$t$, false),

('am-150', 'AM150-021', 210, $t$Budget$t$, $t$Positive Cash Flow$t$,
 $t$You have a positive cash flow each month of [Net Income]. This is great! This means we have [Net Income] each month to work with to help you accomplish your goals.$t$,
 array['AC'],
 $t$Say the figure clearly and let "this is great" be genuine. Five months ago this client had nothing spare.$t$,
 $t$I am actually ahead now.$t$, false),

('am-150', 'AM150-022', 220, $t$Budget$t$, $t$Name the Goals$t$,
 $t$Looking at the short term, what goals would you like to accomplish in the next 3-6 months? For example, a goal could be to build up an emergency reserve savings or to payoff some other smaller debts. Those are some really good goals to focus on in the short term. Now, how much money do you feel you will need to save up to accomplish your goal[s]?$t$,
 array['I CARE','AC'],
 $t$Ask, then stop and let them answer. Discuss and notate the short term goals. The goal has to be theirs or the maths that follows means nothing.$t$,
 $t$These are my goals, not a template.$t$, false),

('am-150', 'AM150-023', 230, $t$Budget$t$, $t$Work Out the Timeline$t$,
 $t$Great, so if you need to save [total amount needed to save] then based on your positive cash flow of [Net Income], I can see that it will take you about [# of months] to accomplish that goal. Therefore, if you start saving this month, then you should accomplish that goal by [Date]. Sound about right?$t$,
 array['AC','RM'],
 $t$Do the arithmetic out loud and slowly. A client hearing their own goal turned into a date is the most motivating moment in the entire program — do not rush past it.$t$,
 $t$There is a date when I get there.$t$, false),

('am-150', 'AM150-024', 240, $t$Budget$t$, $t$Short Before Long$t$,
 $t$So, at this time you can focus on your short-terms goals before we move onto longer term goals. Make sense?$t$,
 array['RM'],
 $t$Keeps the horizon manageable. Long term comes later, and saying so stops them overreaching now.$t$,
 $t$One thing at a time.$t$, false),

('am-150', 'AM150-025', 250, $t$Budget$t$, $t$Negative Net Income$t$,
 $t$Ok, one of our goals is to get you to financial independence. Part of this will be by building up an emergency savings account in case anything comes up. We want you to be able to afford to pay for emergencies with your own money and not credit. How much do you reasonably feel you can set aside per month? Ok great, let's work on that for next month.$t$,
 array['CALM','RM'],
 $t$Five months in with nothing spare is discouraging for them. No disappointment in your voice, and let them name the number.$t$,
 $t$I set that target, not them.$t$, false),

-- Section 5: Monthly Call Closing and Next Appointment

('am-150', 'AM150-026', 260, $t$Closing and Next Appointment$t$, $t$Schedule the Next Call$t$,
 $t$Let's get you scheduled for your next appointment. For our next call… Let me look at my schedule. How does [weekday & date] at [time, their time zone] work for you?$t$,
 array['CALM','RM'],
 $t$Refer to best time to contact before proposing one.$t$,
 $t$That fits my month.$t$, false),

('am-150', 'AM150-027', 270, $t$Closing and Next Appointment$t$, $t$Homework$t$,
 $t$Before our next call I would like for you to have [budget item] ready. Also, should you receive Collection Notices very soon, so please don't wait to send those to us. Send them as soon as you receive them, ok?$t$,
 array['PT'],
 $t$SLOW DOWN.$t$,
 $t$I know my two jobs.$t$, false),

('am-150', 'AM150-028', 280, $t$Closing and Next Appointment$t$, $t$Close$t$,
 $t$Thanks for taking the time today and I look forward to our next call. Have a great rest of your day!$t$,
 array['CALM'],
 $t$If they have questions, answer them before moving on.$t$,
 $t$That was a good call.$t$, false)

) as v(module_slug, code, sort_order, section, title, script_text, tones, coaching, feel, verbatim)
where m.slug = v.module_slug and s.slug = 'bolton-am'
on conflict (module_id, segment_code) do update set
  script_text = excluded.script_text, tones = excluded.tones,
  coaching = excluded.coaching, client_should_feel = excluded.client_should_feel,
  verbatim = excluded.verbatim, section = excluded.section,
  title = excluded.title, sort_order = excluded.sort_order;
