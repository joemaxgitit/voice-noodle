-- "Coach this": a coaching focus a manager starts from a call's Coach Now card, checked on the rep's next 5 calls that give a chance to show it.
set lock_timeout = '5s'; -- gives up instead of freezing the app if busy; just run it again

create table if not exists public.coaching_focus (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  rep_id      uuid not null references public.profiles(id) on delete cascade,
  call_id     uuid references public.calls(id) on delete set null, -- the call it was coached from
  skill       text,
  title       text not null,
  next_call   text,
  drill       text,
  check_for   text,
  shared      boolean not null default false,          -- shown on the rep's home only when a manager sends it
  status      text not null default 'active',          -- active | done | stopped | replaced
  result      text,                                    -- improved | mixed | not_yet
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists coaching_focus_rep on public.coaching_focus (rep_id, status, created_at desc);

create table if not exists public.coaching_focus_checks (
  focus_id   uuid not null references public.coaching_focus(id) on delete cascade,
  call_id    uuid not null references public.calls(id) on delete cascade,
  org_id     uuid not null references public.orgs(id) on delete cascade,
  call_date  date,
  shown      text,     -- yes | partly | no
  quote      text,
  at_secs    numeric,
  note       text,
  created_at timestamptz not null default now(),
  primary key (focus_id, call_id)
);

alter table public.coaching_focus enable row level security;
alter table public.coaching_focus_checks enable row level security;

drop policy if exists coaching_focus_admin on public.coaching_focus;
create policy coaching_focus_admin on public.coaching_focus
for all to authenticated
using ((select public.is_admin()) and org_id = (select public.my_org_id()))
with check ((select public.is_admin()) and org_id = (select public.my_org_id()));

-- A rep sees only their own focus, and only once a manager has sent it.
drop policy if exists coaching_focus_rep_read on public.coaching_focus;
create policy coaching_focus_rep_read on public.coaching_focus
for select to authenticated
using (rep_id = (select auth.uid()) and shared = true and status = 'active');

drop policy if exists coaching_focus_checks_admin on public.coaching_focus_checks;
create policy coaching_focus_checks_admin on public.coaching_focus_checks
for all to authenticated
using ((select public.is_admin()) and org_id = (select public.my_org_id()))
with check ((select public.is_admin()) and org_id = (select public.my_org_id()));

notify pgrst, 'reload schema';
