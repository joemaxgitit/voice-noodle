-- ============================================================
-- Narrators: several voices performing the same tone map.
-- Run AFTER the previous migrations. Safe to run more than once.
--
-- Tones and coaching stay on the SEGMENT, not on the recording.
-- The research on observational learning is specific here: varying
-- the model's style helps transfer, but varying the model's strategy
-- hurts it. Three voices reading the same annotated script is the
-- first; three people making different tonal choices is the second.
-- ============================================================

-- The word-level column was added by hand earlier; make sure it exists so
-- this migration does not depend on that having been run.
alter table public.segments
add column if not exists words jsonb;

create table if not exists public.narrators (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  name       text not null,
  sort_order integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

create table if not exists public.recordings (
  id          uuid primary key default gen_random_uuid(),
  segment_id  uuid not null references public.segments(id) on delete cascade,
  narrator_id uuid not null references public.narrators(id) on delete cascade,
  audio_path  text,
  timings     jsonb not null default '[]'::jsonb,
  words       jsonb,
  version     integer not null default 1,
  updated_at  timestamptz not null default now(),
  unique (segment_id, narrator_id)
);

create index if not exists recordings_segment_idx on public.recordings(segment_id);

-- ------------------------------------------------------------
-- Seed the three narrators
-- ------------------------------------------------------------

insert into public.narrators (org_id, name, sort_order)
select o.id, v.name, v.sort_order
from public.orgs o
cross join (values
  ('Max Sharp',      10),
  ('Patrick Mclain', 20),
  ('Kevin Fallis',   30)
) as v(name, sort_order)
where o.slug = 'lionside'
on conflict (org_id, name) do update set
  sort_order = excluded.sort_order,
  active = true;

-- ------------------------------------------------------------
-- Move any audio already recorded onto Max's profile
-- ------------------------------------------------------------

insert into public.recordings (segment_id, narrator_id, audio_path, timings, words, version)
select sg.id, n.id, sg.audio_path, sg.timings, sg.words, sg.version
from public.segments sg
join public.modules m on m.id = sg.module_id
join public.scripts s on s.id = m.script_id
join public.narrators n on n.org_id = s.org_id and n.name = 'Max Sharp'
where sg.audio_path is not null
on conflict (segment_id, narrator_id) do nothing;

-- ------------------------------------------------------------
-- Row level security, mirroring the segment rules
-- ------------------------------------------------------------

alter table public.narrators  enable row level security;
alter table public.recordings enable row level security;

drop policy if exists narrators_read on public.narrators;
create policy narrators_read on public.narrators
for select to authenticated
using (org_id = public.my_org_id() and active = true);

drop policy if exists narrators_admin on public.narrators;
create policy narrators_admin on public.narrators
for all to authenticated
using (public.is_admin() and org_id = public.my_org_id())
with check (org_id = public.my_org_id());

drop policy if exists recordings_read on public.recordings;
create policy recordings_read on public.recordings
for select to authenticated
using (exists (
  select 1 from public.segments sg
  join public.modules m on m.id = sg.module_id
  join public.scripts s on s.id = m.script_id
  where sg.id = recordings.segment_id
    and s.org_id = public.my_org_id()
    and public.can_see_script(s.team)
));

drop policy if exists recordings_admin on public.recordings;
create policy recordings_admin on public.recordings
for all to authenticated
using (public.is_admin() and exists (
  select 1 from public.segments sg
  join public.modules m on m.id = sg.module_id
  join public.scripts s on s.id = m.script_id
  where sg.id = recordings.segment_id and s.org_id = public.my_org_id()
))
with check (true);

-- ------------------------------------------------------------
-- Remember each rep's preferred voice
-- ------------------------------------------------------------

alter table public.profiles
add column if not exists narrator_id uuid references public.narrators(id) on delete set null;
