-- ============================================================
-- Coaching history from the old tracker, and the team's own topic list.
--
--   1. coaching_history: how many one-on-ones each rep has had on each
--      topic before Voice Noodle (the "Coaching Session Matrix" sheet).
--      Coaching trends and each rep's one-on-one tab add these to the
--      sessions saved here.
--   2. The one-on-one topic list becomes the same 32 topics, so new
--      sessions keep adding to the same counts. One-on-ones already saved
--      under the old short names are moved to the matching new name.
--
-- Managers see only their own side's reps (public.can_see_person).
-- Safe to run more than once.
-- ============================================================

create table if not exists public.coaching_history (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  rep_id     uuid not null references public.profiles(id) on delete cascade,
  topic      text not null,
  sessions   integer not null check (sessions >= 0),
  source     text not null default 'old tracker',
  created_at timestamptz not null default now(),
  unique (rep_id, topic, source)
);
alter table public.coaching_history enable row level security;
grant select, insert, update, delete on public.coaching_history to authenticated;
drop policy if exists coaching_history_admin_all on public.coaching_history;
create policy coaching_history_admin_all on public.coaching_history for all to authenticated
using (public.is_admin() and org_id = public.my_org_id() and public.can_see_person(rep_id))
with check (public.is_admin() and org_id = public.my_org_id() and public.can_see_person(rep_id));

-- 2. The topic list.
insert into public.coaching_topics (org_id, name, hint, sort_order)
select o.id, v.name, v.hint, v.ord
from public.orgs o
cross join (values
  ('Accountability',       'Owning results, doing what they said they would', 1),
  ('Activity',             'Dials, outbound volume, staying on the phones', 2),
  ('Attendance',           'Showing up on time, absences, schedule', 3),
  ('Call Review',          'Listening back to a call together', 4),
  ('Credit Eligibility',   'Who qualifies, credit pulls, eligibility rules', 5),
  ('Creditor Practice',    'Creditor knowledge, how creditors behave', 6),
  ('CRM',                  'Using the CRM, notes, dispositions', 7),
  ('Compliance',           'Disclosures, accurate claims, what can and cannot be promised', 8),
  ('Debt Settlement',      'The program itself, how settlement works', 9),
  ('Efficiency',           'Talk time, time management, pace, using the day well', 10),
  ('File Review',          'Reviewing client files, deals, pending and cancelled files', 11),
  ('Hardship',             'Hardship probing and hardship letters', 12),
  ('Industry',             'Industry knowledge, competitors, the market', 13),
  ('KPI',                  'Going over the numbers and the monthly KPI scorecard', 14),
  ('Mission',              'Why we do this, company mission and values', 15),
  ('MPE',                  null, 16),
  ('Pacing',               'Pace through the call, rushing or dragging', 17),
  ('PIP',                  'Performance improvement plan', 18),
  ('Pipeline Management',  'Follow-ups, callbacks, working the pipeline', 19),
  ('Preflight',            'Preparing before calls: the lead, setup, goals for the day', 20),
  ('Production',           'Deals, enrollments, closing numbers', 21),
  ('Retention',            'Keeping clients enrolled, cancellations', 22),
  ('Rotation',             'Making rotation, the daily point targets', 23),
  ('Sales Skills',         'Straight Line skills on calls: looping, certainty, rapport, objections', 24),
  ('Script',               'Knowing and using the script', 25),
  ('Standards',            'Professional standards and expectations', 26),
  ('State Management',     'Mindset, energy, confidence, call reluctance, how the rep is doing', 27),
  ('Tech Issue',           'A technical problem that got in the way', 28),
  ('Technology',           'Learning the tools: phones, software, setup', 29),
  ('Tonality',             'The tones and how they are used on calls', 30),
  ('Transitions',          'Moving smoothly between parts of the call', 31),
  ('Loan Decision',        'Loan options and decisions', 32)
) as v(name, hint, ord)
on conflict (org_id, name) do update set sort_order = excluded.sort_order, archived = false;

-- Old short names -> the matching new topic. Saved one-on-ones move over; the old names go.
do $$
declare m record;
begin
  for m in select * from (values
    ('State check', 'State Management'),
    ('Pre-flight', 'Preflight'),
    ('File review', 'File Review'),
    ('Straight Line skills', 'Sales Skills')
  ) as v(old_name, new_name)
  loop
    update public.coaching_sessions set topics = array_replace(topics, m.old_name, m.new_name)
    where m.old_name = any(topics);
    delete from public.coaching_topics where name = m.old_name;
  end loop;
end $$;

-- 3. The history itself (David Lopez left out: no longer here).
with v(name, pattern, topic, n) as (values
  ('Art Gandara', 'art%gandara%', 'Efficiency', 2),
  ('Art Gandara', 'art%gandara%', 'File Review', 2),
  ('Art Gandara', 'art%gandara%', 'Hardship', 1),
  ('Art Gandara', 'art%gandara%', 'KPI', 2),
  ('Art Gandara', 'art%gandara%', 'MPE', 1),
  ('Art Gandara', 'art%gandara%', 'PIP', 2),
  ('Art Gandara', 'art%gandara%', 'Preflight', 1),
  ('Art Gandara', 'art%gandara%', 'Production', 1),
  ('Art Gandara', 'art%gandara%', 'Sales Skills', 3),
  ('Art Gandara', 'art%gandara%', 'Standards', 1),
  ('Art Gandara', 'art%gandara%', 'State Management', 10),
  ('Greg Varey', 'greg%varey%', 'Accountability', 7),
  ('Greg Varey', 'greg%varey%', 'Activity', 1),
  ('Greg Varey', 'greg%varey%', 'Compliance', 1),
  ('Greg Varey', 'greg%varey%', 'Efficiency', 1),
  ('Greg Varey', 'greg%varey%', 'File Review', 14),
  ('Greg Varey', 'greg%varey%', 'KPI', 6),
  ('Greg Varey', 'greg%varey%', 'Standards', 1),
  ('Greg Varey', 'greg%varey%', 'State Management', 4),
  ('Joe Madrigal', 'joe%madri%', 'Accountability', 4),
  ('Joe Madrigal', 'joe%madri%', 'Activity', 2),
  ('Joe Madrigal', 'joe%madri%', 'Efficiency', 10),
  ('Joe Madrigal', 'joe%madri%', 'Industry', 1),
  ('Joe Madrigal', 'joe%madri%', 'KPI', 3),
  ('Joe Madrigal', 'joe%madri%', 'MPE', 1),
  ('Joe Madrigal', 'joe%madri%', 'PIP', 2),
  ('Joe Madrigal', 'joe%madri%', 'Pipeline Management', 1),
  ('Joe Madrigal', 'joe%madri%', 'Production', 1),
  ('Joe Madrigal', 'joe%madri%', 'Sales Skills', 1),
  ('Joe Madrigal', 'joe%madri%', 'Standards', 1),
  ('Joe Madrigal', 'joe%madri%', 'State Management', 7),
  ('Joe Madrigal', 'joe%madri%', 'Tonality', 1),
  ('Jordan Lindenbaum', 'jordan%linde%', 'Accountability', 1),
  ('Jordan Lindenbaum', 'jordan%linde%', 'Attendance', 1),
  ('Jordan Lindenbaum', 'jordan%linde%', 'Credit Eligibility', 2),
  ('Jordan Lindenbaum', 'jordan%linde%', 'Efficiency', 3),
  ('Jordan Lindenbaum', 'jordan%linde%', 'File Review', 2),
  ('Jordan Lindenbaum', 'jordan%linde%', 'KPI', 3),
  ('Jordan Lindenbaum', 'jordan%linde%', 'MPE', 1),
  ('Jordan Lindenbaum', 'jordan%linde%', 'PIP', 1),
  ('Jordan Lindenbaum', 'jordan%linde%', 'Production', 2),
  ('Jordan Lindenbaum', 'jordan%linde%', 'Rotation', 2),
  ('Jordan Lindenbaum', 'jordan%linde%', 'Standards', 2),
  ('Jordan Lindenbaum', 'jordan%linde%', 'State Management', 3),
  ('Kevin Jackson', 'kevin%jacks%', 'Accountability', 6),
  ('Kevin Jackson', 'kevin%jacks%', 'Compliance', 1),
  ('Kevin Jackson', 'kevin%jacks%', 'Efficiency', 4),
  ('Kevin Jackson', 'kevin%jacks%', 'File Review', 13),
  ('Kevin Jackson', 'kevin%jacks%', 'KPI', 5),
  ('Kevin Jackson', 'kevin%jacks%', 'MPE', 2),
  ('Kevin Jackson', 'kevin%jacks%', 'Pipeline Management', 1),
  ('Kevin Jackson', 'kevin%jacks%', 'Production', 1),
  ('Kevin Jackson', 'kevin%jacks%', 'Sales Skills', 2),
  ('Kevin Jackson', 'kevin%jacks%', 'Standards', 4),
  ('Kevin Jackson', 'kevin%jacks%', 'State Management', 20),
  ('Lucy Garcia', 'lucy%garci%', 'Attendance', 1),
  ('Lucy Garcia', 'lucy%garci%', 'Compliance', 1),
  ('Lucy Garcia', 'lucy%garci%', 'Efficiency', 4),
  ('Lucy Garcia', 'lucy%garci%', 'File Review', 24),
  ('Lucy Garcia', 'lucy%garci%', 'Industry', 1),
  ('Lucy Garcia', 'lucy%garci%', 'KPI', 2),
  ('Lucy Garcia', 'lucy%garci%', 'MPE', 1),
  ('Lucy Garcia', 'lucy%garci%', 'Standards', 2),
  ('Lucy Garcia', 'lucy%garci%', 'State Management', 8),
  ('Manny Acosta', 'manny%acost%', 'Accountability', 3),
  ('Manny Acosta', 'manny%acost%', 'Efficiency', 5),
  ('Manny Acosta', 'manny%acost%', 'File Review', 5),
  ('Manny Acosta', 'manny%acost%', 'Hardship', 1),
  ('Manny Acosta', 'manny%acost%', 'KPI', 5),
  ('Manny Acosta', 'manny%acost%', 'MPE', 2),
  ('Manny Acosta', 'manny%acost%', 'Pacing', 1),
  ('Manny Acosta', 'manny%acost%', 'Production', 1),
  ('Manny Acosta', 'manny%acost%', 'Sales Skills', 2),
  ('Manny Acosta', 'manny%acost%', 'Standards', 1),
  ('Manny Acosta', 'manny%acost%', 'State Management', 13),
  ('Michael Navarro', 'michael%navar%', 'Accountability', 2),
  ('Michael Navarro', 'michael%navar%', 'Compliance', 2),
  ('Michael Navarro', 'michael%navar%', 'Debt Settlement', 1),
  ('Michael Navarro', 'michael%navar%', 'File Review', 5),
  ('Michael Navarro', 'michael%navar%', 'KPI', 8),
  ('Michael Navarro', 'michael%navar%', 'MPE', 1),
  ('Michael Navarro', 'michael%navar%', 'Pipeline Management', 2),
  ('Michael Navarro', 'michael%navar%', 'State Management', 4),
  ('Michael Navarro', 'michael%navar%', 'Technology', 1),
  ('Mike Ward', 'mike%ward%', 'Accountability', 1),
  ('Mike Ward', 'mike%ward%', 'Activity', 1),
  ('Mike Ward', 'mike%ward%', 'Efficiency', 9),
  ('Mike Ward', 'mike%ward%', 'File Review', 12),
  ('Mike Ward', 'mike%ward%', 'KPI', 5),
  ('Mike Ward', 'mike%ward%', 'Production', 2),
  ('Mike Ward', 'mike%ward%', 'Standards', 1),
  ('Mike Ward', 'mike%ward%', 'State Management', 14),
  ('Mike Ward', 'mike%ward%', 'Technology', 1),
  ('Moses Mikaio', 'moses%mik%', 'Call Review', 2),
  ('Moses Mikaio', 'moses%mik%', 'Efficiency', 7),
  ('Moses Mikaio', 'moses%mik%', 'File Review', 8),
  ('Moses Mikaio', 'moses%mik%', 'KPI', 1),
  ('Moses Mikaio', 'moses%mik%', 'MPE', 1),
  ('Moses Mikaio', 'moses%mik%', 'PIP', 1),
  ('Moses Mikaio', 'moses%mik%', 'Production', 1),
  ('Moses Mikaio', 'moses%mik%', 'Sales Skills', 1),
  ('Moses Mikaio', 'moses%mik%', 'State Management', 7),
  ('Phillip Rodriguez', 'phillip%rodri%', 'Call Review', 2),
  ('Phillip Rodriguez', 'phillip%rodri%', 'Efficiency', 3),
  ('Phillip Rodriguez', 'phillip%rodri%', 'File Review', 18),
  ('Phillip Rodriguez', 'phillip%rodri%', 'KPI', 1),
  ('Rafael Rivera', 'rafael%river%', 'Accountability', 1),
  ('Rafael Rivera', 'rafael%river%', 'Activity', 1),
  ('Rafael Rivera', 'rafael%river%', 'Credit Eligibility', 1),
  ('Rafael Rivera', 'rafael%river%', 'Efficiency', 1),
  ('Rafael Rivera', 'rafael%river%', 'File Review', 6),
  ('Rafael Rivera', 'rafael%river%', 'KPI', 2),
  ('Rafael Rivera', 'rafael%river%', 'Pipeline Management', 1),
  ('Rafael Rivera', 'rafael%river%', 'Production', 2),
  ('Rafael Rivera', 'rafael%river%', 'Standards', 2),
  ('Rafael Rivera', 'rafael%river%', 'State Management', 4),
  ('Rolando Gonzalez', 'rolando%gonza%', 'Accountability', 1),
  ('Rolando Gonzalez', 'rolando%gonza%', 'Activity', 1),
  ('Rolando Gonzalez', 'rolando%gonza%', 'Attendance', 1),
  ('Rolando Gonzalez', 'rolando%gonza%', 'Efficiency', 2),
  ('Rolando Gonzalez', 'rolando%gonza%', 'File Review', 2),
  ('Rolando Gonzalez', 'rolando%gonza%', 'KPI', 1),
  ('Rolando Gonzalez', 'rolando%gonza%', 'MPE', 2),
  ('Rolando Gonzalez', 'rolando%gonza%', 'Production', 1),
  ('Rolando Gonzalez', 'rolando%gonza%', 'State Management', 5),
  ('Ryan Smith', 'ryan%smith%', 'Accountability', 1),
  ('Ryan Smith', 'ryan%smith%', 'Activity', 1),
  ('Ryan Smith', 'ryan%smith%', 'Efficiency', 4),
  ('Ryan Smith', 'ryan%smith%', 'File Review', 15),
  ('Ryan Smith', 'ryan%smith%', 'State Management', 1),
  ('Shawna Muckey', 'shawna%mucke%', 'Activity', 2),
  ('Shawna Muckey', 'shawna%mucke%', 'Efficiency', 4),
  ('Shawna Muckey', 'shawna%mucke%', 'KPI', 6),
  ('Shawna Muckey', 'shawna%mucke%', 'MPE', 2),
  ('Shawna Muckey', 'shawna%mucke%', 'Pipeline Management', 1),
  ('Shawna Muckey', 'shawna%mucke%', 'Production', 2),
  ('Shawna Muckey', 'shawna%mucke%', 'Retention', 1),
  ('Shawna Muckey', 'shawna%mucke%', 'Standards', 1),
  ('Shawna Muckey', 'shawna%mucke%', 'State Management', 11)
),
matched as (
  select distinct on (v.name, v.topic) p.org_id, p.id as rep_id, v.topic, v.n
  from v
  join public.profiles p on lower(regexp_replace(p.full_name, '\s+', ' ', 'g')) like v.pattern and p.role = 'rep'
  order by v.name, v.topic, p.active desc
)
insert into public.coaching_history (org_id, rep_id, topic, sessions)
select org_id, rep_id, topic, n from matched
on conflict (rep_id, topic, source) do update set sessions = excluded.sessions;

-- Check: one line per rep with their total from the old tracker.
select p.full_name, sum(h.sessions) as sessions_on_record
from public.coaching_history h join public.profiles p on p.id = h.rep_id
group by p.full_name order by p.full_name;
