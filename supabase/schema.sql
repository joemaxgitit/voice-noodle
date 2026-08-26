-- ============================================================
-- SCRIPT KARAOKE — SCHEMA V2 (multi-tenant)
-- Run once in Supabase > SQL Editor.
-- Safe to re-run.
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- 1. TENANTS
-- ------------------------------------------------------------

create table if not exists public.orgs (
  id         uuid primary key default gen_random_uuid(),
  slug       text unique not null,
  name       text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  org_id     uuid references public.orgs(id) on delete cascade,
  full_name  text,
  role       text not null default 'rep' check (role in ('rep','manager','admin')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists profiles_org_idx on public.profiles(org_id);

-- ------------------------------------------------------------
-- 2. CONTENT  (org -> script -> module -> segment)
-- ------------------------------------------------------------

create table if not exists public.scripts (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  slug       text not null,
  title      text not null,
  kind       text not null default 'sales',   -- sales | csr | screenplay | custom
  sort_order integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, slug)
);

create table if not exists public.modules (
  id         uuid primary key default gen_random_uuid(),
  script_id  uuid not null references public.scripts(id) on delete cascade,
  slug       text not null,
  title      text not null,
  sort_order integer not null default 0,
  active     boolean not null default true,
  unique (script_id, slug)
);

create table if not exists public.segments (
  id                 uuid primary key default gen_random_uuid(),
  module_id          uuid not null references public.modules(id) on delete cascade,
  segment_code       text not null,              -- OPEN-002, HARDSHIP-004
  sort_order         integer not null default 0,
  title              text,
  script_text        text not null,              -- what the customer hears
  tones              text[] not null default '{}',
  coaching           text,
  client_should_feel text,
  audio_path         text,                       -- {org_id}/{segment_code}-v{n}.mp3
  timings            jsonb not null default '[]'::jsonb,
  version            integer not null default 1,
  status             text not null default 'draft' check (status in ('draft','published')),
  active             boolean not null default true,
  updated_at         timestamptz not null default now(),
  unique (module_id, segment_code)
);

create index if not exists segments_module_idx on public.segments(module_id);

-- Version history so you can restore v2 after deciding v3 was worse.
create table if not exists public.segment_versions (
  id          uuid primary key default gen_random_uuid(),
  segment_id  uuid not null references public.segments(id) on delete cascade,
  version     integer not null,
  audio_path  text,
  timings     jsonb not null default '[]'::jsonb,
  script_text text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  unique (segment_id, version)
);

create table if not exists public.progress (
  user_id    uuid not null references auth.users(id) on delete cascade,
  segment_id uuid not null references public.segments(id) on delete cascade,
  completed  boolean not null default false,
  play_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, segment_id)
);

-- ------------------------------------------------------------
-- 3. HELPERS
-- security definer = bypasses RLS, which prevents policy recursion
-- ------------------------------------------------------------

create or replace function public.my_org_id()
returns uuid language sql stable security definer set search_path = public as $$
  select org_id from public.profiles
  where id = auth.uid() and active = true
$$;

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles
  where id = auth.uid() and active = true
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('admin','manager'), false)
$$;

-- ------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- ------------------------------------------------------------

alter table public.orgs             enable row level security;
alter table public.profiles         enable row level security;
alter table public.scripts          enable row level security;
alter table public.modules          enable row level security;
alter table public.segments         enable row level security;
alter table public.segment_versions enable row level security;
alter table public.progress         enable row level security;

-- orgs: you can see your own org
drop policy if exists orgs_read on public.orgs;
create policy orgs_read on public.orgs
for select to authenticated
using (id = public.my_org_id());

-- profiles: read yourself always; admins read their whole org
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
for select to authenticated
using (id = auth.uid() or (public.is_admin() and org_id = public.my_org_id()));

drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles
for update to authenticated
using (public.is_admin() and org_id = public.my_org_id())
with check (org_id = public.my_org_id());

-- scripts / modules: read within org
drop policy if exists scripts_read on public.scripts;
create policy scripts_read on public.scripts
for select to authenticated
using (org_id = public.my_org_id() and active = true);

drop policy if exists scripts_admin_all on public.scripts;
create policy scripts_admin_all on public.scripts
for all to authenticated
using (public.is_admin() and org_id = public.my_org_id())
with check (org_id = public.my_org_id());

drop policy if exists modules_read on public.modules;
create policy modules_read on public.modules
for select to authenticated
using (active = true and exists (
  select 1 from public.scripts s
  where s.id = modules.script_id and s.org_id = public.my_org_id()
));

drop policy if exists modules_admin_all on public.modules;
create policy modules_admin_all on public.modules
for all to authenticated
using (public.is_admin() and exists (
  select 1 from public.scripts s
  where s.id = modules.script_id and s.org_id = public.my_org_id()
))
with check (exists (
  select 1 from public.scripts s
  where s.id = modules.script_id and s.org_id = public.my_org_id()
));

-- segments: reps see PUBLISHED only; admins see drafts too
drop policy if exists segments_read on public.segments;
create policy segments_read on public.segments
for select to authenticated
using (
  active = true
  and (status = 'published' or public.is_admin())
  and exists (
    select 1 from public.modules m
    join public.scripts s on s.id = m.script_id
    where m.id = segments.module_id and s.org_id = public.my_org_id()
  )
);

drop policy if exists segments_admin_all on public.segments;
create policy segments_admin_all on public.segments
for all to authenticated
using (public.is_admin() and exists (
  select 1 from public.modules m
  join public.scripts s on s.id = m.script_id
  where m.id = segments.module_id and s.org_id = public.my_org_id()
))
with check (exists (
  select 1 from public.modules m
  join public.scripts s on s.id = m.script_id
  where m.id = segments.module_id and s.org_id = public.my_org_id()
));

-- segment_versions: admins only
drop policy if exists segment_versions_admin on public.segment_versions;
create policy segment_versions_admin on public.segment_versions
for all to authenticated
using (public.is_admin() and exists (
  select 1 from public.segments sg
  join public.modules m on m.id = sg.module_id
  join public.scripts s on s.id = m.script_id
  where sg.id = segment_versions.segment_id and s.org_id = public.my_org_id()
))
with check (true);

-- progress: your own rows; managers can read their org's
drop policy if exists progress_own on public.progress;
create policy progress_own on public.progress
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists progress_manager_read on public.progress;
create policy progress_manager_read on public.progress
for select to authenticated
using (public.is_admin() and exists (
  select 1 from public.profiles p
  where p.id = progress.user_id and p.org_id = public.my_org_id()
));

-- ------------------------------------------------------------
-- 5. AUTO-PROFILE ON SIGNUP
-- ------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, org_id, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    (new.raw_user_meta_data->>'org_id')::uuid,
    coalesce(new.raw_user_meta_data->>'role', 'rep')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- ------------------------------------------------------------
-- 6. STORAGE  (create private bucket "master-audio" in the UI first)
-- Path convention: {org_id}/{SEGMENT-CODE}-v{n}.mp3
-- ------------------------------------------------------------

drop policy if exists master_audio_read on storage.objects;
create policy master_audio_read on storage.objects
for select to authenticated
using (
  bucket_id = 'master-audio'
  and (storage.foldername(name))[1] = public.my_org_id()::text
);

drop policy if exists master_audio_admin_write on storage.objects;
create policy master_audio_admin_write on storage.objects
for insert to authenticated
with check (
  bucket_id = 'master-audio'
  and public.is_admin()
  and (storage.foldername(name))[1] = public.my_org_id()::text
);

drop policy if exists master_audio_admin_update on storage.objects;
create policy master_audio_admin_update on storage.objects
for update to authenticated
using (
  bucket_id = 'master-audio'
  and public.is_admin()
  and (storage.foldername(name))[1] = public.my_org_id()::text
);
