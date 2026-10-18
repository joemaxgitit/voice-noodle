-- ============================================================
-- Training cards: one behavior, drafted by Claude, approved and signed by
-- a manager, sent to a rep. Reps see only their own cards once sent, and
-- can only answer them (got it / question / I see it differently), edit
-- their when-then plan, and log practice -- through the functions below.
-- Safe to run more than once.
-- ============================================================

create table if not exists public.training_cards (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  rep_id       uuid not null references public.profiles(id) on delete cascade,
  kind         text not null default 'focus' check (kind in ('focus','win','model','compliance','encouragement')),
  skill        text not null default '',
  noticed      text not null default '',      -- what I noticed, with the moment from their call
  why          text not null default '',
  try_this     text not null default '',
  when_then    text not null default '',      -- "When ___, I'll ___." as the manager wrote it
  rep_plan     text,                          -- the rep's own edit of it
  call_id      uuid references public.calls(id) on delete set null,
  call_moment  text,                          -- "at 4:12" plus the line, shown with the card
  drill        jsonb,                         -- { "type": "module"|"persona", "id": "...", "label": "..." }
  status       text not null default 'draft' check (status in ('draft','sent','closed','discarded')),
  signed_by    uuid references public.profiles(id) on delete set null,
  signed_name  text,                          -- shown to the rep (reps can't read other profiles)
  created_by   uuid references public.profiles(id) on delete set null,
  review_id    uuid,                          -- the coaching review it came from, if any
  group_id     uuid,                          -- set when one card went to several reps
  rep_response text check (rep_response in ('got_it','question','disagree')),
  rep_note     text,
  practiced    integer not null default 0,
  last_practiced_at timestamptz,
  sent_at      timestamptz,
  read_at      timestamptz,
  responded_at timestamptz,
  closed_at    timestamptz,
  close_note   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists training_cards_rep_idx on public.training_cards(org_id, rep_id, status, sent_at desc);

alter table public.training_cards enable row level security;

drop policy if exists training_cards_admin_all on public.training_cards;
create policy training_cards_admin_all on public.training_cards for all to authenticated
using (public.is_admin() and org_id = public.my_org_id())
with check (public.is_admin() and org_id = public.my_org_id());

-- Reps read their own cards once a manager has sent them. No write policy:
-- their only changes go through the functions below.
drop policy if exists training_cards_rep_read on public.training_cards;
create policy training_cards_rep_read on public.training_cards for select to authenticated
using (rep_id = auth.uid() and status in ('sent','closed'));

-- The rep opened it.
create or replace function public.training_card_seen(p_card uuid)
returns void language sql security definer set search_path = public as $$
  update public.training_cards set read_at = coalesce(read_at, now())
  where id = p_card and rep_id = auth.uid() and status = 'sent';
$$;

-- The rep answers: got it / question / I see it differently, with an optional note,
-- and can rewrite the when-then plan in their own words.
create or replace function public.training_card_respond(p_card uuid, p_response text, p_note text, p_plan text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_response is not null and p_response not in ('got_it','question','disagree') then
    raise exception 'Unknown response';
  end if;
  update public.training_cards
     set rep_response = coalesce(p_response, rep_response),
         rep_note = case when p_note is null then rep_note else left(p_note, 2000) end,
         rep_plan = case when p_plan is null then rep_plan else left(p_plan, 600) end,
         responded_at = case when p_response is null then responded_at else now() end,
         read_at = coalesce(read_at, now()),
         updated_at = now()
   where id = p_card and rep_id = auth.uid() and status = 'sent';
  if not found then raise exception 'Card not found'; end if;
end $$;

-- The rep did the drill.
create or replace function public.training_card_practiced(p_card uuid)
returns void language sql security definer set search_path = public as $$
  update public.training_cards
     set practiced = practiced + 1, last_practiced_at = now(), read_at = coalesce(read_at, now())
   where id = p_card and rep_id = auth.uid() and status = 'sent';
$$;

grant execute on function public.training_card_seen(uuid) to authenticated;
grant execute on function public.training_card_respond(uuid, text, text, text) to authenticated;
grant execute on function public.training_card_practiced(uuid) to authenticated;

select 'training cards ready' as result;
