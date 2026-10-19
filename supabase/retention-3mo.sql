-- ============================================================
-- 3-month retention look back.
-- Every cancelled (lost) client from the Friday lookbacks, kept once by
-- client ID -- the weekly windows overlap, so a client counts once.
-- Client ID only: no names. Before or after the 1st payment.
-- Links to the rep by name like every other report. Safe to run more than once.
-- ============================================================

create table if not exists public.retention_cancels (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  rep_id     uuid references public.profiles(id) on delete set null,
  salesman   text not null,
  client_id  text not null,
  requested  date not null,
  stage      text not null check (stage in ('before_1st', 'after_1st', 'other')),
  created_at timestamptz not null default now(),
  unique (org_id, client_id)
);
create index if not exists retention_cancels_rep_idx on public.retention_cancels(org_id, rep_id, requested desc);

alter table public.retention_cancels enable row level security;
grant select, insert, update, delete on public.retention_cancels to authenticated;

drop policy if exists retention_cancels_admin_all on public.retention_cancels;
create policy retention_cancels_admin_all on public.retention_cancels for all to authenticated
using (public.is_admin() and org_id = public.my_org_id() and public.can_see_person(rep_id))
with check (public.is_admin() and org_id = public.my_org_id() and public.can_see_person(rep_id));

-- Link to the rep by name, on the way in.
drop trigger if exists retention_cancels_link_name on public.retention_cancels;
create trigger retention_cancels_link_name before insert on public.retention_cancels
for each row execute function public.link_row_by_name();

-- And when an account's name changes later.
create or replace function public.link_rows_for_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.org_id is null then return new; end if;
  update public.kpi_rows r set rep_id = new.id
   where r.rep_id is null and r.org_id = new.org_id and public.match_rep_by_name(r.org_id, r.salesman) = new.id;
  update public.rep_daily r set rep_id = new.id
   where r.rep_id is null and r.org_id = new.org_id and public.match_rep_by_name(r.org_id, r.salesman) = new.id;
  update public.retention_reps r set rep_id = new.id
   where r.rep_id is null and r.org_id = new.org_id and public.match_rep_by_name(r.org_id, r.salesman) = new.id;
  update public.retention_cancels r set rep_id = new.id
   where r.rep_id is null and r.org_id = new.org_id and public.match_rep_by_name(r.org_id, r.salesman) = new.id;
  return new;
end $$;

select 'retention look back ready' as result;
