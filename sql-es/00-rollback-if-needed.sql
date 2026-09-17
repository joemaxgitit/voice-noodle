-- ROLLBACK. Only if something is wrong. These are all new rows, so
-- this removes nothing that existed before the Spanish load.

delete from segments
where module_id in (
  select id from modules
  where script_id = '116a3615-57b5-4a87-aeac-4256d06dc3df'
    and language = 'es'
);

delete from modules
where script_id = '116a3615-57b5-4a87-aeac-4256d06dc3df'
  and language = 'es';
