-- ============================================================
-- Account Manager script support.
-- Run AFTER the teams migration. Safe to run more than once.
-- ============================================================

-- 1. Compliance. Some lines must be said verbatim -- the yellow and green
--    highlighting in Bolton's playbook. A rep needs to see at a glance which
--    lines they cannot paraphrase, so this is its own field rather than a
--    note buried in the coaching text.
alter table public.segments
add column if not exists verbatim boolean not null default false;

-- 2. Language. The AM playbook has a Spanish version of every call.
alter table public.modules
add column if not exists language text not null default 'en';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'modules_language_check') then
    alter table public.modules
      add constraint modules_language_check
      check (language in ('en','es'));
  end if;
end $$;

-- 3. The AM script itself
insert into public.orgs (slug, name)
values ('lionside', 'ProEdge Solutions')
on conflict (slug) do nothing;

insert into public.scripts (org_id, slug, title, kind, sort_order, team, logo_url)
select o.id, 'bolton-am', 'Bolton Account Manager Calls', 'sales', 20,
       'ams', '/bolton-logo.png'
from public.orgs o
where o.slug = 'lionside'
on conflict (org_id, slug) do update set
  title = excluded.title,
  team = excluded.team,
  logo_url = excluded.logo_url,
  sort_order = excluded.sort_order;

-- 4. The call lifecycle. Intro first, then the day-numbered checkpoints,
--    then the two situational scripts.
insert into public.modules (script_id, slug, title, sort_order, kind, language)
select s.id, v.slug, v.title, v.sort_order, 'sequence', 'en'
from public.scripts s
cross join (values
  ('am-intro',        'Intro Call',                 10),
  ('am-15',           '15-Day Call',                20),
  ('am-30',           '30-Day Call',                30),
  ('am-60',           '60-Day & Monthly Call',      40),
  ('am-90',           '90-Day Call',                50),
  ('am-120',          '120-Day Call',               60),
  ('am-150',          '150-Day Call',               70),
  ('am-cancel',       'Phone Cancellation Request', 80),
  ('am-voicemail',    'Voicemail Recordings',       90)
) as v(slug, title, sort_order)
where s.slug = 'bolton-am'
on conflict (script_id, slug) do update set
  title = excluded.title,
  sort_order = excluded.sort_order,
  language = 'en';

-- Spanish counterparts
insert into public.modules (script_id, slug, title, sort_order, kind, language)
select s.id, v.slug, v.title, v.sort_order, 'sequence', 'es'
from public.scripts s
cross join (values
  ('am-intro-es',  'Llamada de introducción',   10),
  ('am-15-es',     'Llamada de 15 días',        20),
  ('am-30-es',     'Llamada de 30 días',        30),
  ('am-60-es',     'Llamada de 60 días',        40),
  ('am-90-es',     'Llamada de 90 días',        50),
  ('am-120-es',    'Llamada de 120 días',       60),
  ('am-150-es',    'Llamada de 150 días',       70)
) as v(slug, title, sort_order)
where s.slug = 'bolton-am'
on conflict (script_id, slug) do update set
  title = excluded.title,
  sort_order = excluded.sort_order,
  language = 'es';
