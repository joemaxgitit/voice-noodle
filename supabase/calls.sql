-- ============================================================
-- Call monitoring: uploaded rep/client call recordings,
-- their redacted transcripts, and script grades.
-- Safe to run more than once.
--
-- Admins and managers only. Reps cannot read this table or the
-- audio bucket at all -- the recordings contain client banking
-- details spoken aloud, even though the transcripts do not.
-- ============================================================

-- 1. The private audio bucket. Created here so there is no UI step.
insert into storage.buckets (id, name, public)
values ('call-audio', 'call-audio', false)
on conflict (id) do update set public = false;

-- 2. One row per uploaded call.
create table if not exists public.calls (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  uploaded_by    uuid references auth.users(id) on delete set null,
  rep_id         uuid references public.profiles(id) on delete set null,
  client_label   text,                      -- whatever the manager types; optional
  call_date      date,
  script_id      uuid references public.scripts(id) on delete set null,
  file_name      text,
  audio_path     text,                      -- {org_id}/{call_id}.{ext}; null once audio is deleted
  duration_secs  numeric,
  status         text not null default 'uploading'
                 check (status in ('uploading','uploaded','transcribing','transcribed','grading','graded','failed')),
  error          text,
  transcript     jsonb,                     -- { utterances: [...], speakers: [...] } -- already redacted
  redaction_count integer not null default 0,
  speaker_roles  jsonb,                     -- manager override: { "speaker_0": "rep", ... }
  grade          jsonb,                     -- the grader's full result
  score          integer,                   -- 0-100, computed from grade sections
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists calls_org_created_idx on public.calls(org_id, created_at desc);
create index if not exists calls_rep_idx on public.calls(rep_id);

alter table public.calls enable row level security;

drop policy if exists calls_admin_all on public.calls;
create policy calls_admin_all on public.calls
for all to authenticated
using (public.is_admin() and org_id = public.my_org_id())
with check (public.is_admin() and org_id = public.my_org_id());

-- 3. Storage policies: admins/managers, own org folder only.
drop policy if exists call_audio_admin_read on storage.objects;
create policy call_audio_admin_read on storage.objects
for select to authenticated
using (
  bucket_id = 'call-audio'
  and public.is_admin()
  and (storage.foldername(name))[1] = public.my_org_id()::text
);

drop policy if exists call_audio_admin_insert on storage.objects;
create policy call_audio_admin_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'call-audio'
  and public.is_admin()
  and (storage.foldername(name))[1] = public.my_org_id()::text
);

drop policy if exists call_audio_admin_delete on storage.objects;
create policy call_audio_admin_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'call-audio'
  and public.is_admin()
  and (storage.foldername(name))[1] = public.my_org_id()::text
);

-- 4. Check: should return one row, public = false.
select id, public from storage.buckets where id = 'call-audio';
