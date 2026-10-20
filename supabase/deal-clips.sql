-- Morning Deal Clip snapshots: each rep's month-to-date deals and month-end projection, per day.
create table if not exists public.deal_clips (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  day        date not null,
  rep_id     uuid references public.profiles(id) on delete set null,
  salesman   text not null,
  deals      numeric not null default 0,
  ratio      numeric,
  clip       numeric not null default 0,
  two_a_day  numeric,
  gone       integer not null,
  total      integer not null,
  team_name  text,
  saved_by   uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, day, salesman)
);
create index if not exists deal_clips_rep_idx on public.deal_clips(rep_id, day desc);
alter table public.deal_clips enable row level security;

drop policy if exists deal_clips_manager on public.deal_clips;
create policy deal_clips_manager on public.deal_clips for all to authenticated
using (public.is_admin() and org_id = public.my_org_id() and public.can_see_person(rep_id))
with check (public.is_admin() and org_id = public.my_org_id());

grant select, insert, update, delete on public.deal_clips to authenticated;

-- Make PostgREST see new columns and tables right away.
notify pgrst, 'reload schema';

select 'deal clips ready' as result;
