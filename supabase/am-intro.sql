-- ============================================================
-- Bolton Intro Call. Run AFTER am-schema.sql. Safe to re-run.
--
-- verbatim = true marks the yellow and green compliance dialogue
-- from Bolton's playbook. Those lines cannot be paraphrased.
-- ============================================================

insert into public.segments
  (module_id, segment_code, sort_order, title, script_text, tones,
   coaching, client_should_feel, verbatim, status)
select m.id, v.code, v.sort_order, v.title, v.script_text, v.tones,
       v.coaching, v.feel, v.verbatim, 'published'
from public.modules m
join public.scripts s on s.id = m.script_id
cross join (values

('am-intro', 'AMINT-001', 10, $t$Welcome$t$,
 $t$Hello [client name], my name is [your name]. Welcome to Bolton Service Group! Congratulations on taking the first step towards financial wellness.$t$,
 array['AC'],
 $t$Bright and genuinely congratulatory. They just made a decision that scared them and then got handed to a stranger — this is the first sixty seconds of that handoff.$t$,
 $t$I am in good hands now.$t$, true),

('am-intro', 'AMINT-002', 20, $t$Send the Text$t$,
 $t$It is important that we stay in contact throughout the program so I am going to send you a text with our phone number.$t$,
 array['PT'],
 $t$Pause here and actually send the Intro Call Text Template before continuing.$t$,
 $t$They are easy to reach.$t$, true),

('am-intro', 'AMINT-003', 30, $t$Save the Number$t$,
 $t$Great! You should see that text now. Please save that number as Bolton Service Group.$t$,
 array['CALM'],
 $t$Wait for them to confirm they got it. Do not move on while they are still looking at their phone.$t$,
 $t$I know who is calling me from now on.$t$, true),

('am-intro', 'AMINT-004', 40, $t$How Appointments Work$t$,
 $t$We will call you for all appointments. BUT, you can use that number to call us for any questions you may have along the way. We will schedule that appointment at the end of this call, OK?$t$,
 array['CALM','RM'],
 $t$Land the BUT — it is the difference between feeling managed and feeling supported.$t$,
 $t$I can reach out whenever I need to.$t$, true),

('am-intro', 'AMINT-005', 50, $t$Review the Goals$t$,
 $t$Let's take a moment to review our goals, OK?$t$,
 array['CALM'],
 $t$Short signpost. It tells them the next few minutes have a shape.$t$,
 $t$There is a plan.$t$, false),

('am-intro', 'AMINT-006', 60, $t$Phase One — Financial Education$t$,
 $t$The first phase is financial education. We want to start laying the groundwork for the first six months, working on your budget and savings.$t$,
 array['AC'],
 $t$Steady and matter of fact. This is the phase they will actually feel first.$t$,
 $t$Something starts right away.$t$, false),

('am-intro', 'AMINT-007', 70, $t$Phase Two — Consumer Rights$t$,
 $t$The second phase is consumer rights education. We dispute your accounts using federal and state laws until it's resolved, no matter how much work it takes on our part. In order to dispute your accounts, the monthly payments must be voluntarily withheld from the creditors.$t$,
 array['AC','PT'],
 $t$Do not speed up on the last sentence. Withholding payments is the part clients later say they did not understand, and rushing it is what creates that.$t$,
 $t$I understand what I agreed to.$t$, false),

('am-intro', 'AMINT-008', 80, $t$The Two Confirmations$t$,
 $t$Do you understand you are making the voluntary decision to stop paying all the creditors that you enrolled into our program, right? ... You also understand your accounts will need to reach collections so we can dispute on your behalf?$t$,
 array['PT'],
 $t$Two separate questions. Ask the first, get a yes, then ask the second. Running them together is how you end up with a recording that does not hold up.$t$,
 $t$Nobody is hiding anything from me.$t$, true),

('am-intro', 'AMINT-009', 90, $t$If They Break the Rules$t$,
 $t$Great! If the creditors do not play by the rules you will be referred to a national law firm that can put a stop to creditor harassment, or they will try to sue the creditor and get you an award.$t$,
 array['AC'],
 $t$This is good news after two heavy confirmations. Let the energy come back up.$t$,
 $t$Somebody is on my side.$t$, false),

('am-intro', 'AMINT-010', 100, $t$Phase Three — Credit Education$t$,
 $t$The final phase of the program is credit education. We'll put together a plan to get your credit score over 700 so you can leverage a healthy credit profile for important purchases like a home or a car at the best rates.$t$,
 array['AC'],
 $t$The house and the car are the point. Say those slowly enough that they picture them.$t$,
 $t$There is a version of this where I am fine.$t$, false),

('am-intro', 'AMINT-011', 110, $t$Send Us Your Letters$t$,
 $t$As you receive letters for your enrolled accounts, please send those to us as quickly as possible. You can upload anything you receive using the Client Portal. We will go over the portal on our next call, ok?$t$,
 array['PT'],
 $t$Plain and clear. This single instruction drives more of the program's success than anything else on this call.$t$,
 $t$I know what my job is.$t$, false),

('am-intro', 'AMINT-012', 120, $t$Notifications$t$,
 $t$Now, you'll receive important notifications monthly. We'll send you an appointment reminder for our calls via text and email. After our calls, you'll receive an email recap for your records. You'll also receive monthly payment reminders via text 72 hours prior to drafting. A benchmark to my success is keeping you on track, but if life happens and you need to change your draft date, please let me know AT LEAST 3 business days in advance, ok?$t$,
 array['CALM'],
 $t$Long list — vary your pace or it turns into noise. Weight the 3 business days.$t$,
 $t$I will not be surprised by anything.$t$, false),

('am-intro', 'AMINT-013', 130, $t$Loan and Payment Confirmation$t$,
 $t$Great, and to confirm, you understand you applied for a loan but you chose to enroll in this program to resolve your debt instead. Additionally, we do not pay off your debts with the money you pay to us. The money you pay to us is for our services of your Financial Wellness Plan.$t$,
 array['PT'],
 $t$Full clarity, normal volume, no hedging. Mumbling this is exactly what creates a dispute six months from now.$t$,
 $t$I know what my money is buying.$t$, true),

('am-intro', 'AMINT-014', 140, $t$Accounts and Total$t$,
 $t$Now, let's take a moment to review your accounts. I see you have [number in D&C list] accounts enrolled for a total of $[CC Debt total], correct?$t$,
 array['PT'],
 $t$Read from the Debts/Creditors tab. Say the numbers cleanly and wait for the confirmation.$t$,
 $t$They have my file in front of them.$t$, true),

('am-intro', 'AMINT-015', 150, $t$Payment Amount and Dates$t$,
 $t$Your scheduled monthly payment is $[monthly payment amount] and your first payment is [date of first payment]. Your reoccurring payment is on the [# day] of each month thereafter, correct?$t$,
 array['PT'],
 $t$From the Bolton tab. Three facts, one confirmation. Do not rush past the first payment date.$t$,
 $t$I know exactly what comes out and when.$t$, true),

('am-intro', 'AMINT-016', 160, $t$Bank Confirmation$t$,
 $t$Ok, I see you are using [Bank Name] for your monthly payments, is that correct?$t$,
 array['PT'],
 $t$From the Bank tab. Short, then stop.$t$,
 $t$That is right.$t$, true),

('am-intro', 'AMINT-017', 170, $t$Draft Authorization$t$,
 $t$When you see Bolton Service Group on your bank statement, it is the scheduled monthly payment per your agreement. Do you agree to allow Bolton Service Group to draft your monthly payments?$t$,
 array['PT'],
 $t$A clear YES is required before you go any further, and this portion of the recording gets snipped. Ask it cleanly, then be completely silent until they answer.$t$,
 $t$I authorised this deliberately.$t$, true),

('am-intro', 'AMINT-018', 180, $t$Chirp$t$,
 $t$The last thing I want to cover with you is Chirp. It's a program that helps protect you from NSF and overdraft fees if you don't have enough money in your account when your payment date comes around. I will email you the link after the call, it only takes a minute to link your account and is encrypted for your protection.$t$,
 array['CALM'],
 $t$Light and helpful. This is a courtesy, so treat it as one.$t$,
 $t$They thought about the thing I was worried about.$t$, false),

('am-intro', 'AMINT-019', 190, $t$Schedule the First Check-In$t$,
 $t$Do you have any questions on anything we covered? ... Ok, let's schedule our first check in, which will be a few days from now. Our hours are Monday through Friday, 8am-5pm PST. Great, how does [weekday & date] at [time, their time zone] AM/PM work for you?$t$,
 array['CALM','RM'],
 $t$Count today as day one, or their preferred day if they gave you one. Pause for a real answer before proposing a time.$t$,
 $t$This is easy to fit in.$t$, true),

('am-intro', 'AMINT-020', 200, $t$We Call You$t$,
 $t$Thank you. To confirm, we will call YOU for ALL your appointments including the one we just scheduled. You will also receive a reminder before our next call. As always, if you need to reschedule our call please let us know, ok?$t$,
 array['CALM'],
 $t$Weight YOU and ALL. This is what stops the anxious call on day three.$t$,
 $t$I do not have to remember anything.$t$, true),

('am-intro', 'AMINT-021', 210, $t$United Alliance Law$t$,
 $t$You will receive a call from United Alliance Law, it will be from (888) 819-6434. There will be no charge for this call. You will speak to a staff member of United Alliance, who works under the supervision of an attorney at the firm. The staff member will share any relevant information with the attorney who can provide further guidance or feedback as necessary. United Alliance can answer your questions about your rights as a consumer under federal laws, as well as general questions about state law protections. Do you agree to be contacted by United Alliance Law consistent with the previously described conditions?$t$,
 array['PT'],
 $t$Read it properly — this is a disclosure and a consent, not a paragraph to get through. Slow on the phone number. Then wait for the yes.$t$,
 $t$I know who is calling and why.$t$, true),

('am-intro', 'AMINT-022', 220, $t$Benefits Email$t$,
 $t$Also, you'll receive an email about your Bolton Service Group benefits that are included in your program. They are tremendously valuable so if you do not receive the call or emails, please let me know.$t$,
 array['AC'],
 $t$Sound like the benefits are worth opening the email for, because they are.$t$,
 $t$There is more here than I expected.$t$, false),

('am-intro', 'AMINT-023', 230, $t$Did You Get the Text$t$,
 $t$Lastly, did you receive the text message with our phone number? ... Yes: Great! ... No: I will resend and give it to you verbally, let me know when you are ready. (877) 882-4306$t$,
 array['CALM'],
 $t$If no, slow right down on the digits and repeat them. Getting this wrong costs you the next appointment.$t$,
 $t$I can reach them.$t$, false),

('am-intro', 'AMINT-024', 240, $t$Hand Back$t$,
 $t$Again, congratulations on the first step towards your Financial Wellness Plan. I will reconnect you with your Enrollment Specialist now.$t$,
 array['AC'],
 $t$End warm and confident. They should hang up feeling like they met a person, not completed a process.$t$,
 $t$That went well.$t$, true)

) as v(module_slug, code, sort_order, title, script_text, tones, coaching, feel, verbatim)
where m.slug = v.module_slug and s.slug = 'bolton-am'
on conflict (module_id, segment_code) do update set
  script_text = excluded.script_text, tones = excluded.tones,
  coaching = excluded.coaching, client_should_feel = excluded.client_should_feel,
  verbatim = excluded.verbatim,
  title = excluded.title, sort_order = excluded.sort_order;
