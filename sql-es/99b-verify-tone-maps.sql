-- Must return ZERO rows. Each tone map has to rebuild its own text.

select sg.segment_code
from segments sg
join modules m on m.id = sg.module_id
cross join lateral (
  select string_agg(x->>'text', ' ' order by ord) as rebuilt
  from jsonb_array_elements(sg.tone_map) with ordinality t(x, ord)
) j
where m.script_id = '116a3615-57b5-4a87-aeac-4256d06dc3df'
  and m.language = 'es'
  and sg.tone_map is not null
  and regexp_replace(j.rebuilt, '\s+', ' ', 'g')
   <> regexp_replace(sg.script_text, '\s+', ' ', 'g');
