-- ============================================================
-- Follow-up calls and client journeys. Calls with the same client ID are
-- one journey; call_number is the manager's number for this call in it
-- (empty = numbered automatically by date). handoff: a call taken by a
-- different rep because the lead went to renew, or to cover for an absent rep.
-- ============================================================
alter table public.calls add column if not exists call_number integer check (call_number is null or call_number between 1 and 30);
alter table public.calls add column if not exists handoff text check (handoff is null or handoff in ('renew', 'coverage'));
create index if not exists calls_client_idx on public.calls(org_id, lower(trim(client_label)));
notify pgrst, 'reload schema';
select 'follow-ups ready' as result;

-- One read of each client's whole journey: bridges, disconnects, what decided it. Updated as calls are graded.
create table if not exists public.client_journeys (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  client_key  text not null,
  read        jsonb not null default '{}'::jsonb,
  calls_read  integer not null default 0,
  model       text,
  usd         numeric,
  updated_at  timestamptz not null default now(),
  unique (org_id, client_key)
);
alter table public.client_journeys enable row level security;
drop policy if exists client_journeys_manager on public.client_journeys;
create policy client_journeys_manager on public.client_journeys for all to authenticated
using (public.is_admin() and org_id = public.my_org_id())
with check (public.is_admin() and org_id = public.my_org_id());
grant select, insert, update, delete on public.client_journeys to authenticated;
notify pgrst, 'reload schema';
