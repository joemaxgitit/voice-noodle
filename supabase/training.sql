-- ============================================================
-- Training Hub: the training calendar, Master Your Craft classes,
-- the Thursday sales meeting, and the training library (videos and
-- documents) with each rep's progress.
-- Safe to run more than once.
--
-- Dates and times are stored as the local date and clock time the
-- managers typed (Pacific), so daylight saving can never shift a class.
-- ============================================================

-- 0. The managers' names, for reps' schedules. Reps cannot read other
--    people's profiles, so this hands over managers only.
create or replace function public.training_people()
returns table (id uuid, full_name text, role text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.role
  from public.profiles p
  where p.org_id = public.my_org_id() and p.active and p.role in ('admin','manager')
  order by p.full_name;
$$;
grant execute on function public.training_people() to authenticated;

-- 1. Topics: reusable subjects ("Hardship Probing Questions").
create table if not exists public.training_topics (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  title       text not null,
  category    text,
  description text,
  archived    boolean not null default false,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists training_topics_org_idx on public.training_topics(org_id, title);

-- 2. Materials: videos, PDFs, slides, documents and links.
create table if not exists public.training_materials (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  topic_id      uuid references public.training_topics(id) on delete set null,
  title         text not null,
  description   text,
  kind          text not null default 'video' check (kind in ('video','pdf','doc','slides','link')),
  storage_path  text,                 -- {org_id}/{material_id}/{file}; null for links
  url           text,                 -- for links
  file_name     text,
  size_bytes    bigint,
  duration_secs numeric,              -- videos
  version       integer not null default 1,
  published     boolean not null default true,     -- visible to reps
  required      boolean not null default false,    -- shows on reps' to-do list
  audience      text not null default 'all' check (audience in ('all','closers','ams')),
  due_date      date,
  complete_pct  integer not null default 90 check (complete_pct between 10 and 100),
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists training_materials_org_idx on public.training_materials(org_id, created_at desc);

-- 3. Each person's progress on each material. Reps never write this
--    directly -- see training_watch() and training_acknowledge().
create table if not exists public.training_progress (
  material_id   uuid not null references public.training_materials(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  org_id        uuid not null references public.orgs(id) on delete cascade,
  version       integer not null default 1,
  position_secs numeric not null default 0,    -- where to resume
  watched_secs  numeric not null default 0,    -- time actually played
  pct           integer not null default 0,
  completed_at  timestamptz,
  updated_at    timestamptz not null default now(),
  primary key (material_id, user_id)
);

-- 4. Calendar events: new-hire and general training, lunches, breaks.
--    Master Your Craft and the Thursday meeting have their own tables
--    and appear on the calendar automatically.
create table if not exists public.training_events (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.orgs(id) on delete cascade,
  kind             text not null default 'training' check (kind in ('training','break')),
  title            text not null,
  topic_id         uuid references public.training_topics(id) on delete set null,
  event_date       date not null,
  start_time       time not null,
  minutes          integer not null default 60 check (minutes between 5 and 600),
  instructor_ids   uuid[] not null default '{}',
  guest_instructors text,             -- people without an account: "Sebastian", "KJ or Rafael"
  audience         text not null default 'all' check (audience in ('all','new_hires','closers','ams')),
  required         boolean not null default true,
  status           text not null default 'draft' check (status in ('draft','published')),
  notes            text,
  material_ids     uuid[] not null default '{}',
  created_by       uuid references auth.users(id) on delete set null,
  updated_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists training_events_org_date_idx on public.training_events(org_id, event_date);

-- 5. Master Your Craft: Mon-Wed 1:30-2:00, one manager teaches the week.
create table if not exists public.mastery_weeks (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  week_start    date not null,                     -- the Monday
  topic_id      uuid references public.training_topics(id) on delete set null,
  title         text,
  instructor_id uuid references public.profiles(id) on delete set null,
  day_instructors jsonb not null default '{}'::jsonb,   -- rare per-day override: {"2": "<profile id>"}
  material_ids  uuid[] not null default '{}',
  notes         text,
  capacity      integer,
  status        text not null default 'draft' check (status in ('draft','published')),
  updated_by    uuid references auth.users(id) on delete set null,
  updated_at    timestamptz not null default now(),
  unique (org_id, week_start)
);

-- A rep's regular class day: 1 Monday, 2 Tuesday, 3 Wednesday.
create table if not exists public.mastery_regular (
  rep_id     uuid primary key references public.profiles(id) on delete cascade,
  org_id     uuid not null references public.orgs(id) on delete cascade,
  day        smallint not null check (day between 1 and 3),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- One-week moves. day 0 = not in class that week.
create table if not exists public.mastery_moves (
  org_id     uuid not null references public.orgs(id) on delete cascade,
  week_start date not null,
  rep_id     uuid not null references public.profiles(id) on delete cascade,
  day        smallint not null check (day between 0 and 3),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (week_start, rep_id)
);

-- What actually happened, kept separately from the roster.
create table if not exists public.mastery_attendance (
  org_id     uuid not null references public.orgs(id) on delete cascade,
  week_start date not null,
  rep_id     uuid not null references public.profiles(id) on delete cascade,
  day        smallint not null check (day between 1 and 3),
  status     text not null check (status in ('present','absent','excused','makeup_required','makeup_done')),
  marked_by  uuid references auth.users(id) on delete set null,
  marked_at  timestamptz not null default now(),
  primary key (week_start, rep_id)
);

-- A rep asking to attend a different day one week.
create table if not exists public.mastery_requests (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  week_start  date not null,
  rep_id      uuid not null references public.profiles(id) on delete cascade,
  to_day      smallint not null check (to_day between 1 and 3),
  note        text,
  status      text not null default 'pending' check (status in ('pending','approved','declined')),
  decided_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- 6. The Thursday sales meeting (10:00, 15-20 minutes, 4-7 topics).
create table if not exists public.meetings (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  meeting_date date not null,
  start_time   time not null default '10:00',
  status       text not null default 'draft' check (status in ('draft','published')),
  notes        text,
  updated_at   timestamptz not null default now(),
  unique (org_id, meeting_date)
);

-- Agenda items. meeting_id null = the backlog of ideas.
create table if not exists public.meeting_items (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  meeting_id   uuid references public.meetings(id) on delete cascade,
  title        text not null,
  notes        text,
  presenter_id uuid references public.profiles(id) on delete set null,
  minutes      integer not null default 3 check (minutes between 1 and 30),
  position     integer not null default 0,
  prep         text not null default 'draft' check (prep in ('draft','ready')),
  delivery     text not null default 'planned' check (delivery in ('planned','presented','deferred')),
  material_ids uuid[] not null default '{}',
  updated_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists meeting_items_meeting_idx on public.meeting_items(org_id, meeting_id, position);

-- 7. Row-level security. Managers run everything in their org; reps
--    read what is published and their own records, and change nothing
--    except asking to move a class.
alter table public.training_topics    enable row level security;
alter table public.training_materials enable row level security;
alter table public.training_progress  enable row level security;
alter table public.training_events    enable row level security;
alter table public.mastery_weeks      enable row level security;
alter table public.mastery_regular    enable row level security;
alter table public.mastery_moves      enable row level security;
alter table public.mastery_attendance enable row level security;
alter table public.mastery_requests   enable row level security;
alter table public.meetings           enable row level security;
alter table public.meeting_items      enable row level security;

do $$
declare t text;
begin
  foreach t in array array['training_topics','training_materials','training_progress','training_events',
                           'mastery_weeks','mastery_regular','mastery_moves','mastery_attendance',
                           'mastery_requests','meetings','meeting_items']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (public.is_admin() and org_id = public.my_org_id())
         with check (public.is_admin() and org_id = public.my_org_id())',
      t || '_admin', t);
  end loop;
end $$;

drop policy if exists training_topics_read on public.training_topics;
create policy training_topics_read on public.training_topics for select to authenticated
using (org_id = public.my_org_id());

drop policy if exists training_materials_read on public.training_materials;
create policy training_materials_read on public.training_materials for select to authenticated
using (org_id = public.my_org_id() and published);

drop policy if exists training_progress_own on public.training_progress;
create policy training_progress_own on public.training_progress for select to authenticated
using (user_id = auth.uid());

drop policy if exists training_events_read on public.training_events;
create policy training_events_read on public.training_events for select to authenticated
using (org_id = public.my_org_id() and status = 'published');

drop policy if exists mastery_weeks_read on public.mastery_weeks;
create policy mastery_weeks_read on public.mastery_weeks for select to authenticated
using (org_id = public.my_org_id() and status = 'published');

drop policy if exists mastery_regular_own on public.mastery_regular;
create policy mastery_regular_own on public.mastery_regular for select to authenticated
using (rep_id = auth.uid());

drop policy if exists mastery_moves_own on public.mastery_moves;
create policy mastery_moves_own on public.mastery_moves for select to authenticated
using (rep_id = auth.uid());

drop policy if exists mastery_attendance_own on public.mastery_attendance;
create policy mastery_attendance_own on public.mastery_attendance for select to authenticated
using (rep_id = auth.uid());

drop policy if exists mastery_requests_own_read on public.mastery_requests;
create policy mastery_requests_own_read on public.mastery_requests for select to authenticated
using (rep_id = auth.uid());

drop policy if exists mastery_requests_own_insert on public.mastery_requests;
create policy mastery_requests_own_insert on public.mastery_requests for insert to authenticated
with check (rep_id = auth.uid() and org_id = public.my_org_id() and status = 'pending');

drop policy if exists meetings_read on public.meetings;
create policy meetings_read on public.meetings for select to authenticated
using (org_id = public.my_org_id() and status = 'published');

-- 8. Progress, recorded on the server's terms. The player reports every
--    few seconds; time only counts up to the real time that has passed
--    since the last report (twice that, for 2x playback), so skipping
--    ahead or a faked request cannot complete a video.
create or replace function public.training_watch(p_material uuid, p_position numeric, p_played numeric)
returns table (pct integer, completed boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  m public.training_materials;
  p public.training_progress;
  credit numeric;
  dur numeric;
  newpct integer;
begin
  select * into m from public.training_materials
  where id = p_material and org_id = public.my_org_id() and (published or public.is_admin());
  if not found then raise exception 'not found'; end if;

  select * into p from public.training_progress where material_id = p_material and user_id = auth.uid();
  if not found then
    insert into public.training_progress (material_id, user_id, org_id, version, updated_at)
    values (p_material, auth.uid(), m.org_id, m.version, now() - interval '1 second')
    returning * into p;
  end if;

  -- A new version of the video starts the count again.
  if p.version <> m.version then
    p.watched_secs := 0; p.pct := 0; p.completed_at := null; p.version := m.version;
  end if;

  -- Up to 2x playback speed counts in full.
  credit := least(greatest(coalesce(p_played, 0), 0),
                  2 * extract(epoch from (now() - p.updated_at)) + 2,
                  60);
  dur := nullif(m.duration_secs, 0);
  newpct := case when dur is null then p.pct
                 else least(100, floor(100 * (p.watched_secs + credit) / dur))::integer end;

  update public.training_progress t set
    version = m.version,
    position_secs = greatest(0, coalesce(p_position, 0)),
    watched_secs = p.watched_secs + credit,
    pct = greatest(newpct, 0),
    completed_at = coalesce(p.completed_at, case when newpct >= m.complete_pct then now() end),
    updated_at = now()
  where t.material_id = p_material and t.user_id = auth.uid()
  returning t.pct, t.completed_at is not null into pct, completed;
  return next;
end;
$$;
grant execute on function public.training_watch(uuid, numeric, numeric) to authenticated;

-- Documents and links: "I've read this."
create or replace function public.training_acknowledge(p_material uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare m public.training_materials;
begin
  select * into m from public.training_materials
  where id = p_material and org_id = public.my_org_id() and (published or public.is_admin());
  if not found then raise exception 'not found'; end if;
  if m.kind = 'video' then raise exception 'videos are completed by watching them'; end if;
  insert into public.training_progress (material_id, user_id, org_id, version, pct, completed_at)
  values (p_material, auth.uid(), m.org_id, m.version, 100, now())
  on conflict (material_id, user_id) do update
    set pct = 100, version = m.version,
        completed_at = coalesce(public.training_progress.completed_at, now()), updated_at = now();
end;
$$;
grant execute on function public.training_acknowledge(uuid) to authenticated;

-- 9. Private storage for the files.
insert into storage.buckets (id, name, public)
values ('training', 'training', false)
on conflict (id) do update set public = false;

drop policy if exists training_files_read on storage.objects;
create policy training_files_read on storage.objects for select to authenticated
using (bucket_id = 'training' and (storage.foldername(name))[1] = public.my_org_id()::text);

drop policy if exists training_files_insert on storage.objects;
create policy training_files_insert on storage.objects for insert to authenticated
with check (bucket_id = 'training' and public.is_admin() and (storage.foldername(name))[1] = public.my_org_id()::text);

drop policy if exists training_files_update on storage.objects;
create policy training_files_update on storage.objects for update to authenticated
using (bucket_id = 'training' and public.is_admin() and (storage.foldername(name))[1] = public.my_org_id()::text);

drop policy if exists training_files_delete on storage.objects;
create policy training_files_delete on storage.objects for delete to authenticated
using (bucket_id = 'training' and public.is_admin() and (storage.foldername(name))[1] = public.my_org_id()::text);

-- 10. Starting topics, from the new-hire schedule and the training files.
with org as (select id from public.orgs where slug = 'lionside'),
t (title, category) as (values
  ('Credit Background', 'Credit Background'),
  ('Dealing with Debt', 'Credit Background'),
  ('Collections', 'Credit Background'),
  ('Inner Game', 'Sales Psychology'),
  ('Sales Strategy / Choice Options', 'Options Presentation'),
  ('Financial Restoration', 'Options Presentation'),
  ('OneDrive / Office / Chats', 'New Hire Training'),
  ('Straight Line Persuasion', 'Sales Psychology'),
  ('Script and Loops', 'Objections'),
  ('Contract Walkthrough', 'Compliance'),
  ('Listen to a Call', 'New Hire Training'),
  ('Covering Credit Reports', 'Credit Background'),
  ('SuperMoney and Guidelines', 'Options Presentation'),
  ('CRM', 'CRM'),
  ('Hardship Probing Questions', 'Hardship'),
  ('Take a Lead Beginning to End', 'New Hire Training'),
  ('Slate Legal Plan / Price / Tradeline Reporting', 'Company Trust'),
  ('Script Roleplay', 'New Hire Training'),
  ('Guest Speaker', 'New Hire Training'),
  ('CRM Refreshers / Pipeline Management', 'Pipeline Management'),
  ('DS Flips', 'Objections'),
  ('Softphone Setup', 'New Hire Training')
)
insert into public.training_topics (org_id, title, category)
select org.id, t.title, t.category from t, org
where not exists (
  select 1 from public.training_topics x where x.org_id = org.id and lower(x.title) = lower(t.title)
);

-- 11. Check: should return 11 tables, then the topic count.
select table_name from information_schema.tables
where table_schema = 'public' and table_name in ('training_topics','training_materials','training_progress','training_events',
  'mastery_weeks','mastery_regular','mastery_moves','mastery_attendance','mastery_requests','meetings','meeting_items')
order by 1;
select count(*) as topics from public.training_topics;
