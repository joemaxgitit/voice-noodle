-- ============================================================
-- Practice clients that learn from real calls.
-- After a real call is graded, an anonymous profile of the client is
-- kept here: their situation, the objections they raised in their own
-- words (no names or numbers), what made them go cold or warm up, and how
-- the call ended. Practice clients borrow real wording from it, and new
-- practice clients are drafted from it for a manager to approve.
-- Safe to run more than once.
-- ============================================================
create table if not exists public.client_insights (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  call_id    uuid not null references public.calls(id) on delete cascade,
  lang       text not null default 'en' check (lang in ('en','es')),
  kind       text not null default 'full' check (kind in ('full','short','skip')),
  outcome    text,
  profile    jsonb not null default '{}'::jsonb,
  objections jsonb not null default '[]'::jsonb,
  moments    jsonb not null default '{}'::jsonb,   -- { cold: [...], warm: [...] }
  ending     jsonb not null default '{}'::jsonb,   -- { how, hung_up, trigger, last_words }
  used_in    uuid references public.roleplay_personas(id) on delete set null,  -- drafted into this practice client
  model      text,
  usd        numeric,
  created_at timestamptz not null default now(),
  unique (call_id)
);
create index if not exists client_insights_org_idx on public.client_insights(org_id, created_at desc);

alter table public.client_insights enable row level security;
drop policy if exists client_insights_admin on public.client_insights;
create policy client_insights_admin on public.client_insights for all to authenticated
using (public.is_admin() and org_id = public.my_org_id())
with check (public.is_admin() and org_id = public.my_org_id());
grant select, insert, update, delete on public.client_insights to authenticated;

-- Where a practice client came from, so drafts from real calls stand out.
alter table public.roleplay_personas add column if not exists origin text not null default 'manual';
-- How long this client gives a rep before hanging up: 1 (very short fuse) to 10 (very patient).
alter table public.roleplay_persona_secrets add column if not exists patience integer;

notify pgrst, 'reload schema';
select 'real-call learning ready' as result;

-- Notes a manager drops while listening in on a practice call: [{ at, text, by, name, when }].
alter table public.calls add column if not exists live_notes jsonb;
notify pgrst, 'reload schema';

-- Suggested updates to a practice client from real calls, waiting for a manager: { backstory, patience, why, based_on, at }.
alter table public.roleplay_persona_secrets add column if not exists proposal jsonb;
notify pgrst, 'reload schema';
