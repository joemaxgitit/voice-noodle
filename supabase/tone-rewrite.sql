-- Rewrite of the sales script tone layer, taken from the marker
-- positions in the Options Script PDF. Several segments previously
-- carried tones the script does not mark at all; those are cleared.


update public.segments set
  tones = '{}',
  tone_map = $j$[{"tone": "", "text": "Hello, may I speak with (Client's Name)?"}]$j$::jsonb,
  script_text = $t$Hello, may I speak with (Client's Name)?$t$
where segment_code = 'OPEN-001';

update public.segments set
  tones = array['AC'],
  tone_map = $j$[{"tone": "AC", "text": "Hello (Client's Name), Happy (Day of the Week)! My name is ___, from Lionside Financial, calling about the application you submitted. Is now a good time to talk?"}]$j$::jsonb,
  script_text = $t$Hello (Client's Name), Happy (Day of the Week)! My name is ___, from Lionside Financial, calling about the application you submitted. Is now a good time to talk?$t$
where segment_code = 'OPEN-002';

update public.segments set
  tones = array['PT'],
  tone_map = $j$[{"tone": "PT", "text": "For training and quality assurance this call will be recorded, ok?"}]$j$::jsonb,
  script_text = $t$For training and quality assurance this call will be recorded, ok?$t$
where segment_code = 'OPEN-003';

update public.segments set
  tones = array['AC'],
  tone_map = $j$[{"tone": "AC", "text": "I see you have about $XXX in total unsecured debt and are paying $XXX per month, is that correct? What is it you're looking to accomplish? Is it to get a lower payment, lower interest, or perhaps both?"}]$j$::jsonb,
  script_text = $t$I see you have about $XXX in total unsecured debt and are paying $XXX per month, is that correct? What is it you're looking to accomplish? Is it to get a lower payment, lower interest, or perhaps both?$t$
where segment_code = 'DISC-001';

update public.segments set
  tones = array['AC','I CARE','RM'],
  tone_map = $j$[{"tone": "AC", "text": "We specialize in providing customized financial solutions for our clients."}, {"tone": "I CARE", "text": "Today we will go over your options together to resolve the debt and restore your credit."}, {"tone": "RM", "text": "Sound good?"}]$j$::jsonb,
  script_text = $t$We specialize in providing customized financial solutions for our clients. Today we will go over your options together to resolve the debt and restore your credit. Sound good?$t$
where segment_code = 'DISC-002';

update public.segments set
  tones = array['I CARE'],
  tone_map = $j$[{"tone": "I CARE", "text": "Is Bankruptcy something you're considering?"}]$j$::jsonb,
  script_text = $t$Is Bankruptcy something you're considering?$t$
where segment_code = 'DISC-003';

update public.segments set
  tones = array['AC'],
  tone_map = $j$[{"tone": "AC", "text": "That's good. It doesn't look like you are at the tipping point yet. Now, I see your score used to be higher, and you had less debt. If you don't mind, could you tell me... what happened?"}]$j$::jsonb,
  script_text = $t$That's good. It doesn't look like you are at the tipping point yet. Now, I see your score used to be higher, and you had less debt. If you don't mind, could you tell me... what happened?$t$
where segment_code = 'DISC-004';

update public.segments set
  tones = '{}',
  tone_map = $j$[{"tone": "", "text": "How long has this been going on? Are you at least able to keep up with basic expenses? What are you going to do if it doesn't get better?"}]$j$::jsonb,
  script_text = $t$How long has this been going on? Are you at least able to keep up with basic expenses? What are you going to do if it doesn't get better?$t$
where segment_code = 'DISC-005';

update public.segments set
  tones = array['I CARE'],
  tone_map = $j$[{"tone": "I CARE", "text": "Thank you for sharing that with me... unfortunately you're not alone."}]$j$::jsonb,
  script_text = $t$Thank you for sharing that with me... unfortunately you're not alone.$t$
where segment_code = 'VILL-001';

update public.segments set
  tones = array['Preacher'],
  tone_map = $j$[{"tone": "Preacher", "text": "Millions of Americans live paycheck to paycheck, and it only takes one thing to really put us behind. What many people don't realize is that these creditors prey on consumers. With the high interest rates and payments, they get us to a point where we can only afford minimum payments. Then we are one hardship away from falling behind. These same creditors are usually the last ones to help you once you start to struggle. Am I right?"}]$j$::jsonb,
  script_text = $t$Millions of Americans live paycheck to paycheck, and it only takes one thing to really put us behind. What many people don't realize is that these creditors prey on consumers. With the high interest rates and payments, they get us to a point where we can only afford minimum payments. Then we are one hardship away from falling behind. These same creditors are usually the last ones to help you once you start to struggle. Am I right?$t$
where segment_code = 'VILL-002';

update public.segments set
  tones = array['AC'],
  tone_map = $j$[{"tone": "AC", "text": "The first option is a Debt Consolidation Loan. It will wrap up all your unsecured debt into one loan and one new payment. We work with the largest lending network in the country and rates start in the single digits. If approvals are available, it would be through our network."}]$j$::jsonb,
  script_text = $t$The first option is a Debt Consolidation Loan. It will wrap up all your unsecured debt into one loan and one new payment. We work with the largest lending network in the country and rates start in the single digits. If approvals are available, it would be through our network.$t$
where segment_code = 'LOAN-001';

update public.segments set
  tones = '{}',
  tone_map = $j$[{"tone": "", "text": "I need to go over this application process with you via email. Are you in front of a computer or smart phone? Let me verify the email address we have on file."}]$j$::jsonb,
  script_text = $t$I need to go over this application process with you via email. Are you in front of a computer or smart phone? Let me verify the email address we have on file.$t$
where segment_code = 'LOAN-002';

update public.segments set
  tones = array['AC','RM'],
  tone_map = $j$[{"tone": "AC", "text": "So, let's take a look at the other options that will get you lower interest and payments."}, {"tone": "RM", "text": "Sound reasonable?"}]$j$::jsonb,
  script_text = $t$So, let's take a look at the other options that will get you lower interest and payments. Sound reasonable?$t$
where segment_code = 'LOAN-003';

update public.segments set
  tones = '{}',
  tone_map = $j$[{"tone": "", "text": "Perfect! I am going to touch on 3 options with you. I'm confident that one of these three options will be directly in line with your goals and what you're trying to accomplish."}]$j$::jsonb,
  script_text = $t$Perfect! I am going to touch on 3 options with you. I'm confident that one of these three options will be directly in line with your goals and what you're trying to accomplish.$t$
where segment_code = 'LOAN-004';

update public.segments set
  tones = array['PT','AC'],
  tone_map = $j$[{"tone": "PT", "text": "The next option available is Credit Counseling."}, {"tone": "AC", "text": "It's a program for consumers that can still afford their monthly payments but are getting nowhere because of high interest rates. With Credit Counseling, you still pay back the total amount you owe, but at lower rates. So, in your case, it looks like the payment would be about the same as what you're paying now, but you would be out of debt within 5 years instead of 22."}]$j$::jsonb,
  script_text = $t$The next option available is Credit Counseling. It's a program for consumers that can still afford their monthly payments but are getting nowhere because of high interest rates. With Credit Counseling, you still pay back the total amount you owe, but at lower rates. So, in your case, it looks like the payment would be about the same as what you're paying now, but you would be out of debt within 5 years instead of 22.$t$
where segment_code = 'OPT-001';

update public.segments set
  tones = array['AC'],
  tone_map = $j$[{"tone": "AC", "text": "The next one is Debt Settlement. This is where your debt is settled for less than the full balance. This will affect your credit, but your payment goes down to (2% of the debt), resolving the debt in about 4 years."}]$j$::jsonb,
  script_text = $t$The next one is Debt Settlement. This is where your debt is settled for less than the full balance. This will affect your credit, but your payment goes down to (2% of the debt), resolving the debt in about 4 years.$t$
where segment_code = 'OPT-002';

update public.segments set
  tones = array['S','AC'],
  tone_map = $j$[{"tone": "", "text": "The last option is Financial Wellness."}, {"tone": "S", "text": "This is a program for consumers who want to get out of debt quickly and fully restore their credit."}, {"tone": "AC", "text": "With Financial Wellness FIRST NAME you'll be able to resolve your debt in less than two years and heal your credit with a payment around $XXX a month."}]$j$::jsonb,
  script_text = $t$The last option is Financial Wellness. This is a program for consumers who want to get out of debt quickly and fully restore their credit. With Financial Wellness FIRST NAME you'll be able to resolve your debt in less than two years and heal your credit with a payment around $XXX a month.$t$
where segment_code = 'OPT-003';

update public.segments set
  tones = '{}',
  tone_map = $j$[{"tone": "", "text": "Now out of those 3 options, which one sounds best to you?"}]$j$::jsonb,
  script_text = $t$Now out of those 3 options, which one sounds best to you?$t$
where segment_code = 'OPT-004';

update public.segments set
  tones = array['AC'],
  tone_map = $j$[{"tone": "AC", "text": "Great! The company that offers this option is Bolton Services Group. The program consists of 2 phases."}]$j$::jsonb,
  script_text = $t$Great! The company that offers this option is Bolton Services Group. The program consists of 2 phases.$t$
where segment_code = 'BOLT-001';

update public.segments set
  tones = array['AC'],
  tone_map = $j$[{"tone": "AC", "text": "Phase 1 begins immediately upon your enrollment and continues until you graduate. They will work with you to restore your monthly savings with robust financial education. They will set up monthly credit monitoring to track your progress. And put you in touch with a law firm that will make sure to protect your consumer rights. Most of the work in this phase is to set the groundwork for resolving the debt and improving the credit in Phase 2. Does it make sense so far?"}]$j$::jsonb,
  script_text = $t$Phase 1 begins immediately upon your enrollment and continues until you graduate. They will work with you to restore your monthly savings with robust financial education. They will set up monthly credit monitoring to track your progress. And put you in touch with a law firm that will make sure to protect your consumer rights. Most of the work in this phase is to set the groundwork for resolving the debt and improving the credit in Phase 2. Does it make sense so far?$t$
where segment_code = 'BOLT-002';

update public.segments set
  tones = array['AC'],
  tone_map = $j$[{"tone": "AC", "text": "Phase 2 begins when the accounts go to collections. Now I want to be very clear here... your accounts DO NOT need to be in collections to enroll. In fact, most people like you enroll before the accounts are with a collection agency. Make sense?"}]$j$::jsonb,
  script_text = $t$Phase 2 begins when the accounts go to collections. Now I want to be very clear here... your accounts DO NOT need to be in collections to enroll. In fact, most people like you enroll before the accounts are with a collection agency. Make sense?$t$
where segment_code = 'BOLT-003';

update public.segments set
  tones = array['AC'],
  tone_map = $j$[{"tone": "AC", "text": "So the first step of this phase is to show the creditors that you are going through a hardship, in the only way they understand, by allowing the accounts to close and go past due. By withholding the monthly minimums, the account enrolled will fall behind and eventually go to collections."}]$j$::jsonb,
  script_text = $t$So the first step of this phase is to show the creditors that you are going through a hardship, in the only way they understand, by allowing the accounts to close and go past due. By withholding the monthly minimums, the account enrolled will fall behind and eventually go to collections.$t$
where segment_code = 'BOLT-004';

update public.segments set
  tones = array['AC','RM'],
  tone_map = $j$[{"tone": "AC", "text": "Now, once your accounts are in collections, we step in and dispute the debt collector's right to even collect on your accounts. By law, these debt collectors must provide proof of their legal right to collect on your debts. They must also prove and verify that they have followed the law with respect to your debt and how it is reporting on your credit, and this is where the problem lies."}, {"tone": "RM", "text": "You see what I am saying here?"}]$j$::jsonb,
  script_text = $t$Now, once your accounts are in collections, we step in and dispute the debt collector's right to even collect on your accounts. By law, these debt collectors must provide proof of their legal right to collect on your debts. They must also prove and verify that they have followed the law with respect to your debt and how it is reporting on your credit, and this is where the problem lies. You see what I am saying here?$t$
where segment_code = 'BOLT-005';

update public.segments set
  tones = array['AC','PT','RM'],
  tone_map = $j$[{"tone": "AC", "text": "Now when they are unable to provide legal proof that they have the right to collect on your account, then that account becomes what's called uncollectable,"}, {"tone": "PT", "text": "meaning the third-party debt collector can no longer attempt to collect that debt from you."}, {"tone": "AC", "text": "Bolton Services Group does not pay off your accounts, rather they assert your legal right to dispute the debt."}, {"tone": "RM", "text": "Are you with me?"}]$j$::jsonb,
  script_text = $t$Now when they are unable to provide legal proof that they have the right to collect on your account, then that account becomes what's called uncollectable, meaning the third-party debt collector can no longer attempt to collect that debt from you. Bolton Services Group does not pay off your accounts, rather they assert your legal right to dispute the debt. Are you with me?$t$
where segment_code = 'BOLT-006';

update public.segments set
  tones = array['AC'],
  tone_map = $j$[{"tone": "AC", "text": "Let's take a moment to recap the process. The primary goal is to resolve the debt. We do this through disputing the accounts with debt collectors once the accounts charge off with the original creditors because it is the fastest and least expensive way to resolve the debt. Now, FIRST NAME, what do you think would happen if the debt was rendered uncollectable and could no longer impact your credit score?"}]$j$::jsonb,
  script_text = $t$Let's take a moment to recap the process. The primary goal is to resolve the debt. We do this through disputing the accounts with debt collectors once the accounts charge off with the original creditors because it is the fastest and least expensive way to resolve the debt. Now, FIRST NAME, what do you think would happen if the debt was rendered uncollectable and could no longer impact your credit score?$t$
where segment_code = 'BOLT-007';

update public.segments set
  tones = '{}',
  tone_map = $j$[{"tone": "", "text": "The second goal is to monitor and analyze your credit to strategize and help improve your score. And the final goal would be to provide education about your rights as a consumer and complete financial wellness. Make sense?"}]$j$::jsonb,
  script_text = $t$The second goal is to monitor and analyze your credit to strategize and help improve your score. And the final goal would be to provide education about your rights as a consumer and complete financial wellness. Make sense?$t$
where segment_code = 'BOLT-008';

update public.segments set
  tones = '{}',
  tone_map = $j$[{"tone": "", "text": "Let's take your (creditor) account for example. Soon after this account reaches late or nonpayment status, (creditor) is going to sell your account to a collections company. In doing so (creditor) gets a tax break by writing off your debt as uncollectable and charges it off while at the same time selling it to a collections company. (Creditor) takes their money, are now out of the picture and have sold your account for pennies on the dollar to the debt collector. This debt collector is now seeking to collect the full amount from you! Pretty good business deal for them especially when you consider the only thing, they really bought was paper!"}]$j$::jsonb,
  script_text = $t$Let's take your (creditor) account for example. Soon after this account reaches late or nonpayment status, (creditor) is going to sell your account to a collections company. In doing so (creditor) gets a tax break by writing off your debt as uncollectable and charges it off while at the same time selling it to a collections company. (Creditor) takes their money, are now out of the picture and have sold your account for pennies on the dollar to the debt collector. This debt collector is now seeking to collect the full amount from you! Pretty good business deal for them especially when you consider the only thing, they really bought was paper!$t$
where segment_code = 'BOLT-009';

update public.segments set
  tones = array['PT','AC'],
  tone_map = $j$[{"tone": "PT", "text": "Now, the entire process is very simple."}, {"tone": "AC", "text": "The first step is for you and I to review your credit report together to ensure it's accurate. We'll be going over each of your accounts and its balance so if you could, please grab a pen and paper and let me know when you're ready."}]$j$::jsonb,
  script_text = $t$Now, the entire process is very simple. The first step is for you and I to review your credit report together to ensure it's accurate. We'll be going over each of your accounts and its balance so if you could, please grab a pen and paper and let me know when you're ready.$t$
where segment_code = 'REV-001';

update public.segments set
  tones = array['AC'],
  tone_map = $j$[{"tone": "AC", "text": "So, the great news is, based on this information, it looks like your new monthly payment with us would only be $XXX for XX Months. How does that sound?"}]$j$::jsonb,
  script_text = $t$So, the great news is, based on this information, it looks like your new monthly payment with us would only be $XXX for XX Months. How does that sound?$t$
where segment_code = 'REV-002';

update public.segments set
  tones = array['CALM'],
  tone_map = $j$[{"tone": "CALM", "text": "The fact of the matter is there are a lot of companies that claim to get people out of debt. I want to share what makes Bolton Services Group a really special company. First is that they are a value-based organization. What this means is that they put people before profits. Their values include Support and Accountability. These are cornerstones to their commitment to make their community financial experts through empowering education, practical benefits, and consumer protection. And that's so you're never in this situation again. That's important to you, right?"}]$j$::jsonb,
  script_text = $t$The fact of the matter is there are a lot of companies that claim to get people out of debt. I want to share what makes Bolton Services Group a really special company. First is that they are a value-based organization. What this means is that they put people before profits. Their values include Support and Accountability. These are cornerstones to their commitment to make their community financial experts through empowering education, practical benefits, and consumer protection. And that's so you're never in this situation again. That's important to you, right?$t$
where segment_code = 'WHY-001';

update public.segments set
  tones = array['AC'],
  tone_map = $j$[{"tone": "AC", "text": "In addition to getting out of debt you receive education from a certified financial coach, over 10,000 discounts on just about anything you can imagine, your program payment actually reports as a tradeline to stabilize your credit score, customized client portal to track every step of the journey from the palm of your hand, attorney on retainer for any legal questions or issues, and a vast amount of passive education about money, credit and dealing with financial hardship."}]$j$::jsonb,
  script_text = $t$In addition to getting out of debt you receive education from a certified financial coach, over 10,000 discounts on just about anything you can imagine, your program payment actually reports as a tradeline to stabilize your credit score, customized client portal to track every step of the journey from the palm of your hand, attorney on retainer for any legal questions or issues, and a vast amount of passive education about money, credit and dealing with financial hardship.$t$
where segment_code = 'WHY-002';

update public.segments set
  tones = array['AC'],
  tone_map = $j$[{"tone": "AC", "text": "I almost forgot, you also get free access to a cutting edge career development and resource platform. This gives you access to a career coach, skills training, certification, and of course a job platform that recommends jobs in your area that you are qualified for, from all of the job platforms in the US. This is all included at no additional cost, and it's through Slate... you've heard of them right?"}]$j$::jsonb,
  script_text = $t$I almost forgot, you also get free access to a cutting edge career development and resource platform. This gives you access to a career coach, skills training, certification, and of course a job platform that recommends jobs in your area that you are qualified for, from all of the job platforms in the US. This is all included at no additional cost, and it's through Slate... you've heard of them right?$t$
where segment_code = 'WHY-003';

update public.segments set
  tones = array['AC'],
  tone_map = $j$[{"tone": "AC", "text": "The only thing we ask of you is to be engaged with your certified financial coach. They will do all the heavy lifting for you and in ## months, your debt is resolved, you have good credit, cash savings, and a bright financial future. Pretty good tradeoff, right?"}]$j$::jsonb,
  script_text = $t$The only thing we ask of you is to be engaged with your certified financial coach. They will do all the heavy lifting for you and in ## months, your debt is resolved, you have good credit, cash savings, and a bright financial future. Pretty good tradeoff, right?$t$
where segment_code = 'WHY-004';

update public.segments set
  tones = array['AC'],
  tone_map = $j$[{"tone": "AC", "text": "So in summary, your Bolton Financial Wellness includes everything that covers you legally and financially. First and foremost, your new payment of $XXX per month saves you a ton of money, not even factoring in all the interest you're saving. No other company is willing to invest the time and money into your success. I hear about success stories all the time that blow my mind. Bolton actually cares about being good humans first. Now you can finally say you've found a solution that you can trust. And that's what really matters, right?"}]$j$::jsonb,
  script_text = $t$So in summary, your Bolton Financial Wellness includes everything that covers you legally and financially. First and foremost, your new payment of $XXX per month saves you a ton of money, not even factoring in all the interest you're saving. No other company is willing to invest the time and money into your success. I hear about success stories all the time that blow my mind. Bolton actually cares about being good humans first. Now you can finally say you've found a solution that you can trust. And that's what really matters, right?$t$
where segment_code = 'WHY-005';

update public.segments set
  tones = array['CALM'],
  tone_map = $j$[{"tone": "CALM", "text": "So to get started is super simple. We pick a payment date that works for you, I'll enter your banking info which allows me to send you the agreement via email - we'll walk through that together - it only takes about 10 minutes. When we're done there, I'll introduce you to your certified financial coach and that'll be it for today."}]$j$::jsonb,
  script_text = $t$So to get started is super simple. We pick a payment date that works for you, I'll enter your banking info which allows me to send you the agreement via email - we'll walk through that together - it only takes about 10 minutes. When we're done there, I'll introduce you to your certified financial coach and that'll be it for today.$t$
where segment_code = 'ENR-001';

update public.segments set tones = '{}', tone_map = null where segment_code = 'ENR-002';

update public.segments set tones = '{}', tone_map = null where segment_code = 'ENR-003';

update public.segments set tones = '{}', tone_map = null where segment_code = 'ENR-004';

update public.segments set tones = '{}', tone_map = null where segment_code = 'ENR-005';

update public.segments set tones = '{}', tone_map = null where segment_code = 'ENR-006';

update public.segments set tones = '{}', tone_map = null where segment_code = 'CON-001';

update public.segments set tones = '{}', tone_map = null where segment_code = 'CON-002';

update public.segments set tones = '{}', tone_map = null where segment_code = 'CON-003';

update public.segments set tones = '{}', tone_map = null where segment_code = 'CON-004';

update public.segments set tones = '{}', tone_map = null where segment_code = 'CON-005';

update public.segments set tones = '{}', tone_map = null where segment_code = 'CON-006';

update public.segments set tones = '{}', tone_map = null where segment_code = 'CON-007';

update public.segments set tones = '{}', tone_map = null where segment_code = 'CON-008';

update public.segments set tones = '{}', tone_map = null where segment_code = 'CON-009';

update public.segments set tones = '{}', tone_map = null where segment_code = 'CON-010';

update public.segments set tones = '{}', tone_map = null where segment_code = 'CON-011';

update public.segments set tones = '{}', tone_map = null where segment_code = 'CMP-001';

update public.segments set tones = '{}', tone_map = null where segment_code = 'CMP-002';

update public.segments set tones = '{}', tone_map = null where segment_code = 'FIN-001';

update public.segments set tones = '{}', tone_map = null where segment_code = 'FIN-002';

update public.segments set tones = '{}', tone_map = null where segment_code = 'FIN-003';

update public.segments set tones = '{}', tone_map = null where segment_code = 'FIN-004';

update public.segments set tones = '{}', tone_map = null where segment_code = 'FIN-005';

update public.segments set
  tones = array['AC'],
  tone_map = $j$[{"tone": "AC", "text": "I hear what you're saying. Let me ask you a question: Does the program make sense? Do you like the idea?"}]$j$::jsonb,
  script_text = $t$I hear what you're saying. Let me ask you a question: Does the program make sense? Do you like the idea?$t$
where segment_code = 'LOOP1-001';

update public.segments set
  tones = array['AC'],
  tone_map = $j$[{"tone": "AC", "text": "Exactly! It's a great program! In fact, one of the true beauties here is that you will be putting $XXX of hard-earned cash back into your pocket every month. Let me tell you exactly what you're going to get for that, ok?"}]$j$::jsonb,
  script_text = $t$Exactly! It's a great program! In fact, one of the true beauties here is that you will be putting $XXX of hard-earned cash back into your pocket every month. Let me tell you exactly what you're going to get for that, ok?$t$
where segment_code = 'LOOP1-002';

update public.segments set
  tones = array['AC'],
  tone_map = $j$[{"tone": "AC", "text": "We dispute the debt once it goes to collections, because it's the cheapest way; we monitor and analyze your credit because we want to increase your lending power; and we educate you on your rights because we want to empower you and set you up for financial success for the rest of your life. You see what I am saying here, FIRST NAME?"}]$j$::jsonb,
  script_text = $t$We dispute the debt once it goes to collections, because it's the cheapest way; we monitor and analyze your credit because we want to increase your lending power; and we educate you on your rights because we want to empower you and set you up for financial success for the rest of your life. You see what I am saying here, FIRST NAME?$t$
where segment_code = 'LOOP1-003';

update public.segments set
  tones = array['AC'],
  tone_map = $j$[{"tone": "AC", "text": "Exactly! This finally puts you back in the driver's seat. Now FIRST NAME, let me ask you another question... If I'd been able to put this plan together when this all started for you, and you had been able to save thousands of dollars, eliminated all the stress so you can focus on what really matters, then you probably wouldn't be saying \"Let me think about it\" right now. You'd be saying \"Why didn't we do it sooner.\" Am I right?"}]$j$::jsonb,
  script_text = $t$Exactly! This finally puts you back in the driver's seat. Now FIRST NAME, let me ask you another question... If I'd been able to put this plan together when this all started for you, and you had been able to save thousands of dollars, eliminated all the stress so you can focus on what really matters, then you probably wouldn't be saying "Let me think about it" right now. You'd be saying "Why didn't we do it sooner." Am I right?$t$
where segment_code = 'LOOP1-004';

update public.segments set
  tones = array['AC','CALM','RM'],
  tone_map = $j$[{"tone": "AC", "text": "Look. You don't know me, and I don't have the luxury of a track record, so let me take a moment to reintroduce myself. My name is FULL NAME. I'm a senior consultant at Lionside Financial and I pride myself on helping every single client improve their financial future. Not only am I going to help you get enrolled, but we will be here every step of the way even after you graduate. As far as my company goes, we are the leader in the industry with cutting edge education and decades of experience."}, {"tone": "CALM", "text": "And believe me, if I'm even half right, the only problem you will have is I didn't call you six months ago and help you then."}, {"tone": "RM", "text": "Fair enough?"}]$j$::jsonb,
  script_text = $t$Look. You don't know me, and I don't have the luxury of a track record, so let me take a moment to reintroduce myself. My name is FULL NAME. I'm a senior consultant at Lionside Financial and I pride myself on helping every single client improve their financial future. Not only am I going to help you get enrolled, but we will be here every step of the way even after you graduate. As far as my company goes, we are the leader in the industry with cutting edge education and decades of experience. And believe me, if I'm even half right, the only problem you will have is I didn't call you six months ago and help you then. Fair enough?$t$
where segment_code = 'LOOP1-005';

update public.segments set
  tones = array['CALM','AC'],
  tone_map = $j$[{"tone": "CALM", "text": "I hear what you're saying, but I've been doing this for a long time."}, {"tone": "AC", "text": "FIRST NAME, this program is tailor made for you. You have one low payment that finally gives you breathing room, and is the fastest way to get your credit back on track. So let's make sure we're on the same page here. Ok?"}]$j$::jsonb,
  script_text = $t$I hear what you're saying, but I've been doing this for a long time. FIRST NAME, this program is tailor made for you. You have one low payment that finally gives you breathing room, and is the fastest way to get your credit back on track. So let's make sure we're on the same page here. Ok?$t$
where segment_code = 'LOOP2-001';

update public.segments set
  tones = array['AC','PT'],
  tone_map = $j$[{"tone": "AC", "text": "Your accounts will fall behind and go to collection,"}, {"tone": "PT", "text": "and that's a good thing,"}, {"tone": "AC", "text": "because this allows us to dispute the debt and get it resolved. And that's what really matters to you right?"}]$j$::jsonb,
  script_text = $t$Your accounts will fall behind and go to collection, and that's a good thing, because this allows us to dispute the debt and get it resolved. And that's what really matters to you right?$t$
where segment_code = 'LOOP2-002';

update public.segments set
  tones = array['AC'],
  tone_map = $j$[{"tone": "AC", "text": "Exactly! All without damaging your credit any further. Our goal is to stop all collection activity as quickly as possible. You see, we've had such high success doing this it's almost unbelievable. In addition to resolving the debt you'll also be empowered with education, support, protection, advice, and finally a plan for your future."}]$j$::jsonb,
  script_text = $t$Exactly! All without damaging your credit any further. Our goal is to stop all collection activity as quickly as possible. You see, we've had such high success doing this it's almost unbelievable. In addition to resolving the debt you'll also be empowered with education, support, protection, advice, and finally a plan for your future.$t$
where segment_code = 'LOOP2-003';

update public.segments set
  tones = array['AC','I CARE'],
  tone_map = $j$[{"tone": "AC", "text": "One of the things that I love about this job is seeing clients transform. Come from a place of stress and become inspired through education and most importantly... results."}, {"tone": "I CARE", "text": "Look, I've been there too. It almost ruined me."}, {"tone": "AC", "text": "But I also know how amazing it feels on the other side and not having this debt burden hanging over me. The reason that I chose to work for Lionside Financial is because..."}, {"tone": "I CARE", "text": "we actually care about our clients. And it's important that you are working with a trustworthy company right?"}]$j$::jsonb,
  script_text = $t$One of the things that I love about this job is seeing clients transform. Come from a place of stress and become inspired through education and most importantly... results. Look, I've been there too. It almost ruined me. But I also know how amazing it feels on the other side and not having this debt burden hanging over me. The reason that I chose to work for Lionside Financial is because... we actually care about our clients. And it's important that you are working with a trustworthy company right?$t$
where segment_code = 'LOOP2-004';

update public.segments set
  tones = array['CALM','AC','I CARE','RM'],
  tone_map = $j$[{"tone": "CALM", "text": "Now let me ask you a question."}, {"tone": "AC", "text": "Let's say I'm wrong, which is highly, HIGHLY unlikely. What's the worst that can happen? You're out $MONTHLY PROGRAM PAYMENT and you cancel the program. That's not going to ruin you financially. You still get all of the other benefits out of the gate. If I'm even half right, on the upside, having us as an asset to you and your family, you get credit monitoring, ID theft protection, financial education, the lifestyle benefits we discussed, a consultation with the best consumer protection law firm in the nation. We pride ourselves on long term relationships and"}, {"tone": "I CARE", "text": "we will be there to hold your hand every step of the way."}, {"tone": "RM", "text": "Does that make sense?"}]$j$::jsonb,
  script_text = $t$Now let me ask you a question. Let's say I'm wrong, which is highly, HIGHLY unlikely. What's the worst that can happen? You're out $MONTHLY PROGRAM PAYMENT and you cancel the program. That's not going to ruin you financially. You still get all of the other benefits out of the gate. If I'm even half right, on the upside, having us as an asset to you and your family, you get credit monitoring, ID theft protection, financial education, the lifestyle benefits we discussed, a consultation with the best consumer protection law firm in the nation. We pride ourselves on long term relationships and we will be there to hold your hand every step of the way. Does that make sense?$t$
where segment_code = 'LOOP2-005';

update public.segments set
  tones = array['AC','CALM'],
  tone_map = $j$[{"tone": "AC", "text": "FIRST NAME, put your trust in me, my program, and my company. You will finally be done with this debt, your credit will be back to where you need it to be, and you'll have an extra $PROGRAM SAVINGS in the bank."}, {"tone": "CALM", "text": "So, all I ask you is this: if you give me 1 percent of your trust, I'll earn the other 99 percent. Fair enough?"}]$j$::jsonb,
  script_text = $t$FIRST NAME, put your trust in me, my program, and my company. You will finally be done with this debt, your credit will be back to where you need it to be, and you'll have an extra $PROGRAM SAVINGS in the bank. So, all I ask you is this: if you give me 1 percent of your trust, I'll earn the other 99 percent. Fair enough?$t$
where segment_code = 'LOOP2-006';

update public.segments set
  tones = array['I CARE','AC'],
  tone_map = $j$[{"tone": "I CARE", "text": "FIRST NAME, I hear you. Please don't mistake my enthusiasm for pressure. I see the pain you're in and this is the remedy."}, {"tone": "AC", "text": "Give me one shot and you'll see, just like all my other clients, this is the best financial decision."}]$j$::jsonb,
  script_text = $t$FIRST NAME, I hear you. Please don't mistake my enthusiasm for pressure. I see the pain you're in and this is the remedy. Give me one shot and you'll see, just like all my other clients, this is the best financial decision.$t$
where segment_code = 'LOOP3-001';

update public.segments set
  tones = array['PT','AC'],
  tone_map = $j$[{"tone": "PT", "text": "The program is simple."}, {"tone": "AC", "text": "As the accounts fall behind the creditors simply write off the debt as a loss. Trust me, they never lose money. Then, when they sell the debt to a collector, they don't have the documents they need to collect the debt from you. You never borrowed any money from a collection agency right?"}]$j$::jsonb,
  script_text = $t$The program is simple. As the accounts fall behind the creditors simply write off the debt as a loss. Trust me, they never lose money. Then, when they sell the debt to a collector, they don't have the documents they need to collect the debt from you. You never borrowed any money from a collection agency right?$t$
where segment_code = 'LOOP3-002';

update public.segments set
  tones = array['AC','CALM','RM'],
  tone_map = $j$[{"tone": "AC", "text": "Exactly! Why would you pay someone you didn't even owe? You wouldn't."}, {"tone": "CALM", "text": "Look, getting you out of debt is the easy part."}, {"tone": "AC", "text": "Remember, our success rate is off the charts. Where we earn our money is the long term relationship. We work with you to design a very specific and detailed plan to save you money and improve your credit,"}, {"tone": "RM", "text": "and that's important to you as well, right?"}]$j$::jsonb,
  script_text = $t$Exactly! Why would you pay someone you didn't even owe? You wouldn't. Look, getting you out of debt is the easy part. Remember, our success rate is off the charts. Where we earn our money is the long term relationship. We work with you to design a very specific and detailed plan to save you money and improve your credit, and that's important to you as well, right?$t$
where segment_code = 'LOOP3-003';

update public.segments set
  tones = array['AC','S','CALM'],
  tone_map = $j$[{"tone": "AC", "text": "Of course it is! Just so you know, I don't offer this program to everybody."}, {"tone": "S", "text": "It's for a select few."}, {"tone": "CALM", "text": "Because you're with us for the long run,"}, {"tone": "AC", "text": "if there were a problem it would reflect on my reputation, which is sterling, and I am not willing to have even one client fail. My entire company feels this way. And you want to work with a company that stands behind their service right?"}]$j$::jsonb,
  script_text = $t$Of course it is! Just so you know, I don't offer this program to everybody. It's for a select few. Because you're with us for the long run, if there were a problem it would reflect on my reputation, which is sterling, and I am not willing to have even one client fail. My entire company feels this way. And you want to work with a company that stands behind their service right?$t$
where segment_code = 'LOOP3-004';

update public.segments set
  tones = array['I CARE','AC'],
  tone_map = $j$[{"tone": "I CARE", "text": "FIRST NAME, the last thing I want to see is you continue to struggle month after month just to make ends meet. Imagine how you will feel in a year when this is still keeping you up at night. That feeling in the pit of your stomach."}, {"tone": "AC", "text": "But, I want you to focus on how amazing it will be when you are back on your feet again, have plenty of money in your bank account, and you can even take a vacation without worrying. Won't that be amazing?"}]$j$::jsonb,
  script_text = $t$FIRST NAME, the last thing I want to see is you continue to struggle month after month just to make ends meet. Imagine how you will feel in a year when this is still keeping you up at night. That feeling in the pit of your stomach. But, I want you to focus on how amazing it will be when you are back on your feet again, have plenty of money in your bank account, and you can even take a vacation without worrying. Won't that be amazing?$t$
where segment_code = 'LOOP3-005';

update public.segments set
  tones = array['AC','CALM','RM'],
  tone_map = $j$[{"tone": "AC", "text": "If you do even half as well as my clients"}, {"tone": "CALM", "text": "you will be very, VERY impressed."}, {"tone": "RM", "text": "Sound fair enough?"}]$j$::jsonb,
  script_text = $t$If you do even half as well as my clients you will be very, VERY impressed. Sound fair enough?$t$
where segment_code = 'LOOP3-006';
