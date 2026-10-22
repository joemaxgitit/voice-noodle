-- A manager can pin a call as a rep's best call (one regular, one Renew).
alter table public.calls add column if not exists best_pin boolean not null default false;
notify pgrst, 'reload schema';
