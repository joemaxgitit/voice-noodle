-- ============================================================
-- Bolton Llamada de 90 días — Spanish. Word for word.
-- Run AFTER am-schema.sql and sections.sql. Safe to re-run.
--
-- NOTE: this version has EIGHT debt statuses, not the English seven.
-- It restores "Wait for initial Dispute Response" (absent from the
-- Spanish 60-day) and adds "Wait for NOIR response", which appears
-- nowhere in the English scripts.
-- ============================================================

insert into public.segments
  (module_id, segment_code, sort_order, section, title, script_text, tones,
   coaching, client_should_feel, verbatim, status)
select m.id, v.code, v.sort_order, v.section, v.title, v.script_text, v.tones,
       v.coaching, v.feel, v.verbatim, 'published'
from public.modules m
join public.scripts s on s.id = m.script_id
cross join (values

-- Sección 1: Introducción a la llamada mensual

('am-90-es', 'AM90ES-001', 10, $t$Introducción a la llamada mensual$t$, $t$Abrir el expediente$t$,
 $t$Soy [su nombre] de Bolton Services Group. ¿Podría darme un minuto para que pueda abrir su expediente? Muy bien.$t$,
 array['CALM'],
 $t$DESPACIO. Three months in, this is still the first thing they hear after a month of silence.$t$,
 $t$Me está llamando mi persona.$t$, false),

('am-90-es', 'AM90ES-002', 20, $t$Introducción a la llamada mensual$t$, $t$¿Cómo ha estado?$t$,
 $t$Hola [Nombre del cliente]. ¿Cómo ha estado?$t$,
 array['I CARE'],
 $t$Wait for the client's response. A real one.$t$,
 $t$De verdad quieren saber.$t$, false),

('am-90-es', 'AM90ES-003', 30, $t$Introducción a la llamada mensual$t$, $t$Objetivo y preguntas$t$,
 $t$Muy bien. El objetivo de nuestra llamada de hoy es discutir el estado de sus cuentas inscritas, cualquier documento y llamadas que pueda estar recibiendo, y continuar con la parte de Bienestar Financiero del programa. ¿Le parece bien? Antes de empezar, ¿tiene alguna pregunta fuera de nuestros temas habituales?$t$,
 array['AC','I CARE'],
 $t$Answer whatever they raise before you start.$t$,
 $t$Hay espacio para mis preguntas.$t$, false),

-- Sección 2: Estado de la deuda

('am-90-es', 'AM90ES-004', 40, $t$Estado de la deuda$t$, $t$Cuándo esperar cartas$t$,
 $t$30 días de retraso - esta cuenta va a empezar a ser puesta en el proceso de recolección del acreedor. Su próximo estado de cuenta probablemente se verá un poco diferente de lo normal. 60 días de retraso - Probablemente recibirá un estado de cuenta adicional entre periodos. 90-120 días de retraso - Este es el momento en el que pueden vender su cuenta a un recolector de deudas de terceros. Es probable que reciba pronto esa carta de recolecciones que estamos buscando. Así que esté atento/a en caso de recibir una.$t$,
 array['PT'],
 $t$Open the Deudas/Acreedores tab and Smart Credit. Only say the stage that applies to their accounts.$t$,
 $t$La carta que da miedo es buena noticia.$t$, false),

('am-90-es', 'AM90ES-005', 50, $t$Estado de la deuda$t$, $t$Estado — Fully Disputed$t$,
 $t$Tenemos [lista de acreedores] totalmente disputada. El proceso de disputa se ha completado con los cobradores, pero si en el futuro recibe alguna carta relacionada con la(s) cuenta(s), no se preocupe. Envíelas y continuaremos el proceso por usted.$t$,
 array['AC'],
 $t$Only read the statuses that apply to their file.$t$,
 $t$Esa ya está resuelta.$t$, false),

('am-90-es', 'AM90ES-006', 60, $t$Estado de la deuda$t$, $t$Estado — Wait for initial Dispute Response$t$,
 $t$Esto significa que recibimos la información del cobrador que usted nos envió o que encontramos en su reporte crediticio, y actualmente estamos exigiendo al cobrador que demuestre que tiene derecho a cobrar su deuda. La mayoría de las veces verá que este estado cambia en los próximos 60 días.$t$,
 array['AC'],
 $t$Weight "exigiendo". This status is missing from the Spanish 60-day script but present here.$t$,
 $t$Alguien está a la ofensiva por mí.$t$, false),

('am-90-es', 'AM90ES-007', 70, $t$Estado de la deuda$t$, $t$Estado — Wait for Sold Package Response$t$,
 $t$La cuenta se disputó completamente con un cobrador, pero recibimos una nueva carta de una nueva agencia de recolección. Esta carta informa al nuevo cobrador de la disputa anterior y les solicita información adecuada para validar la deuda. A partir de ahora, continuaremos el proceso de disputa como de costumbre.$t$,
 array['CALM'],
 $t$A new collector feels like going backwards. Say "como de costumbre" like it is routine, because it is.$t$,
 $t$Esto no es un retroceso.$t$, false),

('am-90-es', 'AM90ES-008', 80, $t$Estado de la deuda$t$, $t$Estado — Wait for Response Type$t$,
 $t$Según las cartas de cobro/respuestas de validación que usted nos ha enviado, estamos trabajando activamente en su(s) cuenta(s) de [lista de acreedores]. Envíenos cualquier otra respuesta de ellos para que podamos asegurarnos de responder lo antes posible.$t$,
 array['AC'],
 $t$"Trabajando activamente" is only credible if you sound busy on their behalf.$t$,
 $t$Mi expediente no está en una pila.$t$, false),

('am-90-es', 'AM90ES-009', 90, $t$Estado de la deuda$t$, $t$Estado — Wait for NOIR response$t$,
 $t$El cobrador envió un intento de validación o respuesta al paquete de disputa, pero fue insuficiente para demostrar el derecho del cobrador a cobrar. Esta carta les informa de la insuficiencia y les da otros 30 días para intentar la validación de nuevo. Por lo tanto, esté atento a las nuevas cartas que pueda recibir del cobrador.$t$,
 array['PT'],
 $t$This status appears in no English script. It is good news dressed as a delay — the collector failed and got a second chance they will probably also miss. Land "fue insuficiente" and then the instruction to watch the mail.$t$,
 $t$El cobrador no pudo probarlo.$t$, false),

('am-90-es', 'AM90ES-010', 100, $t$Estado de la deuda$t$, $t$Estado — Took Action in Smartcredit Only$t$,
 $t$Parece que su cuenta [lista de acreedores] ha sido dada de baja. Les hemos solicitado información actualizada, así que asegúrese de estar atento a cualquier carta.$t$,
 array['PT'],
 $t$"Dada de baja" sounds alarming if unexplained. Say it flatly and move to the action.$t$,
 $t$Es un paso normal.$t$, false),

('am-90-es', 'AM90ES-011', 110, $t$Estado de la deuda$t$, $t$Estado — Under Attorney Review$t$,
 $t$Resolve Law Group fue capaz de iniciar una demanda por violación a sus derechos del consumidor por parte del acreedor/cobrador. No eliminamos estas deudas si la demanda tiene éxito; se consideran resueltas por nuestra parte, ya que el cliente estaba en conexión con RLG debido a nuestra referencia.$t$,
 array['PT'],
 $t$Say "no eliminamos estas deudas" clearly — letting them assume otherwise creates a dispute later.$t$,
 $t$Entiendo qué hace y qué no hace la demanda.$t$, true),

-- Sección 3: Cartas/llamadas de cobro  (sin summons en esta llamada)

('am-90-es', 'AM90ES-012', 120, $t$Cartas y llamadas de cobro$t$, $t$Cartas pendientes$t$,
 $t$¿Ha recibido alguna carta de cobro desde la última vez que hablamos que aún no haya enviado? ... Por favor, continúe enviando sus cartas para que podamos estar seguros de empezar a trabajar en sus cuentas lo antes posible.$t$,
 array['PT'],
 $t$Wait for the client's response. Clients sit on letters and only silence gets them to admit it.$t$,
 $t$Debería buscar esas cartas.$t$, false),

('am-90-es', 'AM90ES-013', 130, $t$Cartas y llamadas de cobro$t$, $t$¿Siguen llamando?$t$,
 $t$¿Cómo van las cosas con las llamadas telefónicas? ¿Ha recibido alguna desde la última vez que hablamos?$t$,
 array['I CARE'],
 $t$Genuine concern. Collection calls are the part that wears people down.$t$,
 $t$Saben cómo se siente esto.$t$, false),

('am-90-es', 'AM90ES-014', 140, $t$Cartas y llamadas de cobro$t$, $t$Llamadas — con RLG$t$,
 $t$¿Ha estado trabajando con Resolve Law Group para detenerlas? ... Me alegro. ¿Cómo van las cosas con ellos hasta ahora? ... ¡Genial! Me alegra ver que está involucrado en el proceso.$t$,
 array['AC'],
 $t$If it is going well, say so warmly.$t$,
 $t$Lo estoy haciendo bien.$t$, false),

('am-90-es', 'AM90ES-015', 150, $t$Cartas y llamadas de cobro$t$, $t$Llamadas — no van bien$t$,
 $t$¿Cuál es el problema?$t$,
 array['I CARE'],
 $t$Ask and stop. See how you can help.$t$,
 $t$Alguien va a resolver esto.$t$, false),

('am-90-es', 'AM90ES-016', 160, $t$Cartas y llamadas de cobro$t$, $t$Llamadas — aún no con RLG$t$,
 $t$Entonces tengo buenas noticias. Es posible que sea víctima de acreedores depredadores y que se le pueda conceder una indemnización por daños y percances. Podemos proporcionarle una consulta gratuita con Resolve Law Group. Son un bufete de abogados a nivel nacional con el que nos hemos asociado para ayudar a proteger los derechos legales de nuestros clientes. Esto a menudo resulta en que nuestros clientes como usted obtengan una indemnización cuando los acreedores infringen la ley. Puede encontrar su número de contacto en su Portal del Cliente, en la pestaña de Recursos. Por favor, llámeles cuando pueda ya que podría significar literalmente dinero en su bolsillo, así que no pierda esta oportunidad.$t$,
 array['AC'],
 $t$Lift on "buenas noticias". Offer to provide the number by phone or email: (818) 600-5386.$t$,
 $t$Esto podría pagarme.$t$, false),

('am-90-es', 'AM90ES-017', 170, $t$Cartas y llamadas de cobro$t$, $t$Llamadas — ninguna$t$,
 $t$¡Me alegro de oírlo! Si recibe más llamadas en el futuro, no dude en hacérmelo saber.$t$,
 array['AC'],
 $t$Short and genuinely pleased.$t$,
 $t$Se permiten buenas noticias.$t$, false),

('am-90-es', 'AM90ES-018', 180, $t$Cartas y llamadas de cobro$t$, $t$Seguimiento$t$,
 $t$¿Tiene alguna pregunta que hacerme antes de pasar al presupuesto?$t$,
 array['I CARE'],
 $t$Answer any questions the client may have before moving on.$t$,
 $t$Puedo detenerlos y preguntar.$t$, false),

-- Sección 4: Presupuesto

('am-90-es', 'AM90ES-019', 190, $t$Presupuesto$t$, $t$Abrir el presupuesto$t$,
 $t$Ahora, echemos un vistazo a su presupuesto, ¿okay?$t$,
 array['CALM'],
 $t$Short signpost. Budget talk makes people defensive, so arrive gently.$t$,
 $t$Es parte normal de la llamada.$t$, false),

('am-90-es', 'AM90ES-020', 200, $t$Presupuesto$t$, $t$¿Cambió algo este mes?$t$,
 $t$¿Ha tenido algún cambio en su presupuesto o gastos inesperados en el último mes?$t$,
 array['I CARE'],
 $t$Discuss it with the client. Note the Spanish 90-day drops the English questions about whether they started tracking and spotted high categories — this is the whole budget review here.$t$,
 $t$Puedo decirles si se puso difícil.$t$, false),

('am-90-es', 'AM90ES-021', 210, $t$Presupuesto$t$, $t$Ingresos positivos — ¿ahorró?$t$,
 $t$Si el cliente tiene ingresos netos positivos, ¿ha podido ahorrar algo durante el mes?$t$,
 array['CALM'],
 $t$Only if they have positive net income. Ask without implying what the answer should be.$t$,
 $t$Cualquier respuesta está bien.$t$, false),

('am-90-es', 'AM90ES-022', 220, $t$Presupuesto$t$, $t$Ahorró — si sí$t$,
 $t$¡Perfecto! Sigamos por buen camino.$t$,
 array['AC'],
 $t$Brief and genuinely pleased.$t$,
 $t$Eso contó.$t$, false),

('am-90-es', 'AM90ES-023', 230, $t$Presupuesto$t$, $t$Ahorró — si no$t$,
 $t$De acuerdo, uno de nuestros objetivos es conseguir su independencia financiera. Parte de esto será mediante la apertura de una cuenta de ahorros de emergencia en caso de que surja algo. Queremos que pueda pagar alguna emergencia con su propio dinero y no a crédito. ¿Cuánto cree que pueda comenzar a ahorrar razonablemente al mes? ... Muy bien, trabajemos en ello para el mes que viene, okay?$t$,
 array['CALM','RM'],
 $t$No disappointment in your voice. Let them name the number.$t$,
 $t$Yo puse esa meta, no ellos.$t$, false),

-- Sección 5: Cierre de la llamada mensual y próxima cita

('am-90-es', 'AM90ES-024', 240, $t$Cierre y próxima cita$t$, $t$Programar la próxima cita$t$,
 $t$Vamos a programar su próxima cita. Para nuestra próxima llamada... Permítame mirar mi agenda. ¿Qué le parece [día de la semana y fecha] a las [hora, su zona horaria]?$t$,
 array['CALM','RM'],
 $t$Refer to the best time to contact before proposing one.$t$,
 $t$Eso me queda bien.$t$, false),

('am-90-es', 'AM90ES-025', 250, $t$Cierre y próxima cita$t$, $t$Tarea$t$,
 $t$Antes de nuestra próxima llamada me gustaría que tuviera preparados [cantidad de meta de ahorro]. Además, deberá recibir las cartas de recolecciones muy pronto, así que no espere para enviárnoslas. Envíelas en cuanto las reciba, ¿Muy bien?$t$,
 array['PT'],
 $t$DESPACIO. These are the two things that decide whether next month moves the file forward.$t$,
 $t$Sé cuáles son mis dos tareas.$t$, false),

('am-90-es', 'AM90ES-026', 260, $t$Cierre y próxima cita$t$, $t$Cierre$t$,
 $t$Gracias por tomarse el tiempo el día de hoy y espero con entusiasmo nuestra próxima llamada. Tenga un lindo día y hasta pronto!$t$,
 array['CALM'],
 $t$Answer any questions before this. Then end warm and unhurried.$t$,
 $t$Fue una buena llamada.$t$, false)

) as v(module_slug, code, sort_order, section, title, script_text, tones, coaching, feel, verbatim)
where m.slug = v.module_slug and s.slug = 'bolton-am'
on conflict (module_id, segment_code) do update set
  script_text = excluded.script_text, tones = excluded.tones,
  coaching = excluded.coaching, client_should_feel = excluded.client_should_feel,
  verbatim = excluded.verbatim, section = excluded.section,
  title = excluded.title, sort_order = excluded.sort_order;
