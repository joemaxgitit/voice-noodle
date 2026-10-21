-- ============================================================
-- Client archetypes: the kinds of clients that actually show up on
-- real calls, grouped through the Straight Line lens (buyer type,
-- action threshold, pain, weakest Ten, core belief, openness, Pluto).
-- Drafted by the app from real calls, approved by a manager, then used
-- to build and mix the practice clients. Managers only.
-- Safe to run more than once.
-- ============================================================
create table if not exists public.client_archetypes (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  created_by  uuid references auth.users(id) on delete set null,
  status      text not null default 'draft' check (status in ('draft','approved','replaced')),
  body        jsonb not null default '{}'::jsonb,   -- { archetypes: [...], notes }
  inputs      jsonb not null default '{}'::jsonb,   -- { clients, proven, cancelled }
  usd         numeric,
  created_at  timestamptz not null default now(),
  approved_at timestamptz
);
create index if not exists client_archetypes_org_idx on public.client_archetypes(org_id, created_at desc);
alter table public.client_archetypes enable row level security;
drop policy if exists client_archetypes_manager on public.client_archetypes;
create policy client_archetypes_manager on public.client_archetypes for all to authenticated
using (public.is_admin() and org_id = public.my_org_id())
with check (public.is_admin() and org_id = public.my_org_id());
grant select, insert, update, delete on public.client_archetypes to authenticated;

notify pgrst, 'reload schema';
