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
