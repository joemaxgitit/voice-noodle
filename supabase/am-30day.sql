-- ============================================================
-- Bolton 30-Day Call. Run AFTER am-schema.sql and sections.sql.
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

('am-30', 'AM30-001', 10, $t$Introduction$t$, $t$Pull Up the File$t$,
 $t$Hello, this is [your name] with Bolton Services Group. Could you please give me a minute so I can pull up your file?$t$,
 array['CALM'],
 $t$Same opening as the 15-day. Familiar is the point — they should recognise the shape of your calls.$t$,
 $t$This is my person.$t$, false),

('am-30', 'AM30-002', 20, $t$Introduction$t$, $t$Confirm Who You Have$t$,
 $t$Do I have [client name] on the line?$t$,
 array['PT'],
 $t$Once the file is up. Short, then wait.$t$,
 $t$They know who I am.$t$, false),

('am-30', 'AM30-003', 30, $t$Introduction$t$, $t$Set the Agenda$t$,
 $t$Great! The goal of our call today is to review our overall goals and start developing a game plan to improve your finances, resolve your debt, and improve your credit. Sound good? ... Before we get started, do you have any questions for me?$t$,
 array['AC','I CARE'],
 $t$Agenda, then pause for a real answer before you start.$t$,
 $t$There is a plan, and room for me in it.$t$, false),

-- ---------- Section 2: Collection Calls and Letters ----------

('am-30', 'AM30-004', 40, $t$Collection Calls and Letters$t$, $t$Are They Calling Yet$t$,
 $t$Most creditors call a lot in the first 2 months after a person is late. After that, the calls slow down and usually stop altogether after 5 or 6 months. Are you getting calls from your creditors yet? Have you spoken with Resolve Law Group yet about how to handle collection calls?$t$,
 array['CALM'],
 $t$Normalise it first, then ask. A client being called feels singled out, and the timeline tells them they are not.$t$,
 $t$This is expected, not a disaster.$t$, false),

('am-30', 'AM30-005', 50, $t$Collection Calls and Letters$t$, $t$If Yes — Going Well$t$,
 $t$Good to hear. How are things going with them so far? ... Great! I am glad to see you are engaged in the process!$t$,
 array['AC'],
 $t$Genuine encouragement. An engaged client is the single best predictor of a client who finishes.$t$,
 $t$I am doing this right.$t$, false),

('am-30', 'AM30-006', 60, $t$Collection Calls and Letters$t$, $t$If Yes — Not Going Well$t$,
 $t$What is the issue?$t$,
 array['I CARE'],
 $t$Ask, then stop completely and listen. Your job here is to find out what you can actually fix.$t$,
 $t$Somebody wants to sort this out.$t$, false),

('am-30', 'AM30-007', 70, $t$Collection Calls and Letters$t$, $t$If No — Resolve Law Group$t$,
 $t$Well then... I have some really good news. You may be a victim of predatory creditors and could be awarded monetary damages. We're able to provide you a free consultation with Resolve. They're a nationwide law firm we've partnered with to help protect our client's legal rights. This often results in our clients like you getting paid when the creditors break the law. You can find their contact number in your Client Portal in the Resources tab, or I can give it to you now — (818) 600-5386. Please give them a call when you can as it could literally mean money in your pocket so don't miss this opportunity.$t$,
 array['AC'],
 $t$Lift on "really good news" — this is the best thing you will tell them today. Slow right down on the phone number and repeat it.$t$,
 $t$This could actually pay me.$t$, false),

('am-30', 'AM30-008', 80, $t$Collection Calls and Letters$t$, $t$This Will Take Time$t$,
 $t$Next, I want to make sure you know that your Financial Wellness Plan is going to take time. Generally, it takes about 2 years to recover from issues regarding debt. One of our goals is to raise your credit score, but I need to make sure you understand your credit score will likely drop in the beginning. That's ok, because we're going to be working on your finances first. Our main goal is to help you gain financial freedom by starting a budget, going over ways to save money, and working with you on financial education. The key indicator of success for me is you making program payments since they'll save you money in the long run. If there's a problem with your payments, it tells us that we still have work to do. So, keeping you on track is a priority for me, and I hope it is for you too.$t$,
 array['CALM','PT'],
 $t$Say the credit drop plainly. Second time they have heard it, and it still needs to land without hedging.$t$,
 $t$Nobody is overselling this to me.$t$, true),

('am-30', 'AM30-009', 90, $t$Collection Calls and Letters$t$, $t$The FDCPA, Again$t$,
 $t$As a reminder, the collection letters are the key to resolving your debts. As soon as we receive a collection letter from you, that is when the dispute process begins. The Fair Debt Collection Practices Act, known as the FDCPA, is a law specifically designed by Congress to protect all consumers against 3rd party debt collectors that were not following the rules. Based on the FDCPA, we have the right to request proof that they have all the documentation on file about your debt BEFORE they collect any money. We know that they rarely do and that is why we have such a high success rate. Your client portal has detailed information about these laws, as well as other articles to help you navigate the process and earning your financial freedom, and I will be working with you closely to give you that information as well. So, not only will this program help to resolve your debts, but you will be receiving an education along the way. How does that sound?$t$,
 array['AC'],
 $t$Shorter than the 15-day version because they have heard it. Weight BEFORE. Do not read it like a repeat — they may not have absorbed it the first time.$t$,
 $t$There is real law behind this.$t$, false),

('am-30', 'AM30-010', 100, $t$Collection Calls and Letters$t$, $t$The 30-Day Notice$t$,
 $t$The most important letters you'll be sending us will be from third-party collection agencies. The FDCPA law that we discussed defines what your rights are with them, which includes your ability to dispute the validity of the debt once your account goes to collection. On those letters you'll notice this phrase: "Unless you notify us within 30 days of receiving this notice that you dispute the validity of this debt, we will assume this debt is valid." One of the keys to resolving your debts is that we take action within this 30 day period. So please send those letters to me as soon as you receive them. You can upload them to the client portal or email them as an attachment to info@BoltonServiceGroup.com, though most of our clients find it easiest to take a picture with their smart phone and text them to me. Once I receive them, I will send you a message confirming we received it. Do you have any questions about getting documents to us?$t$,
 array['PT','AC'],
 $t$Statutory language — read the quoted phrase exactly and slow through it. Then lift into the urgency.$t$,
 $t$There is a clock, and I know what to do.$t$, true),

-- ---------- Section 3: Budget and Goals ----------

('am-30', 'AM30-011', 110, $t$Budget and Goals$t$, $t$Do They Have the Portal$t$,
 $t$Next, we'll review your budget. Do you have access to your Client Portal?$t$,
 array['CALM'],
 $t$Ask before you assume. The whole next stretch depends on the answer.$t$,
 $t$Straightforward question.$t$, false),

('am-30', 'AM30-012', 120, $t$Budget and Goals$t$, $t$If Yes — Walk It Together$t$,
 $t$Perfect, let's go through your budget together so we can get an idea what your monthly finances look like, ok? Please go to your portal and on the left hand side click on the budget tab.$t$,
 array['CALM'],
 $t$One instruction, then wait for them to actually be there before continuing.$t$,
 $t$We are doing this together.$t$, false),

('am-30', 'AM30-013', 130, $t$Budget and Goals$t$, $t$If No — Do It Anyway$t$,
 $t$No worries. Let's go through your budget together so we can get an idea what your monthly finances look like, ok? You can access and update your budget at any time in your portal. All you need to do is log in, click on the Budget tab on the left-hand side, then be sure to press save if you make any changes.$t$,
 array['CALM','RM'],
 $t$No judgment about the portal. The budget conversation matters more than where it happens.$t$,
 $t$Not being told off for not logging in.$t$, false),

('am-30', 'AM30-014', 140, $t$Budget and Goals$t$, $t$If Negative Net Income$t$,
 $t$Ok, now that we've reviewed your finances, we want to keep an eye on your budget to see what changes we can make to put funds aside and work towards financial restoration. Sound good?$t$,
 array['CALM'],
 $t$Do not react to the number. Steady and forward-looking — they already know it is bad.$t$,
 $t$They did not flinch at my numbers.$t$, false),

('am-30', 'AM30-015', 150, $t$Budget and Goals$t$, $t$If Positive Net Income$t$,
 $t$Ok, so your budget shows a surplus of $[Net Income]. Our first goal now is to establish a savings account and start to put aside those funds. Do you currently have a savings account?$t$,
 array['AC'],
 $t$Say the surplus figure clearly — many clients have never had it named out loud.$t$,
 $t$There is money left over.$t$, false),

('am-30', 'AM30-016', 160, $t$Budget and Goals$t$, $t$Savings — If Yes$t$,
 $t$Great! You should have [surplus amount] left over at the end of the month. Why don't we start by saving [reasonable savings goal] every month?$t$,
 array['RM'],
 $t$Pick a number they will actually hit. A goal they miss in month one costs you more than a small one they keep.$t$,
 $t$That is doable.$t$, false),

('am-30', 'AM30-017', 170, $t$Budget and Goals$t$, $t$Savings — If No$t$,
 $t$No worries. It's extremely important to build an emergency savings fund. The extra money can help cover unexpected expenses without leaving you strapped for cash and unable to pay your bills at the end of the month. First thing's first: open a savings account. You should have [surplus amount] left over at the end of the month. Why don't we start by saving [reasonable savings goal] every month?$t$,
 array['CALM','RM'],
 $t$"First thing's first" is the action item. Everything before it is the reason.$t$,
 $t$I know my first step.$t$, false),

('am-30', 'AM30-018', 180, $t$Budget and Goals$t$, $t$Credit Builder Benefit$t$,
 $t$To help you get started, we are partnered with Slate Financial, and through this partnership you are receiving the Credit Builder Benefit. This is where your program payment is reported to all 3 credit bureaus giving the credit reporting benefits of an installment loan without the high interest cost nor inquiries! Remember this is not a traditional loan. Please note that this will show as Consolidation Capital LLC on your credit report and will appear as a secured loan. You should start seeing this report within the next couple of months. Do you have any questions before we move on?$t$,
 array['AC','PT'],
 $t$Two things must be unmissable: this is not a traditional loan, and it appears as Consolidation Capital LLC. A client who sees an unexplained name on their credit report calls in a panic.$t$,
 $t$I know what that entry is when I see it.$t$, true),

-- ---------- Section 4: Closing and Monthly Cadence ----------

('am-30', 'AM30-019', 190, $t$Closing and Monthly Cadence$t$, $t$Moving to Monthly$t$,
 $t$We will now move to monthly update calls. We'll speak via appointment once a month, but if you need anything, please feel free to call, text or email. During these monthly appointments, I'll give you an update on anything that's transpired, as well as attempt to prepare you for what to expect based on the current status of each account. I will be working quite a bit between our calls, which you will be able to see in the client portal. I'd like to take the next 60 to 90 days to work on these debts and also become more familiar with your situation.$t$,
 array['CALM'],
 $t$Calls getting less frequent can read as being dropped. "I will be working quite a bit between our calls" is the line that prevents that, so mean it.$t$,
 $t$Less contact does not mean less work.$t$, false),

('am-30', 'AM30-020', 200, $t$Closing and Monthly Cadence$t$, $t$Schedule and Close$t$,
 $t$Let's go ahead and schedule our next call. For our next call, how does [weekday & date] at [time, their time zone] work for you?$t$,
 array['RM'],
 $t$Refer to their best time to contact before you propose one.$t$,
 $t$That works for me.$t$, false)

) as v(module_slug, code, sort_order, section, title, script_text, tones, coaching, feel, verbatim)
where m.slug = v.module_slug and s.slug = 'bolton-am'
on conflict (module_id, segment_code) do update set
  script_text = excluded.script_text, tones = excluded.tones,
  coaching = excluded.coaching, client_should_feel = excluded.client_should_feel,
  verbatim = excluded.verbatim, section = excluded.section,
  title = excluded.title, sort_order = excluded.sort_order;
