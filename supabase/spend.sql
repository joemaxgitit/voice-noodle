-- ============================================================
-- Spending: every paid action, in one log, so managers can see today's and
-- this month's spend against limits they set. Managers and admins only.
-- Safe to run more than once.
-- ============================================================

alter table public.orgs add column if not exists budget_daily_usd numeric;
alter table public.orgs add column if not exists budget_monthly_usd numeric;

create table if not exists public.spend_log (
  id      uuid primary key default gen_random_uuid(),
  org_id  uuid not null references public.orgs(id) on delete cascade,
  at      timestamptz not null default now(),
  kind    text not null,      -- transcribe | grade | translate | roleplay | review | card_draft | dropbox | lessons
  usd     numeric not null,
  user_id uuid references public.profiles(id) on delete set null,
  ref_id  uuid,               -- the call, review or rep it was for
  note    text
);
create index if not exists spend_log_org_at_idx on public.spend_log(org_id, at desc);
create index if not exists spend_log_kind_idx on public.spend_log(org_id, kind, at desc);

alter table public.spend_log enable row level security;
drop policy if exists spend_log_admin_read on public.spend_log;
create policy spend_log_admin_read on public.spend_log for select to authenticated
using (public.is_admin() and org_id = public.my_org_id());
drop policy if exists spend_log_admin_insert on public.spend_log;
create policy spend_log_admin_insert on public.spend_log for insert to authenticated
with check (public.is_admin() and org_id = public.my_org_id());

-- Calls already record what each step cost; log the difference whenever it
-- changes, whoever triggered it (a rep's practice call included).
create or replace function public.log_call_spend()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  who uuid := coalesce(new.rep_id, new.uploaded_by);
  d numeric;
begin
  d := coalesce((new.cost->>'transcribe_usd')::numeric, 0) - coalesce((case when tg_op = 'UPDATE' then old.cost->>'transcribe_usd' end)::numeric, 0);
  if d > 0 then insert into public.spend_log(org_id, kind, usd, user_id, ref_id) values (new.org_id, 'transcribe', d, who, new.id); end if;

  d := coalesce((new.cost->>'grade_usd_total')::numeric, 0) - coalesce((case when tg_op = 'UPDATE' then old.cost->>'grade_usd_total' end)::numeric, 0);
  if d > 0 then insert into public.spend_log(org_id, kind, usd, user_id, ref_id) values (new.org_id, 'grade', d, who, new.id); end if;

  d := coalesce((new.cost->>'roleplay_usd')::numeric, 0) - coalesce((case when tg_op = 'UPDATE' then old.cost->>'roleplay_usd' end)::numeric, 0);
  if d > 0 then insert into public.spend_log(org_id, kind, usd, user_id, ref_id) values (new.org_id, 'roleplay', d, who, new.id); end if;

  d := coalesce((new.translation->>'usd')::numeric, 0) - coalesce((case when tg_op = 'UPDATE' then old.translation->>'usd' end)::numeric, 0);
  if d > 0 then insert into public.spend_log(org_id, kind, usd, user_id, ref_id) values (new.org_id, 'translate', d, who, new.id); end if;

  return new;
end $$;

drop trigger if exists calls_spend on public.calls;
create trigger calls_spend after insert or update of cost, translation on public.calls
for each row execute function public.log_call_spend();

-- One-time backfill from calls processed before this existed.
insert into public.spend_log (org_id, at, kind, usd, user_id, ref_id, note)
select c.org_id, c.created_at, k.kind, k.usd, coalesce(c.rep_id, c.uploaded_by), c.id, 'before tracking'
from public.calls c
cross join lateral (values
  ('transcribe', (c.cost->>'transcribe_usd')::numeric),
  ('grade',      (c.cost->>'grade_usd_total')::numeric),
  ('roleplay',   (c.cost->>'roleplay_usd')::numeric),
  ('translate',  (c.translation->>'usd')::numeric)
) as k(kind, usd)
where k.usd > 0
  and not exists (select 1 from public.spend_log s where s.ref_id = c.id and s.kind = k.kind);

select 'spending ready' as result, count(*) as rows_logged from public.spend_log;
