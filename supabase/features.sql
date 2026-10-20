-- Extra manager features the super admin turns on or off for everyone else.
create table if not exists public.app_features (
  org_id     uuid primary key references public.orgs(id) on delete cascade,
  flags      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.app_features enable row level security;

drop policy if exists app_features_read on public.app_features;
create policy app_features_read on public.app_features for select to authenticated
using (org_id = public.my_org_id());

drop policy if exists app_features_write on public.app_features;
create policy app_features_write on public.app_features for all to authenticated
using (public.is_super_admin() and org_id = public.my_org_id())
with check (public.is_super_admin() and org_id = public.my_org_id());

grant select, insert, update on public.app_features to authenticated;

-- Start with everything off for other managers (as it is today).
insert into public.app_features (org_id, flags)
select id, '{}'::jsonb from public.orgs
on conflict (org_id) do nothing;

select 'features ready' as result;
