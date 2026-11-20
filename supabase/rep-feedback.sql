-- ============================================================
-- Call feedback a manager sends to a rep.
-- The grade comes from AI, so a rep never sees it directly: a manager
-- reviews it, edits what goes, and sends it. What the rep sees is a copy
-- of exactly what the manager approved -- a later re-grade never changes it,
-- and the rep can't read the call, its grade or its transcript.
-- Reps can't upload or change anything here; they can only read their own
-- and mark it seen.
-- Safe to run more than once.
-- ============================================================
set lock_timeout = '5s';

create table if not exists public.rep_feedback (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  rep_id      uuid not null references public.profiles(id) on delete cascade,
  call_id     uuid references public.calls(id) on delete set null,
  sent_by     uuid references public.profiles(id) on delete set null,
  sent_by_name text,
  call_date   date,
  script_title text,
  content     jsonb not null,
  created_at  timestamptz not null default now(),
  seen_at     timestamptz
);
create index if not exists rep_feedback_rep_idx on public.rep_feedback(rep_id, created_at desc);
create index if not exists rep_feedback_call_idx on public.rep_feedback(call_id);

alter table public.rep_feedback enable row level security;

-- Managers and admins: their own side's reps only.
drop policy if exists rep_feedback_admin on public.rep_feedback;
create policy rep_feedback_admin on public.rep_feedback
for all to authenticated
using (public.is_admin() and org_id = public.my_org_id() and public.can_see_person(rep_id))
with check (public.is_admin() and org_id = public.my_org_id() and public.can_see_person(rep_id) and sent_by = auth.uid());

-- Reps: read their own, nothing else.
drop policy if exists rep_feedback_own on public.rep_feedback;
create policy rep_feedback_own on public.rep_feedback
for select to authenticated
using (rep_id = auth.uid());

-- Reps mark their own as seen (the only thing they can change).
create or replace function public.mark_feedback_seen(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.rep_feedback set seen_at = coalesce(seen_at, now()) where id = p_id and rep_id = auth.uid();
$$;
grant execute on function public.mark_feedback_seen(uuid) to authenticated;

notify pgrst, 'reload schema';

select count(*) as rep_feedback_rows from public.rep_feedback;
