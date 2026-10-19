-- ============================================================
-- Vindico auto dialer. Reps on the Vindico project make rotation
-- automatically. Vindico's seats are labelled with other reps' names,
-- so each Vindico rep keeps the seat name their reports use.
-- Safe to run more than once.
-- ============================================================
alter table public.profiles add column if not exists on_vindico boolean not null default false;
alter table public.profiles add column if not exists vindico_seat text;

-- Moses sits in the "David" seat, Art in "Phillip", Joe in "Ryan".
update public.profiles set on_vindico = true, vindico_seat = 'David Lopez'
 where role = 'rep' and active and full_name ilike 'Moses %';
update public.profiles set on_vindico = true, vindico_seat = 'Phillip Rodriguez'
 where role = 'rep' and active and full_name ilike 'Art %';
update public.profiles set on_vindico = true, vindico_seat = 'Ryan Smith'
 where role = 'rep' and active and full_name ilike 'Joe %';

select full_name, on_vindico, vindico_seat from public.profiles where on_vindico order by full_name;
