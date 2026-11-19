-- ============================================================
-- Openers: a third side (next to sales/closers and service/AMs), with
-- its own managers and reps, its own script and its own rebuttals.
-- Safe to run more than once.
-- ============================================================
set lock_timeout = '5s';

-- 1. 'openers' is a team.
alter table public.profiles drop constraint if exists profiles_team_check;
alter table public.profiles add constraint profiles_team_check check (team is null or team in ('closers','ams','openers'));
alter table public.scripts drop constraint if exists scripts_team_check;
alter table public.scripts add constraint scripts_team_check check (team is null or team in ('closers','ams','openers'));

-- Training materials and classes can be aimed at openers too.
alter table public.training_materials drop constraint if exists training_materials_audience_check;
alter table public.training_materials add constraint training_materials_audience_check check (audience in ('all','closers','ams','openers'));
alter table public.training_events drop constraint if exists training_events_audience_check;
alter table public.training_events add constraint training_events_audience_check check (audience in ('all','new_hires','closers','ams','openers'));

-- 2. Openers are their own side: opener managers see only opener reps; sales and service never see them.
create or replace function public.side_of(uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select case when team = 'ams' then 'service' when team = 'openers' then 'openers' else 'sales' end from public.profiles where id = uid
$$;

-- 3. The Opener Script.
insert into public.scripts (org_id, slug, title, kind, sort_order, team, logo_url)
select o.id, 'openers', 'Opener Script', 'sales', 30, 'openers', '/lionside-logo.png'
from public.orgs o where o.slug = 'lionside'
on conflict (org_id, slug) do update set title = excluded.title, team = excluded.team, sort_order = excluded.sort_order;

-- Sections (English, then Spanish), then the rebuttals as practice loops.
insert into public.modules (script_id, slug, title, sort_order, kind, language)
select s.id, v.slug, v.title, v.sort_order, v.kind, v.language
from public.scripts s
cross join (values
  ($t$opn-greet$t$, $t$Greeting & ID$t$, 10, 'sequence', 'en'),
  ($t$opn-intro$t$, $t$Intro & Soft Pull$t$, 20, 'sequence', 'en'),
  ($t$opn-verify$t$, $t$Verify Info$t$, 30, 'sequence', 'en'),
  ($t$opn-housing$t$, $t$Housing$t$, 40, 'sequence', 'en'),
  ($t$opn-contact$t$, $t$Contact$t$, 50, 'sequence', 'en'),
  ($t$opn-employment$t$, $t$Employment & Income$t$, 60, 'sequence', 'en'),
  ($t$opn-final$t$, $t$Final Questions$t$, 70, 'sequence', 'en'),
  ($t$opn-consents$t$, $t$Consents$t$, 80, 'sequence', 'en'),
  ($t$opn-handoff$t$, $t$Submit & Handoff$t$, 90, 'sequence', 'en')
) as v(slug, title, sort_order, kind, language)
where s.slug = 'openers'
on conflict (script_id, slug) do update set title = excluded.title, sort_order = excluded.sort_order, kind = excluded.kind, language = excluded.language;

insert into public.modules (script_id, slug, title, sort_order, kind, language)
select s.id, v.slug, v.title, v.sort_order, v.kind, v.language
from public.scripts s
cross join (values
  ($t$opn-greet-es$t$, $t$Saludo e identificación$t$, 10, 'sequence', 'es'),
  ($t$opn-intro-es$t$, $t$Introducción y revisión leve$t$, 20, 'sequence', 'es'),
  ($t$opn-verify-es$t$, $t$Verificar datos$t$, 30, 'sequence', 'es'),
  ($t$opn-housing-es$t$, $t$Vivienda$t$, 40, 'sequence', 'es'),
  ($t$opn-contact-es$t$, $t$Contacto$t$, 50, 'sequence', 'es'),
  ($t$opn-employment-es$t$, $t$Empleo e ingresos$t$, 60, 'sequence', 'es'),
  ($t$opn-final-es$t$, $t$Preguntas finales$t$, 70, 'sequence', 'es'),
  ($t$opn-consents-es$t$, $t$Consentimientos$t$, 80, 'sequence', 'es'),
  ($t$opn-handoff-es$t$, $t$Envío y especialista$t$, 90, 'sequence', 'es')
) as v(slug, title, sort_order, kind, language)
where s.slug = 'openers'
on conflict (script_id, slug) do update set title = excluded.title, sort_order = excluded.sort_order, kind = excluded.kind, language = excluded.language;

insert into public.modules (script_id, slug, title, sort_order, kind, language)
select s.id, v.slug, v.title, v.sort_order, v.kind, v.language
from public.scripts s
cross join (values
  ($t$opn-rb-stall$t$, $t$Rebuttals: Not Now$t$, 200, 'loop', 'en'),
  ($t$opn-rb-trust$t$, $t$Rebuttals: Trust$t$, 210, 'loop', 'en'),
  ($t$opn-rb-credit$t$, $t$Rebuttals: Credit$t$, 220, 'loop', 'en'),
  ($t$opn-rb-loan$t$, $t$Rebuttals: The Loan$t$, 230, 'loop', 'en'),
  ($t$opn-rb-info$t$, $t$Rebuttals: Personal Info$t$, 240, 'loop', 'en'),
  ($t$opn-rb-others$t$, $t$Rebuttals: Spouse & Authorization$t$, 250, 'loop', 'en'),
  ($t$opn-rb-after$t$, $t$Rebuttals: After Submitting$t$, 260, 'loop', 'en'),
  ($t$opn-rb-smartcredit$t$, $t$Rebuttals: SmartCredit$t$, 270, 'loop', 'en')
) as v(slug, title, sort_order, kind, language)
where s.slug = 'openers'
on conflict (script_id, slug) do update set title = excluded.title, sort_order = excluded.sort_order, kind = excluded.kind, language = excluded.language;

insert into public.segments
  (module_id, segment_code, sort_order, title, script_text, tones, coaching, client_should_feel, verbatim, status)
select m.id, v.code, v.sort_order, v.title, v.script_text, v.tones, nullif(v.coaching, ''), nullif(v.feel, ''), v.verbatim, 'published'
from public.modules m
join public.scripts s on s.id = m.script_id
cross join (values
($t$opn-greet$t$, 'OPN-001', 10, $t$Greeting$t$,
 $t$Thank you for calling LionSide Financial, [your name] speaking, how may I help you?$t$,
 array['AC']::text[], $t$Find the caller ID while you greet. Bright, quick and sure of yourself.$t$, $t$They called the right place.$t$, false),
($t$opn-greet$t$, 'OPN-002', 20, $t$Invitation ID$t$,
 $t$Would you please read me the invitation ID or PIN number on the letter you received?$t$,
 array['PT']::text[], $t$Ask like it's routine, because it is. Look it up while they read it.$t$, $t$This is a real offer with my name on it.$t$, false),
($t$opn-greet$t$, 'OPN-003', 30, $t$Confirm the Client$t$,
 $t$Excellent. Am I speaking with [client name]?$t$,
 array['AC']::text[], $t$If it isn't them, ask their name. Only the client (or someone they authorize on the line) can apply.$t$, $t$They know exactly who I am.$t$, false),
($t$opn-greet$t$, 'OPN-004', 40, $t$Introduce Yourself$t$,
 $t$Okay [client name], my name is [your name]. I'll be assisting you today, how are you?$t$,
 array['I CARE']::text[], $t$Use their name. Actually listen to the answer.$t$, $t$There's a real person helping me.$t$, false),
($t$opn-intro$t$, 'OPN-005', 10, $t$Why We Need Info$t$,
 $t$Great, we need to take some basic information from you, [client name], so that we're able to determine the best rates for you. Once approved, you would be able to move forward with your loan as soon as today. Ok?$t$,
 array['PT','RM']::text[], $t$Presuppose the application. 'As soon as today' is the hook; let it land.$t$, $t$This is quick and it could happen today.$t$, false),
($t$opn-intro$t$, 'OPN-006', 20, $t$What LionSide Does$t$,
 $t$LionSide provides you with access to several loan options, allowing you to get the best rate, term and payment. Upon approval, you'll have one loan with one low monthly payment. Sound good?$t$,
 array['AC']::text[], $t$One loan, one low monthly payment: slow down on that line.$t$, $t$One payment would make life easier.$t$, false),
($t$opn-intro$t$, 'OPN-007', 30, $t$Soft Pull$t$,
 $t$We use a soft pull to qualify you which means it won't show as an inquiry on your credit report and won't affect your credit score. So let's get started on your application, okay?$t$,
 array['CALM','RM']::text[], $t$Compliance line: say it as written. Calm and reassuring, then move straight into the application.$t$, $t$Nothing to lose by applying.$t$, true),
($t$opn-verify$t$, 'OPN-008', 10, $t$Confirm Name & Address$t$,
 $t$Now just to confirm, I'm speaking with [first and last name] at [address, including city, state and zip code]?$t$,
 array['RM']::text[], $t$Read the full address, including city, state and zip.$t$, $t$They have my details right.$t$, false),
($t$opn-verify$t$, 'OPN-009', 20, $t$Spelling$t$,
 $t$Okay great, is the spelling of your name and address correct on the offer?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-verify$t$, 'OPN-010', 30, $t$Middle Name$t$,
 $t$Thank you, do you have a middle name? (If yes: How do you spell that?)$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-housing$t$, 'OPN-011', 10, $t$Rent or Own$t$,
 $t$Okay, do you rent or own?$t$,
 array['RM']::text[], $t$Keep the rhythm going: question, answer, next question.$t$, $t$$t$, false),
($t$opn-housing$t$, 'OPN-012', 20, $t$Mortgage or Rent$t$,
 $t$What is your approximate monthly mortgage or rent payment?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-housing$t$, 'OPN-013', 30, $t$Time at Address$t$,
 $t$How long have you been at that address?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-contact$t$, 'OPN-014', 10, $t$Best Phone$t$,
 $t$I have your phone number listed as [phone number]? Would that be the best number to reach you?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-contact$t$, 'OPN-015', 20, $t$Second Phone$t$,
 $t$What is the 2nd best phone number to reach you at?$t$,
 array['RM']::text[], $t$Repeat the number back to confirm it.$t$, $t$$t$, false),
($t$opn-contact$t$, 'OPN-016', 30, $t$Call Any Time$t$,
 $t$Can we call you at any time?$t$,
 array['RM']::text[], $t$If they give a specific time, put it in and explain: 'Okay, the FS works from 7am to 5pm PST but I will put that down for you, okay?'$t$, $t$$t$, false),
($t$opn-contact$t$, 'OPN-017', 40, $t$Email$t$,
 $t$What is your email address?$t$,
 array['RM']::text[], $t$Repeat it back and spell it back. A wrong email means no loan offers.$t$, $t$$t$, false),
($t$opn-employment$t$, 'OPN-018', 10, $t$Employer$t$,
 $t$Thank you, who is your current employer?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-employment$t$, 'OPN-019', 20, $t$Time Employed$t$,
 $t$How long have you been employed there?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-employment$t$, 'OPN-020', 30, $t$Position$t$,
 $t$What is your current position there?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-employment$t$, 'OPN-021', 40, $t$Full or Part Time$t$,
 $t$Are you full time or part time?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-employment$t$, 'OPN-022', 50, $t$Income$t$,
 $t$Thank you, what is your gross monthly or annual income?$t$,
 array['RM']::text[], $t$Gross: before taxes.$t$, $t$$t$, false),
($t$opn-employment$t$, 'OPN-023', 60, $t$Other Expenses$t$,
 $t$Do you have any other additional expenses? (Example: an additional mortgage, car payment, or a loan)$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-employment$t$, 'OPN-024', 70, $t$Bank Accounts$t$,
 $t$Do you have a checking or savings account? Or both?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-final$t$, 'OPN-025', 10, $t$US Citizen$t$,
 $t$Are you a US Citizen?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-final$t$, 'OPN-026', 20, $t$Active Military$t$,
 $t$Are you Active Military?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-final$t$, 'OPN-027', 30, $t$Almost Done$t$,
 $t$We are almost done, just have two more questions for you...$t$,
 array['S']::text[], $t$Signal the finish line. It keeps them with you for the last two questions.$t$, $t$Almost there.$t$, false),
($t$opn-final$t$, 'OPN-028', 40, $t$Date of Birth$t$,
 $t$What's your date of birth?$t$,
 array['RM']::text[], $t$Repeat it back.$t$, $t$$t$, false),
($t$opn-final$t$, 'OPN-029', 50, $t$Last Four$t$,
 $t$And the last four of your social?$t$,
 array['CALM','RM']::text[], $t$Repeat it back. If they hesitate, see the Personal Info rebuttals.$t$, $t$$t$, false),
($t$opn-consents$t$, 'OPN-030', 10, $t$Permission to Submit$t$,
 $t$Thank you! Now, do you give us permission to submit your application through our lending platform in an attempt to qualify you for a personal loan?$t$,
 array['CALM']::text[], $t$Compliance line: say it as written and wait for a clear yes.$t$, $t$$t$, true),
($t$opn-consents$t$, 'OPN-031', 20, $t$Contact Permission$t$,
 $t$Okay, and in the event that one of our lenders or other 3rd parties needs to contact you regarding your application, do you grant them permission to contact you via telephone and email at the numbers and email address you provided?$t$,
 array['CALM']::text[], $t$Compliance line: say it as written. After they say yes, pull the CIC.$t$, $t$$t$, true),
($t$opn-consents$t$, 'OPN-032', 30, $t$Text Messages$t$,
 $t$Okay, and do you also agree to text messages?$t$,
 array['CALM']::text[], $t$Compliance line. If the status shows 'Loan Approved', do not read the last paragraph.$t$, $t$$t$, true),
($t$opn-handoff$t$, 'OPN-033', 10, $t$Submitted$t$,
 $t$Ok great, your application has been submitted. You'll hear back within about two hours or less. The Financial Specialist you'll be speaking with is part of our team here at LionSide. Let me give you their direct number in case you need it. Do you have a pen and paper handy? It's [FS number].$t$,
 array['AC']::text[], $t$Upbeat and certain. Make sure they write the number down.$t$, $t$It's done, and help is coming soon.$t$, false),
($t$opn-handoff$t$, 'OPN-034', 20, $t$Close$t$,
 $t$Thank you for your time, do you have any questions before we end this call? Have a great day!$t$,
 array['I CARE']::text[], $t$$t$, $t$Glad I called.$t$, false)
) as v(module_slug, code, sort_order, title, script_text, tones, coaching, feel, verbatim)
where m.slug = v.module_slug and s.slug = 'openers'
on conflict (module_id, segment_code) do update set
  script_text = excluded.script_text, tones = excluded.tones, coaching = excluded.coaching,
  client_should_feel = excluded.client_should_feel, verbatim = excluded.verbatim,
  title = excluded.title, sort_order = excluded.sort_order;

insert into public.segments
  (module_id, segment_code, sort_order, title, script_text, tones, coaching, client_should_feel, verbatim, status)
select m.id, v.code, v.sort_order, v.title, v.script_text, v.tones, nullif(v.coaching, ''), nullif(v.feel, ''), v.verbatim, 'published'
from public.modules m
join public.scripts s on s.id = m.script_id
cross join (values
($t$opn-greet-es$t$, 'OPNES-001', 10, $t$Saludo$t$,
 $t$Gracias por llamar a LionSide Financial, [su nombre] le saluda, ¿cómo le puedo ayudar?$t$,
 array['AC']::text[], $t$Busque el ID de la llamada mientras saluda.$t$, $t$$t$, false),
($t$opn-greet-es$t$, 'OPNES-002', 20, $t$Código de referencia$t$,
 $t$Perfecto, con gusto le ayudaré. Por favor, bríndeme el código de referencia o el número de ID; lo puede encontrar en (la ubicación exacta en la carta) de la carta que usted recibió.$t$,
 array['PT']::text[], $t$$t$, $t$$t$, false),
($t$opn-greet-es$t$, 'OPNES-003', 30, $t$Confirmar al cliente$t$,
 $t$Excelente, ¿estoy hablando con [nombre del cliente]?$t$,
 array['AC']::text[], $t$$t$, $t$$t$, false),
($t$opn-intro-es$t$, 'OPNES-004', 10, $t$Información básica$t$,
 $t$Excelente. Lo primero que necesitamos hacer es tomar información básica de usted, [nombre del cliente], así nosotros podemos determinar cuáles son las mejores tarifas para usted. Una vez aprobada, usted puede continuar con el proceso del préstamo tan pronto como hoy mismo, ¿ok?$t$,
 array['PT','RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-intro-es$t$, 'OPNES-005', 20, $t$Lo que ofrece LionSide$t$,
 $t$LionSide le ofrece acceso a varias opciones de préstamos, lo que le permite obtener la mejor tasa de interés, los mejores términos y el pago mensual más conveniente. Una vez aprobado su préstamo, tendrá un solo préstamo con un pago mensual bajo. ¿Le parece bien?$t$,
 array['AC']::text[], $t$$t$, $t$$t$, false),
($t$opn-intro-es$t$, 'OPNES-006', 30, $t$Revisión leve$t$,
 $t$Nosotros realizamos una revisión leve para calificarlo, lo que significa que no aparecerá como una revisión en su reporte crediticio y tampoco afectará su puntaje de crédito. La aplicación es un proceso bastante corto y sencillo y usted tendría una respuesta en 2 horas o menos. Empecemos con su aplicación, ¿está bien?$t$,
 array['CALM','RM']::text[], $t$Línea de cumplimiento: dígala tal como está escrita.$t$, $t$$t$, true),
($t$opn-verify-es$t$, 'OPNES-007', 10, $t$Confirmar nombre y dirección$t$,
 $t$Solo para confirmar, ¿estoy hablando con [nombre y apellido] que vive en la siguiente dirección: [dirección, incluyendo ciudad, estado y código postal]?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-verify-es$t$, 'OPNES-008', 20, $t$Ortografía$t$,
 $t$¿Podría confirmar que su nombre y dirección aparecen escritos correctamente en la carta que recibió?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-verify-es$t$, 'OPNES-009', 30, $t$Segundo nombre$t$,
 $t$Gracias. ¿Tiene un segundo nombre? Si es así, ¿podría deletrearlo, por favor?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-housing-es$t$, 'OPNES-010', 10, $t$Tiempo en la dirección$t$,
 $t$¡Excelente! ¿Cuánto tiempo tiene viviendo en esta dirección?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-housing-es$t$, 'OPNES-011', 20, $t$Renta o propietario$t$,
 $t$Está bien, ¿usted renta o es propietario?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-housing-es$t$, 'OPNES-012', 30, $t$Hipoteca o renta$t$,
 $t$¿Cuánto aproximadamente paga usted por la hipoteca o el pago de su renta?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-contact-es$t$, 'OPNES-013', 10, $t$Teléfono principal$t$,
 $t$Tengo acá que su número telefónico es [número telefónico]. ¿Ese es el mejor número telefónico para contactarlo?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-contact-es$t$, 'OPNES-014', 20, $t$Teléfono alterno$t$,
 $t$¿Cuál es el número alterno para contactarlo?$t$,
 array['RM']::text[], $t$Repita el número telefónico para confirmar que esté correcto.$t$, $t$$t$, false),
($t$opn-contact-es$t$, 'OPNES-015', 30, $t$Mejor hora$t$,
 $t$Gracias, ¿cuál es la mejor hora para llamarle? ¿Podemos comunicarnos con usted en cualquier momento?$t$,
 array['RM']::text[], $t$Si el cliente solicita un horario específico, anótelo y explique: 'El especialista financiero trabaja de 7:00 AM a 5:00 PM, hora del Pacífico, pero voy a dejar anotado el horario que usted prefiere, ¿está bien?'$t$, $t$$t$, false),
($t$opn-contact-es$t$, 'OPNES-016', 40, $t$Correo electrónico$t$,
 $t$Está bien, [nombre del cliente], ¿cuál es su correo electrónico?$t$,
 array['RM']::text[], $t$Repita el correo electrónico y confirme cómo se escribe.$t$, $t$$t$, false),
($t$opn-employment-es$t$, 'OPNES-017', 10, $t$Empleador$t$,
 $t$Gracias, ¿cómo se llama la compañía para la que usted trabaja?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-employment-es$t$, 'OPNES-018', 20, $t$Cargo$t$,
 $t$¿Qué cargo desempeña en la compañía?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-employment-es$t$, 'OPNES-019', 30, $t$Tiempo de empleo$t$,
 $t$¿Cuánto tiempo tiene usted de trabajar ahí?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-employment-es$t$, 'OPNES-020', 40, $t$Tiempo completo o parcial$t$,
 $t$¿Trabaja a tiempo completo o a tiempo parcial?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-employment-es$t$, 'OPNES-021', 50, $t$Ingresos$t$,
 $t$¿Cuánto es su ingreso mensual o anual antes de deducciones?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-employment-es$t$, 'OPNES-022', 60, $t$Gastos adicionales$t$,
 $t$Gracias. ¿Usted tiene gastos adicionales como otra hipoteca, préstamo por vehículo o pensión alimenticia?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-employment-es$t$, 'OPNES-023', 70, $t$Cuentas bancarias$t$,
 $t$¿Usted tiene cuenta bancaria de ahorro o corriente, o ambas?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-final-es$t$, 'OPNES-024', 10, $t$Ciudadanía$t$,
 $t$¿Es usted ciudadano americano, residente permanente o temporal?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-final-es$t$, 'OPNES-025', 20, $t$Militar$t$,
 $t$¿Es usted o ha sido militar activo?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-final-es$t$, 'OPNES-026', 30, $t$Ya casi terminamos$t$,
 $t$Muchas gracias, ya casi terminamos, solo tengo dos preguntas más...$t$,
 array['S']::text[], $t$$t$, $t$$t$, false),
($t$opn-final-es$t$, 'OPNES-027', 40, $t$Fecha de nacimiento$t$,
 $t$¿Cuál es su fecha de nacimiento?$t$,
 array['RM']::text[], $t$Repita la fecha para confirmar que esté correcta.$t$, $t$$t$, false),
($t$opn-final-es$t$, 'OPNES-028', 50, $t$Últimos 4 dígitos$t$,
 $t$¿Y finalmente podría brindarme los últimos 4 dígitos de su seguro social?$t$,
 array['CALM','RM']::text[], $t$Repita los cuatro dígitos para confirmar que estén correctos.$t$, $t$$t$, false),
($t$opn-consents-es$t$, 'OPNES-029', 10, $t$Permiso para enviar$t$,
 $t$Perfecto, ahora, ¿nos brinda permiso de ingresar su aplicación a nuestra plataforma de préstamos con la única intención de calificarlo para su préstamo personal?$t$,
 array['CALM']::text[], $t$Línea de cumplimiento: dígala tal como está escrita.$t$, $t$$t$, true),
($t$opn-consents-es$t$, 'OPNES-030', 20, $t$Permiso de contacto$t$,
 $t$En el evento que uno de nuestros prestamistas o terceros necesite contactarse con usted en referencia a esta aplicación, ¿usted brinda permiso para que se comuniquen con usted ya sea por teléfono, mensaje de texto o correo electrónico al número o dirección electrónica que nos brindó?$t$,
 array['CALM']::text[], $t$Línea de cumplimiento. El cliente tiene que decir SÍ.$t$, $t$$t$, true),
($t$opn-handoff-es$t$, 'OPNES-031', 10, $t$Aplicación enviada$t$,
 $t$Excelente, su aplicación ha sido enviada exitosamente. El especialista financiero con quien hablará forma parte de nuestro equipo aquí en LionSide. ¿Tiene a mano papel y lápiz para anotar su número directo? De cualquier forma usted va a tener noticias nuestras en dos horas o menos. Permítame darle el número telefónico del especialista financiero: [número].$t$,
 array['AC']::text[], $t$$t$, $t$$t$, false),
($t$opn-handoff-es$t$, 'OPNES-032', 20, $t$Cierre$t$,
 $t$¿Tiene alguna pregunta antes de finalizar la llamada? Muchas gracias por su tiempo. ¡Que tenga un excelente día!$t$,
 array['I CARE']::text[], $t$$t$, $t$$t$, false)
) as v(module_slug, code, sort_order, title, script_text, tones, coaching, feel, verbatim)
where m.slug = v.module_slug and s.slug = 'openers'
on conflict (module_id, segment_code) do update set
  script_text = excluded.script_text, tones = excluded.tones, coaching = excluded.coaching,
  client_should_feel = excluded.client_should_feel, verbatim = excluded.verbatim,
  title = excluded.title, sort_order = excluded.sort_order;

insert into public.segments
  (module_id, segment_code, sort_order, title, script_text, tones, coaching, client_should_feel, verbatim, status)
select m.id, v.code, v.sort_order, v.title, v.script_text, v.tones, nullif(v.coaching, ''), nullif(v.feel, ''), v.verbatim, 'published'
from public.modules m
join public.scripts s on s.id = m.script_id
cross join (values
($t$opn-rb-stall$t$, 'OPNRB-001', 10, $t$Let me think about it$t$,
 $t$What questions or concerns do you have? (Based on what they say, give the matching rebuttal.) ... I completely understand, and the GREAT thing about our company is that you have better odds at getting a lower interest rate PLUS there's no obligation in taking the offer, so I'm confident you'll get the answers you're looking for. Sound good?$t$,
 array['I CARE','AC']::text[], $t$Ask what their questions or concerns are FIRST, then rebuttal. End on a tie-down.$t$, $t$$t$, false),
($t$opn-rb-stall$t$, 'OPNRB-002', 20, $t$I'll call you back$t$,
 $t$What questions or concerns do you have? (Based on what they say, give the matching rebuttal.) ... I understand, and by submitting the application there are no strings attached to accept any offer. You'll get to know different loan options so you can decide which one you'd like to take advantage of, and remember this is a soft pull so it won't affect your credit score. Sounds good?$t$,
 array['RM']::text[], $t$Ask what their questions or concerns are first.$t$, $t$$t$, false),
($t$opn-rb-stall$t$, 'OPNRB-003', 30, $t$I'm not interested$t$,
 $t$What are your questions or concerns? (Based on what they say, give the matching rebuttal.)$t$,
 array['I CARE']::text[], $t$Don't accept the no until you know what's behind it.$t$, $t$$t$, false),
($t$opn-rb-stall$t$, 'OPNRB-004', 40, $t$Let me talk to my spouse$t$,
 $t$What questions or concerns do you have? (Based on what they say, give the matching rebuttal.) ... Ok, no problem, I understand. What I can do for you is help you out with the application. There's no commitment and no obligation on accepting any loan terms; remember this is a soft pull. You'll get to know your loan options, and you can have your spouse on the line once the Financial Specialist calls so you both can get to know your options and make your decision way easier. Ok?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-stall$t$, 'OPNRB-005', 50, $t$I'd like to research first$t$,
 $t$What questions or concerns do you have? (Based on what they say, give the matching rebuttal.) ... Ok great, you can check us out at www.lionsidefinancial.com now if you want some solid information about what we can offer you. The Financial Specialist will be able to help you research options that can work for you. Plus we've been in business for over 7 years. Okay?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-stall$t$, 'OPNRB-006', 60, $t$Too busy, call me in a little$t$,
 $t$This will only take about 3 minutes, it's really quick, and then I'll schedule a call back for the Financial Specialist at your best convenient time. Ok? ... (If they still can't:) Okay, no problem. When is the best time to reach you?$t$,
 array['S','AC']::text[], $t$Set urgency with your tonality and pace.$t$, $t$$t$, false),
($t$opn-rb-stall$t$, 'OPNRB-007', 70, $t$My offer doesn't expire yet$t$,
 $t$I understand, and yes, the offer gives you a month. However, interest rates or loan terms can change unexpectedly, and acting now ensures you're ahead of any changes. We wouldn't want you to miss out on more favorable terms. Plus the application only takes about 5 minutes, and I'll guide you through every step to make it easy. Once it's done, you'll be in a better position to decide. Okay?$t$,
 array['S']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-stall$t$, 'OPNRB-008', 80, $t$Not interested, I lost my job$t$,
 $t$I'm sorry that happened. The FS can still provide affordable options for you, and you don't have to accept the offer. This way you can hold off and take the offer once you do have a job. Does that sound good?$t$,
 array['I CARE']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-stall$t$, 'OPNRB-009', 90, $t$Going with another company or my bank$t$,
 $t$Ok, no problem! If you decide to move forward with your offer with us, just remember that no one gets left behind. Everyone that processes an application gets paired with a lender or bank that we work with, so why not see if we can get you a better offer, and you can compare?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-trust$t$, 'OPNRB-010', 10, $t$Bad reviews$t$,
 $t$I completely understand, and it's actually a common mix-up. We've seen reviews for a different company with a similar name, but we're not affiliated with them in any way. Our company has proudly served clients for over 7 years, and we're committed to providing a great experience. I'd be happy to help you with your loan, okay?$t$,
 array['CALM','AC']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-trust$t$, 'OPNRB-011', 20, $t$How did you get my information?$t$,
 $t$Great question! Our Marketing Department works with the credit reporting agencies, and you have met the criteria to be pre-approved for a personal loan and to see if you would benefit from one. Okay? ... (If needed:) We have not run your credit yet, and those debt amounts are an estimate. Our marketing department works with a pre-screen from Equifax, so we have an estimate of your debts; based on that we determine whether or not we can help you out, ok?$t$,
 array['AC']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-trust$t$, 'OPNRB-012', 30, $t$Is this a scam?$t$,
 $t$No, we are not a scam. Our collective companies have been in business for over 7 years, and I'll be happy to assist. Okay? ... I completely understand where you're coming from. You can review our website at www.lionsidefinancial.com. Plus every lender and bank we work with is required to be A+ rated with the BBB, and we're here to help, okay?$t$,
 array['CALM','AC']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-trust$t$, 'OPNRB-013', 40, $t$Are you on the BBB?$t$,
 $t$No, we are not. However, our collective companies have been in business for over 7 years, plus all the lenders and banks we work with are in the BBB and A+ accredited, okay?$t$,
 array['AC']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-trust$t$, 'OPNRB-014', 50, $t$Why aren't you BBB accredited?$t$,
 $t$LionSide doesn't pay for BBB accreditation, but you can google LionSide Financial Delaware to check out our reviews. In order for a lender to be in our network they must have an A+ rating with the BBB. You will be able to verify lender info on the BBB prior to accepting loan terms. Okay?$t$,
 array['AC']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-trust$t$, 'OPNRB-015', 60, $t$Who are you? Tell me about your company$t$,
 $t$Great question! We are a lending referral network, providing different loan options. Our network consists of over 20 different lenders and banks, and each one of them must have an A+ rating with the BBB. We work with lenders such as Lending Club, Avant and Springleaf, among others. Once the FS calls you presenting the loan options, they will provide all the information about the lender. Sounds good?$t$,
 array['AC']::text[], $t$Early in the call, go into the first part of the script instead. Read this if they ask during the application or at the end.$t$, $t$$t$, false),
($t$opn-rb-trust$t$, 'OPNRB-016', 70, $t$How long have you been in business?$t$,
 $t$Our collective companies have been in business for over 7 years, okay?$t$,
 array['AC']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-trust$t$, 'OPNRB-017', 80, $t$Where are you located?$t$,
 $t$We are located in Delaware, but we mainly work remote, okay? ... (If they push or ask if you work overseas:) Yes, I do work overseas, but our main office is in Delaware, and I'll be happy to help, okay?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-trust$t$, 'OPNRB-018', 90, $t$Is your office in my county?$t$,
 $t$Great question! The return address is from a local address because our marketing department tracks our letters by state. Okay? ... Rest assured that our company is registered in the state of Delaware, and we're here to help you, okay?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-trust$t$, 'OPNRB-019', 100, $t$Can I come in and talk to you?$t$,
 $t$No, this is a secure facility, and you need a security card to enter the building. All our applications are finalized over the phone, and it is secure. Ok?$t$,
 array['AC']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-trust$t$, 'OPNRB-020', 110, $t$I only want to apply in person$t$,
 $t$That's a great question! The application is done over the phone. Rest assured we use an encrypted system, and the FS can see if there's a local lender or bank in your area, ok?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-trust$t$, 'OPNRB-021', 120, $t$Can I do this online?$t$,
 $t$Excellent question, you can always visit our website to get information about who we are and what we do. The application is submitted over the phone. You can rest assured that our lines are secure and we also use an encrypted system. Okay?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-trust$t$, 'OPNRB-022', 130, $t$Skeptical: you're a lending network (start of call)$t$,
 $t$The great thing about our company is that you have better odds of getting the interest rate that's on your offer, plus you'll only get 1 phone call. Okay?$t$,
 array['AC']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-trust$t$, 'OPNRB-023', 140, $t$Skeptical: lending network (during disclaimers)$t$,
 $t$The great thing is you will get only 1 call from the FS that will present all the affordable options for you, okay?$t$,
 array['AC']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-trust$t$, 'OPNRB-024', 150, $t$Cold feet about a 3rd party$t$,
 $t$The term 'third party' just means someone besides yourself, like a financial specialist within our team. They're with the same company as us. Okay?$t$,
 array['CALM']::text[], $t$After the 2nd disclaimer.$t$, $t$$t$, false),
($t$opn-rb-credit$t$, 'OPNRB-025', 10, $t$Hard pull or soft pull?$t$,
 $t$The good news is, it's going to be a soft pull. Meaning, it is not going to affect your credit score. Sounds good? ... We can GUARANTEE that it won't affect your credit score since we go through Equifax, okay?$t$,
 array['AC']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-credit$t$, 'OPNRB-026', 20, $t$Which bureau do you pull from?$t$,
 $t$We pull your credit report from Equifax, and this will not affect your credit score, okay?$t$,
 array['AC']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-credit$t$, 'OPNRB-027', 30, $t$Can you read me my credit score?$t$,
 $t$Great question! I don't have access to that. But the FS will have that available and have your options available as well, okay?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-credit$t$, 'OPNRB-028', 40, $t$I have really bad credit$t$,
 $t$I completely understand, and even with bad credit, the FS is still going to provide affordable options for you, so we're here to help, okay?$t$,
 array['I CARE','AC']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-credit$t$, 'OPNRB-029', 50, $t$I thought this was a real check?$t$,
 $t$Great question! You have been pre-approved, and the FS will review your options with you. The GREAT NEWS is that you have met the criteria; now we just need to confirm we're speaking with the correct person, okay?$t$,
 array['AC']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-credit$t$, 'OPNRB-030', 60, $t$It says I'm pre-approved!$t$,
 $t$That's correct, you're pre-approved! Once we submit the application, we'll have a clear picture of your total debts. Based on that information, the financial specialist will present loan options tailored to your needs. You'll then be able to choose the option that works best for you. PLUS you've already met the criteria for a loan. Does that sound good? ... That's right, you are pre-qualified; in order to get final approval for your loan, we have to submit an application, and to do that we need to collect some basic information from you and verify a few things to make sure we are helping and identifying the right person. Ok?$t$,
 array['AC']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-credit$t$, 'OPNRB-031', 70, $t$If I'm approved, why pull my credit?$t$,
 $t$You are pre-approved, and the great news is you have met the criteria for the loan offer. Now we just need to confirm we're speaking to the right person. We pull your credit to check your credit history and debt amounts; this way we can know the exact numbers for everything, okay?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-loan$t$, 'OPNRB-032', 10, $t$Are you the lender?$t$,
 $t$That's a great question, and we are a lending referral network. The great thing about us is we work with over 20 different lenders and banks, so you have better odds at getting a lower interest rate with us. Okay?$t$,
 array['AC']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-loan$t$, 'OPNRB-033', 20, $t$Who is in the lending network?$t$,
 $t$Our network consists of over 20 lenders. Some of our lenders are Lending Club, Avant, Springleaf and many more. You will be paired with the lender that offers the best rate and program for your needs. Ok?$t$,
 array['AC']::text[], $t$If they ask before the disclaimers.$t$, $t$$t$, false),
($t$opn-rb-loan$t$, 'OPNRB-034', 30, $t$Is this a secured loan?$t$,
 $t$Good question! This is an unsecured loan, meaning no collateral is needed. Okay?$t$,
 array['AC']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-loan$t$, 'OPNRB-035', 40, $t$Will it cover my car or other loans?$t$,
 $t$Yes, if approved then the loan will pay off [the debt they named]. Sounds good?$t$,
 array['AC']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-loan$t$, 'OPNRB-036', 50, $t$What if I don't qualify?$t$,
 $t$Great question! This means that the FS will have multiple options for you even if you happen to get declined, okay?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-loan$t$, 'OPNRB-037', 60, $t$What qualifications do I need?$t$,
 $t$That's a great question, and we factor multiple things like your debts and making payments on time. The FS will review everything and ensure that they give you affordable options best suited for you, okay?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-loan$t$, 'OPNRB-038', 70, $t$Highest rate if not 4.99%?$t$,
 $t$That is a great question. The purpose of our offer is to give you affordable options, better than the one you have with your current creditors, okay?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-loan$t$, 'OPNRB-039', 80, $t$Is my offer amount or 4.99% what I'll get?$t$,
 $t$Great question! You are applying for that, and now we just need to confirm we're speaking with the correct person. Okay?$t$,
 array['PT']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-loan$t$, 'OPNRB-040', 90, $t$Can I change the amount or term?$t$,
 $t$Yes, that is possible! Make sure to bring that up with the FS, and they will ensure they'll provide you an option that is more suitable for you, okay?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-loan$t$, 'OPNRB-041', 100, $t$Personal loan or debt consolidation?$t$,
 $t$For sure, you can apply for either one! The FS can even review both options for you if you'd like. Sound good? ... (If they ask which this is:) Great question! It would be either one, and the FS will review all the options with you, okay?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-loan$t$, 'OPNRB-042', 110, $t$What's the difference?$t$,
 $t$Excellent question! A personal loan is going to be up to you on what you'd like to pay off; it could be used for debts or any personal use. A debt consolidation loan is only used towards your debts, like personal loans, credit cards and medical bills. Okay?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-loan$t$, 'OPNRB-043', 120, $t$Payments on the letter don't add up$t$,
 $t$Okay, most likely it is showing you the extended term option beyond 60 months, and depending on your situation you can discuss with your financial specialist what payment options will work for you. Okay?$t$,
 array['CALM']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-loan$t$, 'OPNRB-044', 130, $t$Do my credit cards need to be closed?$t$,
 $t$Great question! No, they do not need to be closed, and the FS will review that with you as well. Okay?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-loan$t$, 'OPNRB-045', 140, $t$Are any documents required?$t$,
 $t$Great question! We do not require any documents; everything is done over the phone with me and also with the FS, okay?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-info$t$, 'OPNRB-046', 10, $t$What's needed for the application?$t$,
 $t$It's a simple process. We need to ask you some employment questions and verify your identity with only the last 4 of your SSN, okay?$t$,
 array['PT']::text[], $t$Then go back to the script.$t$, $t$$t$, false),
($t$opn-rb-info$t$, 'OPNRB-047', 20, $t$I'm not comfortable giving my social$t$,
 $t$I understand your concern, and we ONLY need the last 4 of your social, PLUS we use an encrypted system, okay? ... I totally understand. A social security number is required every time you apply for any loan, and for the protection of our clients, we only require the last four digits, which is more secure. Sounds fair enough?$t$,
 array['CALM','RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-info$t$, 'OPNRB-048', 30, $t$I don't want to give you my information$t$,
 $t$I understand, and we need to ensure we're speaking to the correct person, so this is for your protection, okay?$t$,
 array['CALM']::text[], $t$Before you ask for the social.$t$, $t$$t$, false),
($t$opn-rb-info$t$, 'OPNRB-049', 40, $t$I don't want to give my email$t$,
 $t$I understand, but in order to receive any loan offers we do need an email address to proceed. We will not put you on any marketing lists. Okay? ... (If still no:) Okay, would you like me to call back once you have an email address that you can provide?$t$,
 array['RM']::text[], $t$Schedule a call back time if they still won't.$t$, $t$$t$, false),
($t$opn-rb-info$t$, 'OPNRB-050', 50, $t$I don't have an email$t$,
 $t$Okay, can I have your spouse's email or a family member's?$t$,
 array['RM']::text[], $t$Wait for them to provide it, or schedule a call back.$t$, $t$$t$, false),
($t$opn-rb-info$t$, 'OPNRB-051', 60, $t$Won't give the client ID$t$,
 $t$Okay, I'd be happy to help. What is the client ID on your letter? ... Okay, and in order for me to answer your questions I do need the client ID to provide you the most accurate information, okay? ... Okay, I apologize for any inconvenience. Please give us a call once you're ready to provide the ID so we can assist you. Thank you!$t$,
 array['RM']::text[], $t$Then hang up and mark it Dead: No reference ID.$t$, $t$$t$, false),
($t$opn-rb-others$t$, 'OPNRB-052', 10, $t$Someone else calls for the client$t$,
 $t$Can I speak with the client, please, to get authorization? ... (If they aren't there:) Okay, no problem. Please call us back once the client is there so we can get you authorized. Thank you! ... (If they are there:) Hello [client name], do you grant them permission to speak on your behalf?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-others$t$, 'OPNRB-053', 20, $t$Can I add my spouse to the application?$t$,
 $t$Yes, of course! Are they there so I can get authorization to add them, please? ... (If not:) Okay, no problem! I can do the application with you now, and then the FS can add them later on when they are with you, okay?$t$,
 array['RM']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-after$t$, 'OPNRB-054', 10, $t$Haven't heard from the FS$t$,
 $t$I understand. Have you tried calling them back? ... (If no:) Okay, please call them at [FS number]. ... (If yes:) Okay, they've been experiencing high call volume. I'll pass this info to management so they can call you soon. Thank you!$t$,
 array['I CARE']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-after$t$, 'OPNRB-055', 20, $t$Status shows Loan Approved$t$,
 $t$We sent the instructions via email. All you need to do is follow the steps there for your loan, okay? ... (If they're upset with the email process:) You've been preselected to access our lender platform. This allows you to bypass our underwriters and go direct to the lenders. It also allows you to get funding faster. Okay?$t$,
 array['AC']::text[], $t$Do not provide the FS number.$t$, $t$$t$, false),
($t$opn-rb-after$t$, 'OPNRB-056', 30, $t$Wants to cancel after submitting$t$,
 $t$I understand. Keep in mind that this is for you to hear out your loan offers. If you like what you hear, then you can move forward with the best option for you. Also, there is no obligation and this doesn't affect your credit score, okay?$t$,
 array['CALM']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-smartcredit$t$, 'OPNRB-057', 10, $t$Security questions$t$,
 $t$We are almost done. Now, for compliance and security purposes we need to confirm your identity, and the system gives us 2 options: you can answer security questions, or I can send you a one-time code to your cell phone. Which one would you like?$t$,
 array['CALM']::text[], $t$When you need to go through security questions (SC steps from the CRM).$t$, $t$$t$, false),
($t$opn-rb-smartcredit$t$, 'OPNRB-058', 20, $t$Thrown off by the security questions$t$,
 $t$I understand, and we pull these questions through Equifax. These questions are designed to ensure we are speaking to the right person, and some of these questions may be inapplicable to you, okay?$t$,
 array['CALM']::text[], $t$$t$, $t$$t$, false),
($t$opn-rb-smartcredit$t$, 'OPNRB-059', 30, $t$SmartCredit error: need the full SSN$t$,
 $t$We are having an issue retrieving the credit report and we need to verify your info with Equifax. Can you verify your date of birth for me one more time? Okay, and now your zip code? And lastly, the first 5 digits of your SSN?$t$,
 array['CALM','RM']::text[], $t$CIC error: verify the client's name, address, date of birth, SSN and spelling.$t$, $t$$t$, false)
) as v(module_slug, code, sort_order, title, script_text, tones, coaching, feel, verbatim)
where m.slug = v.module_slug and s.slug = 'openers'
on conflict (module_id, segment_code) do update set
  script_text = excluded.script_text, tones = excluded.tones, coaching = excluded.coaching,
  client_should_feel = excluded.client_should_feel, verbatim = excluded.verbatim,
  title = excluded.title, sort_order = excluded.sort_order;

notify pgrst, 'reload schema';

-- Check: sections and lines loaded.
select m.language, m.kind, count(distinct m.id) as sections, count(g.id) as lines
from public.modules m join public.scripts s on s.id = m.script_id left join public.segments g on g.module_id = m.id
where s.slug = 'openers' group by 1, 2 order by 1, 2;
