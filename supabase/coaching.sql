-- ============================================================
-- One-on-one coaching sessions. The manager jots short notes after a
-- one-on-one; Claude tidies them into a summary, the commitments made and
-- the topics covered (from the team's own short list), and the next
-- one-on-one opens with the last one. Managers and admins only.
-- Safe to run more than once.
-- ============================================================

create table if not exists public.coaching_topics (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  name       text not null,
  hint       text,                 -- what belongs here, so Claude sorts notes the way you would
  sort_order integer not null default 0,
  archived   boolean not null default false,
  unique (org_id, name)
);

create table if not exists public.coaching_sessions (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  rep_id       uuid not null references public.profiles(id) on delete cascade,
  manager_id   uuid references public.profiles(id) on delete set null,
  session_date date not null default current_date,
  raw_notes    text not null,      -- exactly what the manager typed
  summary      text,
  topics       text[] not null default '{}',
  commitments  jsonb not null default '[]'::jsonb,  -- [{ "text": "...", "status": "open"|"kept"|"missed" }]
  follow_up    text,               -- what to check next time
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists coaching_sessions_rep_idx on public.coaching_sessions(org_id, rep_id, session_date desc);
create index if not exists coaching_sessions_topics_idx on public.coaching_sessions using gin(topics);
alter table public.coaching_sessions enable row level security;

do $$
declare t text;
begin
  foreach t in array array['coaching_topics'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (public.is_admin() and org_id = public.my_org_id())
         with check (public.is_admin() and org_id = public.my_org_id())',
      t || '_admin_all', t);
  end loop;
end $$;

-- The starting list. Rename, add or retire topics on the Coaching trends page.
insert into public.coaching_topics (org_id, name, hint, sort_order)
select o.id, v.name, v.hint, v.ord
from public.orgs o
cross join (values
  ('State check',          'Mindset, energy, confidence, call reluctance, how the rep is doing personally', 1),
  ('Pre-flight',           'Preparing before calls: reviewing the lead, setup, goals for the day', 2),
  ('File review',          'Reviewing client files, deals, pending and cancelled files, paperwork quality', 3),
  ('Efficiency',           'Dials, talk time, time management, pace, follow-ups, using the day well', 4),
  ('Straight Line skills', 'Tonality, looping, certainty, rapport, the script and objection handling on calls', 5),
  ('Compliance',           'Disclosures, accurate claims, what can and cannot be promised', 6)
) as v(name, hint, ord)
on conflict (org_id, name) do nothing;



-- ------------------------------------------------------------
-- Personal notes: a note or one-on-one marked personal (column "private")
-- is still seen by every manager and admin -- no secrets -- but is never
-- sent to Claude: not reviews, card drafts, tidying or trends.
-- ------------------------------------------------------------
alter table public.rep_notes add column if not exists private boolean not null default false;
alter table public.coaching_sessions add column if not exists private boolean not null default false;

drop policy if exists rep_notes_admin_all on public.rep_notes;
drop policy if exists rep_notes_team on public.rep_notes;
create policy rep_notes_team on public.rep_notes for all to authenticated
using (public.is_admin() and org_id = public.my_org_id())
with check (public.is_admin() and org_id = public.my_org_id());

drop policy if exists coaching_sessions_admin_all on public.coaching_sessions;
drop policy if exists coaching_sessions_team on public.coaching_sessions;
create policy coaching_sessions_team on public.coaching_sessions for all to authenticated
using (public.is_admin() and org_id = public.my_org_id())
with check (public.is_admin() and org_id = public.my_org_id());

select 'coaching ready' as result, count(*) as topics from public.coaching_topics;
