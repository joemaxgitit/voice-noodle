-- ============================================================
-- Bolton Llamada de 30 días — Spanish. Word for word.
-- Run AFTER am-schema.sql and sections.sql. Safe to re-run.
--
-- Tracks the English 30-day script closely, with one substantive
-- difference: the Resolve Law Group branch sends a referral and has
-- RLG call the client, rather than giving the client a number to
-- dial. Flagged in the coaching on that card.
-- ============================================================

insert into public.segments
  (module_id, segment_code, sort_order, section, title, script_text, tones,
   coaching, client_should_feel, verbatim, status)
select m.id, v.code, v.sort_order, v.section, v.title, v.script_text, v.tones,
       v.coaching, v.feel, v.verbatim, 'published'
from public.modules m
join public.scripts s on s.id = m.script_id
cross join (values

-- Sección: Introducción

('am-30-es', 'AM30ES-001', 10, $t$Introducción$t$, $t$Buscar el archivo$t$,
 $t$Hola, soy [tu nombre] de Bolton Services Group. ¿Podría darme un minuto para que pueda buscar su archivo?$t$,
 array['CALM'],
 $t$Same opening as the 15-day. Familiar is the point — they should recognise the shape of your calls.$t$,
 $t$Es mi persona.$t$, false),

('am-30-es', 'AM30ES-002', 20, $t$Introducción$t$, $t$Objetivo de la llamada$t$,
 $t$¡Genial! El objetivo de nuestra llamada de hoy es repasar nuestros objetivos, empezar un plan para mejorar sus finanzas, resolver sus deudas y mejorar su crédito. Okay?$t$,
 array['AC','RM'],
 $t$Three outcomes, then a soft check.$t$,
 $t$Hay un plan.$t$, false),

('am-30-es', 'AM30ES-003', 30, $t$Introducción$t$, $t$Preguntas primero$t$,
 $t$Antes de comenzar, ¿tienes alguna pregunta para mí?$t$,
 array['I CARE'],
 $t$Pause for a real answer. Note the script uses tú here and usted elsewhere.$t$,
 $t$Puedo preguntar.$t$, false),

-- Sección: Llamadas y cartas de cobro

('am-30-es', 'AM30ES-004', 40, $t$Llamadas y cartas de cobro$t$, $t$¿Ya están llamando?$t$,
 $t$La mayoría de los acreedores llaman mucho en los primeros 2 meses en que una persona se atrasa con los pagos. Después de eso, las llamadas disminuyen y generalmente se detienen por completo después de 5 o 6 meses. ¿Ya está recibiendo llamadas de sus acreedores? ... ¿Ya habló con Resolve Law Group sobre cómo manejar las llamadas de cobro?$t$,
 array['CALM'],
 $t$Normalise it first, then ask, and wait for the client's response. A client being called feels singled out; the timeline tells them they are not.$t$,
 $t$Esto es normal, no un desastre.$t$, false),

('am-30-es', 'AM30ES-005', 50, $t$Llamadas y cartas de cobro$t$, $t$Si responde sí — va bien$t$,
 $t$Es bueno saberlo. ¿Cómo van las cosas con ellos hasta ahora? ... ¡Genial! ¡Me alegra ver que está involucrado/a en el proceso!$t$,
 array['AC'],
 $t$Genuine encouragement. An engaged client is the best predictor you have of one who finishes.$t$,
 $t$Lo estoy haciendo bien.$t$, false),

('am-30-es', 'AM30ES-006', 60, $t$Llamadas y cartas de cobro$t$, $t$Si responde sí — va mal$t$,
 $t$Muy bien. ¿Cuál es el problema?$t$,
 array['I CARE'],
 $t$Ask, then stop completely and listen. Find out what you can actually fix.$t$,
 $t$Alguien quiere resolver esto.$t$, false),

('am-30-es', 'AM30ES-007', 70, $t$Llamadas y cartas de cobro$t$, $t$Si responde no — Resolve Law Group$t$,
 $t$Bueno, entonces tengo muy buenas noticias. Puede ser víctima de acreedores abusivos y podría recibir una indemnización monetaria. Podemos brindarle una consulta gratuita con Resolve. Es un bufete de abogados a nivel nacional con el que nos hemos asociado para ayudar a proteger los derechos legales de nuestros clientes. Esto a menudo da como resultado que nuestros clientes como usted reciban un pago cuando los acreedores infringen la ley. Enviaré una referencia para que se comuniquen con usted lo antes posible. Llamarán desde un código de área (818), así que asegúrese de responder cuando llamen o de devolver la llamada si no está disponible. Literalmente podría significar dinero en su bolsillo, así que no pierda esta oportunidad.$t$,
 array['AC'],
 $t$Lift on "muy buenas noticias". Note this differs from the English script: here you send a referral and RLG calls the client, rather than giving the client the number to dial. Make the (818) area code land so they answer an unknown number.$t$,
 $t$Esto podría pagarme.$t$, false),

('am-30-es', 'AM30ES-008', 80, $t$Llamadas y cartas de cobro$t$, $t$Esto tomará tiempo$t$,
 $t$Ahora, quiero asegurarme de que sepa que su Plan de Bienestar Financiero tomará tiempo. Por lo general, se necesitan aproximadamente 2 años para recuperarse de los problemas relacionados con la deuda. Uno de nuestros objetivos es aumentar su puntaje crediticio, pero necesito asegurarme de que comprenda que es probable que su puntaje crediticio baje al principio. Pero eso está bien, porque primero trabajaremos en sus finanzas. Nuestro objetivo principal es ayudarlo/a a obtener la libertad financiera al comenzar un presupuesto, repasar formas de cómo ahorrar dinero y trabajar con usted en educación financiera. El indicador clave del éxito para mí es que realice los pagos del programa, ya que le ahorrarán dinero a largo plazo. Si hay un problema con sus pagos, nos indica que aún tenemos trabajo por hacer. Por lo tanto, mantenerlo/a por un buen camino es una prioridad para mí y espero que también lo sea para usted.$t$,
 array['CALM','PT'],
 $t$Say the credit drop plainly. Second time they have heard it, and it still needs to land without hedging.$t$,
 $t$Nadie me está vendiendo humo.$t$, true),

('am-30-es', 'AM30ES-009', 90, $t$Llamadas y cartas de cobro$t$, $t$La FDCPA, otra vez$t$,
 $t$Como recordatorio, las cartas de cobro son la clave para resolver sus deudas. Así que tan pronto como recibamos una carta de recolecciones de su parte, es cuando comienza el proceso de disputa. La Ley de Prácticas Justas en el Cobro de Deudas, conocida como FDCPA, es una ley diseñada específicamente por el Congreso para proteger a todos los consumidores contra los cobradores de deudas de terceros que no siguen las reglas. Según la FDCPA, tenemos el derecho de solicitar pruebas de que tienen toda la documentación archivada sobre su deuda ANTES de cobrar dinero. Sabemos que rara vez lo hacen y es por eso que tenemos una tasa de éxito tan alta. Su portal de clientes tiene información detallada sobre estas leyes, así como otros artículos para ayudarlo a navegar por el proceso y obtener su libertad financiera, y trabajaré con usted de cerca para brindarle esa información también. Entonces, este programa no solo lo ayudará a resolver sus deudas, sino que también recibirá una educación en el camino. ¿Qué le parece?$t$,
 array['AC'],
 $t$Weight ANTES. Do not read it like a repeat — they may not have absorbed it at fifteen days.$t$,
 $t$Hay una ley real detrás de esto.$t$, false),

('am-30-es', 'AM30ES-010', 100, $t$Llamadas y cartas de cobro$t$, $t$El aviso de 30 días$t$,
 $t$Las cartas más importantes que nos enviará serán de agencias de cobro de deudas de terceros. La ley FDCPA que analizamos define cuáles son sus derechos con ellos, lo que incluye su capacidad para disputar la validez de la deuda una vez que su cuenta pase a recolecciones. En esas cartas, verá esta frase: "A menos que nos notifique dentro de los 30 días de recibir este aviso que disputa la validez de esta deuda, asumiremos que esta deuda es válida". Una de las claves para resolver sus deudas es que tomemos medidas dentro de este período de 30 días. Por lo tanto, envíeme esas cartas tan pronto como las reciba. Puede subirlas al portal del cliente o enviarlas por correo electrónico como archivo adjunto a info@BoltonServiceGroup.com, aunque la mayoría de nuestros clientes encuentran más fácil tomar una foto con su teléfono inteligente y enviármelas por mensaje de texto. Una vez que las reciba, le enviaré un mensaje confirmando que lo recibimos. ¿Tiene alguna pregunta sobre cómo hacernos llegar los documentos?$t$,
 array['PT','AC'],
 $t$Statutory language — read the quoted phrase exactly and slow through it. Then lift into the urgency.$t$,
 $t$Hay un reloj y sé qué hacer.$t$, true),

-- Sección: Presupuesto y objetivos

('am-30-es', 'AM30ES-011', 110, $t$Presupuesto y objetivos$t$, $t$¿Tiene acceso al portal?$t$,
 $t$A continuación, revisaremos su presupuesto. ¿Tiene acceso a su Portal del cliente?$t$,
 array['CALM'],
 $t$Ask before you assume. The whole next stretch depends on the answer.$t$,
 $t$Pregunta sencilla.$t$, false),

('am-30-es', 'AM30ES-012', 120, $t$Presupuesto y objetivos$t$, $t$Si la respuesta es sí$t$,
 $t$Perfecto, revisemos su presupuesto juntos para que podamos tener una idea de cómo se ven sus finanzas mensuales, ¿de acuerdo? Vaya a su portal y, en el lado izquierdo, haga clic en la pestaña de presupuesto.$t$,
 array['CALM'],
 $t$One instruction, then wait for them to actually be there before continuing.$t$,
 $t$Lo estamos haciendo juntos.$t$, false),

('am-30-es', 'AM30ES-013', 130, $t$Presupuesto y objetivos$t$, $t$Si la respuesta es no$t$,
 $t$No se preocupe. Revisemos su presupuesto juntos para que podamos tener una idea de cómo son sus finanzas mensuales, ¿de acuerdo? Puede acceder y actualizar su presupuesto en cualquier momento en su portal. Todo lo que necesita hacer es iniciar sesión, hacer clic en la pestaña de Presupuesto en el lado izquierdo y luego asegurarse de presionar Guardar si realiza algún cambio.$t$,
 array['CALM','RM'],
 $t$No judgment about the portal. The budget conversation matters more than where it happens.$t$,
 $t$No me están regañando.$t$, false),

('am-30-es', 'AM30ES-014', 140, $t$Presupuesto y objetivos$t$, $t$Si el ingreso neto es negativo$t$,
 $t$Bien, ahora que hemos revisado sus finanzas, queremos mantener control de su presupuesto para ver qué cambios podemos hacer para ahorrar fondos y empezar a trabajar en la recuperación financiera. ¿Suena bien?$t$,
 array['CALM'],
 $t$Do not react to the number. Steady and forward-looking — they already know it is bad.$t$,
 $t$No se inmutaron con mis números.$t$, false),

('am-30-es', 'AM30ES-015', 150, $t$Presupuesto y objetivos$t$, $t$Si el ingreso neto es positivo$t$,
 $t$Bien, entonces su presupuesto muestra una cantidad de $[Ingreso neto]. Nuestro primer objetivo ahora es establecer una cuenta de ahorros y comenzar a reservar esos fondos. ¿Tiene actualmente una cuenta de ahorros?$t$,
 array['AC'],
 $t$Say the figure clearly — many clients have never had it named out loud.$t$,
 $t$Sobra algo de dinero.$t$, false),

('am-30-es', 'AM30ES-016', 160, $t$Presupuesto y objetivos$t$, $t$Ahorros — si la respuesta es sí$t$,
 $t$¡Genial! Deberías tener [cantidad de superávit] sobrante al final del mes. ¿Por qué no empezamos ahorrando [meta de ahorro razonable] cada mes?$t$,
 array['RM'],
 $t$Pick a number they will actually hit. A goal they miss in month one costs more than a small one they keep. Note the switch to tú.$t$,
 $t$Eso es factible.$t$, false),

('am-30-es', 'AM30ES-017', 170, $t$Presupuesto y objetivos$t$, $t$Ahorros — si la respuesta es no$t$,
 $t$No te preocupes. Es muy importante crear un fondo de ahorros para emergencias. El dinero extra puede ayudarte a cubrir gastos inesperados sin que te quedes sin dinero y sin poder pagar tus facturas a fin de mes. Lo primero es lo primero: abre una cuenta de ahorros. Deberías tener [cantidad excedente] de sobra a fin de mes. ¿Por qué no empezamos ahorrando [meta de ahorro razonable] todos los meses?$t$,
 array['CALM','RM'],
 $t$"Lo primero es lo primero" is the action item. Everything before it is the reason.$t$,
 $t$Sé cuál es mi primer paso.$t$, false),

('am-30-es', 'AM30ES-018', 180, $t$Presupuesto y objetivos$t$, $t$Beneficio Credit Builder$t$,
 $t$Para ayudarte a empezar, estamos asociados con Slate Financial y, a través de esta asociación, recibes el beneficio Credit Builder. Aquí es donde el pago de tu programa se informa a las 3 agencias de crédito, lo que brinda los beneficios de informes crediticios de un préstamo a plazos sin el alto costo de interés ni las consultas. Recuerda que este no es un préstamo tradicional. Ten en cuenta que esto aparecerá como Consolidation Capital LLC en tu informe crediticio y aparecerá como un préstamo garantizado. Deberías comenzar a ver este informe en los próximos meses. ¿Tiene alguna pregunta antes de continuar?$t$,
 array['AC','PT'],
 $t$Two things must be unmissable: this is not a traditional loan, and it appears as Consolidation Capital LLC. A client who sees an unexplained name on their credit report calls in a panic.$t$,
 $t$Sé qué es esa entrada cuando la vea.$t$, true),

-- Sección: Cierre y próxima cita

('am-30-es', 'AM30ES-019', 190, $t$Cierre y próxima cita$t$, $t$Pasamos a llamadas mensuales$t$,
 $t$Ahora pasaremos a llamadas de actualización mensuales. Hablaremos mediante cita una vez al mes, pero si necesita algo, no dude en llamarme, enviarme un mensaje de texto o un correo electrónico. Durante estas citas mensuales, le brindaré una actualización sobre todo lo que haya sucedido, así como también intentaré prepararlo para lo que puede esperar según el estado actual de cada cuenta. Trabajaré bastante entre nuestras llamadas, que podrá ver en el portal del cliente. Me gustaría tomarme los próximos 60 a 90 días para trabajar en estas deudas y también familiarizarme más con su situación.$t$,
 array['CALM'],
 $t$Calls getting less frequent can read as being dropped. "Trabajaré bastante entre nuestras llamadas" is the line that prevents that, so mean it.$t$,
 $t$Menos llamadas no es menos trabajo.$t$, false),

('am-30-es', 'AM30ES-020', 200, $t$Cierre y próxima cita$t$, $t$Agendar y cerrar$t$,
 $t$Sigamos adelante y programemos nuestra próxima llamada. Para nuestra próxima llamada, ¿cómo le conviene [día de la semana y fecha] a las [hora, su zona horaria]?$t$,
 array['RM'],
 $t$Consult the best time to contact them before proposing one.$t$,
 $t$Eso me funciona.$t$, false)

) as v(module_slug, code, sort_order, section, title, script_text, tones, coaching, feel, verbatim)
where m.slug = v.module_slug and s.slug = 'bolton-am'
on conflict (module_id, segment_code) do update set
  script_text = excluded.script_text, tones = excluded.tones,
  coaching = excluded.coaching, client_should_feel = excluded.client_should_feel,
  verbatim = excluded.verbatim, section = excluded.section,
  title = excluded.title, sort_order = excluded.sort_order;
