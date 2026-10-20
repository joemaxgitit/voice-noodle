-- ============================================================
-- Each rep's own "style that works": what shows up in their calls whose
-- clients stuck (graduated or made 6+ payments) and not in their calls
-- whose clients cancelled. Compared against the rep's own calls only, so
-- one rep's style is never forced on another. Managers only.
-- ============================================================
create table if not exists public.rep_fingerprints (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  rep_id     uuid not null references public.profiles(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  inputs     jsonb not null default '{}'::jsonb,   -- { proven, cancelled }
  body       jsonb not null default '{}'::jsonb,
  model      text,
  usd        numeric,
  created_at timestamptz not null default now()
);
create index if not exists rep_fingerprints_rep_idx on public.rep_fingerprints(rep_id, created_at desc);

alter table public.rep_fingerprints enable row level security;
drop policy if exists rep_fingerprints_manager on public.rep_fingerprints;
create policy rep_fingerprints_manager on public.rep_fingerprints for all to authenticated
using (public.is_admin() and org_id = public.my_org_id() and public.can_see_person(rep_id))
with check (public.is_admin() and org_id = public.my_org_id());
grant select, insert, delete on public.rep_fingerprints to authenticated;

notify pgrst, 'reload schema';
select 'rep style ready' as result;
