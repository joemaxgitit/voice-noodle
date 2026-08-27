-- ============================================================
-- Bolton Llamada de 15 días — Spanish. Word for word.
-- Run AFTER am-schema.sql and sections.sql. Safe to re-run.
--
-- Unlike the Spanish intro, this one tracks the English 15-day
-- script closely: same four sections, same beats.
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

('am-15-es', 'AM15ES-001', 10, $t$Introducción$t$, $t$Abrir el archivo$t$,
 $t$Hola, soy [tu nombre] de Bolton Services Group. ¿Podría darme un minuto para poder abrir su archivo?$t$,
 array['CALM'],
 $t$Warm and unhurried. Two weeks since they last heard from you, so re-establish who you are first.$t$,
 $t$Recuerdo a esta persona.$t$, false),

('am-15-es', 'AM15ES-002', 20, $t$Introducción$t$, $t$Objetivo de la llamada$t$,
 $t$¡Excelente! El objetivo de nuestra llamada de hoy es revisar nuestros objetivos generales y comenzar a desarrollar un plan de acción para mejorar sus finanzas, resolver sus deudas y mejorar su crédito. ¿Suena bien?$t$,
 array['AC','RM'],
 $t$Three outcomes in one breath, then a soft check.$t$,
 $t$Hay un plan para hoy.$t$, false),

('am-15-es', 'AM15ES-003', 30, $t$Introducción$t$, $t$Preguntas primero$t$,
 $t$Antes de comenzar, ¿tiene alguna pregunta para mí?$t$,
 array['I CARE'],
 $t$Pause and get a real answer. Anything worrying them will derail the rest of the call if you skip past it.$t$,
 $t$Puedo hablar.$t$, false),

-- Sección: Plan de Bienestar Financiero

('am-15-es', 'AM15ES-004', 40, $t$Plan de Bienestar Financiero$t$, $t$No somos liquidación de deudas$t$,
 $t$Solo quiero repasar algunas cosas antes de comenzar la llamada de hoy. Bolton Services Group no es una empresa de liquidación de deudas. No pagamos sus deudas si no que disputamos sus deudas. Hablaré sobre esto con más detalle en unos minutos.$t$,
 array['PT'],
 $t$Flat and clear. "No pagamos sus deudas, disputamos sus deudas" at full clarity — the single most misunderstood fact in the programme.$t$,
 $t$Entiendo qué hace esta empresa.$t$, true),

('am-15-es', 'AM15ES-005', 50, $t$Plan de Bienestar Financiero$t$, $t$Primera fase — presupuesto y ahorros$t$,
 $t$En primer lugar, tomemos un momento para revisar el plan general. La primera fase es trabajar en presupuestos y ahorros. Nos enorgullecemos de educar a los clientes para que tomen decisiones financieras sólidas, por lo que el primer paso es comprender sus gastos mensuales. Vamos a comenzar con eso en nuestra próxima llamada. Esta es una fase realmente importante del programa porque estamos implementando una estructura para que usted no tenga que volver a preocuparse por el dinero. Y eso es importante para ti, ¿verdad?$t$,
 array['AC'],
 $t$Land "no tenga que volver a preocuparse por el dinero" — that is the outcome underneath the debt. Note the closing question slips into tú; everything before it is usted.$t$,
 $t$Esto es más que la deuda.$t$, false),

('am-15-es', 'AM15ES-006', 60, $t$Plan de Bienestar Financiero$t$, $t$Entre bastidores$t$,
 $t$Mientras nos dedicamos a mejorar su situación financiera inmediata, nuestro equipo hará mucho por usted entre bastidores. Estaremos monitoreando su crédito para asegurarnos de que las cuentas avancen hacia los cobros. También enviaremos disputas a las agencias de crédito y nos aseguraremos de que no haya elementos inexactos. Aunque haré un seguimiento de su puntaje crediticio, y el puntaje es importante para muchos de mis clientes, trabajaremos en su crédito como nuestro último objetivo, porque tenemos mucho trabajo que hacer primero. ¿Tiene eso sentido?$t$,
 array['CALM','PT'],
 $t$Setting the expectation that credit comes last is what prevents the month-three panic call. Do not rush it.$t$,
 $t$Están trabajando aunque yo no lo vea.$t$, false),

('am-15-es', 'AM15ES-007', 70, $t$Plan de Bienestar Financiero$t$, $t$La FDCPA$t$,
 $t$Tan pronto como recibimos una carta de recolecciones, es cuando comienza el proceso de disputa. Este es un proceso poderoso que resolverá su deuda y las cartas de cobro son la clave para resolverla. Todo este proceso se basa en la Ley de Prácticas Justas de Cobro de Deudas de 1977, también conocida como FDCPA. Es una ley diseñada para proteger a los consumidores contra los cobradores de deudas que no seguían las reglas. Según la FDCPA, tenemos derecho a solicitar pruebas de que tienen toda la documentación archivada sobre su deuda ANTES de cobrar cualquier monto dinero. Sabemos que no es así y es por eso que tenemos una tasa de éxito tan alta. Simplemente asumen que la mayoría de los consumidores no conocen sus derechos y 9 de cada 10 veces ni siquiera intentan proporcionar ninguna documentación. Sólo para darle una idea, sólo el año pasado se presentaron más de 81.000 quejas ante el gobierno. Y sabemos que a muchos de nuestros clientes también se les violarán sus derechos, razón por la cual trabajamos con las principales firmas de abogados de protección al consumidor del país. Entonces, esto no solo resolverá su deuda, sino que también recibirá educación a lo largo del camino. ¿Qué le parece?$t$,
 array['AC'],
 $t$Long passage — vary your pace or it becomes a lecture. Weight ANTES, and let the 81.000 figure land on its own.$t$,
 $t$Hay una ley real detrás de esto.$t$, false),

-- Sección: Descripción general del portal del cliente y cartas

('am-15-es', 'AM15ES-008', 80, $t$Portal del cliente y cartas$t$, $t$Presentar el portal$t$,
 $t$A continuación, voy a pasar a cómo podemos trabajar juntos. Voy a revisar el portal del cliente y cómo enviar documentos. Puede acceder al portal desde su computadora o teléfono. Le enviaré un enlace una vez que terminemos nuestra llamada el día de hoy. ¿De acuerdo?$t$,
 array['CALM'],
 $t$Short signpost before a long walkthrough.$t$,
 $t$Sé qué viene.$t$, false),

('am-15-es', 'AM15ES-009', 90, $t$Portal del cliente y cartas$t$, $t$Recorrido del portal$t$,
 $t$Me gustaría mencionar que hay mucha información útil en su Panel de control que lo/la guiará a través del programa. Puede ver actualizaciones de crédito y ahorros del programa, junto con algunos artículos útiles sobre cómo mejorar sus finanzas. En el lado izquierdo, verá cuándo se realizará su próximo pago y la cantidad. También verá la fecha de nuestra próxima cita. La pestaña de documentos le mostrará toda la documentación del programa, incluido su contrato y cualquier otro documento que pueda firmar. También incluirá cualquier documento que nos envíe. Luego, en la parte inferior, se muestra nuestra información de contacto para comunicarse con nosotros. También hay una pestaña para su presupuesto mensual, en la que trabajaremos desde el principio. La buena noticia es que si actualiza su presupuesto, podremos ver cualquier cambio. Por último, puede usar el chat en vivo si tiene alguna pregunta básica sobre el portal o el programa. ¿Tiene alguna pregunta sobre el portal hasta ahora?$t$,
 array['CALM'],
 $t$The script marks this ELEMENTOS DE DESACELERACIÓN Y VIÑETAS — slow down and bullet-point it. One item, small pause, next item. Running them together is how a client never opens the portal.$t$,
 $t$Podría encontrar todo eso.$t$, false),

('am-15-es', 'AM15ES-010', 100, $t$Portal del cliente y cartas$t$, $t$Tres formas de enviar cartas$t$,
 $t$Como dije antes, enviarnos las cartas de recolecciones es muy importante para su éxito en el programa. Puede hacerlo tomando una foto con su teléfono inteligente y enviándolas por mensaje de texto a nuestra línea directa, por correo electrónico como archivo adjunto a info@BoltonServiceGroup.com o mandándolas al portal del cliente. Si necesita ayuda para enviar un documento, hágamelo saber y estaré encantado/a de guiarlo/a en el proceso. Okay?$t$,
 array['PT'],
 $t$Three options, said slowly enough that they can pick one. Most people choose the photo and text.$t$,
 $t$Eso lo puedo hacer.$t$, false),

('am-15-es', 'AM15ES-011', 110, $t$Portal del cliente y cartas$t$, $t$Confirmación$t$,
 $t$Una vez que envíe los documentos, yo le enviaré un mensaje confirmando que lo recibimos. ¿Tiene alguna pregunta sobre cómo enviarnos documentos?$t$,
 array['CALM'],
 $t$Small promise, easy to keep, and it is what makes them send the second letter.$t$,
 $t$Sabré que llegó.$t$, false),

('am-15-es', 'AM15ES-012', 120, $t$Portal del cliente y cartas$t$, $t$El aviso de 30 días$t$,
 $t$Las cartas más importantes provienen de agencias de cobro de terceros. Por ley, le permiten ejercer sus derechos. Esto significa que puede disputar la validez de la deuda una vez que sus cuentas pasen a recolecciones. En esas cartas, notará esta frase: "A menos que nos notifique dentro de los 30 días posteriores a la recepción de este aviso que disputa la validez de esta deuda o cualquier parte de ella, asumiremos que esta deuda es válida". Esto es clave para resolver su deuda y debemos actuar rápidamente, así que envíenos esas cartas tan pronto como las reciba. Si recibe alguna carta, no espere hasta nuestra próxima cita para enviarla.$t$,
 array['PT','AC'],
 $t$The quoted phrase is statutory language — read it exactly and slow down through it. Everything after is urgency, so let that lift.$t$,
 $t$Hay un reloj y no debo guardar el correo.$t$, true),

('am-15-es', 'AM15ES-013', 130, $t$Portal del cliente y cartas$t$, $t$Comprobación$t$,
 $t$¿Tiene alguna pregunta para mí?$t$,
 array['I CARE'],
 $t$Pause and wait. This comes right after the heaviest part of the call.$t$,
 $t$Puedo estar confundido.$t$, false),

('am-15-es', 'AM15ES-014', 140, $t$Portal del cliente y cartas$t$, $t$Esto tomará tiempo$t$,
 $t$Quiero asegurarme de que sepa que el Plan de Bienestar Financiero tomará tiempo. Por lo general, se necesitan aproximadamente 2 años para recuperarse por completo de los problemas relacionados con la deuda. Uno de nuestros objetivos es aumentar su puntaje crediticio, pero necesito asegurarme de que comprenda que es probable que su puntaje crediticio baje al principio. Pero eso es completamente normal, porque primero trabajaremos en sus finanzas. Uno de nuestros objetivos es ayudarlo/a a ahorrar dinero. El indicador clave de éxito para nosotros es que usted realice los pagos de su programa, ya que le ahorrarán dinero a largo plazo. Si hay un problema con los pagos, nos indica que aún tenemos trabajo por hacer. Por lo tanto, mantenerlo/a por un buen camino es una prioridad para mí y espero que también lo sea para usted.$t$,
 array['CALM','PT'],
 $t$"Es probable que su puntaje crediticio baje al principio" has to be said plainly and without flinching. Softening it here is what causes the cancellation later.$t$,
 $t$Nadie finge que esto es instantáneo.$t$, true),

-- Sección 4: Cierre y próxima cita

('am-15-es', 'AM15ES-015', 150, $t$Cierre y próxima cita$t$, $t$CHIRP$t$,
 $t$La última cosa que quiero cubrir con usted es CHIRP. Es un programa que le ayuda a protegerse contra los NSF y cargos por sobregiro si usted no tiene suficiente dinero en su cuenta cuando su fecha de pago se acerca. Una vez que te envíe el enlace, todo lo que tienes que hacer es seguir las instrucciones para seleccionar tu banco y luego iniciar sesión para elegir la cuenta que está en tu archivo aquí. ¿Te interesa suscribirte a CHIRP?$t$,
 array['CALM'],
 $t$Check the BANCO tab first to see whether they are already connected to CHIRP. Offer it, do not sell it. Note the script switches from usted to tú partway through.$t$,
 $t$Eso me ahorraría un dolor de cabeza.$t$, false),

('am-15-es', 'AM15ES-016', 160, $t$Cierre y próxima cita$t$, $t$CHIRP — en caso afirmativo$t$,
 $t$Estupendo, le enviaré el enlace por correo electrónico ....... un momento.$t$,
 array['AC'],
 $t$Offer to walk the client through the process while you still have them on the phone.$t$,
 $t$Eso fue fácil.$t$, false),

('am-15-es', 'AM15ES-017', 170, $t$Cierre y próxima cita$t$, $t$CHIRP — si la respuesta es negativa$t$,
 $t$No hay ningún problema. Si cambia de opinión, estaré encantado/a de ayudarle a configurarlo.$t$,
 array['RM'],
 $t$Genuinely no pressure. Pushing here costs goodwill you will need later.$t$,
 $t$No me presionaron.$t$, false),

('am-15-es', 'AM15ES-018', 180, $t$Cierre y próxima cita$t$, $t$Los próximos 60 días$t$,
 $t$Nuestra próxima cita será dentro de dos semanas aproximadamente, y luego pasaremos a llamadas mensuales, pero si necesita algo entre nuestras citas, no dude en llamar, enviar un mensaje de texto o un correo electrónico. También trabajaré bastante entre nuestras llamadas, lo que podrá ver en el portal del cliente. Me gustaría tomarme los próximos 60 días para trabajar en el presupuesto y ahorros mientras esperamos a que esas deudas pasen a recolecciones.$t$,
 array['CALM'],
 $t$Naming the cadence now is what stops them wondering whether they have been forgotten.$t$,
 $t$Sé cuándo sabré de ellos.$t$, false),

('am-15-es', 'AM15ES-019', 190, $t$Cierre y próxima cita$t$, $t$Agendar$t$,
 $t$¿Tiene alguna pregunta para mí antes de programar la próxima llamada? ... Bien, programemos nuestra próxima cita, que será dentro de dos semanas aproximadamente. Nuestro horario es de lunes a viernes, de 8 a. m. a 5 p. m., hora estándar del Pacífico. ¿Qué le parece el [día de la semana/fecha] a las [hora, su zona horaria] a. m./p. m.?$t$,
 array['CALM','RM'],
 $t$Refer to their best time to contact. If they have not given one, ask which day and time frame they prefer and note it in Notas especiales.$t$,
 $t$Eso me queda bien.$t$, false),

('am-15-es', 'AM15ES-020', 200, $t$Cierre y próxima cita$t$, $t$Cierre$t$,
 $t$Recibirá recordatorios antes de nuestra próxima cita. En caso de que necesite reprogramar nuestra llamada por cualquier motivo, avíseme lo antes posible, ¿Okay? ... Muchas gracias por su tiempo el día de hoy y espero hablar con usted pronto para nuestra próxima llamada.$t$,
 array['CALM'],
 $t$Warm and brief. End sounding like you will actually be there next time.$t$,
 $t$Valió la pena.$t$, false)

) as v(module_slug, code, sort_order, section, title, script_text, tones, coaching, feel, verbatim)
where m.slug = v.module_slug and s.slug = 'bolton-am'
on conflict (module_id, segment_code) do update set
  script_text = excluded.script_text, tones = excluded.tones,
  coaching = excluded.coaching, client_should_feel = excluded.client_should_feel,
  verbatim = excluded.verbatim, section = excluded.section,
  title = excluded.title, sort_order = excluded.sort_order;
