-- ============================================================
-- Branch conditions: YES / NO / IF NEGATIVE NET INCOME and so on.
-- Run AFTER tone-map.sql. Safe to run more than once.
--
-- These cannot go in script_text — forced alignment would try to
-- find the word "YES" in audio where nobody says it. They are an
-- annotation like a tone marker: visible, not spoken.
-- ============================================================

alter table public.segments
add column if not exists condition text;

-- ---------- sales script ----------

update public.segments set condition = 'YES'  where segment_code = 'WHY-003A';
update public.segments set condition = 'NO'   where segment_code = 'WHY-003B';
update public.segments set condition = 'IF NO' where segment_code = 'LOOP1-004A';

-- ---------- Bolton, English ----------

update public.segments set condition = 'IF YES' where segment_code in
  ('AM15-016','AM30-005','AM30-012','AM30-016','AM60-015','AM60-026',
   'AM90-014','AM90-022','AM120-014','AM120-022','AM150-014');

update public.segments set condition = 'IF NO' where segment_code in
  ('AM15-017','AM30-007','AM30-013','AM30-017','AM60-018','AM60-027',
   'AM90-017','AM90-023','AM120-017','AM120-023','AM150-017');

update public.segments set condition = 'NOT WELL' where segment_code in
  ('AM30-006','AM60-016','AM90-015','AM120-015','AM150-015');

update public.segments set condition = 'IF NEGATIVE NET INCOME' where segment_code in
  ('AM30-014','AM150-025');

update public.segments set condition = 'IF POSITIVE NET INCOME' where segment_code in
  ('AM30-015','AM60-025','AM90-021','AM120-021','AM150-021');

update public.segments set condition = 'IF UNABLE TO RETAIN' where segment_code = 'CANC-004';

-- ---------- Bolton, Spanish ----------

update public.segments set condition = 'SI SÍ' where segment_code in
  ('AM15ES-016','AM30ES-005','AM30ES-012','AM30ES-016','AM60ES-014','AM60ES-025',
   'AM90ES-014','AM90ES-022','AM120ES-014','AM120ES-023','AM150ES-014');

update public.segments set condition = 'SI NO' where segment_code in
  ('AM15ES-017','AM30ES-007','AM30ES-013','AM30ES-017','AM60ES-017','AM60ES-026',
   'AM90ES-017','AM90ES-023','AM120ES-017','AM120ES-024','AM150ES-017');

update public.segments set condition = 'NO VAN BIEN' where segment_code in
  ('AM30ES-006','AM60ES-015','AM90ES-015','AM120ES-015','AM150ES-015');

update public.segments set condition = 'SI EL INGRESO NETO ES NEGATIVO' where segment_code in
  ('AM30ES-014','AM150ES-025');

update public.segments set condition = 'SI EL INGRESO NETO ES POSITIVO' where segment_code in
  ('AM30ES-015','AM60ES-024','AM90ES-021','AM120ES-022','AM150ES-021');
