-- ============================================================
-- Bolton Intro Call — Spanish. Word for word from the document.
-- Run AFTER am-schema.sql and sections.sql. Safe to re-run.
--
-- NOTE: this is not a literal translation of the English intro.
-- Several passages differ in substance, not just language. Those
-- differences are flagged in the coaching on the affected cards.
-- ============================================================

insert into public.segments
  (module_id, segment_code, sort_order, section, title, script_text, tones,
   coaching, client_should_feel, verbatim, status)
select m.id, v.code, v.sort_order, v.section, v.title, v.script_text, v.tones,
       v.coaching, v.feel, v.verbatim, 'published'
from public.modules m
join public.scripts s on s.id = m.script_id
cross join (values

-- Sección: Introducción y confirmación del programa

('am-intro-es', 'AMES-001', 10, $t$Introducción y confirmación del programa$t$, $t$Bienvenida$t$,
 $t$Hola [nombre del cliente] mi nombre es [tu nombre]. ¡Bienvenido/a a Bolton Services Group! Felicitaciones por tomar el primer paso al bienestar financiero, es importante mantenernos en contacto a lo largo del programa, así que por favor tome un momento para agregar nuestro número de teléfono a sus contactos y déjeme saber cuando esté listo/a. Nuestro número es (888) 374 – 9768$t$,
 array['AC'],
 $t$Bright and genuinely congratulatory. Wait while they actually save the number — do not carry on talking over them. Slow right down on the digits and repeat them.$t$,
 $t$I am in good hands now.$t$, true),

('am-intro-es', 'AMES-002', 20, $t$Introducción y confirmación del programa$t$, $t$Cómo funcionan las citas$t$,
 $t$Muy bien, ese será el número que marcará para todas sus citas y cualquier pregunta o petición que tenga a lo largo del programa. Agendaremos esa cita al final de esta llamada, okay?$t$,
 array['CALM','RM'],
 $t$Note this differs from the English script, which says Bolton calls the client. Here the client is told they will dial in.$t$,
 $t$I know how to reach them.$t$, true),

('am-intro-es', 'AMES-003', 30, $t$Introducción y confirmación del programa$t$, $t$Revisar los objetivos$t$,
 $t$¡Muy bien! Ahora, tomemos unos minutos para revisar nuestros objetivos, ¿okay?$t$,
 array['CALM'],
 $t$Short signpost. It tells them the next few minutes have a shape.$t$,
 $t$Hay un plan.$t$, false),

('am-intro-es', 'AMES-004', 40, $t$Introducción y confirmación del programa$t$, $t$Primera fase — educación financiera$t$,
 $t$El primer paso es la educación financiera. Parte de eso es establecer una cuenta de ahorros para emergencias, para ayudarle a alcanzar sus objetivos financieros a corto y largo plazo. Estaremos trabajando juntos a lo largo del programa, pero la idea es comenzar sentando las bases durante los próximos seis meses, trabajando en su presupuesto y ahorros.$t$,
 array['AC'],
 $t$Steady and matter of fact. This is the phase they will feel first.$t$,
 $t$Algo empieza de inmediato.$t$, false),

('am-intro-es', 'AMES-005', 50, $t$Introducción y confirmación del programa$t$, $t$Segunda fase — derechos del consumidor$t$,
 $t$La segunda fase es la educación sobre los derechos del consumidor. Nosotros disputamos sus cuentas usando leyes estatales y federales hasta que esta se resuelva, sin importar cuánto trabajo requiera de nuestra parte. Para que sea posible para nosotros el disputar sus cuentas, los pagos mensuales deberán ser voluntariamente retenidos hacia los acreedores que inscribió en nuestro programa.$t$,
 array['AC','PT'],
 $t$Do not speed up on the last sentence. Withholding payments is the part clients later say they did not understand, and rushing it is what creates that.$t$,
 $t$Entiendo lo que acepté.$t$, false),

('am-intro-es', 'AMES-006', 60, $t$Introducción y confirmación del programa$t$, $t$Las dos confirmaciones$t$,
 $t$Así que, comprende que deberá tomar la decisión voluntaria de dejar de hacer pagos a sus acreedores que inscribió a nuestro programa ¿cierto? Entonces, para confirmar, ¿entiende que sus cuentas deberán llegar a recolecciones para que podamos disputar en su nombre? (¿Sí o no?)$t$,
 array['PT'],
 $t$Two separate questions. Ask the first, get a yes, then ask the second. Running them together is how you end up with a recording that does not hold up.$t$,
 $t$Nadie me está escondiendo nada.$t$, true),

('am-intro-es', 'AMES-007', 70, $t$Introducción y confirmación del programa$t$, $t$Si no siguen las reglas$t$,
 $t$¡Muy bien! si los acreedores no siguen las reglas, lo/la referirán a una firma de abogados nacional que puede poner fin al acoso del acreedor, o intentarán demandar al acreedor y conseguirle una indemnización.$t$,
 array['AC'],
 $t$Good news after two heavy confirmations. Let the energy come back up.$t$,
 $t$Alguien está de mi lado.$t$, false),

('am-intro-es', 'AMES-008', 80, $t$Introducción y confirmación del programa$t$, $t$Fase final — educación crediticia$t$,
 $t$La fase final del programa es la educación crediticia. Elaboraremos un plan para lograr que su crédito obtenga una puntuación superior a 700, para que pueda aprovechar un perfil crediticio saludable, que le ayudará en compras importantes, como una casa o un coche al mejor precio.$t$,
 array['AC'],
 $t$The house and the car are the point. Say those slowly enough that they picture them.$t$,
 $t$Hay una versión de esto donde estoy bien.$t$, false),

('am-intro-es', 'AMES-009', 90, $t$Introducción y confirmación del programa$t$, $t$Envíenos sus cartas$t$,
 $t$A medida que reciba cartas respecto a sus cuentas inscritas, envíenoslas lo antes posible. Puede mandar cualquier cosa que reciba utilizando el Portal del Cliente. Cubriremos eso con más detalle en nuestra próxima llamada.$t$,
 array['PT'],
 $t$Plain and clear. This single instruction drives more of the program's success than anything else on this call.$t$,
 $t$Sé cuál es mi trabajo.$t$, false),

('am-intro-es', 'AMES-010', 100, $t$Introducción y confirmación del programa$t$, $t$Notificaciones$t$,
 $t$Recibirá notificaciones importantes mensualmente. Le enviaremos un recordatorio de nuestras llamadas por correo electrónico. Después de nuestras llamadas, recibirá un resumen por correo electrónico de sus registros. También recibirá recordatorios sobre sus pagos mensuales 72 horas antes de la sustracción. El punto de referencia de mi éxito es mantenerlo/a por un buen camino, pero si algo sucede y necesita cambiar su fecha de pago, avíseme CON AL MENOS 3 días hábiles de anticipación. ¿Muy bien?$t$,
 array['CALM'],
 $t$Long list — vary your pace or it turns into noise. Weight the 3 días hábiles.$t$,
 $t$No me va a sorprender nada.$t$, false),

('am-intro-es', 'AMES-011', 110, $t$Introducción y confirmación del programa$t$, $t$Préstamo y pagos$t$,
 $t$Genial, y para confirmar, entiende que solicitó un préstamo, pero en lugar de eso elegió inscribirse en este programa para resolver sus deudas. Además, nosotros no saldamos sus deudas con el dinero que usted nos paga. El dinero que usted nos paga es por nuestros servicios de su Plan de Bienestar Financiero. (¿Sí o no?) ¡Perfecto!$t$,
 array['PT'],
 $t$Full clarity, normal volume, no hedging. Mumbling this is exactly what creates a dispute six months from now.$t$,
 $t$Sé qué está comprando mi dinero.$t$, true),

-- Sección: Precisión del expediente

('am-intro-es', 'AMES-012', 120, $t$Precisión del expediente$t$, $t$Cuentas y total$t$,
 $t$Ahora, tomemos un momento para revisar sus cuentas. Veo que tiene [número en la lista D&C] cuentas inscritas por un total de $[CCDebt total], ¿correcto?$t$,
 array['PT'],
 $t$Read from the Deudas/Acreedores tab. Say the numbers cleanly and wait for the confirmation.$t$,
 $t$Tienen mi expediente enfrente.$t$, true),

('am-intro-es', 'AMES-013', 130, $t$Precisión del expediente$t$, $t$Pago y fechas$t$,
 $t$Su pago mensual programado es de $[Monto de pago mensual] y su primer pago es el [fecha del primer Pago]. Su pago recurrente es el [# día] de cada mes despues de eso, ¿correcto?$t$,
 array['PT'],
 $t$From the Bolton tab. Three facts, one confirmation. Do not rush past the first payment date.$t$,
 $t$Sé exactamente qué sale y cuándo.$t$, true),

('am-intro-es', 'AMES-014', 140, $t$Precisión del expediente$t$, $t$Confirmación del banco$t$,
 $t$Ok, veo que está usando [Nombre del banco] para sus pagos mensuales, ¿correcto?$t$,
 array['PT'],
 $t$From the Banco tab. Short, then stop.$t$,
 $t$Así es.$t$, true),

('am-intro-es', 'AMES-015', 150, $t$Precisión del expediente$t$, $t$Autorización de sustracción$t$,
 $t$Cuando vea Bolton Services Group en su estado de cuenta o reporte bancario, es el pago mensual programado según su acuerdo. ¿Acepta permitir que Bolton Services Group sustraiga sus pagos Mensuales?$t$,
 array['PT'],
 $t$A clear SÍ is required before you go any further, and this portion of the recording gets kept. Ask it cleanly, then be completely silent until they answer.$t$,
 $t$Autoricé esto deliberadamente.$t$, true),

-- Sección: Chirp

('am-intro-es', 'AMES-016', 160, $t$Chirp$t$, $t$Chirp$t$,
 $t$Lo último sobre lo que quiero hablar con usted es Chirp. Es un programa que le ayuda a protegerse contra los NSF y cargos por sobregiro si no tiene suficiente dinero en su cuenta cuando llegue la fecha de pago. Le enviaré un correo electrónico con el link después de esta llamada, solo toma un minuto para enlazar su cuenta y está encriptado para su protección.$t$,
 array['CALM'],
 $t$Light and helpful. This is a courtesy, so treat it as one.$t$,
 $t$Pensaron en lo que me preocupaba.$t$, false),

-- Sección 4: Próxima cita

('am-intro-es', 'AMES-017', 170, $t$Próxima cita$t$, $t$Preguntas$t$,
 $t$¿Tiene alguna pregunta sobre los temas que hemos tocado hasta ahora?$t$,
 array['I CARE'],
 $t$Ask and wait properly. Anything unresolved here comes back as a cancellation.$t$,
 $t$Puedo preguntar.$t$, false),

('am-intro-es', 'AMES-018', 180, $t$Próxima cita$t$, $t$Agendar la cita$t$,
 $t$Muy bien, programemos nuestra próxima cita, que será dentro de dos semanas. Nuestro horario es de lunes a viernes, de 8 a. m. a 5 p. m. Hora del Pacífico. ¿Así que qué le parece [día de la semana y fecha] a la [hora, su zona horaria] AM/PM?$t$,
 array['CALM','RM'],
 $t$Count today as day one, or their preferred day if they gave you one. Pause for a real answer before proposing a time.$t$,
 $t$Eso me queda bien.$t$, false),

('am-intro-es', 'AMES-019', 190, $t$Próxima cita$t$, $t$Quién llama a quién$t$,
 $t$Muchas gracias. Para confirmar, usted será quien nos llame para todas sus citas, incluyendo la que acabamos de agendar. También recibirá un recordatorio antes de nuestra próxima cita. Y si es necesario reagendar su cita por cualquier razón, llámenos para dejarnos saber, ¿Está bien?$t$,
 array['CALM'],
 $t$This is the opposite of the English script, which confirms that Bolton calls the client. Check which is correct before recording — a Spanish-speaking client waiting for a call that never comes will assume they were forgotten.$t$,
 $t$Sé quién llama a quién.$t$, true),

('am-intro-es', 'AMES-020', 200, $t$Próxima cita$t$, $t$Correo de beneficios$t$,
 $t$Además, recibirá un correo electrónico sobre sus beneficios de Bolton Services Group que están incluidos en su programa. Son increiblemente valiosos. Así que, si no recibe la llamada o los correos electrónicos, hágamelo saber.$t$,
 array['AC'],
 $t$Sound like the benefits are worth opening the email for, because they are.$t$,
 $t$Hay más de lo que pensaba.$t$, false),

('am-intro-es', 'AMES-021', 210, $t$Próxima cita$t$, $t$Cierre$t$,
 $t$Felicitaciones nuevamente por el primer paso hacia el Plan de Bienestar Financiero. ¡Que tenga un lindo día!$t$,
 array['AC'],
 $t$End warm and confident. They should hang up feeling like they met a person, not completed a process.$t$,
 $t$Eso salió bien.$t$, true)

) as v(module_slug, code, sort_order, section, title, script_text, tones, coaching, feel, verbatim)
where m.slug = v.module_slug and s.slug = 'bolton-am'
on conflict (module_id, segment_code) do update set
  script_text = excluded.script_text, tones = excluded.tones,
  coaching = excluded.coaching, client_should_feel = excluded.client_should_feel,
  verbatim = excluded.verbatim, section = excluded.section,
  title = excluded.title, sort_order = excluded.sort_order;
