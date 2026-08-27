-- ============================================================
-- Sections: named sub-parts inside a long call.
-- Run AFTER the previous migrations. Safe to run more than once.
--
-- Modules are already the top-level structure (they become the margin
-- braces in the script view). This adds the level below, for calls that
-- run long enough to need it -- Bolton's scripts name these themselves.
-- ============================================================

alter table public.segments
add column if not exists section text;

-- ---------- Bolton Intro Call ----------

update public.segments set section = 'Intro and Program Confirmation'
where segment_code between 'AMINT-001' and 'AMINT-013';

update public.segments set section = 'File Accuracy'
where segment_code between 'AMINT-014' and 'AMINT-017';

update public.segments set section = 'Chirp'
where segment_code = 'AMINT-018';

update public.segments set section = 'Transfer to Law Firm & Next Appointment'
where segment_code between 'AMINT-019' and 'AMINT-024';

-- ---------- The Pitch (9 segments) ----------

update public.segments set section = 'The Company and Phase One'
where segment_code in ('BOLT-001','BOLT-002');

update public.segments set section = 'Phase Two'
where segment_code in ('BOLT-003','BOLT-004','BOLT-005','BOLT-006');

update public.segments set section = 'Recap the Goals'
where segment_code in ('BOLT-007','BOLT-008','BOLT-009');

-- ---------- Contract Walk-Through (11 segments) ----------

update public.segments set section = 'Opening the Portal'
where segment_code in ('CON-001','CON-002','CON-003','CON-004');

update public.segments set section = 'Client Agreement'
where segment_code in ('CON-005','CON-006');

update public.segments set section = 'Acknowledgements'
where segment_code in ('CON-007','CON-008','CON-009');

update public.segments set section = 'Legal Benefits'
where segment_code in ('CON-010','CON-011');
