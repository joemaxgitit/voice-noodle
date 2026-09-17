-- Expect 12 rows with these counts:
--   Apertura 3, La dificultad 5, Crear al villano 2, SuperMoney 4,
--   Las tres opciones 4, La presentación 10, Revisión de crédito 2,
--   Más sobre Bolton 7, El cierre 6, Repaso del contrato 11,
--   Preguntas de cumplimiento 2, El remate 5

select m.sort_order, m.title, count(sg.id) as segments
from modules m
left join segments sg on sg.module_id = m.id
where m.script_id = '116a3615-57b5-4a87-aeac-4256d06dc3df'
  and m.language = 'es'
group by m.id, m.sort_order, m.title
order by m.sort_order;
