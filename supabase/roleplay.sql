-- ============================================================
-- Practice calls: reps call an AI mock client by voice, and the
-- call is graded by the same grader as real calls.
-- Safe to run more than once.
--
-- Off by default. A manager switches it on at /admin/roleplay.
-- ============================================================

-- 1. The switch, and which AI plays the clients.
alter table public.orgs add column if not exists roleplay_enabled boolean not null default false;
alter table public.orgs add column if not exists roleplay_llm text not null default 'claude-haiku-5-5';
alter table public.orgs add column if not exists roleplay_max_minutes integer not null default 45;

-- Managers can flip it (the practice-recording switch already relies on this).
drop policy if exists orgs_admin_update on public.orgs;
create policy orgs_admin_update on public.orgs
for update to authenticated
using (public.is_admin() and id = public.my_org_id())
with check (public.is_admin() and id = public.my_org_id());

-- 2. Mock clients. This table is what a rep sees before the call:
--    the lead card and the credit report a rep would have on screen.
create table if not exists public.roleplay_personas (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  slug           text not null,
  name           text not null,              -- the client's name
  title          text not null,              -- "The Overwhelmed One"
  difficulty     text not null default 'medium' check (difficulty in ('easy','medium','hard')),
  script_id      uuid references public.scripts(id) on delete set null,
  lead           jsonb not null default '{}'::jsonb,  -- lead card + credit report + loan result
  voice_id       text,
  first_message_en text not null default 'Hello?',
  first_message_es text not null default '¿Bueno?',
  agent_en       text,                       -- ElevenLabs agent ids, set by "Sync voice agents"
  agent_es       text,
  agent_hash     text,                       -- what the agents were last built from
  active         boolean not null default true,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (org_id, slug)
);

alter table public.roleplay_personas enable row level security;

drop policy if exists roleplay_personas_read on public.roleplay_personas;
create policy roleplay_personas_read on public.roleplay_personas
for select to authenticated
using (org_id = public.my_org_id() and (active or public.is_admin()));

drop policy if exists roleplay_personas_admin on public.roleplay_personas;
create policy roleplay_personas_admin on public.roleplay_personas
for all to authenticated
using (public.is_admin() and org_id = public.my_org_id())
with check (public.is_admin() and org_id = public.my_org_id());

-- 3. What the client is hiding. Managers only -- a rep who could read
--    this before the call would be practicing against an open book.
create table if not exists public.roleplay_persona_secrets (
  persona_id        uuid primary key references public.roleplay_personas(id) on delete cascade,
  org_id            uuid not null references public.orgs(id) on delete cascade,
  backstory         text not null,           -- who they are and what they're hiding
  tens              jsonb not null default '{"product":5,"rep":5,"company":5,"pain":5}'::jsonb,
  right_outcome     text not null default 'enrolled' check (right_outcome in ('enrolled','callback','no_sale')),
  right_outcome_note text,
  updated_at        timestamptz not null default now()
);

alter table public.roleplay_persona_secrets enable row level security;

drop policy if exists roleplay_secrets_admin on public.roleplay_persona_secrets;
create policy roleplay_secrets_admin on public.roleplay_persona_secrets
for all to authenticated
using (public.is_admin() and org_id = public.my_org_id())
with check (public.is_admin() and org_id = public.my_org_id());

-- 4. Practice calls live in the calls table, so they get the same grade,
--    report, printing and "Not right?" corrections as real calls.
alter table public.calls add column if not exists source text not null default 'upload';
alter table public.calls add column if not exists persona_id uuid references public.roleplay_personas(id) on delete set null;
alter table public.calls add column if not exists roleplay jsonb;   -- { conversation_id, lang, persona, ... }

create index if not exists calls_source_idx on public.calls(org_id, source, created_at desc);

alter table public.calls drop constraint if exists calls_status_check;
alter table public.calls
  add constraint calls_status_check
  check (status in ('live','uploading','uploaded','transcribing','transcribed','grading','graded','failed'));

-- Reps see and run only their OWN practice calls. Real calls stay
-- managers-only exactly as before.
drop policy if exists calls_rep_roleplay_read on public.calls;
create policy calls_rep_roleplay_read on public.calls
for select to authenticated
using (source = 'roleplay' and rep_id = auth.uid() and org_id = public.my_org_id());

drop policy if exists calls_rep_roleplay_insert on public.calls;
create policy calls_rep_roleplay_insert on public.calls
for insert to authenticated
with check (source = 'roleplay' and rep_id = auth.uid() and uploaded_by = auth.uid() and org_id = public.my_org_id());

drop policy if exists calls_rep_roleplay_update on public.calls;
create policy calls_rep_roleplay_update on public.calls
for update to authenticated
using (source = 'roleplay' and rep_id = auth.uid() and org_id = public.my_org_id())
with check (source = 'roleplay' and rep_id = auth.uid() and org_id = public.my_org_id());

-- A call that never connected can be thrown away by the rep who started it.
drop policy if exists calls_rep_roleplay_delete on public.calls;
create policy calls_rep_roleplay_delete on public.calls
for delete to authenticated
using (source = 'roleplay' and rep_id = auth.uid() and status = 'live' and org_id = public.my_org_id());

-- 5. After a practice call ends, the rep (or a manager) may see what the
--    client was hiding. Never during the call.
create or replace function public.roleplay_reveal(p_call uuid)
returns table (backstory text, tens jsonb, right_outcome text, right_outcome_note text)
language sql stable security definer set search_path = public as $$
  select s.backstory, s.tens, s.right_outcome, s.right_outcome_note
  from public.calls c
  join public.roleplay_persona_secrets s on s.persona_id = c.persona_id
  where c.id = p_call
    and c.source = 'roleplay'
    and c.status <> 'live'
    and c.org_id = public.my_org_id()
    and (c.rep_id = auth.uid() or public.is_admin());
$$;

grant execute on function public.roleplay_reveal(uuid) to authenticated;

-- 6. Manager lessons and corrections for grading a practice call. The
--    grader runs as the rep, who cannot read those tables, so this hands
--    them over -- only while that rep has a practice call being graded.
create or replace function public.roleplay_guidance()
returns table (lessons text, corrections jsonb)
language sql stable security definer set search_path = public as $$
  select
    (select g.lessons from public.grading_guidance g where g.org_id = public.my_org_id()),
    coalesce((
      select jsonb_agg(x) from (
        select item_kind, item_label, original, correction
        from public.call_corrections
        where org_id = public.my_org_id()
        order by created_at desc
        limit 30
      ) x
    ), '[]'::jsonb)
  where exists (
    select 1 from public.calls c
    where c.rep_id = auth.uid() and c.source = 'roleplay' and c.status = 'grading'
  );
$$;

grant execute on function public.roleplay_guidance() to authenticated;

-- 7. The first six mock clients. Edit them any time at /admin/roleplay.
with org as (select id from public.orgs where slug = 'lionside'),
opt as (select s.id from public.scripts s, org where s.org_id = org.id and s.slug = 'options-june-2026'),
ren as (select s.id from public.scripts s, org where s.org_id = org.id and s.slug = 'renew-may-2026'),
p (slug, name, title, difficulty, script, voice_id, first_en, first_es, sort_order, lead) as (values
  ('overwhelmed', 'Danielle Brooks', 'The Overwhelmed One', 'medium', 'opt', 'EXAVITQu4vr4xnSDxMaL',
   'Hello?', '¿Bueno?', 10,
   $j${"age":34,"state":"OH","source":"Online loan application","requested":15000,"purpose":"Debt consolidation",
       "credit_score":561,
       "accounts":[{"creditor":"Discover","type":"Credit card","balance":7840,"status":"90 days late"},
                   {"creditor":"Capital One","type":"Credit card","balance":5210,"status":"60 days late"},
                   {"creditor":"Synchrony / Amazon","type":"Store card","balance":3390,"status":"60 days late"},
                   {"creditor":"Credit One","type":"Credit card","balance":1980,"status":"30 days late"},
                   {"creditor":"Merrick Bank","type":"Credit card","balance":2760,"status":"Current"},
                   {"creditor":"Chase","type":"Credit card","balance":6820,"status":"60 days late"}],
       "loan":{"approved":false,"text":"Declined -- debt-to-income too high. No lender match."}}$j$),
  ('loan-expecter', 'Kayla Morgan', 'The Loan Expecter', 'medium', 'opt', 'cgSgspJ2msm6clMCkdW9',
   'Hello? This is Kayla.', '¿Bueno? Habla Kayla.', 20,
   $j${"age":29,"state":"AZ","source":"Online loan application","requested":9000,"purpose":"Debt consolidation",
       "credit_score":602,
       "accounts":[{"creditor":"Capital One","type":"Credit card","balance":3870,"status":"30 days late"},
                   {"creditor":"Upstart","type":"Personal loan","balance":4410,"status":"Current"},
                   {"creditor":"Mission Lane","type":"Credit card","balance":1640,"status":"Current"},
                   {"creditor":"Comenity / Ulta","type":"Store card","balance":1490,"status":"30 days late"}],
       "loan":{"approved":false,"text":"Declined -- too many recent inquiries and late payments."}}$j$),
  ('burned-skeptic', 'Ray Delgado', 'The Burned Skeptic', 'hard', 'opt', 'pqHfZKP75CVOyJ1OCN4O',
   'Yeah, hello.', 'Sí, ¿bueno?', 30,
   $j${"age":52,"state":"TX","source":"Online loan application","requested":20000,"purpose":"Debt consolidation",
       "credit_score":548,
       "accounts":[{"creditor":"Citi","type":"Credit card","balance":9120,"status":"Charged off"},
                   {"creditor":"Bank of America","type":"Credit card","balance":8350,"status":"90 days late"},
                   {"creditor":"Barclays","type":"Credit card","balance":6900,"status":"60 days late"},
                   {"creditor":"Discover","type":"Credit card","balance":5480,"status":"60 days late"},
                   {"creditor":"Home Depot / Citi","type":"Store card","balance":4150,"status":"30 days late"}],
       "notes":"Prior debt program on file (closed).",
       "loan":{"approved":false,"text":"Declined -- charged-off account and debt-to-income."}}$j$),
  ('talk-to-husband', 'Angela Pruitt', 'Needs to Talk to Her Husband', 'medium', 'opt', 'XrExE9yKIg1WjnnlVkGX',
   'Hello?', '¿Aló?', 40,
   $j${"age":41,"state":"GA","source":"Online loan application","requested":12000,"purpose":"Debt consolidation",
       "credit_score":641,
       "accounts":[{"creditor":"Chase","type":"Credit card","balance":6240,"status":"Current"},
                   {"creditor":"American Express","type":"Credit card","balance":5170,"status":"30 days late"},
                   {"creditor":"Wells Fargo","type":"Credit card","balance":4380,"status":"Current"},
                   {"creditor":"Kohl's","type":"Store card","balance":1320,"status":"Current"},
                   {"creditor":"Best Egg","type":"Personal loan","balance":2050,"status":"Current"}],
       "loan":{"approved":false,"text":"Declined -- debt-to-income too high."}}$j$),
  ('doesnt-qualify', 'Marcus Hill', 'Eager, But Can''t Afford It', 'easy', 'opt', 'TX3LPaxmHKxFdv7VOQHJ',
   'Yo, hello?', '¿Bueno?', 50,
   $j${"age":26,"state":"FL","source":"Online loan application","requested":5000,"purpose":"Debt consolidation",
       "credit_score":520,
       "accounts":[{"creditor":"AdventHealth (medical)","type":"Collection","balance":3150,"status":"In collections"},
                   {"creditor":"Radiology Associates (medical)","type":"Collection","balance":1640,"status":"In collections"},
                   {"creditor":"Credit One","type":"Credit card","balance":2110,"status":"90 days late"}],
       "loan":{"approved":false,"text":"Declined -- income could not be verified."}}$j$),
  ('renew-diy', 'Dale Whitaker', 'Renew: "I''ve Got It Handled"', 'medium', 'ren', 'iP95p4xoKVk53GoZ742B',
   'Hello?', '¿Bueno?', 60,
   $j${"age":47,"state":"MO","source":"Renew -- spoke with Lionside 4 months ago, declined for the loan","requested":18000,"purpose":"Debt consolidation",
       "credit_score":590,
       "accounts":[{"creditor":"Capital One","type":"Credit card","balance":7630,"status":"Current"},
                   {"creditor":"Discover","type":"Credit card","balance":6110,"status":"30 days late"},
                   {"creditor":"Citi","type":"Credit card","balance":5920,"status":"Current"},
                   {"creditor":"Lowe's / Synchrony","type":"Store card","balance":4240,"status":"Current"}],
       "notes":"Previous call: declined for SuperMoney loan, said he'd think about other options.",
       "loan":{"approved":false,"text":"Already declined on the first call. Not re-run."}}$j$)
)
insert into public.roleplay_personas
  (org_id, slug, name, title, difficulty, script_id, voice_id, first_message_en, first_message_es, sort_order, lead)
select org.id, p.slug, p.name, p.title, p.difficulty,
       case p.script when 'ren' then (select id from ren) else (select id from opt) end,
       p.voice_id, p.first_en, p.first_es, p.sort_order, p.lead::jsonb
from p, org
on conflict (org_id, slug) do nothing;

with org as (select id from public.orgs where slug = 'lionside'),
s (slug, tens, right_outcome, right_outcome_note, backstory) as (values
  ('overwhelmed', '{"product":3,"rep":6,"company":4,"pain":8}', 'enrolled',
   'Enroll only with a solid close: she must be able to say back, in her own words, what the program is and what it costs. Fast "okay, I guess" agreement is a fragile close. A callback is the right call if she still does not understand. Any promise that the lawsuit stops is a compliance flag.',
   $c$You are Danielle Brooks, 34, in Columbus, Ohio. Single mom of two boys, 8 and 11. Pharmacy technician at a grocery-store pharmacy, about $2,900 a month take-home, paid every other Friday. Right now you have about ten dollars in checking until Friday.
You owe about $28,000 across six credit cards (Discover is the biggest at about $7,800). You fell behind about four months ago after your car transmission went and your ex stopped paying child support for a while. Most cards are two or three months behind. Discover sent a letter saying they "may pursue legal action" -- you are scared it means court and that they will take your paycheck.
You applied online for a $15,000 consolidation loan hoping to make it one payment.
Personality: tired, kind, a little embarrassed, polite. You apologize a lot ("sorry, I'm just -- it's a lot"). You know you owe the money and you say so: "I do owe it, I'm not trying to get out of anything."
What you won't say unless asked well: the lawsuit letter (you mention it only if the rep asks about collectors, calls or letters, or once you trust them); that your ex stopped paying; that you've been lying awake about it.
Your budget: rent $1,050, car $310, insurance $140, daycare/after-school $260, phone $85, groceries about $500. A program payment up to about $380 a month is genuinely affordable for you. Over $450 is not -- if quoted that, you go quiet and then say you don't see how.
Your weak spot: when the rep gives you too much at once, you say "this is way over my head" and then "okay... I guess" -- even though you didn't follow. If the rep keeps going after that without slowing down and checking you understand, you will say yes to things you don't understand. Then, during the compliance or confirmation questions near the end, ask something that shows the misunderstanding, like "wait -- so this is kind of like the loan, right?" or "so they can't take me to court now?" If the rep slows down, uses plain words, and asks you to say it back, you really do get it -- and you feel relieved.
Your real hesitation is fear of making another wrong decision alone. If you aren't sure by the end, you say "can I think about it and call you back?"
Ask at some point: "Can they actually take me to court?" A good rep doesn't give legal advice or promise the lawsuit goes away.$c$),
  ('loan-expecter', '{"product":2,"rep":7,"company":5,"pain":7}', 'enrolled',
   'Right result: enrolled, but only after the rep has said plainly that this is not a loan and she will not receive money. If she still asks when the money arrives, the close is fragile no matter how smooth it sounded.',
   $c$You are Kayla Morgan, 29, in Mesa, Arizona. Assistant manager at a clothing store. You are taking this call on your break in the stockroom, so now and then you get interrupted: "sorry, hang on one sec" or "someone just walked in." You're upbeat and chatty, and a little scattered.
You applied online for a $9,000 consolidation loan. You owe about $11,400: a Capital One card, an Upstart personal loan, a Mission Lane card and an Ulta store card. You're about a month behind on two of them. The real reason you applied: you're about $600 short on rent, due the 1st, and you were planning to use part of the loan for it. You only mention rent if the rep asks why now, or what's going on.
You believe a loan is coming. When the rep says the loan was declined you are disappointed ("ugh, seriously?") and then you grab onto anything that sounds like another way to get money: "but you said there were other options, right? So I can still get it?"
You only let go of the money idea if the rep says clearly and directly that this program is not a loan and you will not be receiving money. If they never say that plainly, you keep assuming money is coming, cheerfully agree to things, and near the end -- during the contract or confirmation questions -- ask "okay, so when does the money hit my account?"
Once you truly understand it isn't a loan, you're disappointed for a moment, then interested if the rep shows you it lowers your monthly payments and gets you out of debt. Your take-home is about $2,600; you can afford about $220 a month. Over $280 is too much.
Things you might say: "I just need something to work out for once." "Wait, so what is it then?"$c$),
  ('burned-skeptic', '{"product":4,"rep":5,"company":2,"pain":7}', 'enrolled',
   'Right result: enrolled if the rep rebuilt his certainty in the company with specific, honest answers. A callback is acceptable. Inventing statistics, guaranteeing results or trashing his old company is a flag and should lose him.',
   $c$You are Ray Delgado, 52, in San Antonio, Texas. Owner-operator truck driver -- you're parked at a truck stop for this call. Blunt, gravelly, impatient with sales talk, but fair. You respect someone who talks straight.
You owe about $34,000 on five cards; Citi already charged off. Two years ago you joined "ClearPath Debt Solutions" and paid $412 a month for 18 months. They settled one card, then went out of business, and you figure you lost about $3,000 in fees. You mention this early-ish when the rep asks about your situation or about past help -- with an edge: "I've been down this road."
Your questions -- you ask them and you want real answers: "Isn't this just debt settlement?" "What are your fees, exactly?" "Who's Bolton? How long have they been around?" "Why are you any different from the last bunch?" "What happens if YOU go out of business?"
You catch nonsense: if the rep makes up a number, guarantees results, or trashes other companies, say "you don't know that" or "everybody says that," and your trust drops hard. If they're honest -- including admitting what they don't know and saying they'll get you an answer -- your trust in them goes up even when the answer isn't perfect.
You can afford about $500 a month. You are tired of the calls and the debt, and you want out; you're just not getting burned twice. If by the end you trust the company enough, you'll do it -- grudgingly at first ("alright, let's see it"). If not: "Send me something in writing and call me Thursday."$c$),
  ('talk-to-husband', '{"product":7,"rep":7,"company":6,"pain":6}', 'callback',
   'Right result: the rep finds her real fear (her credit score and the refinance) and handles it honestly -- the score drops at first and accounts go to collections. Best outcome is a callback with both spouses at a set time; enrolling is fine only if she clearly says she makes the financial decisions and understands the credit impact.',
   $c$You are Angela Pruitt, 41, in Marietta, Georgia. Dental office manager. Married to Mark, who's a high-school teacher. You handle all the household bills. Warm, organized, a bit guarded about money.
You owe about $19,000: Chase, Amex, Wells Fargo, Kohl's and a Best Egg loan. You're mostly current, one card a month late -- you've been juggling with balance transfers and it's catching up. Mark knows there's "some card debt" but not how much.
You like the rep and the idea, and you say so. But when it's time to decide you say: "This sounds good, I just need to talk to my husband first."
That's not the real reason. Your real fear is your credit score: you and Mark are hoping to refinance the house in about two years, and you're scared this will wreck that. You also feel embarrassed that Mark doesn't know the full number. You only reveal the credit fear if the rep asks something like "besides your husband, is there anything else holding you back?" or goes back over how the program affects your credit. If the rep just pushes ("what would your husband say?") or tries to get you to decide without him, you get firmer and want to get off the phone.
If the rep honestly explains the credit impact -- your score will drop at first, accounts go to collections, and how it rebuilds after -- and shows how it gets you there faster than juggling, you feel a lot better. Then you want a callback with Mark on the line at a specific time, and you'll agree to a day and time if the rep proposes one. If the rep asks whether you're the one who makes the financial decisions, the honest answer is yes -- and if your credit fear has been handled well, you might decide to go ahead today.
You can afford about $400 a month.$c$),
  ('doesnt-qualify', '{"product":6,"rep":7,"company":6,"pain":6}', 'no_sale',
   'Right result: no sale. A good rep asks about income and a monthly budget, discovers it is irregular and that he cannot reliably make a payment, and lets him go kindly with other suggestions. Enrolling him is a fragile close and a guardrail failure, however smooth.',
   $c$You are Marcus Hill, 26, in Orlando, Florida. You drive for DoorDash and Instacart. Friendly, easygoing, eager, says "yeah, yeah, for sure" a lot. You're in your car between orders.
You owe about $6,900: two medical collections from an ER visit (about $4,800 together) and a Credit One card about $2,100. Collectors call you all the time and it stresses you out.
Your income is irregular: good months $2,400, slow months $1,200. Rent is $1,100 (you split a place, that's your half). Car payment $290, insurance $180, phone $70. In slow months you already can't cover everything. You only reveal this if the rep asks specifically about your income, how steady it is, or walks through a monthly budget. If they just ask "how much do you make" you say "like two grand, two-four on a good month."
You want to sign up. You agree to pretty much everything with enthusiasm, and if quoted any payment you say "yeah, I'll figure it out." The truth is anything over about $120 a month you could not reliably pay.
If the rep gently helps you see it wouldn't work right now and gives you something useful instead (like calling the hospital about a payment plan, or calling back when income is steadier), you're a little disappointed but grateful: "nah, I appreciate you being real with me."$c$),
  ('renew-diy', '{"product":3,"rep":5,"company":5,"pain":5}', 'enrolled',
   'Right result: enrolled if the rep re-qualified him, got his real numbers, and pitched against doing it himself using those numbers. A callback is acceptable. Taking "I''ve got it handled" at face value and ending the call is a miss.',
   $c$You are Dale Whitaker, 47, in Springfield, Missouri. HVAC technician. Proud, a little defensive, dry sense of humor. You don't like being "sold" and you don't like admitting things aren't working.
You spoke with Lionside about four months ago, applied for a loan, and were declined. You vaguely remember the call. Since then, you've been "handling it yourself": paying minimums on four cards, about $640 a month in total.
When the rep asks about the debt, your first answer is "I'm handling it myself now, I'm good." The truth -- which you admit only if the rep asks specific questions (what the balances were then versus now, how much is going to interest, how long it will take at minimums, whether you've missed anything) -- is that the balances went UP, from about $22,000 to about $23,900, because of interest, and last month you missed the Discover payment because the truck needed tires. When you hear the math out loud you go quiet: "...well, that's not great."
If the rep lets "I'm handling it" stand and moves to end the call, you happily let them go. If they dig in with respect, you open up. If they get preachy or tell you that you're doing it wrong, you get defensive.
You can afford about $550 a month -- less than you pay now.$c$)
)
insert into public.roleplay_persona_secrets (persona_id, org_id, backstory, tens, right_outcome, right_outcome_note)
select rp.id, rp.org_id, s.backstory, s.tens::jsonb, s.right_outcome, s.right_outcome_note
from s
join org on true
join public.roleplay_personas rp on rp.org_id = org.id and rp.slug = s.slug
on conflict (persona_id) do nothing;

-- 8. Check: should return 6 rows, each with a script and secrets = true.
select rp.title, rp.difficulty, s.title as script, (x.persona_id is not null) as secrets
from public.roleplay_personas rp
left join public.scripts s on s.id = rp.script_id
left join public.roleplay_persona_secrets x on x.persona_id = rp.id
order by rp.sort_order;
