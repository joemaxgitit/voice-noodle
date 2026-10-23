-- ============================================================
-- Speed. Safe to run more than once.
-- 1. Every security rule (row level security) called its helper -- "is this a
--    manager?", "which company are they in?" -- once PER ROW. With thousands of
--    calls that's thousands of lookups per page. Wrapped in (select ...) Postgres
--    runs each helper once per query instead. Same rules, same answers.
-- 2. Indexes for the ways pages look calls up (by date, rep, status).
-- ============================================================
set lock_timeout = '5s'; -- gives up instead of freezing the app if tables are busy; just run it again

-- Rewrites one rule: helpers wrapped so they run once per query; an admin skips the per-row "which side" check.
create or replace function public._vn_fast(e text) returns text language plpgsql immutable as $f$
begin
  e := regexp_replace(e, '(?<![A-Za-z_])(?<!SELECT )(public\.)?(is_admin|my_org_id|my_role|is_super_admin)\(\)', '(select public.\2())', 'g');
  e := regexp_replace(e, '(?<!SELECT )auth\.uid\(\)', '(select auth.uid())', 'g');
  e := regexp_replace(e, '(?<![A-Za-z_])(?<!OR )(public\.)?can_see_person\(([a-z_]+)\)', '((select public.my_role()) = ''admin'' OR public.can_see_person(\2))', 'g');
  return e;
end $f$;

do $$
declare
  p record;
  q text;
  c text;
  n int := 0;
begin
  for p in select tablename, policyname, qual, with_check from pg_policies where schemaname = 'public' loop
    q := p.qual;
    c := p.with_check;
    if q is not null then
      q := public._vn_fast(q);
    end if;
    if c is not null then
      c := public._vn_fast(c);
    end if;
    if q is distinct from p.qual then
      execute format('alter policy %I on public.%I using (%s)', p.policyname, p.tablename, q);
      n := n + 1;
    end if;
    if c is distinct from p.with_check then
      execute format('alter policy %I on public.%I with check (%s)', p.policyname, p.tablename, c);
      n := n + 1;
    end if;
  end loop;
  raise notice 'Security rules sped up: %', n;
end $$;

create index if not exists calls_org_date_idx on public.calls (org_id, call_date desc, created_at desc);
create index if not exists calls_org_status_idx on public.calls (org_id, status);
create index if not exists calls_rep_date_idx on public.calls (rep_id, call_date desc);
create index if not exists calls_retention_idx on public.calls (retention) where retention is not null;
create index if not exists calls_outcome_idx on public.calls (org_id, outcome);
do $$ begin
  if to_regclass('public.retention_cancels') is not null then
    execute 'create index if not exists retention_cancels_rep_idx on public.retention_cancels (rep_id, requested)';
  end if;
  if to_regclass('public.rep_daily') is not null then
    execute 'create index if not exists rep_daily_rep_day_idx on public.rep_daily (rep_id, day desc)';
  end if;
end $$;

drop function public._vn_fast(text);
analyze public.calls;
notify pgrst, 'reload schema';
